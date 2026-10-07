"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..", "..");
const PWA = path.join(ROOT, "pwa");

function readPwa(name) {
  return fs.readFileSync(path.join(PWA, name), "utf8");
}

function defaultStates(activity, extra) {
  const roles = {
    "script.watch_bluray": "off",
    "script.play_xbox": "off",
    "script.theater_shutdown": "off",
    "script.theater_resync": "off",
    "input_select.theater_activity": activity || "Idle",
    "input_text.theater_last_error": "",
    "sensor.jvc_projector_power_state": "off",
    "switch.lumagen_radiancepro_power": "off",
    "select.lumagen_radiancepro_input": "Blu-ray (3)",
    "select.lumagen_radiancepro_memory": "MEMA",
    "media_player.tx_rz800": "on",
    "media_player.panasonic_bluray": "off",
    "remote.panasonic_bluray": "on",
    "media_player.xbox": "off",
    "remote.xbox": "on",
      "button.lumagen_radiancepro_restart_outputs": "unknown",
      "select.jvc_projector_input": "hdmi1",
      "select.jvc_projector_picture_mode": "cinema",
      "sensor.jvc_projector_content_type": "hdr10",
      "sensor.jvc_projector_colorimetry": "bt709",
      "sensor.jvc_projector_source_display": "4K60",
      "sensor.jvc_projector_light_source_time": "312",
      "sensor.lumagen_radiancepro_input_video_status": "Active Video",
      "sensor.lumagen_radiancepro_logical_input": "1",
      "sensor.lumagen_radiancepro_source_resolution": "2160",
      "sensor.lumagen_radiancepro_source_refresh_rate": "60",
      "sensor.lumagen_radiancepro_source_dynamic_range": "HDR",
      "sensor.lumagen_radiancepro_output_resolution": "2160",
      "sensor.lumagen_radiancepro_output_refresh_rate": "60",
      "sensor.lumagen_radiancepro_output_colorspace": "BT.2020",
      "sensor.lumagen_radiancepro_output_cms_label": "Film",
      "sensor.lumagen_radiancepro_output_style_label": "MEMA",
      "button.lumagen_radiancepro_reload_config": "unknown",
    };
  if (extra) Object.assign(roles, extra);
  const attrs = {
    "media_player.tx_rz800": {
      volume_level: 0.42,
      is_volume_muted: false,
      source: "VIDEO3 ··· GAME/TV ··· GAME",
      sound_mode: "DIRECT",
      sound_mode_list: ["DIRECT", "Dolby Atmos", "THX Cinema"],
      audio_information: {
        input_signal_format: "Dolby TrueHD",
        input_frequency: "48 kHz",
        output_channels: "7.1 ch",
        listening_mode: "Direct",
      },
    },
    "select.jvc_projector_picture_mode": {
      options: ["cinema", "natural", "frame_adapt_hdr"],
    },
  };
  return Object.entries(roles).map(([entity_id, state]) => {
    if (state && typeof state === "object" && !Array.isArray(state) && ("state" in state || "attributes" in state)) {
      return {
        entity_id,
        state: state.state != null ? state.state : "unknown",
        attributes: Object.assign({}, attrs[entity_id] || {}, state.attributes || {}),
      };
    }
    return {
      entity_id,
      state,
      attributes: attrs[entity_id] || {},
    };
  });
}

