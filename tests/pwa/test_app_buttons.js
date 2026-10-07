"use strict";

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { bootApp, fire, press, flush, IPHONE_UA } = require("./harness");

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

function services(ctx) {
  const ws = ctx.FakeWebSocket.instances[0];
  assert.ok(ws, "expected a Home Assistant websocket");
  return ws.sent.filter((msg) => msg.type === "call_service");
}

describe("theater PWA buttons", () => {
  it("renders after connect without throwing (helpUntil must be initialized)", async () => {
    const ctx = await boot({ activity: "Watch Blu-Ray" });
    assert.deepEqual(ctx.errors, []);
    assert.equal(ctx.document.getElementById("activity-title").textContent, "Watch Blu-Ray");
    assert.equal(ctx.document.getElementById("main").classList.contains("hidden"), false);
    assert.equal(ctx.document.getElementById("boot").classList.contains("hidden"), true);
  });

  it("does not overlay haptic switches on non-iOS", async () => {
    const ctx = await boot();
    assert.equal(ctx.document.querySelectorAll(".haptic-switch").length, 0);
  });

  it("overlays a native switch on iOS and sends the activity from that tap", async () => {
    const ctx = await boot({ userAgent: IPHONE_UA });
    const btn = ctx.document.querySelector('[data-script="watch_bluray"]');
    const sw = btn.querySelector(".haptic-switch");
    assert.ok(sw, "iOS buttons need a real switch hit target");
    press(ctx.window, btn, { pointerType: "touch", button: 0 });
    const sent = services(ctx).filter((msg) => msg.service === "turn_on");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].service_data.entity_id, "script.watch_bluray");
    assert.deepEqual(ctx.errors, []);
  });

  it("sends Watch Blu-Ray on pointerdown", async () => {
    const ctx = await boot();
    const btn = ctx.document.querySelector('[data-script="watch_bluray"]');
    press(ctx.window, btn, { pointerType: "touch", button: -1 });
    const sent = services(ctx).filter((msg) => msg.service === "turn_on");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].domain, "script");
    assert.equal(sent[0].service_data.entity_id, "script.watch_bluray");
    assert.deepEqual(ctx.errors, []);
  });

  it("does not double-send when click follows pointerdown", async () => {
    const ctx = await boot();
    const btn = ctx.document.querySelector('[data-script="play_xbox"]');
    press(ctx.window, btn, { pointerType: "touch", button: 0 });
    fire(ctx.window, btn, "click");
    assert.equal(services(ctx).filter((msg) => msg.service === "turn_on").length, 1);
  });

  it("sends disc and xbox remote commands on pointerdown", async () => {
    const ctx = await boot({ activity: "Watch Blu-Ray" });
    const disc = ctx.document.querySelector('[data-disc="PLAYBACK"]');
    disc.disabled = false;
    press(ctx.window, disc);
    const xbox = ctx.document.querySelector('[data-xbox="A"]');
    xbox.disabled = false;
    press(ctx.window, xbox);
    const remote = services(ctx).filter((msg) => msg.domain === "remote");
    assert.equal(remote.length, 2);
    assert.equal(remote[0].service_data.command, "PLAYBACK");
    assert.equal(remote[1].service_data.command, "A");
  });

  it("sends volume up when the receiver is on", async () => {
    const ctx = await boot();
    const volUp = ctx.document.getElementById("vol-up");
    assert.equal(volUp.disabled, false);
    press(ctx.window, volUp);
    assert.ok(services(ctx).some((msg) => msg.service === "volume_up"));
  });

  it("does not send volume while the receiver is off", async () => {
    const ctx = await boot({ extra: { "media_player.tx_rz800": "off" } });
    const volUp = ctx.document.getElementById("vol-up");
    assert.equal(volUp.disabled, true);
    press(ctx.window, volUp);
    assert.equal(services(ctx).some((msg) => msg.service === "volume_up"), false);
    assert.doesNotMatch(ctx.document.querySelector('[data-device="onkyo"]').textContent, /TrueHD|Atmos/);
  });

  it("pulses vibrate on a non-iOS control press", async () => {
    const ctx = await boot();
    ctx.vibrateCalls.length = 0;
    press(ctx.window, ctx.document.querySelector('[data-script="resync"]'));
    assert.deepEqual(ctx.vibrateCalls, [12]);
  });

  it("uses the room name and shutdown copy from config", async () => {
    const ctx = await boot();
    const names = [...ctx.document.querySelectorAll("[data-room-name]")].map((el) => el.textContent);
    assert.deepEqual(names, ["Theater", "Theater", "Theater"]);
    assert.equal(ctx.document.getElementById("shutdown-confirm-title").textContent, "Shut down the theater?");
    assert.equal(
      ctx.document.getElementById("shutdown-confirm-hint").textContent,
      "This turns off the projector, Lumagen, receiver, and disc player.",
    );
  });

  it("keeps the HTML room name and shutdown sentence when config omits them", async () => {
    const ctx = await boot({
      mutateConfig(cfg) {
        cfg.name = "   ";
        cfg.shutdownTitle = "";
        cfg.shutdownHint = "";
      },
    });
    const names = [...ctx.document.querySelectorAll("[data-room-name]")].map((el) => el.textContent);
    assert.deepEqual(names, ["Theater", "Theater", "Theater"]);
    assert.equal(ctx.document.getElementById("shutdown-confirm-title").textContent, "Shut down the theater?");
    assert.equal(
      ctx.document.getElementById("shutdown-confirm-hint").textContent,
      "This turns off the projector, Lumagen, receiver, and disc player.",
    );
  });

  it("applies a different room name and shutdown sentence from config", async () => {
    const ctx = await boot({
      mutateConfig(cfg) {
        cfg.name = "Living Room";
        cfg.shutdownTitle = "Shut down the living room?";
        cfg.shutdownHint = "This turns off the TV, receiver, and Apple TV.";
      },
    });
    const names = [...ctx.document.querySelectorAll("[data-room-name]")].map((el) => el.textContent);
    assert.deepEqual(names, ["Living Room", "Living Room", "Living Room"]);
    assert.equal(ctx.document.getElementById("shutdown-confirm-title").textContent, "Shut down the living room?");
    assert.equal(
      ctx.document.getElementById("shutdown-confirm-hint").textContent,
      "This turns off the TV, receiver, and Apple TV.",
    );
  });

  it("asks before sending shutdown", async () => {
    const ctx = await boot({ activity: "Play Xbox" });
    const power = ctx.document.querySelector('[data-script="shutdown"]');
    press(ctx.window, power);
    assert.equal(services(ctx).filter((msg) => msg.service === "turn_on").length, 0);
    assert.equal(ctx.document.getElementById("shutdown-confirm").classList.contains("hidden"), false);
    press(ctx.window, ctx.document.getElementById("shutdown-cancel"));
    assert.equal(ctx.document.getElementById("shutdown-confirm").classList.contains("hidden"), true);
    press(ctx.window, power);
    press(ctx.window, ctx.document.getElementById("shutdown-ok"));
    const sent = services(ctx).filter((msg) => msg.service === "turn_on");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].service_data.entity_id, "script.theater_shutdown");
  });

  it("shows inbound audio encoding on the Onkyo pill when the receiver is on", async () => {
    const ctx = await boot();
    const pill = ctx.document.querySelector('[data-device="onkyo"]');
    assert.match(pill.textContent, /TrueHD/);
  });

  it("opens a device sheet from a status pill and closes on Back", async () => {
    const ctx = await boot({ activity: "Play Xbox" });
    const jvc = ctx.document.querySelector('[data-device="jvc"]');
    assert.ok(jvc);
    press(ctx.window, jvc);
    const sheet = ctx.document.getElementById("device-sheet");
    assert.equal(sheet.classList.contains("hidden"), false);
    assert.equal(ctx.document.getElementById("device-title").textContent, "JVC");
    assert.equal(ctx.document.getElementById("device-kicker").textContent, "NZ500");
    press(ctx.window, ctx.document.getElementById("device-back"));
    for (const [id, kicker, title] of [
      ["lumagen", "Radiance Pro", "Lumagen"],
      ["onkyo", "TX-RZ800", "Onkyo"],
      ["panasonic", "DP-UB820", "Panasonic"],
      ["xbox", "Series X", "Xbox"],
    ]) {
      press(ctx.window, ctx.document.querySelector(`[data-device="${id}"]`));
      assert.equal(ctx.document.getElementById("device-title").textContent, title);
      assert.equal(ctx.document.getElementById("device-kicker").textContent, kicker);
      press(ctx.window, ctx.document.getElementById("device-back"));
    }
    assert.equal(sheet.classList.contains("hidden"), true);
  });

  it("leaves the model line blank when a pill has no kicker", async () => {
    const ctx = await boot({
      mutateConfig(cfg) {
        const jvc = cfg.pills.find((pill) => pill.id === "jvc");
        delete jvc.kicker;
      },
    });
    press(ctx.window, ctx.document.querySelector('[data-device="jvc"]'));
    assert.equal(ctx.document.getElementById("device-title").textContent, "JVC");
    assert.equal(ctx.document.getElementById("device-kicker").textContent, "");
  });

  it("uses the pill id as the sheet title when that pill is missing", async () => {
    const ctx = await boot({
      mutateConfig(cfg) {
        cfg.name = 12;
      },
    });
    const names = [...ctx.document.querySelectorAll("[data-room-name]")].map((el) => el.textContent);
    assert.deepEqual(names, ["Theater", "Theater", "Theater"]);
    ctx.window.THEATER_CONFIG.pills = ctx.window.THEATER_CONFIG.pills.filter((pill) => pill.id !== "jvc");
    press(ctx.window, ctx.document.querySelector('[data-device="jvc"]'));
    assert.equal(ctx.document.getElementById("device-title").textContent, "jvc");
    assert.equal(ctx.document.getElementById("device-kicker").textContent, "");
  });

  it("sends Onkyo listening mode from the device sheet", async () => {
    const ctx = await boot();
    press(ctx.window, ctx.document.querySelector('[data-device="onkyo"]'));
    const atmos = ctx.document.querySelector('[data-sound="Dolby Atmos"]');
    assert.ok(atmos);
    press(ctx.window, atmos);
    const sent = services(ctx).filter((msg) => msg.service === "select_sound_mode");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].service_data.sound_mode, "Dolby Atmos");
  });

  it("sends Onkyo Setup menu keys through the PWA host", async () => {
    const ctx = await boot();
    press(ctx.window, ctx.document.querySelector('[data-device="onkyo"]'));
    const setup = ctx.document.querySelector('[data-osd="setup"]');
    const enter = ctx.document.querySelector('[data-osd="enter"]');
    assert.ok(setup);
    assert.ok(enter);
    assert.equal(setup.disabled, false);
    press(ctx.window, setup);
    press(ctx.window, enter);
    const osd = ctx.fetches.filter((req) => req.url.includes("onkyo-osd"));
    assert.ok(osd.some((req) => /cmd=setup/.test(req.url) && req.init.method === "POST"));
    assert.ok(osd.some((req) => /cmd=enter/.test(req.url)));
  });

  it("does not send Onkyo Setup while the receiver is off", async () => {
    const ctx = await boot({ extra: { "media_player.tx_rz800": "off" } });
    press(ctx.window, ctx.document.querySelector('[data-device="onkyo"]'));
    const setup = ctx.document.querySelector('[data-osd="setup"]');
    assert.ok(setup);
    assert.equal(setup.disabled, true);
    press(ctx.window, setup);
    assert.equal(ctx.fetches.some((req) => req.url.includes("onkyo-osd")), false);
  });

  it("sends JVC picture mode from the device sheet", async () => {
    const ctx = await boot({ extra: { "sensor.jvc_projector_power_state": "on" } });
    press(ctx.window, ctx.document.querySelector('[data-device="jvc"]'));
    const mode = ctx.document.querySelector('[data-select="displayPictureMode"][data-option="frame_adapt_hdr"]');
    assert.ok(mode);
    press(ctx.window, mode);
    const sent = services(ctx).filter((msg) => msg.service === "select_option");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].service_data.option, "frame_adapt_hdr");
  });

  it("sends extra Panasonic and Xbox commands from device sheets", async () => {
    const ctx = await boot({
      activity: "Watch Blu-Ray",
      extra: {
        "media_player.panasonic_bluray": "on",
        "media_player.xbox": "on",
      },
    });
    press(ctx.window, ctx.document.querySelector('[data-device="panasonic"]'));
    const skip = ctx.document.querySelector('[data-disc="SKIP"]');
    skip.disabled = false;
    press(ctx.window, skip);
    press(ctx.window, ctx.document.getElementById("device-back"));
    press(ctx.window, ctx.document.querySelector('[data-device="xbox"]'));
    const lb = ctx.document.querySelector('[data-xbox="LeftShoulder"]');
    lb.disabled = false;
    press(ctx.window, lb);
    const remote = services(ctx).filter((msg) => msg.domain === "remote");
    assert.ok(remote.some((msg) => msg.service_data.command === "SKIP"));
    assert.ok(remote.some((msg) => msg.service_data.command === "LeftShoulder"));
  });

  it("sends typed Xbox text as remote insert_text", async () => {
    const ctx = await boot({
      activity: "Play Xbox",
      extra: { "media_player.xbox": "on" },
    });
    const form = ctx.document.getElementById("xbox-type");
    const input = form.querySelector("input");
    assert.equal(input.type, "password");
    assert.equal(input.disabled, false);
    input.value = "halo";
    form.dispatchEvent(new ctx.window.Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    const remote = services(ctx).filter((msg) => msg.domain === "remote");
    assert.ok(remote.some((msg) => msg.service_data.command === "halo"));
    assert.equal(input.value, "");
  });

  it("prefixes reserved Xbox commands so typing A is text", async () => {
    const ctx = await boot({
      activity: "Play Xbox",
      extra: { "media_player.xbox": "on" },
    });
    const form = ctx.document.getElementById("xbox-type");
    const input = form.querySelector("input");
    input.value = "A";
    form.dispatchEvent(new ctx.window.Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    const remote = services(ctx).filter((msg) => msg.domain === "remote");
    assert.ok(remote.some((msg) => msg.service_data.command === "text:A"));
  });

  it("does not run shutdown when the stack is already idle", async () => {
    const ctx = await boot({
      extra: {
        "sensor.jvc_projector_power_state": "standby",
        "switch.lumagen_radiancepro_power": "off",
        "media_player.tx_rz800": "off",
      },
    });
    press(ctx.window, ctx.document.querySelector('[data-script="shutdown"]'));
    press(ctx.window, ctx.document.getElementById("shutdown-ok"));
    const scripts = services(ctx).filter((msg) => msg.domain === "script");
    assert.equal(scripts.length, 0);
    assert.equal(ctx.document.getElementById("shutdown-confirm").classList.contains("hidden"), true);
    assert.equal(ctx.document.getElementById("progress").classList.contains("hidden"), true);
  });

  it("applies a dark-room look from Settings theme swatches", async () => {
    const ctx = await boot();
    const btn = ctx.document.querySelector('#settings-sheet [data-look="void"]');
    assert.ok(btn);
    press(ctx.window, btn);
    assert.equal(ctx.document.documentElement.getAttribute("data-theme"), "void");
    assert.equal(ctx.window.localStorage.getItem("theater.theme"), "void");
  });

  it("reconnects the Home Assistant websocket after the socket closes", async () => {
    const ctx = await boot();
    const reconnect = ctx.document.getElementById("reconnect");
    assert.equal(reconnect.hidden, true);
    assert.equal(reconnect.textContent, "Offline");
    const before = ctx.FakeWebSocket.instances.length;
    ctx.FakeWebSocket.instances[0].close();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await flush();
    assert.ok(ctx.FakeWebSocket.instances.length > before);
    assert.equal(reconnect.hidden, true);
  });

  it("reconnects when returning from a lock screen", async () => {
    const ctx = await boot();
    const before = ctx.FakeWebSocket.instances.length;
    Object.defineProperty(ctx.document, "visibilityState", { configurable: true, get: () => "hidden" });
    ctx.document.dispatchEvent(new ctx.window.Event("visibilitychange"));
    Object.defineProperty(ctx.document, "visibilityState", { configurable: true, get: () => "visible" });
    ctx.document.dispatchEvent(new ctx.window.Event("visibilitychange"));
    await flush();
    assert.ok(ctx.FakeWebSocket.instances.length > before);
    assert.equal(ctx.document.getElementById("reconnect").hidden, true);
  });
});
