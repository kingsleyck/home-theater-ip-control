"""App Store icon proxy — bundle ids, mzstatic hosts, cache, and backoff. No network."""
from __future__ import annotations

import io
import json
import sys
import threading
import unittest
import urllib.error
from http.client import HTTPConnection
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pwa"))
import serve  # noqa: E402


class Resp:
    def __init__(self, status=200, body=b"{}", headers=None):
        self.status = status
        self._body = body
        self.headers = headers or {"Content-Type": "application/json"}

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def http_error(code, body=b""):
    return urllib.error.HTTPError("http://x", code, "no", {}, io.BytesIO(body))


def request(port, method, path):
    conn = HTTPConnection("127.0.0.1", port, timeout=5)
    conn.request(method, path)
    resp = conn.getresponse()
    body = resp.read()
    status = resp.status
    headers = dict(resp.getheaders())
    conn.close()
    return status, headers, body


class AppIconTest(unittest.TestCase):
    def setUp(self):
        self._icon_dir = serve.ICON_DIR
        self._next = serve._icon_next
        self._pause = serve._icon_pause_until
        self.tmp = TemporaryDirectory()
        serve.ICON_DIR = Path(self.tmp.name)
        serve._icon_next = 0.0
        serve._icon_pause_until = 0.0

    def tearDown(self):
        serve.ICON_DIR = self._icon_dir
        serve._icon_next = self._next
        serve._icon_pause_until = self._pause
        self.tmp.cleanup()

    def test_bundle_id_charset(self):
        self.assertTrue(serve.bundle_id_ok("com.netflix.Netflix"))
        self.assertTrue(serve.bundle_id_ok("com.apple.TVSettings"))
        self.assertFalse(serve.bundle_id_ok(""))
        self.assertFalse(serve.bundle_id_ok("../secrets"))
        self.assertFalse(serve.bundle_id_ok("com.netflix.Netflix/../../etc"))
        self.assertFalse(serve.bundle_id_ok("https://evil.example/icon.png"))

    def test_artwork_host(self):
        self.assertTrue(serve.artwork_host_ok("https://is1-ssl.mzstatic.com/image/thumb/foo/512x512bb.jpg"))
        self.assertTrue(serve.artwork_host_ok("https://mzstatic.com/image/thumb/foo.jpg"))
        self.assertFalse(serve.artwork_host_ok("https://evil.example/icon.png"))
        self.assertFalse(serve.artwork_host_ok("https://mzstatic.com.evil.example/icon.png"))
        self.assertFalse(serve.artwork_host_ok(""))

    def test_icon_meta_and_store(self):
        self.assertIsNone(serve._icon_meta("com.example"))
        meta = serve.ICON_DIR / "com.example.json"
        meta.write_text("{", encoding="utf-8")
        self.assertIsNone(serve._icon_meta("com.example"))
        meta.write_text(json.dumps({"at": 1, "miss": False}), encoding="utf-8")
        self.assertIsNone(serve._icon_meta("com.example"))
        meta.write_text(json.dumps({"at": serve.time.time(), "miss": True}), encoding="utf-8")
        self.assertTrue(serve._icon_meta("com.example")["miss"])
        meta.write_text("not-json", encoding="utf-8")
        with patch.object(Path, "read_text", side_effect=OSError("no")):
            self.assertIsNone(serve._icon_meta("com.example"))
        serve._store_icon("com.example", {"at": 1, "miss": True})
        self.assertTrue((serve.ICON_DIR / "com.example.json").is_file())
        serve._store_icon("com.example", {"at": 1, "miss": False, "type": "image/png"}, b"png")
        self.assertEqual((serve.ICON_DIR / "com.example.bin").read_bytes(), b"png")

    def test_lookup_artwork(self):
        responses = []

        def urlopen(req, timeout=0):
            item = responses.pop(0)
            if isinstance(item, Exception):
                raise item
            return item

        with patch.object(serve, "urlopen", urlopen):
            responses.append(Resp(403, b""))
            self.assertEqual(serve._lookup_artwork("com.a")[0], "backoff")
            responses.append(http_error(429, b""))
            self.assertEqual(serve._lookup_artwork("com.a")[0], "backoff")
            responses.append(http_error(404, b"missing"))
            self.assertEqual(serve._lookup_artwork("com.a")[0], "miss")
            responses.append(Resp(200, b"not-json"))
            self.assertEqual(serve._lookup_artwork("com.a")[0], "miss")

        with patch.object(serve, "urlopen", side_effect=OSError("down")):
            self.assertEqual(serve._lookup_artwork("com.a")[0], "miss")

        art = "https://is1-ssl.mzstatic.com/image/thumb/a/512x512bb.jpg"
        with patch.object(serve, "urlopen", urlopen):
            responses.append(Resp(200, json.dumps({"results": []}).encode()))
            self.assertEqual(serve._lookup_artwork("com.a")[0], "miss")
            responses.append(Resp(200, json.dumps({"results": [{"artworkUrl512": "https://evil.example/a.jpg"}]}).encode()))
            self.assertEqual(serve._lookup_artwork("com.a")[0], "miss")
            responses.append(Resp(200, json.dumps({"results": [{"artworkUrl512": art}]}).encode()))
            responses.append(Resp(429, b""))
            self.assertEqual(serve._lookup_artwork("com.a")[0], "backoff")
            responses.append(Resp(200, json.dumps({"results": [{"artworkUrl512": art}]}).encode()))
            responses.append(http_error(403, b""))
            self.assertEqual(serve._lookup_artwork("com.a")[0], "backoff")
            responses.append(Resp(200, json.dumps({"results": [{"artworkUrl512": art}]}).encode()))
            responses.append(http_error(500, b"x"))
            self.assertEqual(serve._lookup_artwork("com.a")[0], "miss")
            responses.append(Resp(200, json.dumps({"results": [{"artworkUrl512": art}]}).encode()))
            responses.append(Resp(200, b"gif89", {"Content-Type": "text/plain"}))
            self.assertEqual(serve._lookup_artwork("com.a")[0], "miss")

        state = {"n": 0}

        def art_down(req, timeout=0):
            state["n"] += 1
            if state["n"] == 1:
                return Resp(200, json.dumps({"results": [{"artworkUrl512": art}]}).encode())
            raise OSError("art")

        with patch.object(serve, "urlopen", art_down):
            self.assertEqual(serve._lookup_artwork("com.a")[0], "miss")

        def hit(req, timeout=0):
            if "itunes" in req.full_url:
                return Resp(200, json.dumps({"results": [{"artworkUrl512": art}]}).encode())
            return Resp(200, b"img", {"Content-Type": "image/jpeg; charset=binary"})

        with patch.object(serve, "urlopen", hit):
            status, body, ctype = serve._lookup_artwork("com.a")
        self.assertEqual((status, body, ctype), ("hit", b"img", "image/jpeg"))

    def test_fetch_app_icon(self):
        with patch.object(serve.time, "sleep", lambda n: None):
            self.assertEqual(serve.fetch_app_icon("../x")[0], "bad")

            serve._store_icon("com.miss", {"at": serve.time.time(), "miss": True})
            self.assertEqual(serve.fetch_app_icon("com.miss")[0], "miss")

            serve._store_icon("com.hit", {"at": serve.time.time(), "miss": False, "type": "image/png"}, b"png")
            self.assertEqual(serve.fetch_app_icon("com.hit"), ("hit", b"png", "image/png"))

            serve._store_icon("com.plain", {"at": serve.time.time(), "miss": False}, b"jpg")
            self.assertEqual(serve.fetch_app_icon("com.plain")[2], "image/jpeg")

            serve._store_icon("com.stale", {"at": serve.time.time(), "miss": False, "type": "image/png"}, b"old")
            (serve.ICON_DIR / "com.stale.bin").unlink()
            with patch.object(serve, "_lookup_artwork", lambda bundle: ("hit", b"new", "image/gif")):
                self.assertEqual(serve.fetch_app_icon("com.stale"), ("hit", b"new", "image/gif"))

            state = {"n": 0}

            def meta(bundle):
                state["n"] += 1
                if state["n"] == 1:
                    return None
                return {"at": serve.time.time(), "miss": True}

            with patch.object(serve, "_icon_meta", meta):
                self.assertEqual(serve.fetch_app_icon("com.lockmiss")[0], "miss")

            def meta_hit(bundle):
                state["n"] += 1
                if state["n"] < 3:
                    return None
                return {"at": serve.time.time(), "miss": False, "type": "image/png"}

            (serve.ICON_DIR / "com.lockhit.bin").write_bytes(b"cached")
            with patch.object(serve, "_icon_meta", meta_hit):
                self.assertEqual(serve.fetch_app_icon("com.lockhit")[0], "hit")
            state["n"] = 0

            def meta_nobin(bundle):
                state["n"] += 1
                if state["n"] == 1:
                    return None
                return {"at": serve.time.time(), "miss": False, "type": ""}

            serve._icon_pause_until = 0.0
            serve._icon_next = 0.0
            with patch.object(serve, "_icon_meta", meta_nobin), patch.object(
                serve, "_lookup_artwork", lambda bundle: ("miss", None, None)
            ):
                self.assertEqual(serve.fetch_app_icon("com.nobin")[0], "miss")
            state["n"] = 0
            (serve.ICON_DIR / "com.lockbin.bin").write_bytes(b"in")

            def meta_inside(bundle):
                state["n"] += 1
                if state["n"] == 1:
                    return None
                return {"at": serve.time.time(), "miss": False, "type": "image/png"}

            with patch.object(serve, "_icon_meta", meta_inside):
                self.assertEqual(serve.fetch_app_icon("com.lockbin"), ("hit", b"in", "image/png"))

            serve._icon_pause_until = serve.time.time() + 30
            with patch.object(serve, "_icon_meta", lambda bundle: None):
                self.assertEqual(serve.fetch_app_icon("com.pause")[0], "backoff")

            slept = {}
            serve._icon_pause_until = 0.0
            serve._icon_next = serve.time.time() + 5
            with patch.object(serve.time, "sleep", lambda n: slept.setdefault("n", n)), patch.object(
                serve, "_lookup_artwork", lambda bundle: ("backoff", None, None)
            ), patch.object(serve, "_icon_meta", lambda bundle: None):
                self.assertEqual(serve.fetch_app_icon("com.wait")[0], "backoff")
            self.assertGreater(slept["n"], 0)

            serve._icon_next = 0.0
            serve._icon_pause_until = 0.0
            with patch.object(serve, "_lookup_artwork", lambda bundle: ("hit", b"", "image/jpeg")), patch.object(
                serve, "_icon_meta", lambda bundle: None
            ):
                self.assertEqual(serve.fetch_app_icon("com.empty")[0], "miss")
            with patch.object(serve, "_lookup_artwork", lambda bundle: ("miss", None, None)), patch.object(
                serve, "_icon_meta", lambda bundle: None
            ):
                self.assertEqual(serve.fetch_app_icon("com.lookupmiss")[0], "miss")

    def test_handler_routes(self):
        icons = {
            "../x": ("bad", None, None),
            "com.back": ("backoff", None, None),
            "com.miss": ("miss", None, None),
            "com.empty": ("hit", b"", None),
            "com.ok": ("hit", b"img", "image/png"),
            "com.raw": ("hit", b"jpg", None),
        }

        def fetch(bundle):
            return icons.get(bundle, ("bad", None, None))

        httpd = serve.ThreadingHTTPServer(("127.0.0.1", 0), serve.Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        port = httpd.server_address[1]
        try:
            with patch.object(serve, "fetch_app_icon", fetch):
                status, _, _ = request(port, "GET", "/app-icon?id=../x")
                self.assertEqual(status, 400)
                status, headers, _ = request(port, "GET", "/app-icon?id=com.back")
                self.assertEqual(status, 503)
                self.assertEqual(headers.get("Retry-After"), "60")
                status, headers, _ = request(port, "GET", "/app-icon?id=com.miss")
                self.assertEqual(status, 404)
                self.assertEqual(headers.get("Cache-Control"), "public, max-age=86400")
                status, _, _ = request(port, "GET", "/app-icon/?id=com.empty")
                self.assertEqual(status, 404)
                status, headers, body = request(port, "GET", "/app-icon?id=com.ok")
                self.assertEqual(status, 200)
                self.assertEqual(body, b"img")
                self.assertEqual(headers["Content-Type"], "image/png")
                self.assertEqual(headers["Cache-Control"], "public, max-age=604800")
                status, headers, body = request(port, "GET", "/app-icon?id=com.raw")
                self.assertEqual(status, 200)
                self.assertEqual(body, b"jpg")
                self.assertEqual(headers["Content-Type"], "image/jpeg")
                status, _, _ = request(port, "GET", "/app-icon-cache/secret")
                self.assertEqual(status, 404)
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
