# Theater UI

This directory contains the theater progressive web application (PWA) served to Safari on the LAN. A PWA is a web application with a manifest and icons so the phone can install it on the Home Screen and open it as a standalone app, without an App Store listing. Device I/O remains in Home Assistant scripts and integrations. Sample frames of this UI are in [`docs/screenshots/`](../docs/screenshots).

## Contents

| File | Role |
|------|------|
| `index.html` | Shell: activity mount, Settings, Xbox / Panasonic / Apple TV decks, device sheet, shutdown, volume |
| `styles.css` | Layout + tangible controls + themed docks (Ember / Void / Phosphor / Abyss) |
| `app.js` | HA WebSocket, contracts, progress, config-driven activities, deck by `data-deck`, sheets, Settings |
| `controls.js` | Immediate pointerdown and iOS haptic switch overlay |
| `config.js` | Room `name`, shutdown copy, activities (`label` plus optional `tile`), scripts, helpers, pills (`label` plus optional `kicker`), role → entity map |
| `contracts.json` | Required versus warn state for Idle and each activity `label` |
| `sheets/` | Device detail modules registered on `TheaterSheets` by pill `id` |
| `serve.py` | HTTP server; injects `/auth.json`; proxies cover art and App Store icons (`/app-icon`); Onkyo Setup POST |
| `onkyo_osd.py` | Whitelisted eISCP Setup keys (the Onkyo integration has no OSD service) |
| `manifest.webmanifest` | Home Screen name and icons |
| `print-qr.html` | Printable QR that reads `publicUrl` from `/auth.json` |

## Home Assistant Interface

1. `serve.py` reads `../local.json` and serves `/auth.json` (`haUrl` and token). The token is not written into git.
2. `app.js` opens the Home Assistant WebSocket, authenticates, subscribes to theater entities, and calls `script.turn_on` plus volume and remote services on that socket. After a phone or tablet lock, or any other socket drop, it reconnects on its own; an **Offline** header button appears only after several failed retries and can force a reconnect. The header gear opens Settings (themes).
3. `/media-art?src=/api/...` proxies Home Assistant media images so the phone does not require a second CORS or auth path.
4. Onkyo Setup keys POST to `/onkyo-osd?cmd=…`. `serve.py` sends one eISCP packet to `osdHost`:`osdPort` from `local.json` and closes. A second eISCP client can drop the Home Assistant session; Resync reloads routing after the pill returns.

Progress hides when `contracts.json` required checks pass. Shutdown confirmation is a centered modal. Cancel or backdrop tap does not start the script. When the stack already matches Idle, confirm does not invoke `script.theater_shutdown`. Status pills open device diagnostics and safe extras (picture mode, listening mode, Onkyo Setup, extra remote keys, Lumagen restart/reload). Activities own power and routing.

Activity button text uses `tile` when that field is set, and `label` otherwise. `label` is the helper option and the `contracts.json` key. The JVC sample tiles read Blu-Ray, Streaming, and Xbox.

Pills that share an `exclusive` key occupy one slot. The pill whose `activity` matches the selected activity id is shown; otherwise the pill in that slot with no `activity` is shown. In the JVC sample, Apple TV replaces Xbox while Watch Streaming is selected.

`name` is the on-screen room title. Each pill `label` is the device sheet title, and an optional pill `kicker` is the model line above it. `shutdownTitle` and `shutdownHint` are the shutdown confirmation. The JVC sample keeps Theater, NZ500, and the projector shutdown sentence. The living-room sample uses Living Room.

`roles.appletv` is optional. A rack without that role is valid: Apple TV settings stay hidden, and the shell does not require an Apple TV pill or a streaming activity. `/app-icon?id=` returns App Store artwork for a bundle id when an Apple TV apps grid is in use. The lookup host is limited to mzstatic, and the cache stays out of git.

## Cache Bust

After UI changes, increment the shared `?v=N` query on `styles.css`, `config.js`, `controls.js`, `sheets/*.js`, `app.js`, and the `contracts.json` fetch together. Safari retains cached copies of these assets.

## iOS Constraints

iPhone has no `navigator.vibrate()`. Each tappable control receives a native `<input type="checkbox" switch>` overlay (`opacity: 0`, not `appearance: none`) so the finger tap is the haptic. Commands bind on that overlay via `TheaterControls.bindImmediate`. Scripted `.click()` on the switch is a no-op on iOS 26 and later.

Home Screen **Open as a Web App** uses `100vh` (not `100dvh`). On iOS those dynamic units are short by the status-bar inset. Xbox and disc pads then scale to the leftover stage height.

Play Xbox includes a native type field. Submit sends the string once as Xbox `remote.send_command` (a `text:` prefix when the value would otherwise be a reserved pad command). The field uses `type="password"` so the last character flashes, then hides. The console still has to focus a text box on the TV; the PWA does not open Xbox search.
