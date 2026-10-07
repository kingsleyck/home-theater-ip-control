"""Publish Watch Blu-Ray / Play Xbox / Theater Shutdown / Theater Resync HA scripts.

Watch Streaming is included only when profile.json sets streamInput,
streamLogical, appletv, and appletvRemote. Those strings stay in the profile.

Power-on and activity changes are serial:
  Projector (commanded until warming/on) -> Lumagen -> Onkyo -> Blu-Ray | Xbox | Apple TV
Laser warmup continues while the HDMI chain starts.

Shutdown is the reverse:
  Blu-Ray | Xbox | Apple TV -> Onkyo -> Lumagen -> Projector

Site-specific strings live in profile.json (Xbox MAC, AVR source name, stream route).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests"))

PROFILE = json.loads((Path(__file__).parent / "profile.json").read_text(encoding="utf-8"))
GAME = PROFILE["gameSource"]
XBOX_MAC = PROFILE["xboxMac"]
WOL_BUTTON = PROFILE["wolButton"]
BROADCAST = PROFILE.get("broadcastAddress") or "255.255.255.255"
STREAM_KEYS = ("streamInput", "streamLogical", "appletv", "appletvRemote")


def stream_profile(profile):
    """Return the four stream fields, or None when any of them is blank."""
    values = {key: str(profile.get(key) or "").strip() for key in STREAM_KEYS}
    if not all(values.values()):
        return None
    return values


ONKYO_ON = "{{ states('media_player.tx_rz800') in ['on', 'playing', 'paused', 'idle'] }}"
ONKYO_NOT_ON = "{{ states('media_player.tx_rz800') not in ['on', 'playing', 'paused', 'idle'] }}"


def action(name, entity=None, data=None, alias=None, continue_on_error=False):
    step = {"action": name}
    if entity:
        step["target"] = {"entity_id": entity}
    if data:
        step["data"] = data
    if alias:
        step["alias"] = alias
    if continue_on_error:
        step["continue_on_error"] = True
    return step


def wait(template, timeout, alias, continue_on_timeout=False):
    return {
        "wait_template": template,
        "timeout": timeout,
        "continue_on_timeout": continue_on_timeout,
        "alias": alias,
    }


def delay(seconds, alias=None):
    step = {"delay": {"seconds": seconds}}
    if alias:
        step["alias"] = alias
    return step


def check_then(template_ne, then_steps):
    return {
        "repeat": {
            "count": 3,
            "sequence": [
                {
                    "if": [{"condition": "template", "value_template": template_ne}],
                    "then": then_steps,
                }
            ],
        }
    }


def retry_until(still_bad, steps, count, delay_s=5):
    return {
        "repeat": {
            "count": count,
            "sequence": [
                {
                    "if": [{"condition": "template", "value_template": still_bad}],
                    "then": steps + [delay(delay_s)],
                }
            ],
        }
    }


def if_then(template, then_steps, alias=None):
    step = {
        "if": [{"condition": "template", "value_template": template}],
        "then": then_steps,
    }
    if alias:
        step["alias"] = alias
    return step


def fail_if(template, message):
    return {
        "if": [{"condition": "template", "value_template": template}],
        "then": [
            action("persistent_notification.create", data={
                "title": "Theater activity failed",
                "message": message,
                "notification_id": "theater_activity",
            }),
            action("input_text.set_value", "input_text.theater_last_error", {"value": message}),
            {"stop": message, "error": True},
        ],
    }


def header(activity):
    return [
        {"variables": {"game_source": GAME}},
        action("input_select.select_option", "input_select.theater_activity", {"option": activity}),
        action("input_text.set_value", "input_text.theater_last_error", {"value": " "}),
    ]


def xbox_sleep_if_on():
    """SmartGlass Power/TurnOff. With Sleep mode this is Instant-On, not Shut down.

    Only send when the console is actually on. A second TurnOff in ConnectedStandby
    can drop it into a full shutdown that HA cannot wake.
    Never send Reboot.
    """
    return {
        "if": [
            {
                "condition": "template",
                "value_template": "{{ states('media_player.xbox') in ['on', 'playing', 'paused', 'idle'] }}",
            }
        ],
        "then": [
            action(
                "remote.send_command",
                "remote.xbox",
                {"command": "TurnOff"},
                alias="Xbox sleep (TurnOff)",
                continue_on_error=True,
            )
        ],
        "alias": "Xbox sleep if on",
    }


def appletv_on_template(entity):
    return "{{ states('%s') in ['on', 'playing', 'paused', 'idle'] }}" % entity


def appletv_suspend_if_on(stream):
    """Companion suspend. Not media_player power."""
    return if_then(
        appletv_on_template(stream["appletv"]),
        [
            action(
                "remote.send_command",
                stream["appletvRemote"],
                {"command": "suspend"},
                alias="Apple TV suspend",
                continue_on_error=True,
            )
        ],
        "Apple TV suspend if on",
    )


def appletv_wakeup(stream):
    return [
        action(
            "remote.send_command",
            stream["appletvRemote"],
            {"command": "wakeup"},
            alias="Apple TV wakeup",
            continue_on_error=True,
        ),
        wait(appletv_on_template(stream["appletv"]), "00:00:45", "Wait Apple TV", continue_on_timeout=True),
    ]


def xbox_wake_steps():
    return [
        action(
            "remote.send_command",
            "remote.xbox",
            {"command": "WakeUp"},
            alias="Xbox WakeUp",
            continue_on_error=True,
        ),
        action("button.press", WOL_BUTTON, alias="Xbox WoL", continue_on_error=True),
    ]


def ensure_jvc_hdmi1():
    return check_then(
        "{{ states('select.jvc_projector_input') != 'hdmi1' }}",
        [action("select.select_option", "select.jvc_projector_input", {"option": "hdmi1"}, "JVC hdmi1"), delay(2)],
    )


def ensure_jvc_on():
    return [
        wait(
            "{{ states('sensor.jvc_projector_power_state') != 'cooling' }}",
            "00:05:00",
            "Wait JVC cooling to finish",
        ),
        {
            "if": [
                {
                    "condition": "template",
                    "value_template": "{{ states('sensor.jvc_projector_power_state') not in ['on', 'warming'] }}",
                }
            ],
            "then": [
                action("remote.turn_on", "remote.jvc_projector", alias="JVC on", continue_on_error=True),
            ],
            "alias": "JVC on if needed",
        },
        wait(
            "{{ states('sensor.jvc_projector_power_state') in ['on', 'warming'] }}",
            "00:01:00",
            "Wait JVC warming or on",
        ),
        ensure_jvc_hdmi1(),
    ]


def ensure_lumagen_on():
    """Serial-to-Ethernet bridges are often a single TCP client. After standby,
    ha-lumagen can drop the session and the power switch sticks at unknown —
    turn_on is a no-op until the config entry reconnects.
    """
    return [
        retry_until(
            "{{ not is_state('switch.lumagen_radiancepro_power', 'on') }}",
            [
                {
                    "if": [
                        {
                            "condition": "template",
                            "value_template": "{{ states('switch.lumagen_radiancepro_power') in ['unavailable', 'unknown'] }}",
                        }
                    ],
                    "then": [
                        action(
                            "homeassistant.reload_config_entry",
                            "switch.lumagen_radiancepro_power",
                            alias="Reload Lumagen TCP",
                            continue_on_error=True,
                        ),
                        delay(5),
                    ],
                },
                action(
                    "switch.turn_on",
                    "switch.lumagen_radiancepro_power",
                    alias="Lumagen on",
                    continue_on_error=True,
                ),
            ],
            count=8,
            delay_s=5,
        ),
        wait(
            "{{ states('sensor.lumagen_radiancepro_logical_input') not in ['unavailable', 'unknown', 'none'] }}",
            "00:00:45",
            "Wait Lumagen I/O live",
            continue_on_timeout=True,
        ),
        delay(8, "Lumagen boot settle"),
    ]


def route_lumagen(input_name, logical):
    """Cold boot restores the last physical input. Keep selecting until both the
    select entity and logical_input sensor match. Digit+A is the remote recall.
    """
    still_bad = (
        "{{ states('select.lumagen_radiancepro_input') != '%s' "
        "or states('sensor.lumagen_radiancepro_logical_input') != '%s' }}"
        % (input_name, logical)
    )
    return [
        retry_until(
            still_bad,
            [
                action(
                    "select.select_option",
                    "select.lumagen_radiancepro_input",
                    {"option": input_name},
                    input_name,
                    continue_on_error=True,
                ),
                action(
                    "remote.send_command",
                    "remote.lumagen_radiancepro",
                    {"command": [logical, "a"]},
                    "Lumagen %sA" % logical,
                    continue_on_error=True,
                ),
            ],
            count=12,
            delay_s=4,
        ),
        retry_until(
            "{{ states('select.lumagen_radiancepro_memory') != 'MEMA' }}",
            [
                action(
                    "select.select_option",
                    "select.lumagen_radiancepro_memory",
                    {"option": "MEMA"},
                    "Lumagen MEMA",
                    continue_on_error=True,
                ),
            ],
            count=6,
            delay_s=2,
        ),
    ]


def ensure_onkyo_on():
    """eISCP drops when the receiver goes to standby. Retry PWR ON; reload the
    Onkyo entry if HA shows unavailable (lost TCP). Do not abort the activity
    if the AVR is still catching up — routing continues and fail_if still
    requires GAME + on.
    """
    return [
        retry_until(
            ONKYO_NOT_ON,
            [
                {
                    "if": [
                        {
                            "condition": "template",
                            "value_template": "{{ is_state('media_player.tx_rz800', 'unavailable') }}",
                        }
                    ],
                    "then": [
                        action(
                            "homeassistant.reload_config_entry",
                            "media_player.tx_rz800",
                            alias="Reload Onkyo eISCP",
                            continue_on_error=True,
                        ),
                        delay(4),
                    ],
                },
                action(
                    "media_player.turn_on",
                    "media_player.tx_rz800",
                    alias="Onkyo PWR ON",
                    continue_on_error=True,
                ),
            ],
            count=12,
            delay_s=5,
        ),
        wait(ONKYO_ON, "00:00:20", "Wait Onkyo on", continue_on_timeout=True),
        check_then(
            "{{ state_attr('media_player.tx_rz800', 'source') != game_source }}",
            [action("media_player.select_source", "media_player.tx_rz800", {"source": GAME}), delay(2)],
        ),
        check_then(
            "{{ state_attr('media_player.tx_rz800', 'sound_mode') != 'DIRECT' }}",
            [action("media_player.select_sound_mode", "media_player.tx_rz800", {"sound_mode": "DIRECT"}, "Onkyo DIRECT"), delay(2)],
        ),
    ]


def power_on_chain(lumagen_input, logical):
    """Projector -> Lumagen -> Onkyo. Sources are appended by the activity."""
    return (
        [
            wait(
                "{{ is_state('script.theater_shutdown', 'off') }}",
                "00:05:00",
                "Wait shutdown to finish",
                continue_on_timeout=True,
            ),
        ]
        + ensure_jvc_on()
        + ensure_lumagen_on()
        + route_lumagen(lumagen_input, logical)
        + ensure_onkyo_on()
    )


def source_bluray(stream=None):
    steps = []
    if stream:
        steps.append(appletv_suspend_if_on(stream))
    return steps + [
        xbox_sleep_if_on(),
        if_then(
            "{{ is_state('media_player.panasonic_bluray', 'off') or is_state('media_player.panasonic_bluray', 'unavailable') or is_state('media_player.panasonic_bluray', 'unknown') }}",
            [
                action(
                    "media_player.turn_on",
                    "media_player.panasonic_bluray",
                    alias="Disc on",
                    continue_on_error=True,
                ),
            ],
            "Disc on if off",
        ),
        wait(
            "{{ not is_state('media_player.panasonic_bluray', 'off') and not is_state('media_player.panasonic_bluray', 'unavailable') and not is_state('media_player.panasonic_bluray', 'unknown') }}",
            "00:02:00",
            "Wait disc player",
            continue_on_timeout=True,
        ),
    ]


def source_streaming(stream):
    """Disc off, Xbox sleep, then wake the Apple TV. Do not launch an app."""
    return [
        if_then(
            "{{ states('media_player.panasonic_bluray') not in ['off', 'unavailable', 'unknown'] }}",
            [
                action(
                    "media_player.turn_off",
                    "media_player.panasonic_bluray",
                    alias="Disc off",
                    continue_on_error=True,
                ),
            ],
            "Disc off if on",
        ),
        xbox_sleep_if_on(),
    ] + appletv_wakeup(stream)


def source_xbox(stream=None):
    steps = []
    if stream:
        steps.append(appletv_suspend_if_on(stream))
    return steps + [
        if_then(
            "{{ states('media_player.panasonic_bluray') not in ['off', 'unavailable', 'unknown'] }}",
            [
                action(
                    "media_player.turn_off",
                    "media_player.panasonic_bluray",
                    alias="Disc off",
                    continue_on_error=True,
                ),
            ],
            "Disc off if on",
        ),
        retry_until(
            "{{ is_state('media_player.xbox', 'off') or is_state('media_player.xbox', 'unavailable') or is_state('media_player.xbox', 'unknown') }}",
            xbox_wake_steps()
            + [
                action("wake_on_lan.send_magic_packet", data={
                    "mac": XBOX_MAC,
                    "broadcast_address": BROADCAST,
                    "broadcast_port": 9,
                }, continue_on_error=True),
            ],
            count=4,
            delay_s=8,
        ),
        wait(
            "{{ states('media_player.xbox') in ['on', 'playing', 'paused', 'idle'] }}",
            "00:00:20",
            "Wait Xbox HDMI",
            continue_on_timeout=True,
        ),
    ]


def play_xbox(stream=None):
    """Live Xbox route on Lumagen input 2, labeled Xbox (2). Not a parked-console script."""
    label = "Xbox (2)"
    logical = "2"
    return {
        "alias": "Play Xbox",
        "description": "JVC then Lumagen then Onkyo, then Xbox WakeUp + WoL. Never Reboot.",
        "icon": "mdi:microsoft-xbox",
        "mode": "restart",
        "sequence": header("Play Xbox")
        + power_on_chain(label, logical)
        + source_xbox(stream)
        + route_lumagen(label, logical)
        + [ensure_jvc_hdmi1()]
        + [
            fail_if(
                "{{ not (is_state('select.lumagen_radiancepro_input', '%s') and is_state('select.lumagen_radiancepro_memory', 'MEMA') and is_state('select.jvc_projector_input', 'hdmi1') and (game_source in (state_attr('media_player.tx_rz800', 'source') | string)) and states('media_player.xbox') in ['on', 'playing', 'paused', 'idle']) }}"
                % label,
                "Play Xbox failed: Lumagen must be %s/MEMA and the Xbox must wake (Sleep / Instant-On, not Energy-saving; allow apps to turn on the console)."
                % label,
            ),
        ],
    }


def watch_streaming(stream):
    label = stream["streamInput"]
    logical = stream["streamLogical"]
    return {
        "alias": "Watch Streaming",
        "description": "JVC then Lumagen then Onkyo, then Apple TV wakeup. Does not launch an app.",
        "icon": "mdi:apple",
        "mode": "restart",
        "sequence": header("Watch Streaming")
        + power_on_chain(label, logical)
        + source_streaming(stream)
        + route_lumagen(label, logical)
        + [ensure_jvc_hdmi1()]
        + [
            fail_if(
                "{{ not (is_state('select.lumagen_radiancepro_input', '%s') and is_state('select.lumagen_radiancepro_memory', 'MEMA') and is_state('select.jvc_projector_input', 'hdmi1') and (game_source in (state_attr('media_player.tx_rz800', 'source') | string)) and states('%s') in ['on', 'playing', 'paused', 'idle']) }}"
                % (label, stream["appletv"]),
                "Watch Streaming failed: Lumagen must be %s/MEMA and the Apple TV must wake."
                % label,
            ),
        ],
    }


def watch_bluray(stream=None):
    return {
        "alias": "Watch Blu-Ray",
        "description": "JVC then Lumagen then Onkyo, then disc on. Xbox TurnOff only if on.",
        "icon": "mdi:disc-player",
        "mode": "restart",
        "sequence": header("Watch Blu-Ray")
        + power_on_chain("Blu-ray (3)", "3")
        + source_bluray(stream)
        + route_lumagen("Blu-ray (3)", "3")
        + [ensure_jvc_hdmi1()]
        + [
            fail_if(
                "{{ not (is_state('select.lumagen_radiancepro_input', 'Blu-ray (3)') and is_state('select.lumagen_radiancepro_memory', 'MEMA') and is_state('select.jvc_projector_input', 'hdmi1') and (game_source in (state_attr('media_player.tx_rz800', 'source') | string)) and not is_state('media_player.panasonic_bluray', 'off') and not is_state('media_player.panasonic_bluray', 'unavailable') and not is_state('media_player.panasonic_bluray', 'unknown')) }}",
                "Watch Blu-Ray failed: Lumagen must be Blu-ray (3)/MEMA and the disc player must be on.",
            ),
        ],
    }


def theater_shutdown(stream=None):
    sequence = [
        action("input_select.select_option", "input_select.theater_activity", {"option": "Idle"}),
        action("input_text.set_value", "input_text.theater_last_error", {"value": " "}),
    ]
    if stream:
        sequence.append(appletv_suspend_if_on(stream))
    sequence += [
        if_then(
            "{{ states('media_player.panasonic_bluray') not in ['off', 'unavailable', 'unknown'] or states('media_player.xbox') in ['on', 'playing', 'paused', 'idle'] }}",
            [
                if_then(
                    "{{ states('media_player.panasonic_bluray') not in ['off', 'unavailable', 'unknown'] }}",
                    [
                        action(
                            "media_player.turn_off",
                            "media_player.panasonic_bluray",
                            alias="Disc off",
                            continue_on_error=True,
                        ),
                    ],
                ),
                xbox_sleep_if_on(),
                delay(2, "HDMI drop after sources"),
            ],
            "Sources off if on",
        ),
        if_then(
            ONKYO_ON,
            [
                action(
                    "media_player.turn_off",
                    "media_player.tx_rz800",
                    alias="Onkyo standby",
                    continue_on_error=True,
                ),
                wait(ONKYO_NOT_ON, "00:00:20", "Wait Onkyo off", continue_on_timeout=True),
                delay(20, "Onkyo Network Standby settle"),
            ],
            "Onkyo off if on",
        ),
        if_then(
            "{{ is_state('switch.lumagen_radiancepro_power', 'on') }}",
            [
                action(
                    "switch.turn_off",
                    "switch.lumagen_radiancepro_power",
                    alias="Lumagen off",
                    continue_on_error=True,
                ),
                wait(
                    "{{ not is_state('switch.lumagen_radiancepro_power', 'on') }}",
                    "00:00:15",
                    "Wait Lumagen off",
                    continue_on_timeout=True,
                ),
            ],
            "Lumagen off if on",
        ),
        if_then(
            "{{ states('sensor.jvc_projector_power_state') in ['on', 'warming'] }}",
            [
                action("remote.turn_off", "remote.jvc_projector", alias="JVC off", continue_on_error=True),
                wait(
                    "{{ states('sensor.jvc_projector_power_state') in ['standby', 'cooling', 'off'] }}",
                    "00:02:00",
                    "Wait JVC leaving on",
                    continue_on_timeout=True,
                ),
            ],
            "JVC off if on",
        ),
    ]
    return {
        "alias": "Theater Shutdown",
        "description": "Sources, then Onkyo, then Lumagen, then JVC. Skip any step already off.",
        "icon": "mdi:power",
        "mode": "restart",
        "sequence": sequence,
    }


def activity_options(script_ids):
    """Idle, Watch Blu-Ray, Play Xbox, and Watch Streaming only when that script was published."""
    options = ["Idle", "Watch Blu-Ray", "Play Xbox"]
    if "watch_streaming" in script_ids:
        options.append("Watch Streaming")
    return options


def theater_resync(stream=None):
    """Re-run a published activity from the helper. Anything else, including Idle, notifies."""
    choices = [
        ("Watch Blu-Ray", "script.watch_bluray"),
        ("Play Xbox", "script.play_xbox"),
    ]
    if stream:
        choices.insert(1, ("Watch Streaming", "script.watch_streaming"))
        listed = "Watch Blu-Ray, Watch Streaming, or Play Xbox"
        description = "Re-run Watch Blu-Ray, Watch Streaming, or Play Xbox from the last activity helper."
    else:
        listed = "Watch Blu-Ray or Play Xbox"
        description = "Re-run Watch Blu-Ray or Play Xbox from the last activity helper."
    return {
        "alias": "Theater Resync",
        "description": description,
        "icon": "mdi:sync",
        "mode": "restart",
        "sequence": [
            {
                "choose": [
                    {
                        "conditions": [
                            {
                                "condition": "state",
                                "entity_id": "input_select.theater_activity",
                                "state": label,
                            }
                        ],
                        "sequence": [
                            action("script.turn_on", entity),
                        ],
                    }
                    for label, entity in choices
                ],
                "default": [
                    action(
                        "persistent_notification.create",
                        data={
                            "title": "Theater Resync",
                            "message": "No activity to resync. Start %s first." % listed,
                            "notification_id": "theater_activity",
                        },
                    ),
                ],
            }
        ],
    }


def published_scripts(profile=None):
    """Script id and config pairs. Watch Streaming is omitted unless the profile has a stream route."""
    profile = PROFILE if profile is None else profile
    stream = stream_profile(profile)
    items = [
        ("play_xbox", play_xbox(stream)),
        ("watch_bluray", watch_bluray(stream)),
    ]
    if stream:
        items.append(("watch_streaming", watch_streaming(stream)))
    items.append(("theater_shutdown", theater_shutdown(stream)))
    items.append(("theater_resync", theater_resync(stream)))
    return items


def put_script(sid: str, cfg: dict) -> None:
    from ha_client import ha
    code, body = ha(f"/api/config/script/config/{sid}", "POST", cfg, timeout=60)
    print(sid, code, str(body)[:300] if body is not None else "")
    if code not in (200, 201):
        raise SystemExit(f"failed to publish {sid}")


def ensure_activity_options(options) -> None:
    from ha_client import ha
    code, body = ha(
        "/api/services/input_select/set_options",
        "POST",
        {
            "entity_id": "input_select.theater_activity",
            "options": options,
        },
    )
    print("theater_activity options", code, str(body)[:300] if body is not None else "")
    if code not in (200, 201):
        raise SystemExit("failed to set theater activity options")


def main() -> int:
    scripts = list(published_scripts())
    ensure_activity_options(activity_options([sid for sid, _cfg in scripts]))
    for sid, cfg in scripts:
        put_script(sid, cfg)
    return 0


if __name__ == "__main__":
    sys.exit(main())
