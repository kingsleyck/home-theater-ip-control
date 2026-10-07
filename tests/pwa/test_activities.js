"use strict";

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { bootApp, flush, press } = require("./harness");

const running = [];
afterEach(() => {
  while (running.length) {
    const ctx = running.pop();
    if (ctx.window.TheaterApp) ctx.window.TheaterApp.stop();
    ctx.window.close();
  }
});

async function boot(options) {
  const ctx = await bootApp(options);
  running.push(ctx);
  return ctx;
}

describe("config-driven activities", () => {
  it("renders activity tiles from config plus sticky shutdown outside the scrollport", async () => {
    const ctx = await boot();
    const root = ctx.document.getElementById("activities");
    const scroll = ctx.document.getElementById("activity-scroll");
    assert.ok(scroll);
    assert.equal(scroll.querySelectorAll("[data-script]").length, 3);
    assert.ok(root.querySelector(':scope > .activity.power[data-script="shutdown"]'));
    assert.equal(scroll.contains(root.querySelector('[data-script="shutdown"]')), false);
    assert.ok(root.querySelector('[data-script="watch_bluray"]'));
    assert.ok(root.querySelector('[data-script="watch_streaming"]'));
    assert.ok(root.querySelector('[data-script="play_xbox"]'));
    const labels = [...scroll.querySelectorAll("[data-script] span")].map((el) => el.textContent);
    assert.deepEqual(labels, ["Blu-Ray", "Streaming", "Xbox"]);
  });

  it("shows decks by data-deck id, not label strings", async () => {
    const ctx = await boot({ activity: "Play Xbox" });
    assert.equal(ctx.document.getElementById("xbox-deck").classList.contains("hidden"), false);
    assert.equal(ctx.document.getElementById("transport-deck").classList.contains("hidden"), true);
    assert.equal(ctx.document.getElementById("appletv-deck").classList.contains("hidden"), true);
    assert.equal(ctx.document.getElementById("idle-deck").classList.contains("hidden"), true);
  });

  it("shows the appletv deck when Watch Streaming is settled", async () => {
    const ctx = await boot({
      activity: "Watch Streaming",
      extra: {
        "script.watch_streaming": "off",
        "remote.apple_tv": "on",
      },
    });
    assert.equal(ctx.document.querySelectorAll("#activity-scroll [data-script]").length, 3);
    assert.equal(ctx.document.getElementById("appletv-deck").classList.contains("hidden"), false);
    assert.equal(ctx.document.getElementById("xbox-deck").classList.contains("hidden"), true);
    assert.equal(ctx.document.getElementById("idle-deck").classList.contains("hidden"), true);
  });

  it("hides Help when lumagenRestart is not configured", async () => {
    const ctx = await boot({
      mutateConfig(cfg) {
        delete cfg.roles.lumagenRestart;
      },
    });
    const help = ctx.document.getElementById("help");
    assert.equal(help.hidden, true);
  });

  it("shows Help when lumagenRestart is configured", async () => {
    const ctx = await boot();
    assert.equal(ctx.document.getElementById("help").hidden, false);
  });

  it("keeps Xbox on the status row unless Streaming is selected", async () => {
    const idle = await boot();
    const idleIds = [...idle.document.querySelectorAll("#status [data-device]")].map((el) => el.dataset.device);
    assert.deepEqual(idleIds, ["jvc", "lumagen", "onkyo", "panasonic", "xbox"]);

    const xbox = await boot({ activity: "Play Xbox" });
    const xboxIds = [...xbox.document.querySelectorAll("#status [data-device]")].map((el) => el.dataset.device);
    assert.deepEqual(xboxIds, ["jvc", "lumagen", "onkyo", "panasonic", "xbox"]);
  });

  it("replaces the Xbox pill with Apple TV during Watch Streaming", async () => {
    const ctx = await boot({
      activity: "Watch Streaming",
      extra: {
        "media_player.apple_tv": {
          state: "playing",
          attributes: { app_name: "Netflix", media_title: "The Film" },
        },
      },
    });
    const ids = [...ctx.document.querySelectorAll("#status [data-device]")].map((el) => el.dataset.device);
    assert.deepEqual(ids, ["jvc", "lumagen", "onkyo", "panasonic", "appletv"]);
    const atv = ctx.document.querySelector('[data-device="appletv"]');
    assert.match(atv.textContent, /The Film/);
    press(ctx.window, atv);
    await flush(4);
    assert.equal(ctx.document.getElementById("device-title").textContent, "Apple TV");
    assert.equal(ctx.document.getElementById("device-kicker").textContent, "Apple TV");
    assert.match(ctx.document.getElementById("device-body").textContent, /Netflix/);
    assert.equal(ctx.document.getElementById("sheet-appletv-title").textContent, "The Film");
  });
});
