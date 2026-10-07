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

describe("Xbox apps sheet and settings prefs", () => {
  it("opens an Apps sheet with browsed apps and no Home tile", async () => {
    const ctx = await boot({
      activity: "Play Xbox",
      extra: { "media_player.xbox": "on" },
    });
    await flush(20);
    const openBtn = ctx.document.getElementById("open-xbox-apps");
    assert.ok(openBtn);
    assert.equal(openBtn.disabled, false);
    assert.match(openBtn.textContent, /Apps/);
    assert.equal(ctx.document.querySelectorAll("#xbox-deck .xbox-sys .xsys").length, 3);
    press(ctx.window, openBtn);
    await flush(10);
    assert.equal(ctx.document.getElementById("xbox-apps-sheet").classList.contains("hidden"), false);
    const tiles = [...ctx.document.querySelectorAll("#xbox-apps-grid [data-xbox-app]")].map((el) => el.dataset.xboxApp);
    assert.ok(!tiles.includes("Home"));
    assert.ok(tiles.includes("9WZDNCRFJ3TJ"));
    assert.equal(ctx.document.querySelectorAll("#xbox-apps-grid .app-name").length, 0);
  });

  it("orders favorites ahead of alphabetical remainder in the Apps sheet", async () => {
    const ctx = await boot({
      activity: "Play Xbox",
      extra: { "media_player.xbox": "on" },
    });
    const thumb = "https://example.com/t.png";
    ctx.window.localStorage.setItem("theater.xboxFavoriteApps", JSON.stringify([
      { productId: "9WZDNCRF1Q69", label: "YouTube" },
      { productId: "9WZDNCRFJ3TJ", label: "Netflix" },
    ]));
    ctx.window.localStorage.setItem("theater.xboxAppCatalog", JSON.stringify({
      fetchedAt: Date.now(),
      apps: [
        { productId: "9WZDNCRFJ3TJ", label: "Netflix", thumbnail: thumb, media_content_type: "app" },
        { productId: "9NXQXX0F5D06", label: "Disney+", thumbnail: thumb, media_content_type: "app" },
        { productId: "9PLN1J1P8P8J", label: "Halo Infinite", thumbnail: thumb, media_content_type: "game" },
        { productId: "9WZDNCRF1Q69", label: "YouTube", thumbnail: thumb, media_content_type: "app" },
        { productId: "9NOTHUMB0001", label: "No Art App", thumbnail: "", media_content_type: "app" },
      ],
    }));
    press(ctx.window, ctx.document.getElementById("open-xbox-apps"));
    await flush(12);
    const ids = [...ctx.document.querySelectorAll("#xbox-apps-grid [data-xbox-app]")].map((el) => el.dataset.xboxApp);
    assert.deepEqual(ids.slice(0, 2), ["9WZDNCRF1Q69", "9WZDNCRFJ3TJ"]);
    assert.equal(ids[2], "9NXQXX0F5D06");
    assert.ok(!ids.includes("9PLN1J1P8P8J"));
    assert.ok(!ids.includes("9NOTHUMB0001"));
  });

  it("hides games and apps without thumbnails from the Apps switcher", async () => {
    const ctx = await boot({
      activity: "Play Xbox",
      extra: { "media_player.xbox": "on" },
    });
    await flush(20);
    press(ctx.window, ctx.document.getElementById("open-xbox-apps"));
    await flush(12);
    const ids = [...ctx.document.querySelectorAll("#xbox-apps-grid [data-xbox-app]")].map((el) => el.dataset.xboxApp);
    assert.ok(ids.includes("9WZDNCRFJ3TJ"));
    assert.ok(ids.includes("9NXQXX0F5D06"));
    assert.ok(ids.includes("9WZDNCRF1Q69"));
    assert.ok(!ids.includes("9PLN1J1P8P8J"));
    assert.ok(!ids.includes("9NOTHUMB0001"));
  });

  it("does not launch on a single tap", async () => {
    const ctx = await boot({
      activity: "Play Xbox",
      extra: { "media_player.xbox": "on" },
    });
    await flush(20);
    press(ctx.window, ctx.document.getElementById("open-xbox-apps"));
    await flush(10);
    const netflix = ctx.document.querySelector('[data-xbox-app="9WZDNCRFJ3TJ"]');
    assert.ok(netflix);
    tap(ctx.window, netflix);
    await flush(4);
    const play = services(ctx).filter((msg) => msg.service === "play_media");
    assert.equal(play.length, 0);
  });

  it("launches an app on double-tap", async () => {
    const ctx = await boot({
      activity: "Play Xbox",
      extra: { "media_player.xbox": "on" },
    });
    await flush(20);
    press(ctx.window, ctx.document.getElementById("open-xbox-apps"));
    await flush(10);
    const netflix = ctx.document.querySelector('[data-xbox-app="9WZDNCRFJ3TJ"]');
    assert.ok(netflix);
    await doubleTap(ctx.window, netflix);
    await flush(6);
    const play = services(ctx).filter((msg) => msg.service === "play_media");
    assert.equal(play.length, 1);
    assert.equal(play[0].domain, "media_player");
    assert.equal(play[0].service_data.media_content_id, "9WZDNCRFJ3TJ");
    assert.equal(play[0].service_data.media_content_type, "app");
    assert.equal(ctx.document.getElementById("xbox-apps-sheet").classList.contains("hidden"), true);
  });

  it("cancels double-tap when the pointer moves (scroll)", async () => {
    const ctx = await boot({
      activity: "Play Xbox",
      extra: { "media_player.xbox": "on" },
    });
    await flush(20);
    press(ctx.window, ctx.document.getElementById("open-xbox-apps"));
    await flush(10);
    const netflix = ctx.document.querySelector('[data-xbox-app="9WZDNCRFJ3TJ"]');
    fire(ctx.window, netflix, "pointerdown", { clientX: 10, clientY: 10, pointerId: 1 });
    fire(ctx.window, netflix, "pointermove", { clientX: 40, clientY: 10, pointerId: 1 });
    fire(ctx.window, netflix, "pointerup", { clientX: 40, clientY: 10, pointerId: 1 });
    await new Promise((resolve) => setTimeout(resolve, 40));
    tap(ctx.window, netflix);
    await flush(4);
    const play = services(ctx).filter((msg) => msg.service === "play_media");
    assert.equal(play.length, 0);
  });

  it("shows favorite icons in Settings and supports arrow reorder", async () => {
    const ctx = await boot({
      activity: "Play Xbox",
      extra: { "media_player.xbox": "on" },
    });
    ctx.window.localStorage.setItem("theater.xboxFavoriteApps", JSON.stringify([
      { productId: "9WZDNCRFJ3TJ", label: "Netflix" },
      { productId: "9NXQXXLFST89", label: "Disney+" },
    ]));
    ctx.window.localStorage.setItem("theater.xboxAppCatalog", JSON.stringify({
      fetchedAt: Date.now(),
      apps: [
        { productId: "9WZDNCRFJ3TJ", label: "Netflix", thumbnail: "https://example.com/n.png" },
        { productId: "9NXQXXLFST89", label: "Disney+", thumbnail: "https://example.com/d.png" },
      ],
    }));
    press(ctx.window, ctx.document.getElementById("open-settings"));
    await flush(12);
    const art = ctx.document.querySelector("#xbox-favorites-list .fav-art img");
    assert.ok(art);
    assert.equal(ctx.document.querySelectorAll("#xbox-favorites-list .fav-moves").length, 2);
    const down = ctx.document.querySelector("#xbox-favorites-list .fav-down");
    assert.ok(down);
    press(ctx.window, down);
    await flush(6);
    const ids = [...ctx.document.querySelectorAll("#xbox-favorites-list li[data-product-id]")].map((li) => li.dataset.productId);
    assert.deepEqual(ids, ["9NXQXXLFST89", "9WZDNCRFJ3TJ"]);
  });

  it("toggles a library favorite on double-tap, not single tap", async () => {
    const ctx = await boot({
      activity: "Play Xbox",
      extra: { "media_player.xbox": "on" },
    });
    ctx.window.localStorage.setItem("theater.xboxAppCatalog", JSON.stringify({
      fetchedAt: Date.now(),
      apps: [
        { productId: "9WZDNCRFJ3TJ", label: "Netflix", thumbnail: "https://example.com/n.png" },
      ],
    }));
    press(ctx.window, ctx.document.getElementById("open-settings"));
    await flush(8);
    press(ctx.window, ctx.document.getElementById("xbox-favorites-add"));
    await flush(8);
    const tile = ctx.document.querySelector('.xbox-lib-tile[data-lib-id="9WZDNCRFJ3TJ"]');
    assert.ok(tile);
    tap(ctx.window, tile);
    await flush(4);
    assert.equal(tile.classList.contains("selected"), false);
    await doubleTap(ctx.window, tile);
    await flush(6);
    assert.equal(tile.classList.contains("selected"), true);
    const favs = JSON.parse(ctx.window.localStorage.getItem("theater.xboxFavoriteApps"));
    assert.equal(favs[0].productId, "9WZDNCRFJ3TJ");
  });

  it("shows icons in the Xbox library picker without sideways overflow", async () => {
    const ctx = await boot({
      activity: "Play Xbox",
      extra: { "media_player.xbox": "on" },
    });
    ctx.window.localStorage.setItem("theater.xboxAppCatalog", JSON.stringify({
      fetchedAt: Date.now(),
      apps: [
        { productId: "9WZDNCRFJ3TJ", label: "Netflix", thumbnail: "https://example.com/n.png" },
        { productId: "9NXQXXLFST89", label: "Disney+", thumbnail: "https://example.com/d.png" },
      ],
    }));
    press(ctx.window, ctx.document.getElementById("open-settings"));
    await flush(8);
    press(ctx.window, ctx.document.getElementById("xbox-favorites-add"));
    await flush(8);
    const picker = ctx.document.getElementById("xbox-library-picker");
    assert.equal(picker.classList.contains("hidden"), false);
    assert.ok(picker.querySelector(".xbox-lib-tile img"));
    assert.equal(picker.querySelectorAll(".xbox-lib-label").length, 0);
  });

  it("exposes default volume and favorites controls in Settings", async () => {
    const ctx = await boot();
    press(ctx.window, ctx.document.getElementById("open-settings"));
    assert.equal(ctx.document.getElementById("settings-sheet").classList.contains("hidden"), false);
    const slider = ctx.document.getElementById("settings-default-volume");
    assert.ok(slider);
    assert.equal(slider.value, "50");
    assert.equal(ctx.document.getElementById("settings-default-volume-label").textContent, "50%");
    assert.ok(ctx.document.getElementById("xbox-favorites-list"));
    assert.ok(ctx.document.getElementById("xbox-favorites-add"));
    assert.ok(ctx.document.getElementById("xbox-blacklist-list"));
    assert.ok(ctx.document.getElementById("xbox-blacklist-add"));
  });

  it("defaults an app blacklist and hides those apps from the switcher", async () => {
    const ctx = await boot({
      activity: "Play Xbox",
      extra: { "media_player.xbox": "on" },
    });
    const thumb = "https://example.com/t.png";
    ctx.window.localStorage.setItem("theater.xboxAppCatalog", JSON.stringify({
      fetchedAt: Date.now(),
      apps: [
        { productId: "9WZDNCRFJ3TJ", label: "Netflix", thumbnail: thumb, media_content_type: "app" },
        { productId: "9NBLGGGZ5QDQ", label: "Xbox Original Avatars", thumbnail: thumb, media_content_type: "app" },
        { productId: "9PJJ1K9DZMRS", label: "HBO Max", thumbnail: thumb, media_content_type: "app" },
        { productId: "9N0866FS04W8", label: "Dolby Access", thumbnail: thumb, media_content_type: "app" },
      ],
    }));
    press(ctx.window, ctx.document.getElementById("open-settings"));
    await flush(8);
    const ids = [...ctx.document.querySelectorAll("#xbox-blacklist-list li[data-product-id]")].map((li) => li.dataset.productId);
    assert.deepEqual(ids, ["9NBLGGGZ5QDQ", "9PJJ1K9DZMRS", "9N0866FS04W8"]);
    assert.equal(ctx.document.querySelectorAll("#xbox-blacklist-list .fav-moves").length, 0);
    press(ctx.window, ctx.document.getElementById("open-xbox-apps"));
    await flush(10);
    const switcher = [...ctx.document.querySelectorAll("#xbox-apps-grid [data-xbox-app]")].map((el) => el.dataset.xboxApp);
    assert.ok(switcher.includes("9WZDNCRFJ3TJ"));
    assert.ok(!switcher.includes("9NBLGGGZ5QDQ"));
    assert.ok(!switcher.includes("9PJJ1K9DZMRS"));
    assert.ok(!switcher.includes("9N0866FS04W8"));
  });

  it("clears removed media attributes so now-playing does not stick on the previous app", async () => {
    const ctx = await boot({
      activity: "Play Xbox",
      extra: {
        "media_player.xbox": {
          state: "on",
          attributes: {
            media_title: "Netflix",
            app_name: "Netflix",
            media_content_type: "app",
            entity_picture: "https://example.com/netflix.png",
          },
        },
      },
    });
    await flush(8);
    assert.equal(ctx.document.getElementById("xbox-title").textContent, "Netflix");

    const ws = ctx.FakeWebSocket.instances[0];
    ws._emit({
      type: "event",
      event: {
        c: {
          "media_player.xbox": {
            "+": {
              a: {
                media_content_type: "app",
                media_content_id: "9MW0ZWQFH0M2",
              },
            },
            "-": {
              a: ["media_title", "app_name", "entity_picture"],
            },
          },
        },
      },
    });
    await flush(8);
    const title = ctx.document.getElementById("xbox-title").textContent;
    assert.notEqual(title, "Netflix");
  });

  it("optimistically shows the launched app name in now-playing", async () => {
    const ctx = await boot({
      activity: "Play Xbox",
      extra: {
        "media_player.xbox": {
          state: "on",
          attributes: {
            media_title: "Netflix",
            app_name: "Netflix",
            media_content_type: "app",
          },
        },
      },
    });
    await flush(8);
    assert.equal(ctx.document.getElementById("xbox-title").textContent, "Netflix");
    press(ctx.window, ctx.document.getElementById("open-xbox-apps"));
    await flush(12);
    // Harness browse_media includes Disney+; launching it must replace the Netflix label.
    const disney = ctx.document.querySelector('[data-xbox-app="9NXQXX0F5D06"]');
    assert.ok(disney);
    await doubleTap(ctx.window, disney);
    await flush(8);
    assert.match(ctx.document.getElementById("xbox-title").textContent, /Disney/i);
  });

  it("persists a changed default volume preference", async () => {
    const ctx = await boot();
    press(ctx.window, ctx.document.getElementById("open-settings"));
    const slider = ctx.document.getElementById("settings-default-volume");
    slider.value = "35";
    slider.dispatchEvent(new ctx.window.Event("input", { bubbles: true }));
    await flush(4);
    assert.equal(ctx.window.localStorage.getItem("theater.defaultVolume"), "35");
    assert.equal(ctx.document.getElementById("settings-default-volume-label").textContent, "35%");
  });
});
