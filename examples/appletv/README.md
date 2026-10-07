# Sample Profile: LG C3 + Denon + Apple TV

Alternate Home Assistant profile for a living-room stack **without** a video processor: LG OLED C3 (webOS), Denon AVR-X3800H, and Apple TV 4K. Generic HAOS patterns: [`PLAN.md`](../../PLAN.md). Deck playbook: [`docs/ACTIVITY_DECKS.md`](../../docs/ACTIVITY_DECKS.md).

Committed `pwa/` defaults remain the JVC / Lumagen / Onkyo sample. Use this directory for a TV + AVR + streamer rack.

## Validation sources (do not invent beyond these)

| Claim | Source |
|-------|--------|
| webOS `media_player`, `select_source`, `source_list`, LG Connect Apps, WoL turn-on | [LG webOS TV](https://www.home-assistant.io/integrations/webostv/) |
| webOS cannot power on by itself; needs `webostv.turn_on` + WoL/CEC | [Device is requested to turn on](https://www.home-assistant.io/triggers/webostv.turn_on/) |
| denonavr supports **AVR-X3800H**; VLAN ports 23 / 8080 / 60006 | [Denon AVR Network Receivers](https://www.home-assistant.io/integrations/denonavr/) |
| Factory HDMI assign: Media Player = HDMI 2; rename via Source Rename | [Input Assign](https://manuals.denon.com/AVRX3800H/na/en/GFNFSYicezyjvb.php), [Source Rename](https://manuals.denon.com/avrx3800h/na/en/GFNFSYbmopaqff.php) |
| denonavr friendly name `Media Player` (command `MPLAY`) | [denonavr `SOURCE_MAPPING`](https://github.com/ol-iver/denonavr/blob/main/denonavr/const.py) |
| Apple TV remote commands: `menu`, `home`, `play`, `pause`, `up`/`down`/`left`/`right`, `select`, `wakeup`, `suspend`, … — **no** `play_pause` | [Apple TV](https://www.home-assistant.io/integrations/apple_tv/) |
| Frontend media_player on/off only toggles HA state; use `wakeup` / `suspend` | Same Apple TV FAQ |
| Example US SKU OLED55C3PUA | [LG OLED55C3PUA](https://www.lg.com/us/tvs/lg-oled55c3pua-oled-4k-tv) |

Entity IDs in this folder are **illustrative**. HA generates them from the names you set at pairing. Always copy live `entity_id`, `source`, and `source_list` from **Developer Tools → States**.

## Contents

| File | Role |
|------|------|
| `config.example.js` / `config.js` | Activities, pills, roles (no `lumagenRestart`) |
| `contracts.json` | **Apple TV** + **Idle** using factory Denon input **Media Player** |
| `profile.json` | Documented model / input defaults + reference URLs |
| `scripts.outline.yaml` | Stub sequences aligned with the integrations above |

## Integrations and constraints

| Role | Device | Integration | Constraints from docs/manuals |
|------|--------|-------------|-------------------------------|
| `display` | LG OLED C3 (e.g. OLED55C3PUA) | Core [webostv](https://www.home-assistant.io/integrations/webostv/) | Enable **LG Connect Apps**. Power-on needs a `webostv.turn_on` automation (typically Wake-on-LAN; Ethernet preferred). Off works via `media_player.turn_off`. HDMI labels must match `source_list` exactly (often `HDMI 2`). |
| `avr` | Denon AVR-X3800H | Core [denonavr](https://www.home-assistant.io/integrations/denonavr/) | Listed as supported. One telnet client if telnet updates enabled. Default **Media Player** input is HDMI 2 — plug Apple TV there unless you reassign. |
| `appletv` / `appletvRemote` | Apple TV 4K | Core [apple_tv](https://www.home-assistant.io/integrations/apple_tv/) | Pair AirPlay/Companion as documented. Deck buttons use only documented `remote.send_command` names. |

No `processor*` / `lumagenRestart` roles → PWA **Help** stays hidden.

## Contracts

[`contracts.json`](contracts.json):

- **Apple TV required:** display `on`/`playing`/`paused`; AVR on-family with `source_contains: "Media Player"`; Apple TV `on`/`playing`/`paused`/`idle`.
- **Idle required:** display off/standby/unavailable; AVR not on/playing/paused.

If Source Rename or HDMI CEC changes the Denon label (manual: names can auto-update from the HDMI device), replace `Media Player` in contracts and scripts with the live `media_player.*.source` string.

## Scripts

See [`scripts.outline.yaml`](scripts.outline.yaml). Important accuracy notes:

1. **LG on** — `media_player.turn_on` only works after you add the official WoL (or CEC) automation on `webostv.turn_on`. The outline assumes that automation exists.
2. **Apple TV wake/sleep** — use `remote.send_command` `wakeup` / `suspend`, not media_player power as the sole mechanism ([FAQ](https://www.home-assistant.io/integrations/apple_tv/)).
3. **Denon input** — `media_player.select_source` with `Media Player` (factory name).
4. **TV HDMI** — `select_source` with a string from that TV’s `source_list` (example `HDMI 2` for AVR out).

## PWA deck commands

Template `data-deck="appletv"` buttons map 1:1 to Apple TV remote commands: `menu`, `home`, `play`, `pause`, `up`, `down`, `left`, `right`, `select`.

## Publication

1. Copy config + contracts into `pwa/` (or merge).
2. Fix entity IDs and input strings from live HA state.
3. Helpers: options `Idle`, `Apple TV`.
4. Create the webOS turn-on automation, then publish scripts from the outline.
5. Bump `?v=N` after UI edits.

## Related

- Projector sample: [`examples/jvc-lumagen-onkyo/`](../jvc-lumagen-onkyo/)
- Agent decks: [`docs/ACTIVITY_DECKS.md`](../../docs/ACTIVITY_DECKS.md)
