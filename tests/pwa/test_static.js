"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { readPwa } = require("./harness");

describe("static PWA regressions", () => {
  it("declares helpUntil so render() cannot throw ReferenceError", () => {
    const src = readPwa("app.js");
    assert.match(src, /let helpUntil\s*=\s*0/);
  });

  it("keeps activity tile labels on one line in equal-width tiles", () => {
    const css = readPwa("styles.css");
    assert.match(css, /\.activity-scroll \.activity \{[^}]*flex:\s*1\s+1\s+0/);
    assert.match(css, /\.activity-scroll \.activity \{[^}]*min-width:\s*0/);
    assert.match(css, /\.activity-scroll \.activity span \{[^}]*white-space:\s*nowrap/);
  });

  it("installs as Home Theater IP Control", () => {
    const html = readPwa("index.html");
    const manifest = JSON.parse(readPwa("manifest.webmanifest"));
    assert.match(html, /<title>Home Theater IP Control<\/title>/);
    assert.match(html, /apple-mobile-web-app-title" content="Home Theater IP Control"/);
    assert.equal(manifest.name, "Home Theater IP Control");
    assert.equal(manifest.short_name, "Home Theater IP Control");
    assert.match(manifest.description, /activity control over IP/);
  });

  it("loads controls.js before app.js and cache-busts them together", () => {
    const html = readPwa("index.html");
    const app = readPwa("app.js");
    const css = html.match(/styles\.css\?v=(\d+)/);
    const cfg = html.match(/config\.js\?v=(\d+)/);
    const controls = html.match(/controls\.js\?v=(\d+)/);
    const appv = html.match(/app\.js\?v=(\d+)/);
    const contracts = app.match(/contracts\.json\?v=(\d+)/);
    const sheets = [...html.matchAll(/sheets\/[\w-]+\.js\?v=(\d+)/g)];
    assert.ok(css && cfg && controls && appv && contracts);
    assert.equal(css[1], cfg[1]);
    assert.equal(css[1], controls[1]);
    assert.equal(css[1], appv[1]);
    assert.equal(css[1], contracts[1]);
    assert.ok(sheets.length >= 5);
    sheets.forEach((m) => assert.equal(m[1], css[1]));
    assert.ok(html.indexOf("controls.js") < html.indexOf("app.js"));
    assert.ok(html.indexOf("sheets/jvc.js") < html.indexOf("app.js"));
  });

  it("keeps activity highlight rings inside the button so they cannot clip off-screen", () => {
    const css = readPwa("styles.css");
    assert.match(css, /\.activity\.starting\s*\{[\s\S]*?inset 0 0 0 2px var\(--accent\)/);
    assert.match(css, /\.activity\s*\{[^}]*overflow:\s*hidden/);
  });

  it("fills the Home Screen web-app viewport and scales device pads", () => {
    const html = readPwa("index.html");
    const css = readPwa("styles.css");
    const app = readPwa("app.js");
    assert.match(html, /setProperty\("--app-height", "100vh"\)/);
    assert.match(html, /class="pad-stack"/);
    assert.match(html, /class="disc-pad-stack"/);
    assert.match(css, /--app-height:\s*100dvh/);
    assert.match(css, /height:\s*var\(--app-height/);
    assert.doesNotMatch(css, /html\s*\{[^}]*-webkit-fill-available/);
    assert.match(app, /function scalePadStacks/);
    assert.match(app, /Math\.min\(1, available \/ need\)/);
    assert.match(app, /stack\.style\.zoom/);
    assert.doesNotMatch(app, /stack\.style\.transform = "scale\(/);
    assert.doesNotMatch(app, /transformOrigin = "center top"/);
    assert.doesNotMatch(app, /marginBlock = \(\(s - 1\)/);
    assert.match(html, /class="xbox-sys"[\s\S]*class="abxy-wrap"[\s\S]*class="pad-stack"[\s\S]*class="abxy"/);
    assert.doesNotMatch(html, /xbox-pad-spacer/);
    assert.match(css, /#xbox-deck\s*\{[^}]*gap:\s*12px/);
    assert.match(css, /#xbox-deck \.xbox-sys\s*\{[^}]*flex-shrink:\s*0/);
    assert.match(css, /#xbox-deck \.abxy-wrap\s*\{[^}]*padding-top:\s*24px/);
    assert.match(css, /\.pad-stack\s*\{[^}]*gap:\s*28px/);
    assert.match(app, /classList\.toggle\("standalone"/);
    assert.match(app, /function scheduleReconnect/);
    assert.match(app, /visibilitychange/);
    assert.match(app, /let wantLive/);
    assert.match(
      app,
      /if \(lumagen !== "on"\) return \[title, "Powering processor"\][\s\S]*if \(jvc === "warming"\) return \[title, "Projector warming"\]/,
    );
  });

  it("does not put explanatory notes at the bottom of device sheets", () => {
    const app = readPwa("app.js");
    const css = readPwa("styles.css");
    const sheets = ["jvc.js", "lumagen.js", "onkyo.js", "panasonic.js", "xbox.js"]
      .map((name) => readPwa("sheets/" + name))
      .join("\n");
    assert.doesNotMatch(app, /sheet-note/);
    assert.doesNotMatch(css, /sheet-note/);
    assert.doesNotMatch(sheets, /sheet-note/);
    assert.doesNotMatch(app, /Setup appears on the projector/);
  });

  it("keeps site-specific LAN addresses out of the template", () => {
    const html = readPwa("index.html");
    const app = readPwa("app.js");
    const cfg = readPwa("config.js");
    assert.doesNotMatch(html + app + cfg, /192\.168\./);
    assert.doesNotMatch(app, /function defaultHaUrl\(\)[\s\S]{0,200}192\.168/);
  });

  it("keeps iOS haptic switches native and tappable, not script-toggled off-screen", () => {
    const html = readPwa("index.html");
    const css = readPwa("styles.css");
    const controls = readPwa("controls.js");
    const overlay = css.match(/\.haptic-switch\s*\{[^}]+\}/);
    assert.ok(overlay);
    assert.doesNotMatch(overlay[0], /pointer-events:\s*none/);
    assert.doesNotMatch(overlay[0], /appearance:\s*none/);
    assert.match(css, /button:disabled \.haptic-switch[\s\S]{0,80}pointer-events:\s*none/);
    assert.match(css, /input:not\(\[switch\]\):not\(\.haptic-switch\)/);
    assert.doesNotMatch(html, /id="ios-haptic"/);
    assert.match(controls, /ensureHapticOverlay/);
    assert.doesNotMatch(controls, /sw\.checked\s*=\s*!sw\.checked/);
  });

  it("defines ember void phosphor and abyss dark-room themes and boots data-theme before CSS", () => {
    const html = readPwa("index.html");
    const css = readPwa("styles.css");
    const app = readPwa("app.js");
    assert.match(html, /localStorage\.getItem\("theater\.theme"\)/);
    assert.match(html, /URLSearchParams\(location\.search\)\.get\("theme"\)/);
    assert.ok(html.indexOf("data-theme") < html.indexOf("styles.css"));
    assert.match(css, /html\[data-theme="ember"\]/);
    assert.match(css, /html\[data-theme="void"\]/);
    assert.match(css, /html\[data-theme="phosphor"\]/);
    assert.match(css, /html\[data-theme="abyss"\]/);
    assert.match(css, /--accent:\s*#b0893e/);
    assert.match(css, /--accent:\s*#6e8aa8/);
    assert.match(css, /--accent:\s*#5d8f6a/);
    assert.match(css, /--accent:\s*#4a72a8/);
    assert.match(css, /--dock-hi:/);
    assert.match(css, /--tangible-hi:/);
    assert.match(app, /STORAGE_THEME/);
    assert.match(app, /function applyTheme/);
    assert.match(app, /abyss/);
    assert.match(html, /settings-sheet/);
    assert.match(html, /open-settings/);
  });
});
