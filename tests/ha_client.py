"""Shared HA REST helper. Token and URL stay in gitignored local.json."""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCAL_FILE = ROOT / "local.json"
if not LOCAL_FILE.exists():
    raise SystemExit("Missing %s — copy local.example.json to local.json" % LOCAL_FILE)
LOCAL = json.loads(LOCAL_FILE.read_text(encoding="utf-8"))
TOKEN = str(LOCAL.get("token") or "").strip()
HA = str(LOCAL.get("haUrl") or "").rstrip("/")


def ha(path: str, method: str = "GET", data=None, timeout: int = 30):
    body = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(
        HA + path,
        data=body,
        method=method,
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:4000]
