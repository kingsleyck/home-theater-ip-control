# Sample Profile: JVC Lumagen Onkyo

This directory contains the sample Home Assistant profile for a JVC projector, Lumagen processor, Onkyo AVR, Panasonic disc player, and Xbox. The profile is one stack, not a requirement. Generic HAOS stand-up, driver discovery, and sequence patterns are defined in [`PLAN.md`](../../PLAN.md).

## Contents

| File | Role |
|------|------|
| `config.example.js` | Role, activity, pill, and helper map for `pwa/config.js` |
| `config.js` | Same map as a drop-in copy of `pwa/config.js` |
| `contracts.json` | Required and warn checks keyed by activity label |
| `profile.json` | Xbox MAC, WoL button, AVR GAME source string, broadcast address, and the optional stream route |
| `publish_activity_scripts.py` | Publisher for Watch Blu-Ray, Play Xbox, Theater Shutdown, and Watch Streaming when the stream route is set |

## Integrations

| Role | Device | Integration | Source | Device constraints |
|------|--------|-------------|--------|-------------------|
| `display` | JVC NZ-series projector | `jvc_projector` or HACS NZ | Core [jvc_projector](https://www.home-assistant.io/integrations/jvc_projector); HACS [mjmcg/jvc_projector_ha](https://github.com/mjmcg/jvc_projector_ha) | Disable Control4 mode. Prefer HACS on NZ500-class. LAN port 20554. |
| `processor` | Lumagen Radiance Pro | `ha-lumagen` | HACS [jaysoffian/ha-lumagen](https://github.com/jaysoffian/ha-lumagen) | TCP-to-RS-232 bridge (IP2SL / USR-TCP232-class). Typical TCP 4999, 9600 8N1. Single TCP client; after standby the config entry may need reload. Avoid “Lowest” standby. |
| `avr` | Onkyo network receiver | `onkyo` | Core [Onkyo](https://www.home-assistant.io/integrations/onkyo) | Network Standby On. eISCP port 60128. |
| `xbox` | Xbox Series | `xbox` | Core [Xbox](https://www.home-assistant.io/integrations/xbox) | Remote features on. Sleep / Instant-On, not Energy-saving. Ethernet preferred. OAuth account linking. |
| `bluray` | Panasonic UB-series | custom UB remote | HACS [albaintor/panasonic_bluray_remote](https://github.com/albaintor/panasonic_bluray_remote) | Full HTTP control requires the community firmware patch. `media_player.turn_on` is a power toggle when HA state is wrong; scripts gate on current state. |

Onkyo Setup is absent from the Core integration. `pwa/onkyo_osd.py` sends one whitelisted eISCP OSD command when `local.json` sets `osdHost`.

Helpers: `input_select.theater_activity` options `Idle`, `Watch Blu-Ray`, `Play Xbox`, plus `Watch Streaming` when the stream route is published; `input_text.theater_last_error`.

A rack without `roles.appletv` is valid. Omit that role, `appletvRemote`, and the four stream keys in `profile.json`. The publisher then emits Watch Blu-Ray, Play Xbox, and Theater Shutdown only, and the PWA keeps Apple TV settings hidden.

## Entity Map

Illustrative IDs from `config.example.js`. A different HA registry requires a coordinated replace in config, contracts, and the publisher.

| Config role | Sample entity | Used by |
|-------------|---------------|---------|
| `display` | `sensor.jvc_projector_power_state` | Contracts, JVC on/off waits |
| `displayInput` | `select.jvc_projector_input` | Forced `hdmi1` |
| `processor` | `switch.lumagen_radiancepro_power` | Power + TCP reload |
| `processorInput` | `select.lumagen_radiancepro_input` | `Blu-ray (3)`, Play `Xbox (2)`, stream label from `profile.json` `streamInput` |
| `processorMemory` | `select.lumagen_radiancepro_memory` | `MEMA` |
| `processorLogical` | `sensor.lumagen_radiancepro_logical_input` | Digit+A recall (`3` Blu-ray, `2` Xbox, `1` stream in this sample) |
| `avr` | `media_player.tx_rz800` | Power, GAME source, DIRECT |
| `bluray` | `media_player.panasonic_bluray` | Source power; `turn_on` is a toggle |
| `blurayRemote` | `remote.panasonic_bluray` | PWA transport deck |
| `xbox` | `media_player.xbox` | Wake / sleep gates |
| `xboxRemote` | `remote.xbox` | `WakeUp` / `TurnOff`; PWA pad (see [Xbox pad / Netflix](#xbox-pad--netflix)) |
| `lumagenRestart` | `button.lumagen_radiancepro_restart_outputs` | PWA Help (Alt+Prev). Omit this role to hide Help when no Lumagen is in the chain. |
| `appletv` | `media_player.apple_tv` | Streaming source. Illustrative id. Omit the role on a rack with no Apple TV. |
| `appletvRemote` | `remote.apple_tv` | `wakeup` / `suspend`, and the Apple TV deck. Omit with `appletv`. |

Scripts also call `remote.jvc_projector` and `remote.lumagen_radiancepro`, which are not in `roles` but must exist on HA.

### Xbox pad / Netflix

PWA face buttons and D-pad use `remote.send_command` on `xboxRemote`. Home Assistant and the UI send the correct commands (`A`, `Up`, …). **Netflix on Xbox often ignores those SmartGlass keypresses** while Home / Guide-style exits still work. That is console/app behavior, not a missing entity. HDMI-CEC cannot work around it on a Lumagen-switched rack (processor does not pass CEC; projector has no CEC). A dedicated streamer (Apple TV) is the practical alternative for in-app Netflix control from the phone.

## Publication

1. Copy `config.example.js` (or `config.js`) and `contracts.json` over `pwa/config.js` and `pwa/contracts.json` when starting from an empty map.
2. Set `xboxMac`, `wolButton`, `gameSource`, and `broadcastAddress` in `profile.json`. Enable Wake on LAN and create the `button.wake_on_lan_*` entity. For streaming, also set `streamInput`, `streamLogical`, `appletv`, and `appletvRemote`. `streamInput` is the Lumagen select label. This sample sets it to `Xbox (1)`, which is a profile value (the jack may still carry that label). `streamLogical` is the Digit+A digit, `1` in this sample. The entity ids are illustrative. Leave all four keys unset and Watch Streaming is not published.
3. With `local.json` present at the repository root, execute:

```text
python examples/jvc-lumagen-onkyo/publish_activity_scripts.py
```

4. The same command sets `input_select.theater_activity` options and publishes `script.theater_resync`. See [Resync](#resync).

Entity IDs in the publisher are literals matching this `config.js`.

## Power-On Sequence

Canonical implementation: `power_on_chain()` then a source function in `publish_activity_scripts.py`. Order is serial.

1. Wait until `script.theater_shutdown` is `off` (timeout 5 minutes, continue on timeout).
2. **Display (`ensure_jvc_on`)** — wait until not `cooling`; `remote.turn_on` if not `on`/`warming`; wait `warming` or `on` (HDMI RX starting; do not wait out laser warmup); select `hdmi1` if needed.
3. **Processor (`ensure_lumagen_on`)** — if power is `unavailable`/`unknown`, `homeassistant.reload_config_entry` then `switch.turn_on`; retry until `on`; wait for logical input; boot-settle delay (8 s).
4. **Processor route (`route_lumagen`)** — select physical input name and send remote `[logical, "a"]` until both the select entity and logical sensor match; then `MEMA`.
5. **AVR (`ensure_onkyo_on`)** — if `unavailable`, reload config entry; `media_player.turn_on`; select GAME source from `profile.json`; select `DIRECT`. Do not abort the activity if the AVR is still catching up; `fail_if` still requires GAME + on at the end.
6. **Source** — Watch Blu-Ray appends `source_bluray()`; Play Xbox appends `source_xbox()`; Watch Streaming, when the profile has a stream route, appends `source_streaming()`.
7. **Route again** — `route_lumagen` is repeated after the source so a late HDMI lock cannot leave the last-boot input. Then `ensure_jvc_hdmi1()` retries HDMI 1 if the projector ignored the select during early warmup.
8. **`fail_if`** — required routing and source power; writes `input_text.theater_last_error` and a persistent notification on failure.

Script `mode` is `restart`. Concurrent Watch/Play/Shutdown invocations are not supported.

Video switches at the Lumagen. JVC HDMI 1 and Onkyo GAME stay fixed for both watch activities. Atmos (or another HDMI listening-mode override) after lock is allowed and is not a contract failure. Contracts use `source_contains: "GAME"`.

### Watch Blu-Ray source

`source_bluray()`: Xbox `TurnOff` only when the console is `on`/`playing`/`paused`/`idle`; Panasonic `turn_on` only when `off`/`unavailable`/`unknown`; wait until the disc player is not those states. When the stream route is set, Apple TV `suspend` runs first if the player is on.

### Play Xbox source

`source_xbox()`: Panasonic `turn_off` when not already off; Xbox `WakeUp` + WoL button + `wake_on_lan.send_magic_packet`; never `Reboot`. Sleep/Instant-On is required. A second `TurnOff` in ConnectedStandby can full-shutdown the console so HA cannot wake it. The script selects Lumagen `Xbox (2)` / `2`. Apple TV stays on the profile stream route, `Xbox (1)` / `1` in this sample. It does not publish a parked-console route. When the stream route is set, Apple TV `suspend` runs first if the player is on.

### Watch Streaming source

Published only when `profile.json` sets `streamInput`, `streamLogical`, `appletv`, and `appletvRemote`. `source_streaming()` turns the disc player off if it is on, sleeps the Xbox if it is on, then sends Apple TV `wakeup`. It does not launch an app. The Lumagen label and logical digit come from the profile. In this sample `streamInput` is `Xbox (1)`. That string is a profile value, not a value in `pwa/`.

PWA tiles for this sample read Blu-Ray, Streaming, and Xbox (`tile`). Helper options and contract keys stay `Watch Blu-Ray`, `Watch Streaming`, and `Play Xbox` (`label`). The Xbox and Apple TV pills share `exclusive: "source"`: Apple TV replaces Xbox only while Watch Streaming is selected.

## Shutdown Sequence

`THEATER_SHUTDOWN` is the reverse of power-on and skips any step already off.

1. Set `input_select.theater_activity` to `Idle`. Clear last error. When the stream route is set, Apple TV `suspend` if it is on.
2. Sources: disc `turn_off` if on; Xbox `TurnOff` only if on; short HDMI-drop delay.
3. AVR `turn_off` if on; wait off; Network Standby settle delay (20 s).
4. Lumagen `switch.turn_off` if on.
5. JVC `remote.turn_off` if `on`/`warming`; wait `standby`/`cooling`/`off`.

The PWA does not call this script when Idle required checks already pass (projector `off`/`cooling`/`standby`, processor not on, AVR not on).

JVC cooling must finish before `remote.turn_on`. Lumagen `turn_on` is a no-op while the power switch is `unknown` after a dropped TCP session; reload the config entry first. Onkyo eISCP drops in standby; reload then PWR ON.

## Sequence Modification

| Change | Function or constant | Also update |
|--------|----------------------|-------------|
| Power-on device order | `power_on_chain()` | Idle/Watch/Play contracts if readiness order is observable |
| Shutdown device order | `theater_shutdown()` | Idle `required` checks |
| Projector input | `ensure_jvc_on()` / `ensure_jvc_hdmi1()` `hdmi1` | `fail_if` templates; optional `displayInput` contract |
| Lumagen Watch input | `watch_bluray()` `route_lumagen("Blu-ray (3)", "3")` | `contracts.json` `processorInput` / logical digit |
| Lumagen Play input | `play_xbox()` `route_lumagen("Xbox (2)", "2")` | same |
| Lumagen stream input | `profile.json` `streamInput` and `streamLogical` | Watch Streaming contract `processorInput`. Sample value `Xbox (1)` is a profile value |
| Lumagen memory | `route_lumagen()` `MEMA` | `processorMemory` contract |
| AVR source string | `profile.json` `gameSource` | contracts `source_contains`; Onkyo pill treats `"GAME"` as the short label |
| AVR default listening mode | `ensure_onkyo_on()` `DIRECT` | None in contracts (Atmos after lock is allowed) |
| Xbox wake / WoL | `xbox_wake_steps()`, `profile.json` | Xbox Sleep policy |
| Xbox sleep policy | `xbox_sleep_if_on()` | Do not send `TurnOff` unless the console is fully on; never `Reboot` |
| Disc toggle safety | `source_bluray()` / `source_xbox()` | Panasonic `turn_on` only when HA shows off |
| Retry counts / delays | `retry_until`, `wait`, `delay` calls | Lumagen boot settle (8 s) and Onkyo Network Standby (20 s) |
| Hard-coded entity IDs in templates | `ONKYO_ON`, `ensure_*`, `fail_if` | `pwa/config.js` `roles` must match |

## Component Substitution

Entity IDs in this publisher are literals, not read from `config.js`. Driver selection for a different brand is defined in [`PLAN.md` Driver Discovery](../../PLAN.md#driver-discovery).

| Substitution | Publisher | `pwa/config.js` | `pwa/contracts.json` | UI |
|--------------|-----------|-----------------|----------------------|-----|
| Different projector | `ensure_jvc_on`, shutdown JVC block, `fail_if` | `display*` roles | `display` Idle/Watch/Play | `pwa/sheets/jvc.js`; pill `id` `jvc` |
| Different processor | `ensure_lumagen_on`, `route_lumagen` | `processor*` roles | `processor*` states | `pwa/sheets/lumagen.js` |
| Different AVR | `ONKYO_*`, `ensure_onkyo_on`, shutdown AVR | `avr` role | `avr` `state_in` / `source_contains` | `pwa/sheets/onkyo.js`; `osdHost` if Setup remains eISCP |
| Different disc player | `source_bluray`, shutdown disc | `bluray`, `blurayRemote` | Watch `bluray` `not_state`; Play warn | `index.html` `#transport-deck`; `sheets/panasonic.js` |
| Different console | `xbox_*`, `profile.json`, Play `fail_if` | `xbox`, `xboxRemote` | Play required / Idle warn | `#xbox-deck`; `sheets/xbox.js` |
| No Apple TV | Omit the four stream keys | Omit `appletv` and `appletvRemote` | Omit the Watch Streaming contract | No streaming tile; Xbox stays in the source pill slot |

## Resync

`main()` sets `input_select.theater_activity` options before it publishes scripts. The options are `Idle`, `Watch Blu-Ray`, `Play Xbox`, and `Watch Streaming` only when that script was published.

`theater_resync()` is emitted after Shutdown. It reads the helper and turns on the matching script: `Watch Blu-Ray` runs `script.watch_bluray`, and `Play Xbox` runs `script.play_xbox`. `Watch Streaming` runs `script.watch_streaming` only when the stream route was published. Idle, or any other helper value, posts a notification that there is nothing to resync.

## Verification

```text
python examples/jvc-lumagen-onkyo/publish_activity_scripts.py
```

On a live HAOS instance wired to this profile, confirm Watch, Play, activity switch, Shutdown, and idle-skip Shutdown without overlapping scripts.
