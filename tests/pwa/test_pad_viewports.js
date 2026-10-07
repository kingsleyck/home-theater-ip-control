"use strict";

/**
 * Layout / hit-target coverage for the Xbox ABXY + D-pad cluster.
 * jsdom cannot exercise real viewport geometry; these tests use Playwright.
 *
 * Requires: npm i && npx playwright install chromium
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { defaultStates } = require("./harness");

const ROOT = path.resolve(__dirname, "..", "..");
const PWA = path.join(ROOT, "pwa");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const PAD_COMMANDS = ["Y", "X", "B", "A", "Up", "Down", "Left", "Right"];
const DOCK_COMMANDS = ["GoHome", "Menu"];

let playwright;
try {
  playwright = require("playwright");
} catch (_) {
  playwright = null;
}

function startStatic() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    if (urlPath === "/auth.json" || urlPath === "/auth.json/") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ haUrl: "http://homeassistant.local", token: "test-token" }));
      return;
    }
    const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
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

async function openXboxPad(page, url) {
  const states = defaultStates("Play Xbox", {
    "media_player.xbox": "on",
    "media_player.tx_rz800": "on",
    "sensor.jvc_projector_power_state": "on",
    "switch.lumagen_radiancepro_power": "on",
  });

  await page.addInitScript((entities) => {
    class FakeWebSocket {
      constructor() {
        this.readyState = 0;
        this.listeners = { open: [], close: [], error: [], message: [] };
        this.sent = [];
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
        this.sent.push(msg);
        if (msg.type === "auth") {
          queueMicrotask(() => this._emit({ type: "auth_ok" }));
        } else if (msg.type === "get_states") {
          queueMicrotask(() => this._emit({
            id: msg.id, type: "result", success: true, result: entities,
          }));
        } else if (msg.type === "subscribe_entities" || msg.type === "call_service") {
          queueMicrotask(() => this._emit({
            id: msg.id, type: "result", success: true, result: {},
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
    window.__wsList = [];
    window.WebSocket = function WebSocketProxy() {
      const w = new FakeWebSocket();
      window.__wsList.push(w);
      window.__ws = w;
      return w;
    };
    Object.assign(window.WebSocket, FakeWebSocket);
  }, states);

  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForSelector("#main:not(.hidden)", { timeout: 20000 });
  await page.waitForSelector("#xbox-deck:not(.hidden)", { timeout: 10000 });
  await page.waitForTimeout(400);
}

function hitReport(page) {
  return page.evaluate((cmds) => {
    const wrap = document.querySelector("#xbox-deck .abxy-wrap");
    const stack = wrap && wrap.querySelector(".pad-stack");
    if (!wrap || !stack) return { error: "missing pad" };

    const wrapRect = wrap.getBoundingClientRect();
    const stackRect = stack.getBoundingClientRect();
    const transform = getComputedStyle(stack).transform;
    const zoom = stack.style.zoom || getComputedStyle(stack).zoom || "1";

    const hits = cmds.map((cmd) => {
      const btn = document.querySelector('[data-xbox="' + cmd + '"]');
      if (!btn) return { cmd, error: "missing" };
      const r = btn.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) {
        return { cmd, error: "zero-size", rect: { w: r.width, h: r.height } };
      }
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const top = document.elementFromPoint(cx, cy);
      let hitBtn = top && top.closest && top.closest("[data-xbox]");
      if (!hitBtn && top && top.classList && top.classList.contains("haptic-switch")) {
        hitBtn = top.parentElement;
      }
      return {
        cmd,
        disabled: !!btn.disabled,
        match: !!(hitBtn && hitBtn.dataset && hitBtn.dataset.xbox === cmd),
        hitCmd: hitBtn && hitBtn.dataset && hitBtn.dataset.xbox,
        inWrap: cy >= wrapRect.top - 1 && cy <= wrapRect.bottom + 1,
      };
    });

    return {
      zoom: String(zoom),
      transform,
      usesTransformScale: /matrix\(|scale\(/.test(transform) && transform !== "none",
      wrapH: wrap.clientHeight,
      stackVisualH: stackRect.height,
      stackFitsWrap: stackRect.bottom <= wrapRect.bottom + 2,
      hits,
    };
  }, PAD_COMMANDS.concat(DOCK_COMMANDS));
}

describe("Xbox pad viewports", { skip: !playwright, concurrency: false }, () => {
  const { chromium, devices } = playwright || {};
  let server;
  let baseUrl;
  let browser;

  const profiles = [
    { name: "iPhone SE", device: devices && devices["iPhone SE"] },
    { name: "iPhone 14 Pro", device: devices && devices["iPhone 14 Pro"] },
    { name: "iPhone 14 Pro Max", device: devices && devices["iPhone 14 Pro Max"] },
    { name: "iPhone 15 Pro Max", device: devices && devices["iPhone 15 Pro Max"] },
    { name: "iPad Mini", device: devices && devices["iPad Mini"] },
    { name: "iPad Pro 11", device: devices && devices["iPad Pro 11"] },
    {
      name: "short phone (tight height)",
      device: devices && {
        ...devices["iPhone 14 Pro"],
        viewport: { width: 390, height: 580 },
        deviceScaleFactor: 2,
      },
    },
  ];

  before(async () => {
    server = await startStatic();
    baseUrl = "http://127.0.0.1:" + server.address().port + "/";
    try {
      browser = await chromium.launch({ headless: true });
    } catch (err) {
      const msg = String(err && err.message || err);
      if (/Executable doesn't exist|browserType\.launch/i.test(msg)) {
        throw new Error("Playwright Chromium missing. Run: npx playwright install chromium\n" + msg);
      }
      throw err;
    }
  });

  after(async () => {
    if (browser) await browser.close();
    if (server) server.close();
  });

  for (const profile of profiles) {
    it("keeps ABXY and D-pad tappable on " + profile.name, async () => {
      assert.ok(profile.device, "missing Playwright device profile for " + profile.name);
      const context = await browser.newContext({
        ...profile.device,
        deviceScaleFactor: profile.device.deviceScaleFactor || 2,
      });
      const page = await context.newPage();
      try {
        await openXboxPad(page, baseUrl);
        const report = await hitReport(page);
        assert.equal(report.error, undefined, profile.name + ": " + report.error);
        assert.equal(report.usesTransformScale, false, profile.name + ": pad must not use transform:scale");
        assert.equal(report.stackFitsWrap, true, profile.name + ": scaled pad must fit abxy-wrap");

        for (const hit of report.hits) {
          assert.equal(hit.error, undefined, profile.name + " " + hit.cmd + ": " + hit.error);
          assert.equal(hit.disabled, false, profile.name + " " + hit.cmd + " disabled");
          assert.equal(hit.match, true, profile.name + " " + hit.cmd + " hit=" + hit.hitCmd);
          if (PAD_COMMANDS.includes(hit.cmd)) {
            assert.equal(hit.inWrap, true, profile.name + " " + hit.cmd + " outside wrap");
          }
        }

        await page.locator('[data-xbox="A"]').click({ timeout: 3000 });
        await page.locator('[data-xbox="Up"]').click({ timeout: 3000 });
        const sent = await page.evaluate(() =>
          (window.__ws && window.__ws.sent || [])
            .filter((m) => m.type === "call_service" && m.domain === "remote")
            .map((m) => m.service_data && m.service_data.command)
        );
        assert.ok(sent.includes("A"), profile.name + " missing A command: " + JSON.stringify(sent));
        assert.ok(sent.includes("Up"), profile.name + " missing Up command: " + JSON.stringify(sent));
      } finally {
        await context.close();
      }
    });
  }

  it("keeps ABXY and D-pad tappable after now-playing appears (Netflix-sized chrome)", async () => {
    const device = devices["iPhone 15 Pro Max"];
    assert.ok(device);
    const context = await browser.newContext({
      ...device,
      deviceScaleFactor: device.deviceScaleFactor || 3,
    });
    const page = await context.newPage();
    try {
      await openXboxPad(page, baseUrl);
      const before = await hitReport(page);
      assert.equal(before.hits.find((h) => h.cmd === "A").match, true);

      // Simulate media_player metadata that appears after launching Netflix.
      await page.evaluate(() => {
        const box = document.getElementById("xbox-now");
        const title = document.getElementById("xbox-title");
        const sub = document.getElementById("xbox-sub");
        const art = document.getElementById("xbox-art");
        title.textContent = "Netflix";
        sub.textContent = "App";
        sub.classList.remove("hidden");
        art.classList.remove("hidden");
        art.src = "data:image/svg+xml," + encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect fill="#e50914" width="40" height="40"/></svg>'
        );
        box.classList.remove("hidden");
        window.dispatchEvent(new Event("resize"));
      });
      await page.waitForTimeout(500);

      const after = await hitReport(page);
      assert.equal(after.error, undefined, after.error);
      assert.equal(after.usesTransformScale, false, "now-playing must not force transform:scale");
      assert.equal(after.stackFitsWrap, true, "pad must still fit after now-playing");
      for (const cmd of PAD_COMMANDS) {
        const hit = after.hits.find((h) => h.cmd === cmd);
        assert.ok(hit, "missing " + cmd);
        assert.equal(hit.match, true, "after now-playing " + cmd + " hit=" + hit.hitCmd);
      }
      // Dock row (Home / Apps) remains outside the scaled stack and must stay hittable.
      assert.equal(after.hits.find((h) => h.cmd === "GoHome").match, true);

      await page.locator('[data-xbox="A"]').click({ timeout: 3000 });
      await page.locator('[data-xbox="Down"]').click({ timeout: 3000 });
      const sent = await page.evaluate(() =>
        (window.__ws && window.__ws.sent || [])
          .filter((m) => m.type === "call_service" && m.domain === "remote")
          .map((m) => m.service_data && m.service_data.command)
      );
      assert.ok(sent.includes("A"), "A after now-playing: " + JSON.stringify(sent));
      assert.ok(sent.includes("Down"), "Down after now-playing: " + JSON.stringify(sent));
    } finally {
      await context.close();
    }
  });
});
