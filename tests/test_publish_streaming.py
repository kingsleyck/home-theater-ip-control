"""Offline graph checks for the optional Watch Streaming publisher.

Building a script graph must not call Home Assistant.
"""
from __future__ import annotations

import importlib.util
import json
import runpy
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLISHER = ROOT / "examples" / "jvc-lumagen-onkyo" / "publish_activity_scripts.py"


def load_publisher():
    name = "jvc_publish_activity_scripts"
    sys.modules.pop(name, None)
    spec = importlib.util.spec_from_file_location(name, PUBLISHER)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def commands(node):
    found = []
    if isinstance(node, dict):
        data = node.get("data")
        if isinstance(data, dict) and "command" in data:
            found.append(data["command"])
        for value in node.values():
            found.extend(commands(value))
    elif isinstance(node, list):
        for item in node:
            found.extend(commands(item))
    return found


def entity_ids(node):
    found = []
    if isinstance(node, dict):
        target = node.get("target")
        if isinstance(target, dict) and "entity_id" in target:
            found.append(target["entity_id"])
        for value in node.values():
            found.extend(entity_ids(value))
    elif isinstance(node, list):
        for item in node:
            found.extend(entity_ids(item))
    return found


class _Ha:
    def __init__(self):
        self.calls = []
        self.result = (200, {"ok": True})

    def ha(self, path, method="GET", data=None, timeout=30):
        self.calls.append((path, method, data, timeout))
        return self.result


