"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const { readPwa, fire } = require("./harness");

eval(readPwa("controls.js"));
const Controls = globalThis.TheaterControls;

const IPHONE = {
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15",
};

function buttonDom() {
  const dom = new JSDOM(`<!doctype html><button id="go" type="button">Go</button>`);
  return { window: dom.window, btn: dom.window.document.getElementById("go") };
}

describe("bindImmediate", () => {
  it("fires on touch pointerdown, not again on the following click", () => {
    const { window, btn } = buttonDom();
    let n = 0;
    Controls.bindImmediate(btn, () => { n += 1; }, { ios: false, hapticPulse() {} });
    fire(window, btn, "pointerdown", { pointerType: "touch", button: -1 });
    fire(window, btn, "click");
    assert.equal(n, 1);
  });

  it("fires on a click that had no pointerdown (keyboard)", () => {
    const { window, btn } = buttonDom();
    let n = 0;
    Controls.bindImmediate(btn, () => { n += 1; }, { ios: false, hapticPulse() {} });
    fire(window, btn, "click");
    assert.equal(n, 1);
  });

  it("ignores disabled controls", () => {
    const { window, btn } = buttonDom();
    btn.disabled = true;
    let n = 0;
    Controls.bindImmediate(btn, () => { n += 1; }, { ios: false, hapticPulse() {} });
    fire(window, btn, "pointerdown", { pointerType: "touch", button: 0 });
    fire(window, btn, "click");
    assert.equal(n, 0);
  });

  it("ignores non-primary mouse buttons", () => {
    const { window, btn } = buttonDom();
    let n = 0;
    Controls.bindImmediate(btn, () => { n += 1; }, { ios: false, hapticPulse() {} });
    fire(window, btn, "pointerdown", { pointerType: "mouse", button: 2 });
    assert.equal(n, 0);
    fire(window, btn, "pointerdown", { pointerType: "mouse", button: 0 });
    assert.equal(n, 1);
  });

  it("does not treat iOS touch pointerdown (button -1) as a rejected mouse click", () => {
    const { window, btn } = buttonDom();
    let n = 0;
    Controls.bindImmediate(btn, () => { n += 1; }, { ios: false, hapticPulse() {} });
    fire(window, btn, "pointerdown", { pointerType: "touch", button: -1 });
    assert.equal(n, 1);
  });

  it("pulses vibrate on non-iOS press", () => {
    const { window, btn } = buttonDom();
    let pulses = 0;
    Controls.bindImmediate(btn, () => {}, { ios: false, hapticPulse() { pulses += 1; } });
    fire(window, btn, "pointerdown", { pointerType: "touch", button: 0 });
    assert.equal(pulses, 1);
  });
});

describe("iOS haptic overlay", () => {
  it("puts a native switch on the button so the finger tap is the haptic", () => {
    const { window, btn } = buttonDom();
    let n = 0;
    Controls.bindImmediate(btn, () => { n += 1; }, { ios: true, nav: IPHONE, hapticPulse() { n += 100; } });
    const sw = btn.querySelector(".haptic-switch");
    assert.ok(sw);
    assert.equal(sw.getAttribute("switch"), "");
    assert.equal(Controls.hapticHitTarget(btn), sw);
    fire(window, sw, "pointerdown", { pointerType: "touch", button: 0 });
    assert.equal(n, 1);
  });

  it("does not fire the command from a scripted checked toggle", () => {
    const { btn } = buttonDom();
    let n = 0;
    Controls.bindImmediate(btn, () => { n += 1; }, { ios: true, hapticPulse() {} });
    const sw = btn.querySelector(".haptic-switch");
    sw.checked = !sw.checked;
    assert.equal(n, 0);
  });

  it("ignores presses on a disabled iOS control even with an overlay", () => {
    const { window, btn } = buttonDom();
    btn.disabled = true;
    let n = 0;
    Controls.bindImmediate(btn, () => { n += 1; }, { ios: true, hapticPulse() {} });
    fire(window, Controls.hapticHitTarget(btn), "pointerdown", { pointerType: "touch", button: 0 });
    assert.equal(n, 0);
  });
});

describe("hapticPulse", () => {
  it("calls navigator.vibrate when available", () => {
    const calls = [];
    Controls.hapticPulse({ vibrate: (ms) => calls.push(ms) });
    assert.deepEqual(calls, [12]);
  });
});
