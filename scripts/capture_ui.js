"use strict";

/**
 * Capture sample PWA frames for docs/screenshots.
 * Requires playwright (not a repo dependency): npm install playwright && npx playwright install chromium
 * Serves pwa/ locally with a mocked Home Assistant websocket. Set PWA_URL to capture a running host instead.
 * Do not start Watch/Play on a live rack.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium, devices } = require("playwright");
const { defaultStates } = require("../tests/pwa/harness");

const ROOT = path.resolve(__dirname, "..");
const PWA = path.join(ROOT, "pwa");
const OUT = path.join(ROOT, "docs", "screenshots");
const iphone = devices["iPhone 14 Pro"];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const DEMO_APPS = [
  { productId: "9MW0ZWQFH0M2", label: "Apple TV | Xbox", thumbnail: "https://store-images.s-microsoft.com/image/apps.25291.13853294760425971.aec3c389-9853-4395-af6e-74aaedd44966.73a58738-f9c2-47fa-9470-a2cb616dbe0c", media_content_type: "app" },
  { productId: "9NXQXXLFST89", label: "Disney+", thumbnail: "https://store-images.s-microsoft.com/image/apps.55921.14495311847124170.7646206e-bd82-4cf0-8b8c-d06a67bc302c.f939755d-cf85-415a-80dc-b98e3ccacd22", media_content_type: "app" },
  { productId: "9NN5NTKVGL4R", label: "HBO Max: TV & Movies", thumbnail: "https://store-images.s-microsoft.com/image/apps.13634.13744881843501632.d805199e-6b79-494c-a60a-0e127578420e.117dc160-2e59-4ea8-83b6-c5668ec77684", media_content_type: "app" },
  { productId: "9WZDNCRFJ3L1", label: "Hulu", thumbnail: "https://store-images.s-microsoft.com/image/apps.54532.9007199266246590.a8642808-8fcd-48e6-805e-aede1f148787.3ad33e70-c240-4294-9b7f-58d55d99f102", media_content_type: "app" },
  { productId: "9WZDNCRFJ3TJ", label: "Netflix", thumbnail: "https://store-images.s-microsoft.com/image/apps.46851.9007199266246365.1f6d0339-ecce-4fe5-840a-652cd84111ad.ddef6be7-6304-41c0-a347-1d571b66dfb2", media_content_type: "app" },
  { productId: "9WZDNCRFJ0WK", label: "Paramount+", thumbnail: "https://store-images.s-microsoft.com/image/apps.24545.9007199266243596.1230f3f2-f93f-4f0e-8de0-9e19b3939e30.f39ca4f9-fa56-4ebd-9301-21f54e397913", media_content_type: "app" },
  { productId: "9PL67R4P9PG5", label: "PeacockTV", thumbnail: "https://store-images.s-microsoft.com/image/apps.39988.14253076346048674.a5a8bfc5-8929-4450-93fe-32b85f7f663e.20a74972-b89b-4a7e-bcf2-4c9caecb885e", media_content_type: "app" },
  { productId: "9NBLGGH4VGD7", label: "Prime Video US (Xbox)", thumbnail: "https://store-images.s-microsoft.com/image/apps.12337.13510798887500496.c8743090-c12d-4e43-8032-5f5af5e716e1.08d4a2b7-f99b-4631-aa0c-254c9923325e", media_content_type: "app" },
  { productId: "9NLVFKN7DT65", label: "Rumble", thumbnail: "https://store-images.s-microsoft.com/image/apps.2245.13700018112551562.392ecce7-67d8-4c2b-a12e-dbd708dfb664.bb543730-e804-419d-82dc-58029059a11c", media_content_type: "app" },
  { productId: "9NDP7KTLK7W3", label: "YouTube", thumbnail: "https://store-images.s-microsoft.com/image/apps.56985.13614820593571814.9ded6f79-d5be-498b-9a13-7c81b78cab18.d6932954-5242-4cb8-9450-55ff824593cd", media_content_type: "app" },
];

function startStatic() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    if (urlPath === "/auth.json" || urlPath === "/auth.json/") {
      const body = JSON.stringify({ haUrl: "http://homeassistant.local", token: "test-token" });
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(body);
      return;
    }
    let rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
    const file = path.normalize(path.join(PWA, rel));
    if (!file.startsWith(PWA)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function shot(page, name) {
  const dest = path.join(OUT, name);
  await page.screenshot({ path: dest, type: "png" });
  console.log("wrote", dest);
}

async function openMain(page, url, deck) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForSelector("#main:not(.hidden)", { timeout: 20000 });
  await page.waitForSelector((deck || "#xbox-deck") + ":not(.hidden)", { timeout: 10000 });
  await page.waitForTimeout(700);
}

function installSocket(entities, apps) {
  return ({ entities: ents, apps: catalog }) => {
    class FakeWebSocket {
      constructor() {
        this.readyState = 0;
        this.listeners = { open: [], close: [], error: [], message: [] };
        queueMicrotask(() => {
          this.readyState = 1;
          this.listeners.open.forEach((fn) => fn());
          this._emit({ type: "auth_required" });
        });
      }
      addEventListener(type, fn) {
        (this.listeners[type] || []).push(fn);
      }
      close() {
        this.readyState = 3;
      }
      send(raw) {
        const msg = JSON.parse(raw);
        if (msg.type === "auth") {
          queueMicrotask(() => this._emit({ type: "auth_ok" }));
        } else if (msg.type === "get_states") {
          queueMicrotask(() => this._emit({
            id: msg.id,
            type: "result",
            success: true,
            result: ents,
          }));
        } else if (msg.type === "subscribe_entities" || msg.type === "call_service") {
          queueMicrotask(() => this._emit({
            id: msg.id,
            type: "result",
            success: true,
            result: {},
          }));
        } else if (msg.type === "media_player/browse_media") {
          const children = catalog.map((a) => ({
            title: a.label,
            media_content_id: a.productId,
            media_content_type: a.media_content_type || "app",
            media_class: a.media_content_type === "game" ? "game" : "app",
            can_play: true,
            can_expand: false,
            thumbnail: a.thumbnail || null,
          }));
          queueMicrotask(() => this._emit({
            id: msg.id,
            type: "result",
            success: true,
            result: {
              title: "Installed Applications",
              media_class: "directory",
              media_content_type: "library",
              media_content_id: "library",
              children,
            },
          }));
        }
      }
      _emit(data) {
        this.listeners.message.forEach((fn) => fn({ data: JSON.stringify(data) }));
      }
    }
    FakeWebSocket.CONNECTING = 0;
    FakeWebSocket.OPEN = 1;
    FakeWebSocket.CLOSING = 2;
    FakeWebSocket.CLOSED = 3;
    window.WebSocket = FakeWebSocket;
    try {
      localStorage.setItem("theater.xboxAppCatalog", JSON.stringify({
        fetchedAt: Date.now(),
        apps: catalog,
      }));
      localStorage.setItem("theater.xboxFavoriteApps", JSON.stringify([
        { productId: "9WZDNCRFJ3TJ", label: "Netflix" },
        { productId: "9NXQXXLFST89", label: "Disney+" },
        { productId: "9NDP7KTLK7W3", label: "YouTube" },
      ]));
      localStorage.removeItem("theater.xboxAppBlacklist");
    } catch (_) {}
  };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  let server;
  let url = process.env.PWA_URL;
  if (url) {
    console.warn("PWA_URL is set; capturing", url, "instead of local pwa/");
  } else {
    server = await startStatic();
    const port = server.address().port;
    url = "http://127.0.0.1:" + port + "/";
  }
  console.log("capture url", url);

  const states = defaultStates("Play Xbox", {
    "sensor.jvc_projector_power_state": "on",
    "switch.lumagen_radiancepro_power": "on",
    "select.lumagen_radiancepro_input": "Xbox (2)",
    "media_player.xbox": "on",
  });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...iphone,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.addInitScript(installSocket(), { entities: states, apps: DEMO_APPS });

  await openMain(page, url);
  await shot(page, "home.png");

  await page.locator("#open-xbox-apps").click();
  await page.waitForSelector("#xbox-apps-sheet:not(.hidden)");
  await page.waitForFunction(() => {
    const imgs = [...document.querySelectorAll("#xbox-apps-grid img")];
    return imgs.length > 0 && imgs.every((img) => img.classList.contains("logo-crop") || !img.naturalWidth);
  }, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);
  await shot(page, "apps.png");
  await page.locator("#xbox-apps-back").click();
  await page.waitForTimeout(300);

  await page.locator('[data-device="xbox"]').first().click();
  await page.waitForSelector("#device-sheet:not(.hidden)");
  await page.waitForTimeout(400);
  await shot(page, "sheet-xbox.png");
  await page.locator("#device-back").click();
  await page.waitForTimeout(300);

  await page.locator("#open-settings").click();
  await page.waitForSelector("#settings-sheet:not(.hidden)");
  await page.waitForTimeout(500);
  await shot(page, "settings.png");
  await page.locator("#settings-back").click();
  await page.waitForTimeout(300);

  await page.locator('[data-device="onkyo"]').first().click();
  await page.waitForSelector("#device-sheet:not(.hidden)");
  await page.waitForTimeout(400);
  await shot(page, "sheet-onkyo.png");
  await page.locator("#device-back").click();
  await page.waitForTimeout(300);

  await page.locator('[data-device="jvc"]').first().click();
  await page.waitForSelector("#device-sheet:not(.hidden)");
  await page.waitForTimeout(400);
  await shot(page, "sheet-jvc.png");
  await page.locator("#device-back").click();
  await page.waitForTimeout(300);

  await page.locator('[data-script="shutdown"]').first().click();
  await page.waitForSelector("#shutdown-confirm:not(.hidden)");
  await page.waitForTimeout(300);
  await shot(page, "shutdown.png");

  const streaming = defaultStates("Watch Streaming", {
    "sensor.jvc_projector_power_state": "on",
    "switch.lumagen_radiancepro_power": "on",
    "select.lumagen_radiancepro_input": "Xbox (1)",
    "media_player.panasonic_bluray": "off",
    "media_player.xbox": "off",
    "script.watch_streaming": "off",
    "remote.apple_tv": "on",
    "media_player.apple_tv": {
      state: "playing",
      attributes: { media_title: "The Film", app_name: "Netflix" },
    },
  });
  const streamContext = await browser.newContext({
    ...iphone,
    deviceScaleFactor: 2,
  });
  const streamPage = await streamContext.newPage();
  await streamPage.addInitScript(installSocket(), { entities: streaming, apps: DEMO_APPS });
  await openMain(streamPage, url, "#appletv-deck");
  await shot(streamPage, "streaming.png");
  await streamContext.close();

  for (const theme of ["ember", "void", "phosphor", "abyss"]) {
    await openMain(page, url + (url.includes("?") ? "&" : "?") + "theme=" + theme);
    await shot(page, theme + ".png");
  }

  await browser.close();
  if (server) server.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
