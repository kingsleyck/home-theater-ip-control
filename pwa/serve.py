"""Serve the theater PWA and inject the HA token from local.json."""
from __future__ import annotations

import json
import re
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import parse_qs, quote, unquote, urlparse
from urllib.request import Request, urlopen

import onkyo_osd

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
LOCAL_FILE = REPO / "local.json"
PORT_DEFAULT = 8765
ICON_DIR = REPO / "app-icon-cache"
ICON_TTL = 7 * 24 * 3600
LOOKUP_GAP = 3.0
LOOKUP_BACKOFF = 60.0
BUNDLE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.-]{0,200}$")
_icon_lock = threading.Lock()
_icon_next = 0.0
_icon_pause_until = 0.0


def load_local() -> dict:
    if not LOCAL_FILE.exists():
        return {}
    return json.loads(LOCAL_FILE.read_text(encoding="utf-8"))


LOCAL = load_local()
HA_URL = str(LOCAL.get("haUrl") or "").rstrip("/")
TOKEN = str(LOCAL.get("token") or "").strip()
LISTEN = str(LOCAL.get("listen") or "0.0.0.0")
PORT = int(LOCAL.get("port") or PORT_DEFAULT)
PUBLIC_URL = str(LOCAL.get("publicUrl") or "").rstrip("/")


def bundle_id_ok(value: str) -> bool:
    return bool(BUNDLE_ID.fullmatch(value or ""))