function createFakeWebSocket(getStates, getBrowseMedia) {
  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.CONNECTING;
      this.sent = [];
      this.listeners = { open: [], close: [], error: [], message: [] };
      FakeWebSocket.instances.push(this);
      queueMicrotask(() => {
        this.readyState = FakeWebSocket.OPEN;
        this.listeners.open.forEach((fn) => fn());
        this._emit({ type: "auth_required" });
      });
    }
    addEventListener(type, fn) {
      (this.listeners[type] || []).push(fn);
    }
    close() {
      if (this.readyState === FakeWebSocket.CLOSED) return;
      this.readyState = FakeWebSocket.CLOSED;
      this.listeners.close.forEach((fn) => fn());
    }
    send(raw) {
      const msg = JSON.parse(raw);
      this.sent.push(msg);
      if (msg.type === "auth") {
        queueMicrotask(() => this._emit({ type: "auth_ok" }));
      } else if (msg.type === "get_states") {
        queueMicrotask(() => this._emit({
          id: msg.id,
          type: "result",
          success: true,
          result: typeof getStates === "function" ? getStates() : getStates,
        }));
      } else if (msg.type === "subscribe_entities" || msg.type === "call_service") {
        queueMicrotask(() => this._emit({
          id: msg.id,
          type: "result",
          success: true,
          result: {},
        }));
      } else if (msg.type === "media_player/browse_media") {
        const tree = typeof getBrowseMedia === "function"
          ? getBrowseMedia(msg)
          : {
            title: "Apps",
            media_class: "directory",
            media_content_type: "app",
            media_content_id: "",
            children: [
              { title: "Netflix", media_content_id: "9WZDNCRFJ3TJ", media_content_type: "app", can_play: true, can_expand: false, thumbnail: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96'%3E%3Crect fill='%23e50914' width='96' height='96'/%3E%3Ctext x='48' y='58' text-anchor='middle' fill='white' font-size='28' font-family='sans-serif'%3EN%3C/text%3E%3C/svg%3E" },
              { title: "Disney+", media_content_id: "9NXQXX0F5D06", media_content_type: "app", can_play: true, can_expand: false, thumbnail: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96'%3E%3Crect fill='%23113ccf' width='96' height='96'/%3E%3Ctext x='48' y='58' text-anchor='middle' fill='white' font-size='22' font-family='sans-serif'%3ED%2B%3C/text%3E%3C/svg%3E" },
              { title: "Halo Infinite", media_content_id: "9PLN1J1P8P8J", media_content_type: "game", can_play: true, can_expand: false, thumbnail: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96'%3E%3Crect fill='%233a7d44' width='96' height='96'/%3E%3Ctext x='48' y='58' text-anchor='middle' fill='white' font-size='28' font-family='sans-serif'%3EH%3C/text%3E%3C/svg%3E" },
              { title: "YouTube", media_content_id: "9WZDNCRF1Q69", media_content_type: "app", can_play: true, can_expand: false, thumbnail: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96'%3E%3Crect fill='%23ff0000' width='96' height='96'/%3E%3Ctext x='48' y='58' text-anchor='middle' fill='white' font-size='28' font-family='sans-serif'%3EYT%3C/text%3E%3C/svg%3E" },
              { title: "No Art App", media_content_id: "9NOTHUMB0001", media_content_type: "app", can_play: true, can_expand: false, thumbnail: "" },
            ],
          };
        queueMicrotask(() => this._emit({
          id: msg.id,
          type: "result",
          success: true,
          result: tree,
        }));
      }
    }
    _emit(data) {
      const ev = { data: JSON.stringify(data) };
      this.listeners.message.forEach((fn) => fn(ev));
    }
  }
  FakeWebSocket.CONNECTING = 0;
  FakeWebSocket.OPEN = 1;
  FakeWebSocket.CLOSING = 2;
  FakeWebSocket.CLOSED = 3;
  FakeWebSocket.instances = [];
  return FakeWebSocket;
}

async function flush(rounds) {
  for (let i = 0; i < (rounds || 12); i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function fire(window, el, type, props) {
  const ev = new window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(ev, { pointerType: "touch", button: 0 }, props || {});
  el.dispatchEvent(ev);
  return ev;
}

function press(window, el, props) {
  const hit = (window.TheaterControls && window.TheaterControls.hapticHitTarget)
    ? window.TheaterControls.hapticHitTarget(el)
    : el;
  return fire(window, hit, "pointerdown", props);
}

function bootDom(options) {
  options = options || {};
  const html = readPwa("index.html").replace(/<script[\s\S]*?<\/script>/g, "");
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:8765/",
    pretendToBeVisual: true,
    runScripts: "outside-only",
    userAgent: options.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
  });
  const { window } = dom;
  if (options.userAgent) {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      get() { return options.userAgent; },
    });
  }
  const errors = [];
  window.addEventListener("error", (ev) => errors.push(ev.error || ev.message));
  window.addEventListener("unhandledrejection", (ev) => errors.push(ev.reason));
  const vibrateCalls = [];
  window.navigator.vibrate = (ms) => {
    vibrateCalls.push(ms);
    return true;
  };
  const fetches = [];
  window.fetch = async (url, init) => {
    const href = String(url);
    fetches.push({ url: href, init: init || {} });
    if (href.includes("auth.json")) {
      return { ok: true, json: async () => ({ haUrl: "http://homeassistant.local", token: "test-token" }) };
    }
    if (href.includes("contracts.json")) {
      return { ok: true, json: async () => JSON.parse(readPwa("contracts.json")) };
    }
    if (href.includes("onkyo-osd")) {
      return { ok: true, json: async () => ({ ok: true }) };
    }
    return { ok: false };
  };
  const FakeWebSocket = createFakeWebSocket(options.states || defaultStates(options.activity, options.extra));
  window.WebSocket = FakeWebSocket;
  window.eval(readPwa("config.js"));
  if (typeof options.mutateConfig === "function") {
    options.mutateConfig(window.THEATER_CONFIG);
  }
  window.eval(readPwa("controls.js"));
  ["jvc.js", "lumagen.js", "onkyo.js", "panasonic.js", "xbox.js", "appletv.js"].forEach((name) => {
    window.eval(readPwa(path.join("sheets", name)));
  });
  window.eval(readPwa("app.js"));
  return { window, document: window.document, FakeWebSocket, errors, vibrateCalls, fetches, fire: (el, type, props) => fire(window, el, type, props) };
}

async function bootApp(options) {
  const ctx = bootDom(options);
  await flush();
  return ctx;
}

module.exports = {
  ROOT,
  PWA,
  readPwa,
  defaultStates,
  flush,
  fire,
  press,
  bootDom,
  bootApp,
  IPHONE_UA: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
};