class PublishStreamingTest(unittest.TestCase):
    def setUp(self):
        self.ha = _Ha()
        sys.modules["ha_client"] = self.ha
        self.pub = load_publisher()

    def base_profile(self):
        return {
            "gameSource": "GAME",
            "xboxMac": "00:11:22:33:44:55",
            "wolButton": "button.wol",
            "broadcastAddress": "255.255.255.255",
        }

    def stream_profile(self, **overrides):
        profile = self.base_profile()
        profile.update({
            "streamInput": "Xbox (1)",
            "streamLogical": "1",
            "appletv": "media_player.apple_tv",
            "appletvRemote": "remote.apple_tv",
        })
        profile.update(overrides)
        return profile

    def ids(self, profile):
        return [sid for sid, _cfg in self.pub.published_scripts(profile)]

    def by_id(self, profile):
        return dict(self.pub.published_scripts(profile))

    def test_without_stream_keys_omits_streaming_and_suspend(self):
        scripts = self.by_id(self.base_profile())
        self.assertEqual(list(scripts), ["play_xbox", "watch_bluray", "theater_shutdown", "theater_resync"])
        blob = json.dumps(scripts)
        self.assertNotIn("suspend", blob)
        self.assertNotIn("wakeup", blob)
        self.assertNotIn("media_player.apple_tv", blob)
        self.assertNotIn("unavailable until", blob)
        xbox = scripts["play_xbox"]
        self.assertEqual(xbox["mode"], "restart")
        xbox_blob = json.dumps(xbox)
        self.assertIn("Xbox (2)", xbox_blob)
        self.assertNotIn("Xbox (1)", xbox_blob)
        self.assertIn('"2"', xbox_blob)
        self.assertIn("WakeUp", commands(xbox))
        self.assertEqual(
            self.pub.activity_options(scripts),
            ["Idle", "Watch Blu-Ray", "Play Xbox"],
        )
        resync = scripts["theater_resync"]
        self.assertEqual(resync["alias"], "Theater Resync")
        self.assertNotIn("script.watch_streaming", entity_ids(resync))
        self.assertEqual(
            [step["conditions"][0]["state"] for step in resync["sequence"][0]["choose"]],
            ["Watch Blu-Ray", "Play Xbox"],
        )
        self.assertIn("Watch Blu-Ray or Play Xbox", json.dumps(resync))
        self.assertNotIn("Watch Streaming", json.dumps(resync))
        self.assertEqual(self.ha.calls, [])

    def test_with_stream_keys_wakes_and_suspends_elsewhere(self):
        scripts = self.by_id(self.stream_profile())
        self.assertEqual(
            list(scripts),
            ["play_xbox", "watch_bluray", "watch_streaming", "theater_shutdown", "theater_resync"],
        )
        streaming = scripts["watch_streaming"]
        self.assertEqual(streaming["alias"], "Watch Streaming")
        self.assertEqual(streaming["mode"], "restart")
        self.assertIn("wakeup", commands(streaming))
        self.assertNotIn("suspend", commands(streaming))
        self.assertNotIn("play_media", json.dumps(streaming))
        self.assertIn("remote.apple_tv", entity_ids(streaming))
        self.assertIn("media_player.apple_tv", json.dumps(streaming))
        for sid in ("play_xbox", "watch_bluray", "theater_shutdown"):
            self.assertIn("suspend", commands(scripts[sid]))
            self.assertIn("remote.apple_tv", entity_ids(scripts[sid]))
        self.assertIn("WakeUp", commands(scripts["play_xbox"]))
        self.assertNotIn("unavailable until", json.dumps(scripts["play_xbox"]))
        self.assertEqual(
            self.pub.activity_options(scripts),
            ["Idle", "Watch Blu-Ray", "Play Xbox", "Watch Streaming"],
        )
        resync = scripts["theater_resync"]
        self.assertEqual(
            [step["conditions"][0]["state"] for step in resync["sequence"][0]["choose"]],
            ["Watch Blu-Ray", "Watch Streaming", "Play Xbox"],
        )
        self.assertEqual(
            [step["sequence"][0]["target"]["entity_id"] for step in resync["sequence"][0]["choose"]],
            ["script.watch_bluray", "script.watch_streaming", "script.play_xbox"],
        )
        self.assertIn("Watch Blu-Ray, Watch Streaming, or Play Xbox", json.dumps(resync))
        self.assertEqual(self.ha.calls, [])

    def test_stream_route_comes_from_the_profile(self):
        scripts = self.by_id(self.stream_profile(streamInput="Apple TV (4)", streamLogical="4"))
        streaming = json.dumps(scripts["watch_streaming"])
        self.assertIn("Apple TV (4)", streaming)
        self.assertIn("Apple TV (4)/MEMA", streaming)
        xbox = json.dumps(scripts["play_xbox"])
        self.assertIn("Xbox (2)", xbox)
        self.assertNotIn("Xbox (1)", xbox)
        self.assertNotIn("Apple TV (4)", xbox)
        self.assertNotIn("unavailable until", xbox)

    def test_blank_or_missing_stream_field_omits_the_script(self):
        for key in ("streamInput", "streamLogical", "appletv", "appletvRemote"):
            missing = self.stream_profile()
            del missing[key]
            self.assertNotIn("watch_streaming", self.ids(missing))
            blank = self.stream_profile(**{key: "  "})
            self.assertIsNone(self.pub.stream_profile(blank))
            self.assertNotIn("watch_streaming", self.ids(blank))
            self.assertNotIn("suspend", json.dumps(self.by_id(blank)))
        self.assertIsNone(self.pub.stream_profile({}))
        self.assertEqual(self.ha.calls, [])

    def test_disk_profile_publishes_streaming_without_calling_ha(self):
        scripts = dict(self.pub.published_scripts())
        self.assertIn("watch_streaming", scripts)
        self.assertEqual(scripts["watch_streaming"]["sequence"][1]["data"]["option"], "Watch Streaming")
        seen = []
        self.pub.put_script = lambda sid, cfg: seen.append(sid)
        self.assertEqual(self.pub.main(), 0)
        self.assertEqual(
            seen,
            ["play_xbox", "watch_bluray", "watch_streaming", "theater_shutdown", "theater_resync"],
        )
        path, method, data, timeout = self.ha.calls[0]
        self.assertTrue(path.endswith("/input_select/set_options"))
        self.assertEqual(method, "POST")
        self.assertEqual(data["entity_id"], "input_select.theater_activity")
        self.assertEqual(data["options"], ["Idle", "Watch Blu-Ray", "Play Xbox", "Watch Streaming"])
        self.assertEqual(timeout, 30)
        self.assertEqual(len(self.ha.calls), 1)

    def test_put_script_posts_and_rejects_failures(self):
        self.pub.put_script("watch_streaming", {"alias": "Watch Streaming"})
        path, method, data, timeout = self.ha.calls[-1]
        self.assertTrue(path.endswith("/watch_streaming"))
        self.assertEqual(method, "POST")
        self.assertEqual(data["alias"], "Watch Streaming")
        self.assertEqual(timeout, 60)
        self.ha.result = (201, "created")
        self.pub.put_script("watch_bluray", {"alias": "Watch Blu-Ray"})
        self.ha.result = (200, None)
        self.pub.put_script("theater_shutdown", {"alias": "Theater Shutdown"})
        self.ha.result = (500, {"err": True})
        with self.assertRaises(SystemExit) as raised:
            self.pub.put_script("play_xbox", {"alias": "Play Xbox"})
        self.assertIn("play_xbox", str(raised.exception))
        self.ha.result = (200, {"ok": True})
        self.pub.ensure_activity_options(["Idle", "Watch Blu-Ray", "Play Xbox"])
        path, method, data, timeout = self.ha.calls[-1]
        self.assertTrue(path.endswith("/input_select/set_options"))
        self.assertEqual(method, "POST")
        self.assertEqual(data["options"], ["Idle", "Watch Blu-Ray", "Play Xbox"])
        self.assertEqual(timeout, 30)
        self.ha.result = (201, None)
        self.pub.ensure_activity_options(["Idle"])
        self.ha.result = (500, {"err": True})
        with self.assertRaises(SystemExit) as options_failed:
            self.pub.ensure_activity_options(["Idle"])
        self.assertIn("theater activity options", str(options_failed.exception))

    def test_module_entry_publishes_through_the_client(self):
        with self.assertRaises(SystemExit) as raised:
            runpy.run_path(str(PUBLISHER), run_name="__main__")
        self.assertEqual(raised.exception.code, 0)
        posted = [path.rsplit("/", 1)[-1] for path, _method, _data, _timeout in self.ha.calls]
        self.assertEqual(
            posted,
            ["set_options", "play_xbox", "watch_bluray", "watch_streaming", "theater_shutdown", "theater_resync"],
        )


if __name__ == "__main__":
    unittest.main()