def artwork_host_ok(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return host == "mzstatic.com" or host.endswith(".mzstatic.com")


def _icon_meta(bundle: str) -> dict | None:
    meta = ICON_DIR / (bundle + ".json")
    if not meta.is_file():
        return None
    try:
        info = json.loads(meta.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if time.time() - float(info.get("at") or 0) > ICON_TTL:
        return None
    return info


def _store_icon(bundle: str, info: dict, body: bytes | None = None) -> None:
    ICON_DIR.mkdir(exist_ok=True)
    if body is not None:
        (ICON_DIR / (bundle + ".bin")).write_bytes(body)
    (ICON_DIR / (bundle + ".json")).write_text(json.dumps(info), encoding="utf-8")


def _lookup_artwork(bundle: str):
    """Return ('hit', bytes, ctype), ('miss', None, None), or ('backoff', None, None)."""
    lookup = "https://itunes.apple.com/lookup?bundleId=%s&country=us" % quote(bundle)
    req = Request(lookup, headers={"User-Agent": "home-theater-ip-control"})
    try:
        with urlopen(req, timeout=15) as resp:
            if resp.status in (403, 429):
                return "backoff", None, None
            payload = json.loads(resp.read().decode("utf-8", "replace"))
    except HTTPError as exc:
        if exc.code in (403, 429):
            return "backoff", None, None
        return "miss", None, None
    except (OSError, ValueError):
        return "miss", None, None
    results = payload.get("results") or []
    if not results:
        return "miss", None, None
    art = str(results[0].get("artworkUrl512") or "")
    if not artwork_host_ok(art):
        return "miss", None, None
    art_req = Request(art, headers={"User-Agent": "home-theater-ip-control"})
    try:
        with urlopen(art_req, timeout=15) as resp:
            if resp.status in (403, 429):
                return "backoff", None, None
            ctype = resp.headers.get("Content-Type") or "image/jpeg"
            if not ctype.startswith("image/"):
                return "miss", None, None
            return "hit", resp.read(), ctype.split(";")[0]
    except HTTPError as exc:
        if exc.code in (403, 429):
            return "backoff", None, None
        return "miss", None, None
    except OSError:
        return "miss", None, None


def fetch_app_icon(bundle: str):
    """Cached App Store icon. Uncached lookups are serialized and spaced."""
    global _icon_next, _icon_pause_until
    if not bundle_id_ok(bundle):
        return "bad", None, None
    cached = _icon_meta(bundle)
    if cached and cached.get("miss"):
        return "miss", None, None
    if cached and not cached.get("miss"):
        path = ICON_DIR / (bundle + ".bin")
        if path.is_file():
            return "hit", path.read_bytes(), cached.get("type") or "image/jpeg"
    with _icon_lock:
        cached = _icon_meta(bundle)
        if cached and cached.get("miss"):
            return "miss", None, None
        if cached and not cached.get("miss"):
            path = ICON_DIR / (bundle + ".bin")
            if path.is_file():
                return "hit", path.read_bytes(), cached.get("type") or "image/jpeg"
        now = time.time()
        if now < _icon_pause_until:
            return "backoff", None, None
        wait = _icon_next - now
        if wait > 0:
            time.sleep(wait)
        status, body, ctype = _lookup_artwork(bundle)
        _icon_next = time.time() + LOOKUP_GAP
        if status == "backoff":
            _icon_pause_until = time.time() + LOOKUP_BACKOFF
            return "backoff", None, None
        if status == "hit" and body:
            _store_icon(bundle, {"at": time.time(), "miss": False, "type": ctype}, body)
            return "hit", body, ctype
        _store_icon(bundle, {"at": time.time(), "miss": True})
        return "miss", None, None


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        out = __import__("sys").stdout
        if out is None:
            return
        out.write("%s - %s\n" % (self.address_string(), fmt % args))
        out.flush()

    def end_headers(self) -> None:
        path = self.path.split("?", 1)[0]
        if path in ("/", "/index.html") or path.endswith((".js", ".css", ".webmanifest", ".json")):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self) -> None:
        if self._onkyo_osd():
            return
        self.send_error(404)

    def _onkyo_osd(self) -> bool:
        path = self.path.split("?", 1)[0]
        if path not in ("/onkyo-osd", "/onkyo-osd/"):
            return False
        qs = parse_qs(urlparse(self.path).query)
        cmd = (qs.get("cmd") or [""])[0]
        try:
            sent = onkyo_osd.send(cmd)
        except ValueError:
            self.send_error(400)
            return True
        except OSError:
            self.send_error(502)
            return True
        body = json.dumps({"ok": True, "cmd": sent}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        super().end_headers()
        self.wfile.write(body)
        return True

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if self._onkyo_osd():
            return
        if path in ("/auth.json", "/auth.json/", "/config.local.js", "/config.local.js/"):
            token = TOKEN
            ha_url = HA_URL
            if path.startswith("/config.local.js"):
                body = (
                    "window.THEATER_CONFIG.haUrl = %s;\n"
                    "window.THEATER_CONFIG.token = %s;\n"
                    % (json.dumps(ha_url), json.dumps(token))
                ).encode("utf-8")
                ctype = "application/javascript; charset=utf-8"
            else:
                payload = {"haUrl": ha_url, "token": token}
                if PUBLIC_URL:
                    payload["publicUrl"] = PUBLIC_URL
                body = json.dumps(payload).encode("utf-8")
                ctype = "application/json; charset=utf-8"
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            super().end_headers()
            self.wfile.write(body)
            return
        if path in ("/app-icon", "/app-icon/"):
            self._app_icon()
            return
        if path in ("/media-art", "/media-art/"):
            qs = parse_qs(urlparse(self.path).query)
            src = unquote((qs.get("src") or [""])[0])
            if not src.startswith("/api/") or ".." in src or src.startswith("//"):
                self.send_error(400)
                return
            req = Request(
                HA_URL.rstrip("/") + src,
                headers={"Authorization": "Bearer " + TOKEN},
            )
            try:
                with urlopen(req, timeout=15) as resp:
                    data = resp.read()
                    ctype = resp.headers.get("Content-Type") or "image/jpeg"
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Cache-Control", "max-age=60")
                self.send_header("Content-Length", str(len(data)))
                super().end_headers()
                self.wfile.write(data)
            except Exception:
                self.send_error(502)
            return
        if path.startswith("/app-icon-cache"):
            self.send_error(404)
            return
        if path in ("/qr.svg", "/qr.svg/"):
            try:
                import segno
            except ImportError:
                self.send_error(501)
                return
            target = PUBLIC_URL or ("http://127.0.0.1:%s/" % PORT)
            import io
            buf = io.BytesIO()
            segno.make(target, error="h").save(buf, kind="svg", scale=16, border=4)
            body = buf.getvalue()
            self.send_response(200)
            self.send_header("Content-Type", "image/svg+xml")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            super().end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def _app_icon(self) -> None:
        qs = parse_qs(urlparse(self.path).query)
        bundle = (qs.get("id") or [""])[0]
        status, body, ctype = fetch_app_icon(bundle)
        if status == "bad":
            self.send_error(400)
            return
        if status == "backoff":
            self.send_response(503)
            self.send_header("Cache-Control", "max-age=15")
            self.send_header("Retry-After", "60")
            self.send_header("Content-Length", "0")
            super().end_headers()
            return
        if status != "hit" or not body:
            self.send_response(404)
            self.send_header("Cache-Control", "public, max-age=86400")
            self.send_header("Content-Length", "0")
            super().end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype or "image/jpeg")
        self.send_header("Cache-Control", "public, max-age=604800")
        self.send_header("Content-Length", str(len(body)))
        super().end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    if not LOCAL_FILE.exists():
        raise SystemExit("Missing %s — copy local.example.json to local.json" % LOCAL_FILE)
    if not TOKEN or not HA_URL:
        raise SystemExit("local.json must set haUrl and token")
    try:
        httpd = ThreadingHTTPServer((LISTEN, PORT), Handler)
    except OSError as exc:
        if getattr(exc, "winerror", None) == 10048 or getattr(exc, "errno", None) == 98:
            raise SystemExit(0)
        raise
    shown = PUBLIC_URL or ("http://127.0.0.1:%s" % PORT)
    print("Theater UI: %s" % shown, flush=True)
    httpd.serve_forever()
