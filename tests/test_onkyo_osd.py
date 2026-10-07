"""Onkyo OSD eISCP helpers — no AVR I/O."""
from __future__ import annotations

import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pwa"))
import onkyo_osd  # noqa: E402


class OnkyoOsdTest(unittest.TestCase):
    def test_aliases(self):
        self.assertEqual(onkyo_osd.resolve("setup"), "OSDMENU")
        self.assertEqual(onkyo_osd.resolve("SETUP"), "OSDMENU")
        self.assertEqual(onkyo_osd.resolve("enter"), "OSDENTER")
        self.assertEqual(onkyo_osd.resolve("quick"), "OSDQUICK")
        self.assertEqual(onkyo_osd.resolve("home"), "OSDHOME")
        self.assertEqual(onkyo_osd.resolve("exit"), "OSDEXIT")
        self.assertEqual(onkyo_osd.resolve("up"), "OSDUP")

    def test_rejects_unknown_and_raw_iscp(self):
        with self.assertRaises(ValueError):
            onkyo_osd.resolve("OSDUP")
        with self.assertRaises(ValueError):
            onkyo_osd.resolve("PWR01")
        with self.assertRaises(ValueError):
            onkyo_osd.resolve("")

    def test_packet_framing(self):
        data = b"!1OSDUP\r"
        pkt = onkyo_osd.packet("OSDUP")
        header = struct.pack(">4sIIBxxx", b"ISCP", 16, len(data), 1)
        self.assertEqual(pkt, header + data)
        self.assertEqual(pkt[:4], b"ISCP")
        self.assertEqual(int.from_bytes(pkt[4:8], "big"), 16)
        self.assertEqual(int.from_bytes(pkt[8:12], "big"), len(data))


if __name__ == "__main__":
    unittest.main()
