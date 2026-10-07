"use strict";

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { bootApp, flush, press, fire } = require("./harness");

const running = [];
afterEach(() => {
  while (running.length) {
    const ctx = running.pop();
    try { ctx.window.localStorage.clear(); } catch (_) {}
    if (ctx.window.TheaterApp) ctx.window.TheaterApp.stop();
    ctx.window.close();
  }
});

function withAppleTv(cfg) {
  cfg.activities.push({
    id: "watch_appletv",
    label: "Apple TV",
    script: "script.watch_appletv",
    icon: "tv",
    deck: "appletv",
  });
  cfg.scripts.watch_appletv = "script.watch_appletv";
  cfg.roles.appletv = "media_player.apple_tv";
  cfg.roles.appletvRemote = "remote.apple_tv";
}

async function boot(options) {
  const ctx = await bootApp(options);
  running.push(ctx);
  return ctx;
}

function services(ctx) {
  const ws = ctx.FakeWebSocket.instances[0];
  return ws.sent.filter((msg) => msg.type === "call_service");
}

function tap(window, el) {
  fire(window, el, "pointerdown", { clientX: 10, clientY: 10, pointerId: 1 });
  fire(window, el, "pointerup", { clientX: 10, clientY: 10, pointerId: 1 });
}

async function doubleTap(window, el) {
  tap(window, el);
  await new Promise((resolve) => setTimeout(resolve, 40));
  tap(window, el);
}

function rerender(ctx) {
  const ws = ctx.FakeWebSocket.instances[0];
  ws._emit({
    type: "event",
    event: { c: { "media_player.apple_tv": { "+": { s: "unavailable" } } } },
  });
}

describe("Apple TV apps", () => {
  it("hides Apple TV settings when the role is absent", async () => {
    const ctx = await boot({
      mutateConfig(cfg) {
        delete cfg.roles.appletv;
        delete cfg.roles.appletvRemote;
      },
    });
    press(ctx.window, ctx.document.getElementById("open-settings"));
    await flush(8);
    assert.equal(ctx.document.getElementById("appletv-favorites-section").classList.contains("hidden"), true);
    assert.equal(ctx.document.getElementById("appletv-blacklist-section").classList.contains("hidden"), true);
  });

  it("shows settings, hides default blacklist apps, and orders favorites", async () => {
    const ctx = await boot({
      activity: "Apple TV",
      mutateConfig: withAppleTv,
      extra: {
        "script.watch_appletv": "off",
        "media_player.apple_tv": "unavailable",
        "remote.apple_tv": "on",
      },
    });
    ctx.window.localStorage.setItem("theater.appletvFavoriteApps", JSON.stringify([
      { bundleId: "com.netflix.Netflix", label: "Netflix" },
    ]));
    ctx.window.localStorage.setItem("theater.appletvAppCatalog", JSON.stringify({
      fetchedAt: Date.now(),
      apps: [
        { bundleId: "com.apple.TVSettings", label: "Settings", thumbnail: "" },
        { bundleId: "com.apple.TVAppStore", label: "App Store", thumbnail: "" },
        { bundleId: "com.apple.TVSearch", label: "Search", thumbnail: "" },
        { bundleId: "com.disney.disneyplus", label: "Disney+", thumbnail: "" },
        { bundleId: "com.netflix.Netflix", label: "Netflix", thumbnail: "/app-icon?id=com.netflix.Netflix" },
      ],
    }));
    rerender(ctx);
    await flush(4);
    assert.equal(ctx.document.getElementById("appletv-favorites-section").classList.contains("hidden"), false);
    assert.equal(ctx.document.getElementById("appletv-blacklist-section").classList.contains("hidden"), false);
    const tiles = [...ctx.document.querySelectorAll("#appletv-apps-grid [data-atv-app]")].map((el) => el.dataset.atvApp);
    assert.deepEqual(tiles, ["com.netflix.Netflix", "com.disney.disneyplus"]);
    const img = ctx.document.querySelector("#appletv-apps-grid img[data-fallback]");
    assert.equal(img.dataset.fallback, "N");
    img.dispatchEvent(new ctx.window.Event("error"));
    assert.equal(ctx.document.querySelector("#appletv-apps-grid .app-mono").textContent, "N");
    press(ctx.window, ctx.document.getElementById("open-settings"));
    await flush(4);
    assert.match(ctx.document.getElementById("appletv-favorites-list").textContent, /Netflix/);
    assert.match(ctx.document.getElementById("appletv-blacklist-list").textContent, /Settings/);
    assert.match(ctx.document.getElementById("appletv-catalog-hint").textContent, /Wake the Apple TV/);
  });

  it("launches an app with play_media and shows now playing", async () => {
    const ctx = await boot({
      activity: "Apple TV",
      mutateConfig: withAppleTv,
      extra: {
        "script.watch_appletv": "off",
        "remote.apple_tv": "on",
        "media_player.apple_tv": {
          state: "playing",
          attributes: { media_title: "Film", app_name: "Netflix" },
        },
      },
    });
    await flush(12);
    const now = ctx.document.getElementById("appletv-now");
    assert.equal(now.classList.contains("hidden"), false);
    assert.equal(ctx.document.getElementById("appletv-title").textContent, "Film");
    const openBtn = ctx.document.getElementById("open-appletv-apps");
    assert.equal(openBtn.disabled, false);
    press(ctx.window, openBtn);
    await flush(12);
    assert.equal(ctx.document.getElementById("appletv-apps-sheet").classList.contains("hidden"), false);
    const tile = ctx.document.querySelector("#appletv-apps-grid [data-atv-app]");
    assert.ok(tile);
    const bundle = tile.dataset.atvApp;
    await doubleTap(ctx.window, tile);
    await flush(8);
    const play = services(ctx).find((msg) => msg.domain === "media_player" && msg.service === "play_media");
    assert.ok(play);
    assert.equal(play.service_data.entity_id, "media_player.apple_tv");
    assert.equal(play.service_data.media_content_type, "app");
    assert.equal(play.service_data.media_content_id, bundle);
    assert.equal(ctx.document.getElementById("appletv-apps-sheet").classList.contains("hidden"), true);
  });
});
