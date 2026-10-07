# Activity decks (agent playbook)

<!-- Humans: short steps live in README.md → Activity Extension. Agents extending sources: read this file. -->

This document is for agents adding an unknown activity and its in-stage remote (deck). Do not invent a second top-level nav or put primary source controls in a device sheet.

## Sheets vs decks

| Surface | Purpose | Where |
|---------|---------|--------|
| Activity tile | Start HA script; select which deck shows | `THEATER_CONFIG.activities` → `#activities` strip |
| Deck | Primary remote while that activity is live | `.stage` panel with `data-deck="<id>"` |
| Sheet | Facts / modes / rare extras | `TheaterSheets.<pillId>` |
| Volume / header | Global | Unchanged |

Activity strip: horizontal scroll for many tiles; **Shutdown** stays sticky outside the scrollport (`#activities > .activity.power`).

## Checklist

1. **Config** — append to `THEATER_CONFIG.activities` in `pwa/config.js`:

   ```js
   { id: "watch_appletv", label: "Apple TV", tile: "Streaming", script: "script.watch_appletv", icon: "tv", deck: "appletv" }
   ```

   `label` is the helper option and the contract key. Optional `tile` is the button text; omit it and the tile shows `label`. Also add `scripts.watch_appletv` and any new roles, such as `appletvRemote`. `roles.appletv` is optional. A rack without that role is valid: leave the Apple TV deck in the shell, and do not add an Apple TV pill or a streaming activity.

2. **Contracts** — `pwa/contracts.json` key must equal the activity **`label`**.

3. **HA script** — publish a script whose `entity_id` matches `script`.

4. **Markup** — one sibling under `.stage`:

   ```html
   <section class="deck device-deck hidden" id="<id>-deck" data-deck="<id>">
     …
   </section>
   ```

   `data-deck` must match `activity.deck`. Visibility is toggled in `app.js` by deck id (not label strings).

5. **Commands** — namespace buttons: `data-xbox`, `data-disc`, `data-appletv`, or `data-<id>="Command"`. Wire with `TheaterControls.bindImmediate` → `remote.send_command` (or the right HA service). Do not hardcode activity labels for show/hide.

6. **CSS** — scope under `#<id>-deck` or `[data-deck="<id>"]`. Reuse `.row`, `.now-playing`, `.disc-keys` / key grids, `.disc-nav` / `.dpad`, tangible tokens (`--tangible-*`, `--dock-*`). No one-off hex.

7. **Cache bust** — bump shared `?v=N` on CSS, JS, sheets, and `contracts.json` fetch together.

## Layout grammar

Phone stage, one column, top → bottom:

```text
[ Title row + state hint ]
[ Optional now-playing ]
[ Compact sys / transport keys ]
[ Primary navigation cluster ]   ← thumb zone
[ Optional secondary row ]
```

### Reference skeletons in `pwa/index.html`

| Kind | `data-deck` | Pattern |
|------|-------------|---------|
| Gamepad | `xbox` | Sys row → type form → ABXY + d-pad |
| Transport / disc | `transport` | Key grid → arrows + OK |
| Streamer / STB | `appletv` | Thin keys → arrows + select (example) |

Copy the closest skeleton; do not clone a full IR remote.

### Rules of thumb

- Large hit targets; few rows.
- Highest-frequency controls in the lower half (thumb zone).
- Do not duplicate volume or activity start inside the deck.
- Deck shows only when its activity is active or settling onto it; otherwise `idle-deck`.

## Anti-patterns

- Switching decks by comparing `"Play Xbox"` / `"Watch Blu-Ray"` strings in `app.js`
- Putting Play/Pause/D-pad only in a sheet
- Editing activity tiles by hand in `index.html` (row is rendered from config)
- Generating full Xbox chrome from JSON

## Example profile

See [`examples/appletv/`](../examples/appletv/) for a full alternate rack (LG OLED C3 + Denon AVR-X3800H + Apple TV). That folder documents claims against HA integration pages and the Denon X3800H Input Assign / Source Rename manuals. Deck buttons use only documented Apple TV remote commands (`play` / `pause`, not `play_pause`). Default `pwa/config.js` stays the JVC / Lumagen sample; `data-deck="appletv"` shows when config sets `deck: "appletv"`.

The JVC sample's streaming Lumagen label is `profile.json` `streamInput`. In that file the value is `Xbox (1)`. That string is a profile value, not a constant in `pwa/`. Pills that share `exclusive` occupy one slot: the JVC sample shows the Apple TV pill only while the streaming activity is selected, and the Xbox pill otherwise.
