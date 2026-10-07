"""One-shot Onkyo OSD (Setup menu) over eISCP.

Home Assistant's Onkyo integration has no OSD/Setup service. The PWA host can
send a single framed command and close immediately so HA can keep the persistent
eISCP session. A second client can still drop HA; Resync reloads the config entry.

Host/port come from local.json (osdHost, osdPort). If osdHost is empty, send()
raises ValueError.
"""
from __future__ import annotations

import json
import socket
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCAL_FILE = ROOT / "local.json"

COMMANDS = {
    "setup": "OSDMENU",
    "menu": "OSDMENU",
    "quick": "OSDQUICK",
    "home": "OSDHOME",
    "up": "OSDUP",
    "down": "OSDDOWN",
    "left": "OSDLEFT",
    "right": "OSDRIGHT",
    "enter": "OSDENTER",
    "exit": "OSDEXIT",
}


def load_local() -> dict:
    if not LOCAL_FILE.exists():
        return {}
    return json.loads(LOCAL_FILE.read_text(encoding="utf-8"))


def resolve(alias: str) -> str:
    cmd = COMMANDS.get((alias or "").strip().lower())
    if not cmd:
        raise ValueError("unknown osd command")
    return cmd


def packet(iscp_cmd: str) -> bytes:
    data = b"!1" + iscp_cmd.encode("ascii") + b"\r"
    header = struct.pack(">4sIIBxxx", b"ISCP", 16, len(data), 1)
    return header + data


def send(alias: str, host: str | None = None, port: int | None = None, timeout: float = 2.0) -> str:
    cfg = load_local()
    host = host if host is not None else str(cfg.get("osdHost") or "").strip()
    port = port if port is not None else int(cfg.get("osdPort") or 60128)
    if not host:
        raise ValueError("osdHost is not set in local.json")
    cmd = resolve(alias)
    with socket.create_connection((host, port), timeout=timeout) as sock:
        sock.sendall(packet(cmd))
    return cmd
