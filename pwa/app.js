(() => {
  const standalone = window.navigator.standalone === true
    || (typeof window.matchMedia === "function" && (
      window.matchMedia("(display-mode: standalone)").matches
      || window.matchMedia("(display-mode: fullscreen)").matches
      || window.matchMedia("(display-mode: minimal-ui)").matches
    ));
  document.documentElement.classList.toggle("standalone", standalone);
  if (standalone) {
    document.documentElement.style.setProperty("--app-height", "100vh");
  }

  const CFG = window.THEATER_CONFIG;
  const STORAGE_URL = "theater.haUrl";
  const STORAGE_TOKEN = "theater.haToken";
  const STORAGE_THEME = "theater.theme";
  const STORAGE_DEFAULT_VOLUME = "theater.defaultVolume";
  const STORAGE_XBOX_FAVORITES = "theater.xboxFavoriteApps";
  const STORAGE_XBOX_BLACKLIST = "theater.xboxAppBlacklist";
  const STORAGE_XBOX_CATALOG = "theater.xboxAppCatalog";
  const STORAGE_ATV_FAVORITES = "theater.appletvFavoriteApps";
  const STORAGE_ATV_BLACKLIST = "theater.appletvAppBlacklist";
  const STORAGE_ATV_CATALOG = "theater.appletvAppCatalog";
  const DEFAULT_XBOX_BLACKLIST = [
    { productId: "9NBLGGGZ5QDQ", label: "Xbox Original Avatars" },
    { productId: "9PJJ1K9DZMRS", label: "HBO Max" },
    { productId: "9N0866FS04W8", label: "Dolby Access" },
  ];
  const DEFAULT_ATV_BLACKLIST = [
    { bundleId: "com.apple.TVSettings", label: "Settings" },
    { bundleId: "com.apple.TVAppStore", label: "App Store" },
    { bundleId: "com.apple.TVSearch", label: "Search" },
  ];
  const THEME_IDS = ["ember", "void", "phosphor", "abyss"];
  const RECONNECT_UI_AFTER = 3;
  const ACTIVITIES = (CFG && Array.isArray(CFG.activities)) ? CFG.activities : [];
  const ACTIVITY_BY_ID = Object.fromEntries(ACTIVITIES.map((a) => [a.id, a]));
  const ACTIVITY_BY_LABEL = Object.fromEntries(ACTIVITIES.map((a) => [a.label, a]));
  const SCRIPT_KEYS = ACTIVITIES.map((a) => a.id).concat(["shutdown", "resync"]);
  const ACTIVITY_LABEL = Object.assign(
    { shutdown: "Shutdown", resync: "Resync" },
    Object.fromEntries(ACTIVITIES.map((a) => [a.id, a.label])),
  );

  const $ = (id) => document.getElementById(id);
  const setupEl = $("setup");
  const mainEl = $("main");
  const banner = $("banner");
  const progressEl = $("progress");
  const progressTitle = $("progress-title");
  const progressDetail = $("progress-detail");
  const statusEl = $("status");
  const activityTitle = $("activity-title");
  const activitiesEl = $("activities");
  const reconnectBtn = $("reconnect");
  const helpBtn = $("help");
  const hasLumagenHelp = !!(CFG && CFG.roles && CFG.roles.lumagenRestart);
  if (helpBtn) helpBtn.hidden = !hasLumagenHelp;
  const settingsSheet = $("settings-sheet");
  const openSettingsBtn = $("open-settings");
  const idleOpenSettingsBtn = $("idle-open-settings");
  const settingsBackBtn = $("settings-back");
  const volume = $("volume");
  const volumeLabel = $("volume-label");
  const muteBtn = $("mute");
  const volUp = $("vol-up");
  const volDown = $("vol-down");
  const discState = $("disc-state");
  const xboxState = $("xbox-state");
  const appletvState = $("appletv-state");
  const idleDeck = $("idle-deck");
  const deviceSheet = $("device-sheet");
  const deviceBody = $("device-body");
  const deviceTitle = $("device-title");
  const deviceKicker = $("device-kicker");
  const deviceLive = $("device-live");
  const deviceBack = $("device-back");
  applyRoomName();
  applyShutdownCopy();

  const entityIds = CFG
    ? [
        ...Object.values(CFG.scripts || {}),
        CFG.helpers.activity,
        CFG.helpers.error,
        ...Object.values(CFG.roles),
      ]
    : [];

  let haUrl = "";
  let token = "";
  let ws = null;
  let wantLive = false;
  let reconnectTimer = 0;
  let reconnectAttempt = 0;
  let msgId = 1;
  const pending = new Map();
  let states = {};
  let volumeBusy = false;
  let defaultVolumeApplied = false;
  let xboxCatalogRefreshing = false;
  let lastXboxBrowseState = "";
  let xboxAppsStripSig = "";
  let atvCatalogRefreshing = false;
  let atvAppsStripSig = "";
  let lastAtvBrowseState = "";
  let startKey = null;
  let startAt = 0;
  let helpUntil = 0;
  let CONTRACTS = {};
  let settleUntil = 0;
  let settleNote = "";
  let sheetDevice = null;
  let sheetSig = "";

  function defaultHaUrl() {
    if (location.pathname.includes("/local/")) return location.origin;
    return "http://homeassistant.local";
  }

  function apiBase() {
    return haUrl.replace(/\/$/, "");
  }

  function wsUrl() {
    const u = new URL(apiBase());
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    u.pathname = "/api/websocket";
    u.search = "";
    u.hash = "";
    return u.toString();
  }

  function setLive(ok) {
    if (ok) {
      reconnectBtn.hidden = true;
      reconnectBtn.classList.remove("down");
      reconnectBtn.textContent = "Offline";
      return;
    }
    const show = reconnectAttempt >= RECONNECT_UI_AFTER;
    reconnectBtn.hidden = !show;
    reconnectBtn.textContent = "Offline";
    reconnectBtn.classList.toggle("down", show);
  }

  function send(payload) {
    const id = msgId++;
    payload = Object.assign({ id }, payload);
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        pending.delete(id);
        reject(new Error("not connected"));
        return;
      }
      ws.send(JSON.stringify(payload));
    });
  }

  function callService(domain, service, data, wait) {
    const payload = {
      type: "call_service",
      domain,
      service,
      target: data && data.entity_id ? { entity_id: data.entity_id } : undefined,
      service_data: data,
    };
    if (wait === false) {
      const id = msgId++;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error("not connected"));
      }
      pending.set(id, {
        resolve: () => {},
        reject: (err) => {
          if (domain === "script") startKey = null;
          banner.textContent = err.message || (domain === "script" ? "Could not start activity." : "Command failed.");
          banner.classList.remove("hidden");
          render();
        },
      });
      ws.send(JSON.stringify(Object.assign({ id }, payload)));
      return Promise.resolve();
    }
    return send(payload);
  }

  function applyEntityDiff(diff) {
    // Match home-assistant-js-websocket: additions merge, removals delete.
    // Without "-" handling, media_title/app_name stick after switching Xbox apps.
    if (diff.a) {
      for (const [eid, patch] of Object.entries(diff.a)) {
        states[eid] = {
          entity_id: eid,
          state: patch.s !== undefined ? patch.s : patch.state,
          attributes: Object.assign({}, patch.a || patch.attributes || {}),
        };
      }
    }
    if (diff.c) {
      for (const [eid, change] of Object.entries(diff.c)) {
        const prev = states[eid] || { entity_id: eid, attributes: {} };
        const toAdd = change["+"] || {};
        const toRemove = change["-"] || {};
        const next = Object.assign({ entity_id: eid, attributes: prev.attributes || {} }, prev);
        if (toAdd.s !== undefined) next.state = toAdd.s;
        if (toAdd.state !== undefined) next.state = toAdd.state;
        const attrsChanged = !!(toAdd.a || toAdd.attributes || toRemove.a);
        let attrs = attrsChanged ? Object.assign({}, next.attributes) : next.attributes;
        if (toAdd.a) Object.assign(attrs, toAdd.a);
        if (toAdd.attributes) attrs = Object.assign({}, toAdd.attributes);
        if (toRemove.a) {
          for (const key of toRemove.a) delete attrs[key];
        }
        if (toAdd.a) {
          for (const [key, value] of Object.entries(toAdd.a)) {
            if (value === null) delete attrs[key];
          }
        }
        if (attrsChanged) next.attributes = attrs;
        states[eid] = next;
      }
    }
    if (diff.r) {
      for (const eid of diff.r) delete states[eid];
    }
  }

  function isOn(state) {
    if (!state) return false;
    const s = String(state).toLowerCase();
    return !["off", "unavailable", "unknown", "standby"].includes(s);
  }

  const XBOX_TEXT_RESERVED = new Set([
    "A", "B", "X", "Y", "Up", "Down", "Left", "Right", "Menu", "View", "Nexus",
    "WakeUp", "TurnOff", "Reboot", "Mute", "Unmute", "Play", "Pause", "Next",
    "Previous", "GoHome", "GoBack", "ShowGuideTab", "ShowGuide",
    "LeftShoulder", "RightShoulder",
  ]);

  function xboxTextCommand(raw) {
    const value = String(raw == null ? "" : raw).trim();
    if (!value) return "";
    return XBOX_TEXT_RESERVED.has(value) ? "text:" + value : value;
  }

  function readJsonStorage(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }

  function writeJsonStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }

  function getDefaultVolume() {
    const raw = localStorage.getItem(STORAGE_DEFAULT_VOLUME);
    if (raw == null || raw === "") return 50;
    const n = Number(raw);
    if (!Number.isFinite(n)) return 50;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function setDefaultVolume(n) {
    if (n == null || n === "") {
      try { localStorage.removeItem(STORAGE_DEFAULT_VOLUME); } catch (_) {}
      return;
    }
    const v = Math.max(0, Math.min(100, Math.round(Number(n))));
    try { localStorage.setItem(STORAGE_DEFAULT_VOLUME, String(v)); } catch (_) {}
  }

  function getFavoriteApps() {
    const list = readJsonStorage(STORAGE_XBOX_FAVORITES, []);
    return Array.isArray(list) ? list.filter((a) => a && a.productId) : [];
  }

  function setFavoriteApps(list) {
    writeJsonStorage(STORAGE_XBOX_FAVORITES, Array.isArray(list) ? list : []);
  }

  function getBlacklistApps() {
    let raw = null;
    try { raw = localStorage.getItem(STORAGE_XBOX_BLACKLIST); } catch (_) {}
    if (raw == null) {
      return DEFAULT_XBOX_BLACKLIST.map((a) => ({ productId: a.productId, label: a.label }));
    }
    try {
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list.filter((a) => a && a.productId) : [];
    } catch (_) {
      return DEFAULT_XBOX_BLACKLIST.map((a) => ({ productId: a.productId, label: a.label }));
    }
  }

  function setBlacklistApps(list) {
    writeJsonStorage(STORAGE_XBOX_BLACKLIST, Array.isArray(list) ? list : []);
  }

  function blacklistedProductIds() {
    return new Set(getBlacklistApps().map((a) => String(a.productId)));
  }

  function getXboxAppCatalog() {
    const cat = readJsonStorage(STORAGE_XBOX_CATALOG, { fetchedAt: 0, apps: [] });
    if (!cat || !Array.isArray(cat.apps)) return { fetchedAt: 0, apps: [] };
    return cat;
  }

  function setXboxAppCatalog(apps) {
    writeJsonStorage(STORAGE_XBOX_CATALOG, {
      fetchedAt: Date.now(),
      apps: Array.isArray(apps) ? apps : [],
    });
  }

  function flattenBrowseMedia(node, out, seen) {
    if (!node || typeof node !== "object") return;
    const id = String(node.media_content_id || "");
    if (node.can_play && id && id !== "Home" && id !== "TV" && !seen.has(id)) {
      seen.add(id);
      out.push({
        productId: id,
        label: String(node.title || id).trim() || id,
        thumbnail: node.thumbnail ? String(node.thumbnail) : "",
        media_content_type: node.media_content_type != null ? String(node.media_content_type) : "app",
      });
    }
    const kids = node.children;
    if (Array.isArray(kids)) {
      kids.forEach((child) => flattenBrowseMedia(child, out, seen));
    }
  }

  function isSwitcherApp(app) {
    if (!app || !app.productId) return false;
    if (!String(app.thumbnail || "").trim()) return false;
    const typ = String(app.media_content_type || "app").toLowerCase();
    if (typ === "game") return false;
    if (blacklistedProductIds().has(String(app.productId))) return false;
    return true;
  }

  function expandableBrowseTargets(node, out, seen) {
    if (!node || typeof node !== "object") return;
    const id = String(node.media_content_id || "");
    const typ = node.media_content_type != null ? String(node.media_content_type) : "";
    if (String(typ).toLowerCase() === "game") return;
    if (node.can_expand && id && !seen.has(typ + "\0" + id)) {
      seen.add(typ + "\0" + id);
      out.push({ media_content_id: id, media_content_type: typ });
    }
    const kids = node.children;
    if (Array.isArray(kids)) {
      kids.forEach((child) => expandableBrowseTargets(child, out, seen));
    }
  }

  async function browseXboxMedia(contentType, contentId) {
    const payload = {
      type: "media_player/browse_media",
      entity_id: CFG.roles.xbox,
    };
    if (contentType != null && contentType !== "" && contentId != null && contentId !== "") {
      payload.media_content_type = contentType;
      payload.media_content_id = contentId;
    }
    return send(payload);
  }

  async function refreshXboxAppCatalog() {
    if (!CFG.roles.xbox || xboxCatalogRefreshing) return getXboxAppCatalog();
    if (!ws || ws.readyState !== WebSocket.OPEN) return getXboxAppCatalog();
    if (!xboxEntityInteractive()) return getXboxAppCatalog();
    xboxCatalogRefreshing = true;
    try {
      const root = await browseXboxMedia(null, null);
      const apps = [];
      const seenApps = new Set();
      flattenBrowseMedia(root, apps, seenApps);
      const folders = [];
      const rootKids = Array.isArray(root && root.children) ? root.children : [];
      rootKids.forEach((child) => expandableBrowseTargets(child, folders, new Set()));
      for (const folder of folders) {
        try {
          const branch = await browseXboxMedia(folder.media_content_type, folder.media_content_id);
          flattenBrowseMedia(branch, apps, seenApps);
        } catch (_) {}
      }
      if (apps.length) setXboxAppCatalog(apps);
      return getXboxAppCatalog();
    } catch (_) {
      return getXboxAppCatalog();
    } finally {
      xboxCatalogRefreshing = false;
    }
  }

  function xboxEntityInteractive() {
    if (!CFG || !CFG.roles || !CFG.roles.xbox) return false;
    const st = states[CFG.roles.xbox] || {};
    const s = String(st.state || "").toLowerCase();
    return s && s !== "unavailable" && s !== "unknown";
  }

  function orderedXboxApps() {
    const favs = getFavoriteApps();
    const catalog = getXboxAppCatalog().apps || [];
    const byId = new Map(catalog.map((a) => [a.productId, a]));
    const favIds = new Set();
    const ordered = [];
    favs.forEach((f) => {
      const id = String(f.productId);
      if (!id || favIds.has(id)) return;
      favIds.add(id);
      const c = byId.get(id);
      ordered.push({
        productId: id,
        label: String((f.label || (c && c.label) || id)).trim() || id,
        thumbnail: (c && c.thumbnail) || "",
        media_content_type: (c && c.media_content_type) || "app",
      });
    });
    catalog
      .filter((a) => a && a.productId && !favIds.has(a.productId))
      .slice()
      .sort((a, b) => String(a.label || "").localeCompare(String(b.label || ""), undefined, { sensitivity: "base" }))
      .forEach((a) => ordered.push(a));
    return ordered.filter(isSwitcherApp);
  }

  function appThumbSrc(thumbnail) {
    if (!thumbnail) return "";
    return String(thumbnail).indexOf("/api/") === 0
      ? "/media-art?src=" + encodeURIComponent(thumbnail)
      : String(thumbnail);
  }

  function appTileArt(app) {
    const mono = String(app.label || "?").trim().charAt(0).toUpperCase() || "?";
    if (app.thumbnail) {
      const src = appThumbSrc(app.thumbnail);
      return `<img src="${esc(src)}" alt="" data-fallback="${esc(mono)}" crossorigin="anonymous" decoding="async" />`;
    }
    return `<span class="app-mono" aria-hidden="true">${esc(mono)}</span>`;
  }

  function bindArtFallback(root) {
    if (!root) return;
    root.querySelectorAll("img[data-fallback]").forEach((img) => {
      img.addEventListener("error", () => {
        const span = document.createElement("span");
        span.className = "app-mono";
        span.setAttribute("aria-hidden", "true");
        span.textContent = img.dataset.fallback || "?";
        img.replaceWith(span);
      });
    });
  }

  const appLogoCropCache = new Map();

  function colorDist(a, b) {
    const dr = a[0] - b[0];
    const dg = a[1] - b[1];
    const db = a[2] - b[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  function measureLogoBounds(img) {
    const w = img.naturalWidth || 0;
    const h = img.naturalHeight || 0;
    if (!w || !h) return null;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    try {
      ctx.drawImage(img, 0, 0);
    } catch (_) {
      return null;
    }
    let data;
    try {
      data = ctx.getImageData(0, 0, w, h).data;
    } catch (_) {
      return null;
    }
    const sample = (x, y) => {
      const i = (y * w + x) * 4;
      return [data[i], data[i + 1], data[i + 2], data[i + 3]];
    };
    const points = [
      [2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3],
      [Math.floor(w / 2), 2], [Math.floor(w / 2), h - 3],
      [2, Math.floor(h / 2)], [w - 3, Math.floor(h / 2)],
    ];
    const bg = [0, 0, 0];
    points.forEach(([x, y]) => {
      const p = sample(x, y);
      bg[0] += p[0];
      bg[1] += p[1];
      bg[2] += p[2];
    });
    bg[0] /= points.length;
    bg[1] /= points.length;
    bg[2] /= points.length;

    const step = Math.max(1, Math.floor(Math.min(w, h) / 420));
    let x0 = w;
    let y0 = h;
    let x1 = 0;
    let y1 = 0;
    let hits = 0;
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const i = (y * w + x) * 4;
        if (data[i + 3] < 8) continue;
        if (colorDist([data[i], data[i + 1], data[i + 2]], bg) <= 28) continue;
        hits += 1;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
    if (!hits) {
      const side = Math.min(w, h);
      return {
        x: Math.floor((w - side) / 2),
        y: Math.floor((h - side) / 2),
        w: side,
        h: side,
        cx: w / 2,
        cy: h / 2,
        rel: 1,
      };
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    return {
      x: x0,
      y: y0,
      w: bw,
      h: bh,
      cx: x0 + bw / 2,
      cy: y0 + bh / 2,
      rel: Math.max(bw / w, bh / h),
    };
  }

  function cropLogoNormalized(img, maxRel, pad) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const bounds = measureLogoBounds(img);
    if (!bounds) return null;
    const minDim = Math.min(w, h);
    const side = Math.max(1, Math.min(minDim, Math.ceil(maxRel * pad * minDim)));
    let x = Math.round(bounds.cx - side / 2);
    let y = Math.round(bounds.cy - side / 2);
    x = Math.max(0, Math.min(w - side, x));
    y = Math.max(0, Math.min(h - side, y));
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, x, y, side, side, 0, 0, side, side);
    try {
      return canvas.toDataURL("image/png");
    } catch (_) {
      return null;
    }
  }

  function waitForImage(img) {
    if (img.complete && img.naturalWidth) return Promise.resolve(img);
    return new Promise((resolve) => {
      const done = () => resolve(img);
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
    });
  }

  function normalizeSwitcherTileCrops(grid) {
    if (!grid) return;
    const imgs = [...grid.querySelectorAll("img")];
    if (!imgs.length) return;
    Promise.all(imgs.map(waitForImage)).then(() => {
      const ready = imgs.filter((img) => img.naturalWidth > 0 && img.naturalHeight > 0);
      if (!ready.length) return;
      const measured = ready.map((img) => ({
        img,
        key: img.currentSrc || img.src,
        bounds: measureLogoBounds(img),
      }));
      let maxRel = 0;
      measured.forEach((row) => {
        if (row.bounds && row.bounds.rel > maxRel) maxRel = row.bounds.rel;
      });
      if (!(maxRel > 0)) maxRel = 0.85;
      const pad = 1.28;
      measured.forEach((row) => {
        const cached = appLogoCropCache.get(row.key);
        if (cached) {
          if (row.img.src !== cached) row.img.src = cached;
          row.img.classList.add("logo-crop");
          return;
        }
        const dataUrl = cropLogoNormalized(row.img, maxRel, pad);
        if (!dataUrl) return;
        appLogoCropCache.set(row.key, dataUrl);
        row.img.src = dataUrl;
        row.img.removeAttribute("crossorigin");
        row.img.classList.add("logo-crop");
      });
    });
  }

  function renderXboxAppsStrip() {
    const grid = $("xbox-apps-grid");
    const openBtn = $("open-xbox-apps");
    const xbox = CFG.roles.xbox ? (states[CFG.roles.xbox] || {}) : {};
    const ready = isOn(xbox.state);
    if (openBtn) openBtn.disabled = !ready;
    if (!grid) return;
    const apps = orderedXboxApps();
    const tiles = apps.slice();
    const sig = (ready ? "1" : "0") + "|" + tiles.map((a) => a.productId + ":" + a.label + ":" + (a.thumbnail || "")).join(",");
    if (sig === xboxAppsStripSig && grid.childElementCount) {
      grid.querySelectorAll("[data-xbox-app]").forEach((btn) => {
        btn.disabled = !ready;
      });
      return;
    }
    xboxAppsStripSig = sig;
    if (!tiles.length) {
      grid.innerHTML = `<p class="hint">${esc(catalogHintText())}</p>`;
      return;
    }
    grid.innerHTML = tiles.map((app) => {
      return `<button type="button" class="xbox-app-tile" role="listitem" data-xbox-app="${esc(app.productId)}"${ready ? "" : " disabled"} title="${esc(app.label)} — double-tap to launch" aria-label="${esc(app.label)}">${appTileArt(app)}</button>`;
    }).join("");
    bindArtFallback(grid);
    grid.querySelectorAll("[data-xbox-app]").forEach((btn) => {
      if (Controls && Controls.bindDoubleTap) {
        Controls.bindDoubleTap(btn, () => {
          if (btn.disabled) return;
          launchXboxApp(btn.dataset.xboxApp);
          closeXboxAppsSheet();
        });
      } else {
        bindImmediate(btn, () => {
          if (btn.disabled) return;
          launchXboxApp(btn.dataset.xboxApp);
          closeXboxAppsSheet();
        });
      }
    });
    normalizeSwitcherTileCrops(grid);
  }

  function openXboxAppsSheet() {
    const sheet = $("xbox-apps-sheet");
    if (!sheet) return;
    sheet.classList.remove("hidden");
    renderXboxAppsStrip();
    refreshXboxAppCatalog().then(() => {
      xboxAppsStripSig = "";
      renderXboxAppsStrip();
    });
  }

  function closeXboxAppsSheet() {
    const sheet = $("xbox-apps-sheet");
    if (!sheet) return;
    sheet.classList.add("hidden");
  }

  function launchXboxApp(productId) {
    const entity = CFG.roles.xbox;
    if (!entity || !productId) return;
    const catalogApp = (getXboxAppCatalog().apps || []).find((a) => a.productId === productId);
    const favApp = getFavoriteApps().find((a) => a.productId === productId);
    const label = (catalogApp && catalogApp.label) || (favApp && favApp.label) || "";
    const thumb = (catalogApp && catalogApp.thumbnail) || "";
    const prev = states[entity] || { entity_id: entity, attributes: {} };
    const attrs = Object.assign({}, prev.attributes || {}, {
      media_content_id: productId,
      media_content_type: "app",
    });
    delete attrs.media_title;
    delete attrs.media_artist;
    delete attrs.media_album_name;
    delete attrs.media_series_title;
    delete attrs.entity_picture;
    delete attrs.entity_picture_local;
    if (label) {
      attrs.app_name = label;
      attrs.media_title = label;
    } else {
      delete attrs.app_name;
    }
    if (thumb) attrs.entity_picture = thumb;
    states[entity] = Object.assign({}, prev, {
      state: prev.state && prev.state !== "off" ? prev.state : "on",
      attributes: attrs,
    });
    render();
    callService("media_player", "play_media", {
      entity_id: entity,
      media_content_id: productId,
      media_content_type: "app",
    }, false).catch(() => {
      banner.textContent = "Xbox app launch failed.";
      banner.classList.remove("hidden");
    });
  }

  function catalogHintText() {
    const cat = getXboxAppCatalog();
    if (cat.fetchedAt) {
      const when = new Date(cat.fetchedAt);
      const stamp = when.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      if (!xboxEntityInteractive()) {
        return "Last synced " + stamp + ". Wake Xbox to refresh.";
      }
      return "Library synced " + stamp + " · " + (cat.apps || []).length + " apps";
    }
    if (!xboxEntityInteractive()) {
      return "Wake the Xbox (or start Play Xbox once) to load apps.";
    }
    return "Loading Xbox library…";
  }

  function renderFavoritesSettings() {
    const list = $("xbox-favorites-list");
    const hint = $("xbox-catalog-hint");
    if (hint) hint.textContent = catalogHintText();
    if (!list) return;
    const favs = getFavoriteApps();
    if (!favs.length) {
      list.innerHTML = `<li class="hint" style="background:none;box-shadow:none;padding:0">No favorites yet.</li>`;
      return;
    }
    const byId = new Map((getXboxAppCatalog().apps || []).map((a) => [a.productId, a]));
    list.innerHTML = favs.map((f, idx) => {
      const catalog = byId.get(f.productId);
      const app = {
        productId: f.productId,
        label: f.label || (catalog && catalog.label) || f.productId,
        thumbnail: (catalog && catalog.thumbnail) || "",
      };
      return `<li data-product-id="${esc(f.productId)}">
        <span class="fav-moves">
          <button type="button" class="ghost fav-up" data-fav-move="up" aria-label="Move up"${idx === 0 ? " disabled" : ""}>↑</button>
          <button type="button" class="ghost fav-down" data-fav-move="down" aria-label="Move down"${idx === favs.length - 1 ? " disabled" : ""}>↓</button>
        </span>
        <span class="fav-art" aria-hidden="true">${appTileArt(app)}</span>
        <span class="fav-label">${esc(app.label)}</span>
        <button type="button" class="ghost fav-remove" data-fav-remove="1" aria-label="Remove">×</button>
      </li>`;
    }).join("");
    bindArtFallback(list);
    list.querySelectorAll("[data-fav-move]").forEach((btn) => {
      bindImmediate(btn, () => {
        const li = btn.closest("[data-product-id]");
        if (!li) return;
        moveFavorite(li.dataset.productId, btn.dataset.favMove);
      });
    });
    list.querySelectorAll("[data-fav-remove]").forEach((btn) => {
      bindImmediate(btn, () => {
        const li = btn.closest("[data-product-id]");
        if (!li) return;
        setFavoriteApps(getFavoriteApps().filter((f) => f.productId !== li.dataset.productId));
        renderFavoritesSettings();
        renderXboxAppsStrip();
      });
    });
  }

  function syncFavoriteMoveButtons(list) {
    const rows = [...list.querySelectorAll("li[data-product-id]")];
    rows.forEach((li, idx) => {
      const up = li.querySelector('[data-fav-move="up"]');
      const down = li.querySelector('[data-fav-move="down"]');
      if (up) up.disabled = idx === 0;
      if (down) down.disabled = idx === rows.length - 1;
    });
  }

  let favoritesSwapBusy = false;

  function animateFavoriteSwap(a, b) {
    const firstA = a.getBoundingClientRect();
    const firstB = b.getBoundingClientRect();
    const parent = a.parentNode;
    if (!parent) return Promise.resolve();

    if (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) {
      parent.insertBefore(b, a);
    } else {
      parent.insertBefore(a, b);
    }

    const lastA = a.getBoundingClientRect();
    const lastB = b.getBoundingClientRect();
    const dyA = firstA.top - lastA.top;
    const dyB = firstB.top - lastB.top;
    if (!dyA && !dyB) return Promise.resolve();

    a.classList.add("fav-swap");
    b.classList.add("fav-swap");
    a.style.transition = "none";
    b.style.transition = "none";
    a.style.transform = "translateY(" + dyA + "px)";
    b.style.transform = "translateY(" + dyB + "px)";

    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const done = () => {
            a.removeEventListener("transitionend", onEnd);
            b.removeEventListener("transitionend", onEnd);
            clearTimeout(fallback);
            a.classList.remove("fav-swap");
            b.classList.remove("fav-swap");
            a.style.transition = "";
            b.style.transition = "";
            a.style.transform = "";
            b.style.transform = "";
            resolve();
          };
          let remaining = 2;
          const onEnd = (ev) => {
            if (ev.target !== a && ev.target !== b) return;
            if (ev.propertyName && ev.propertyName !== "transform") return;
            remaining -= 1;
            if (remaining <= 0) done();
          };
          const fallback = setTimeout(done, 320);
          a.addEventListener("transitionend", onEnd);
          b.addEventListener("transitionend", onEnd);
          a.style.transition = "transform 220ms ease";
          b.style.transition = "transform 220ms ease";
          a.style.transform = "translateY(0)";
          b.style.transform = "translateY(0)";
        });
      });
    });
  }

  function moveFavorite(productId, dir) {
    if (favoritesSwapBusy) return;
    const list = $("xbox-favorites-list");
    if (!list) return;
    const favs = getFavoriteApps().slice();
    const i = favs.findIndex((f) => f.productId === productId);
    if (i < 0) return;
    const j = dir === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= favs.length) return;

    const rows = [...list.querySelectorAll("li[data-product-id]")];
    const a = rows[i];
    const b = rows[j];
    if (!a || !b) {
      const tmp = favs[i];
      favs[i] = favs[j];
      favs[j] = tmp;
      setFavoriteApps(favs);
      renderFavoritesSettings();
      renderXboxAppsStrip();
      return;
    }

    const tmp = favs[i];
    favs[i] = favs[j];
    favs[j] = tmp;
    setFavoriteApps(favs);
    favoritesSwapBusy = true;
    animateFavoriteSwap(a, b).then(() => {
      syncFavoriteMoveButtons(list);
      favoritesSwapBusy = false;
    });
    renderXboxAppsStrip();
  }

  function renderBlacklistSettings() {
    const list = $("xbox-blacklist-list");
    if (!list) return;
    const blocked = getBlacklistApps();
    if (!blocked.length) {
      list.innerHTML = `<li class="hint" style="background:none;box-shadow:none;padding:0">Nothing hidden.</li>`;
      return;
    }
    const byId = new Map((getXboxAppCatalog().apps || []).map((a) => [a.productId, a]));
    list.innerHTML = blocked.map((f) => {
      const catalog = byId.get(f.productId);
      const app = {
        productId: f.productId,
        label: f.label || (catalog && catalog.label) || f.productId,
        thumbnail: (catalog && catalog.thumbnail) || "",
      };
      return `<li data-product-id="${esc(f.productId)}">
        <span class="fav-art" aria-hidden="true">${appTileArt(app)}</span>
        <span class="fav-label">${esc(app.label)}</span>
        <button type="button" class="ghost fav-remove" data-bl-remove="1" aria-label="Remove from blacklist">×</button>
      </li>`;
    }).join("");
    bindArtFallback(list);
    list.querySelectorAll("[data-bl-remove]").forEach((btn) => {
      bindImmediate(btn, () => {
        const li = btn.closest("[data-product-id]");
        if (!li) return;
        setBlacklistApps(getBlacklistApps().filter((f) => f.productId !== li.dataset.productId));
        renderBlacklistSettings();
        renderBlacklistPicker();
        xboxAppsStripSig = "";
        renderXboxAppsStrip();
      });
    });
  }

  function renderBlacklistPicker() {
    const picker = $("xbox-blacklist-picker");
    if (!picker || picker.classList.contains("hidden")) return;
    const blocked = blacklistedProductIds();
    const apps = (getXboxAppCatalog().apps || []).slice()
      .sort((a, b) => String(a.label || "").localeCompare(String(b.label || ""), undefined, { sensitivity: "base" }));
    if (!apps.length) {
      picker.innerHTML = `<p class="hint">${esc(catalogHintText())}</p>`;
      return;
    }
    picker.innerHTML = apps.map((a) => {
      const on = blocked.has(a.productId);
      return `<button type="button" class="xbox-lib-tile${on ? " selected" : ""}" data-bl-id="${esc(a.productId)}" data-bl-label="${esc(a.label)}" aria-pressed="${on ? "true" : "false"}" aria-label="${esc(a.label)}" title="${esc(a.label)}">${appTileArt(a)}</button>`;
    }).join("");
    bindArtFallback(picker);
    picker.querySelectorAll("[data-bl-id]").forEach((btn) => {
      const toggle = () => {
        if (btn.disabled) return;
        const id = btn.dataset.blId;
        const label = btn.dataset.blLabel || id;
        let list = getBlacklistApps().slice();
        const selected = list.some((f) => f.productId === id);
        if (selected) {
          list = list.filter((f) => f.productId !== id);
          btn.classList.remove("selected");
          btn.setAttribute("aria-pressed", "false");
        } else {
          list.push({ productId: id, label });
          btn.classList.add("selected");
          btn.setAttribute("aria-pressed", "true");
        }
        setBlacklistApps(list);
        renderBlacklistSettings();
        xboxAppsStripSig = "";
        renderXboxAppsStrip();
      };
      if (Controls && Controls.bindDoubleTap) {
        Controls.bindDoubleTap(btn, toggle);
      } else {
        bindImmediate(btn, toggle);
      }
    });
  }

  function renderLibraryPicker() {
    const picker = $("xbox-library-picker");
    if (!picker || picker.classList.contains("hidden")) return;
    const favIds = new Set(getFavoriteApps().map((f) => f.productId));
    const apps = (getXboxAppCatalog().apps || []).slice()
      .sort((a, b) => String(a.label || "").localeCompare(String(b.label || ""), undefined, { sensitivity: "base" }));
    if (!apps.length) {
      picker.innerHTML = `<p class="hint">${esc(catalogHintText())}</p>`;
      return;
    }
    picker.innerHTML = apps.map((a) => {
      const on = favIds.has(a.productId);
      return `<button type="button" class="xbox-lib-tile${on ? " selected" : ""}" data-lib-id="${esc(a.productId)}" data-lib-label="${esc(a.label)}" aria-pressed="${on ? "true" : "false"}" aria-label="${esc(a.label)}" title="${esc(a.label)}">${appTileArt(a)}</button>`;
    }).join("");
    bindArtFallback(picker);
    picker.querySelectorAll("[data-lib-id]").forEach((btn) => {
      const toggle = () => {
        if (btn.disabled) return;
        const id = btn.dataset.libId;
        const label = btn.dataset.libLabel || id;
        let favs = getFavoriteApps().slice();
        const selected = favs.some((f) => f.productId === id);
        if (selected) {
          favs = favs.filter((f) => f.productId !== id);
          btn.classList.remove("selected");
          btn.setAttribute("aria-pressed", "false");
        } else {
          favs.push({ productId: id, label });
          btn.classList.add("selected");
          btn.setAttribute("aria-pressed", "true");
        }
        setFavoriteApps(favs);
        renderFavoritesSettings();
        renderXboxAppsStrip();
      };
      if (Controls && Controls.bindDoubleTap) {
        Controls.bindDoubleTap(btn, toggle);
      } else {
        bindImmediate(btn, toggle);
      }
    });
  }

  function syncSettingsVolumeUi() {
    const slider = $("settings-default-volume");
    const label = $("settings-default-volume-label");
    if (!slider || !label) return;
    const v = getDefaultVolume();
    slider.value = String(v);
    label.textContent = v + "%";
  }

  function maybeApplyDefaultVolume(avr) {
    if (!avr || avr.state !== "on") {
      defaultVolumeApplied = false;
      return;
    }
    const pref = getDefaultVolume();
    if (defaultVolumeApplied || volumeBusy) return;
    defaultVolumeApplied = true;
    callService("media_player", "volume_set", {
      entity_id: CFG.roles.avr,
      volume_level: pref / 100,
    }, false).catch(() => {
      defaultVolumeApplied = false;
    });
  }

  function getAtvFavorites() {
    const list = readJsonStorage(STORAGE_ATV_FAVORITES, []);
    return Array.isArray(list) ? list.filter((a) => a && a.bundleId) : [];
  }

  function setAtvFavorites(list) {
    writeJsonStorage(STORAGE_ATV_FAVORITES, Array.isArray(list) ? list : []);
  }

  function getAtvBlacklist() {
    let raw = null;
    try { raw = localStorage.getItem(STORAGE_ATV_BLACKLIST); } catch (_) {}
    if (raw == null) {
      return DEFAULT_ATV_BLACKLIST.map((a) => ({ bundleId: a.bundleId, label: a.label }));
    }
    try {
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list.filter((a) => a && a.bundleId) : [];
    } catch (_) {
      return DEFAULT_ATV_BLACKLIST.map((a) => ({ bundleId: a.bundleId, label: a.label }));
    }
  }

  function setAtvBlacklist(list) {
    writeJsonStorage(STORAGE_ATV_BLACKLIST, Array.isArray(list) ? list : []);
  }

  function atvBlacklistedIds() {
    return new Set(getAtvBlacklist().map((a) => String(a.bundleId)));
  }

  function getAtvCatalog() {
    const cat = readJsonStorage(STORAGE_ATV_CATALOG, { fetchedAt: 0, apps: [] });
    if (!cat || !Array.isArray(cat.apps)) return { fetchedAt: 0, apps: [] };
    return cat;
  }

  function setAtvCatalog(apps) {
    writeJsonStorage(STORAGE_ATV_CATALOG, {
      fetchedAt: Date.now(),
      apps: Array.isArray(apps) ? apps : [],
    });
  }

  function flattenAtvApps(node, out, seen) {
    if (!node || typeof node !== "object") return;
    const id = String(node.media_content_id || "");
    const typ = String(node.media_content_type || "").toLowerCase();
    if (typ === "app" && id && id !== "apps" && !seen.has(id)) {
      seen.add(id);
      out.push({
        bundleId: id,
        label: String(node.title || id).trim() || id,
        thumbnail: "/app-icon?id=" + encodeURIComponent(id),
      });
    }
    const kids = node.children;
    if (Array.isArray(kids)) kids.forEach((child) => flattenAtvApps(child, out, seen));
  }

  function atvEntityInteractive() {
    if (!CFG || !CFG.roles || !CFG.roles.appletv) return false;
    const st = states[CFG.roles.appletv] || {};
    const s = String(st.state || "").toLowerCase();
    return s && s !== "unavailable" && s !== "unknown";
  }

  async function browseAtvMedia(contentType, contentId) {
    const payload = {
      type: "media_player/browse_media",
      entity_id: CFG.roles.appletv,
    };
    if (contentType != null && contentType !== "" && contentId != null && contentId !== "") {
      payload.media_content_type = contentType;
      payload.media_content_id = contentId;
    }
    return send(payload);
  }

  async function refreshAtvCatalog() {
    if (!CFG.roles.appletv || atvCatalogRefreshing) return getAtvCatalog();
    if (!ws || ws.readyState !== WebSocket.OPEN) return getAtvCatalog();
    if (!atvEntityInteractive()) return getAtvCatalog();
    atvCatalogRefreshing = true;
    try {
      const root = await browseAtvMedia(null, null);
      const kids = Array.isArray(root && root.children) ? root.children : [];
      const appsNode = kids.find((child) => {
        const id = String(child && child.media_content_id || "");
        const title = String(child && child.title || "");
        return id === "apps" || title.toLowerCase() === "apps";
      });
      let branch = appsNode || root;
      if (appsNode && appsNode.can_expand && !(Array.isArray(appsNode.children) && appsNode.children.length)) {
        branch = await browseAtvMedia(appsNode.media_content_type, appsNode.media_content_id);
      }
      const apps = [];
      flattenAtvApps(branch, apps, new Set());
      if (!apps.length) {
        const names = ((states[CFG.roles.appletv] || {}).attributes || {}).source_list;
        if (Array.isArray(names)) {
          names.forEach((name) => {
            const label = String(name || "").trim();
            if (!label) return;
            apps.push({ bundleId: "", label, thumbnail: "", sourceName: label });
          });
        }
      }
      if (apps.length) setAtvCatalog(apps);
      atvCatalogRefreshing = false;
      return getAtvCatalog();
    } catch (_) {
      atvCatalogRefreshing = false;
      return getAtvCatalog();
    }
  }

  function orderedAtvApps() {
    const favs = getAtvFavorites();
    const catalog = getAtvCatalog().apps;
    const blocked = atvBlacklistedIds();
    const byId = new Map(catalog.filter((a) => a.bundleId).map((a) => [a.bundleId, a]));
    const favIds = new Set();
    const ordered = [];
    favs.forEach((f) => {
      const id = String(f.bundleId);
      if (!id || favIds.has(id) || blocked.has(id)) return;
      favIds.add(id);
      const c = byId.get(id);
      ordered.push({
        bundleId: id,
        label: String((f.label || (c && c.label) || id)).trim() || id,
        thumbnail: (c && c.thumbnail) || ("/app-icon?id=" + encodeURIComponent(id)),
      });
    });
    catalog
      .filter((a) => a && a.bundleId && !favIds.has(a.bundleId) && !blocked.has(String(a.bundleId)))
      .slice()
      .sort((a, b) => String(a.label || "").localeCompare(String(b.label || ""), undefined, { sensitivity: "base" }))
      .forEach((a) => ordered.push(a));
    return ordered;
  }

  function atvCatalogHint() {
    const cat = getAtvCatalog();
    if (cat.fetchedAt) {
      const when = new Date(cat.fetchedAt);
      const stamp = when.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      if (!atvEntityInteractive()) return "Last synced " + stamp + ". Wake the Apple TV to refresh.";
      return "Library synced " + stamp + " · " + cat.apps.length + " apps";
    }
    if (!atvEntityInteractive()) return "Wake the Apple TV to load apps.";
    return "Loading Apple TV library…";
  }

  function renderAtvAppsStrip() {
    const grid = $("appletv-apps-grid");
    const openBtn = $("open-appletv-apps");
    const atv = CFG.roles.appletv ? (states[CFG.roles.appletv] || {}) : {};
    const ready = isOn(atv.state);
    if (openBtn) openBtn.disabled = !ready;
    if (!grid) return;
    const tiles = orderedAtvApps();
    const sig = (ready ? "1" : "0") + "|" + tiles.map((a) => a.bundleId + ":" + a.label).join(",");
    if (sig === atvAppsStripSig && grid.childElementCount) {
      grid.querySelectorAll("[data-atv-app]").forEach((btn) => { btn.disabled = !ready; });
      return;
    }
    atvAppsStripSig = sig;
    if (!tiles.length) {
      grid.innerHTML = `<p class="hint">${esc(atvCatalogHint())}</p>`;
      return;
    }
    grid.innerHTML = tiles.map((app) => {
      return `<button type="button" class="xbox-app-tile" role="listitem" data-atv-app="${esc(app.bundleId)}"${ready ? "" : " disabled"} title="${esc(app.label)} — double-tap to launch" aria-label="${esc(app.label)}">${appTileArt(app)}</button>`;
    }).join("");
    grid.querySelectorAll("[data-atv-app]").forEach((btn) => {
      const launch = () => {
        if (btn.disabled) return;
        launchAtvApp(btn.dataset.atvApp);
        closeAtvAppsSheet();
      };
      if (Controls && Controls.bindDoubleTap) Controls.bindDoubleTap(btn, launch);
      else bindImmediate(btn, launch);
    });
    normalizeSwitcherTileCrops(grid);
    bindArtFallback(grid);
  }

  function openAtvAppsSheet() {
    const sheet = $("appletv-apps-sheet");
    if (!sheet) return;
    sheet.classList.remove("hidden");
    renderAtvAppsStrip();
    refreshAtvCatalog().then(() => {
      atvAppsStripSig = "";
      renderAtvAppsStrip();
    });
  }

  function closeAtvAppsSheet() {
    const sheet = $("appletv-apps-sheet");
    if (sheet) sheet.classList.add("hidden");
  }

  function launchAtvApp(bundleId) {
    const entity = CFG.roles.appletv;
    if (!entity || !bundleId) return;
    const catalogApp = (getAtvCatalog().apps).find((a) => a.bundleId === bundleId);
    const favApp = getAtvFavorites().find((a) => a.bundleId === bundleId);
    const label = (catalogApp && catalogApp.label) || (favApp && favApp.label) || "";
    callService("media_player", "play_media", {
      entity_id: entity,
      media_content_id: bundleId,
      media_content_type: "app",
    }, false).catch(() => {
      banner.textContent = "Apple TV app launch failed.";
      banner.classList.remove("hidden");
    });
    if (label) {
      const prev = states[entity] || { entity_id: entity, attributes: {} };
      const attrs = Object.assign({}, prev.attributes, { app_name: label, app_id: bundleId });
      states[entity] = Object.assign({}, prev, { attributes: attrs });
      render();
    }
  }

  function renderAtvFavoritesSettings() {
    const list = $("appletv-favorites-list");
    const hint = $("appletv-catalog-hint");
    if (hint) hint.textContent = atvCatalogHint();
    if (!list) return;
    const favs = getAtvFavorites();
    if (!favs.length) {
      list.innerHTML = `<li class="hint" style="background:none;box-shadow:none;padding:0">No favorites yet.</li>`;
      return;
    }
    const byId = new Map((getAtvCatalog().apps).map((a) => [a.bundleId, a]));
    list.innerHTML = favs.map((f, idx) => {
      const catalog = byId.get(f.bundleId);
      const app = {
        bundleId: f.bundleId,
        label: f.label || (catalog && catalog.label) || f.bundleId,
        thumbnail: (catalog && catalog.thumbnail) || ("/app-icon?id=" + encodeURIComponent(f.bundleId)),
      };
      return `<li data-bundle-id="${esc(f.bundleId)}">
        <span class="fav-moves">
          <button type="button" class="ghost fav-up" data-atv-fav-move="up" aria-label="Move up"${idx === 0 ? " disabled" : ""}>↑</button>
          <button type="button" class="ghost fav-down" data-atv-fav-move="down" aria-label="Move down"${idx === favs.length - 1 ? " disabled" : ""}>↓</button>
        </span>
        <span class="fav-art" aria-hidden="true">${appTileArt(app)}</span>
        <span class="fav-label">${esc(app.label)}</span>
        <button type="button" class="ghost fav-remove" data-atv-fav-remove="1" aria-label="Remove">×</button>
      </li>`;
    }).join("");
    bindArtFallback(list);
    list.querySelectorAll("[data-atv-fav-move]").forEach((btn) => {
      bindImmediate(btn, () => {
        const li = btn.closest("[data-bundle-id]");
        if (!li) return;
        const favList = getAtvFavorites().slice();
        const i = favList.findIndex((f) => f.bundleId === li.dataset.bundleId);
        const j = btn.dataset.atvFavMove === "up" ? i - 1 : i + 1;
        if (i < 0 || j < 0 || j >= favList.length) return;
        const tmp = favList[i];
        favList[i] = favList[j];
        favList[j] = tmp;
        setAtvFavorites(favList);
        renderAtvFavoritesSettings();
        atvAppsStripSig = "";
        renderAtvAppsStrip();
      });
    });
    list.querySelectorAll("[data-atv-fav-remove]").forEach((btn) => {
      bindImmediate(btn, () => {
        const li = btn.closest("[data-bundle-id]");
        if (!li) return;
        setAtvFavorites(getAtvFavorites().filter((f) => f.bundleId !== li.dataset.bundleId));
        renderAtvFavoritesSettings();
        atvAppsStripSig = "";
        renderAtvAppsStrip();
      });
    });
  }

  function renderAtvBlacklistSettings() {
    const list = $("appletv-blacklist-list");
    if (!list) return;
    const blocked = getAtvBlacklist();
    if (!blocked.length) {
      list.innerHTML = `<li class="hint" style="background:none;box-shadow:none;padding:0">Nothing hidden.</li>`;
      return;
    }
    const byId = new Map((getAtvCatalog().apps).map((a) => [a.bundleId, a]));
    list.innerHTML = blocked.map((f) => {
      const catalog = byId.get(f.bundleId);
      const app = {
        bundleId: f.bundleId,
        label: f.label || (catalog && catalog.label) || f.bundleId,
        thumbnail: "/app-icon?id=" + encodeURIComponent(f.bundleId),
      };
      return `<li data-bundle-id="${esc(f.bundleId)}">
        <span class="fav-art" aria-hidden="true">${appTileArt(app)}</span>
        <span class="fav-label">${esc(app.label)}</span>
        <button type="button" class="ghost fav-remove" data-atv-bl-remove="1" aria-label="Remove from blacklist">×</button>
      </li>`;
    }).join("");
    bindArtFallback(list);
    list.querySelectorAll("[data-atv-bl-remove]").forEach((btn) => {
      bindImmediate(btn, () => {
        const li = btn.closest("[data-bundle-id]");
        if (!li) return;
        setAtvBlacklist(getAtvBlacklist().filter((f) => f.bundleId !== li.dataset.bundleId));
        renderAtvBlacklistSettings();
        renderAtvBlacklistPicker();
        atvAppsStripSig = "";
        renderAtvAppsStrip();
      });
    });
  }

  function renderAtvLibraryPicker() {
    const picker = $("appletv-library-picker");
    if (!picker || picker.classList.contains("hidden")) return;
    const favIds = new Set(getAtvFavorites().map((f) => f.bundleId));
    const apps = (getAtvCatalog().apps).filter((a) => a && a.bundleId).slice()
      .sort((a, b) => String(a.label || "").localeCompare(String(b.label || ""), undefined, { sensitivity: "base" }));
    if (!apps.length) {
      picker.innerHTML = `<p class="hint">${esc(atvCatalogHint())}</p>`;
      return;
    }
    picker.innerHTML = apps.map((a) => {
      const on = favIds.has(a.bundleId);
      return `<button type="button" class="xbox-lib-tile${on ? " selected" : ""}" data-atv-lib-id="${esc(a.bundleId)}" data-atv-lib-label="${esc(a.label)}" aria-pressed="${on ? "true" : "false"}" aria-label="${esc(a.label)}" title="${esc(a.label)}">${appTileArt(a)}</button>`;
    }).join("");
    bindArtFallback(picker);
    picker.querySelectorAll("[data-atv-lib-id]").forEach((btn) => {
      const toggle = () => {
        const id = btn.dataset.atvLibId;
        const label = btn.dataset.atvLibLabel || id;
        let favs = getAtvFavorites().slice();
        if (favs.some((f) => f.bundleId === id)) favs = favs.filter((f) => f.bundleId !== id);
        else favs.push({ bundleId: id, label });
        setAtvFavorites(favs);
        renderAtvFavoritesSettings();
        renderAtvLibraryPicker();
        atvAppsStripSig = "";
        renderAtvAppsStrip();
      };
      if (Controls && Controls.bindDoubleTap) Controls.bindDoubleTap(btn, toggle);
      else bindImmediate(btn, toggle);
    });
  }

  function renderAtvBlacklistPicker() {
    const picker = $("appletv-blacklist-picker");
    if (!picker || picker.classList.contains("hidden")) return;
    const blocked = atvBlacklistedIds();
    const apps = (getAtvCatalog().apps).filter((a) => a && a.bundleId).slice()
      .sort((a, b) => String(a.label || "").localeCompare(String(b.label || ""), undefined, { sensitivity: "base" }));
    if (!apps.length) {
      picker.innerHTML = `<p class="hint">${esc(atvCatalogHint())}</p>`;
      return;
    }
    picker.innerHTML = apps.map((a) => {
      const on = blocked.has(a.bundleId);
      return `<button type="button" class="xbox-lib-tile${on ? " selected" : ""}" data-atv-bl-id="${esc(a.bundleId)}" data-atv-bl-label="${esc(a.label)}" aria-pressed="${on ? "true" : "false"}" aria-label="${esc(a.label)}" title="${esc(a.label)}">${appTileArt(a)}</button>`;
    }).join("");
    bindArtFallback(picker);
    picker.querySelectorAll("[data-atv-bl-id]").forEach((btn) => {
      const toggle = () => {
        const id = btn.dataset.atvBlId;
        const label = btn.dataset.atvBlLabel || id;
        let list = getAtvBlacklist().slice();
        if (list.some((f) => f.bundleId === id)) list = list.filter((f) => f.bundleId !== id);
        else list.push({ bundleId: id, label });
        setAtvBlacklist(list);
        renderAtvBlacklistSettings();
        renderAtvBlacklistPicker();
        atvAppsStripSig = "";
        renderAtvAppsStrip();
      };
      if (Controls && Controls.bindDoubleTap) Controls.bindDoubleTap(btn, toggle);
      else bindImmediate(btn, toggle);
    });
  }

  function maybeRefreshAtvCatalog() {
    const atv = CFG.roles.appletv ? (states[CFG.roles.appletv] || {}) : {};
    const sig = String(atv.state || "");
    if (sig === lastAtvBrowseState) return;
    lastAtvBrowseState = sig;
    if (!atvEntityInteractive()) return;
    refreshAtvCatalog().then(() => {
      renderAtvAppsStrip();
      if (settingsSheet && !settingsSheet.classList.contains("hidden")) {
        renderAtvFavoritesSettings();
        renderAtvBlacklistSettings();
        renderAtvLibraryPicker();
        renderAtvBlacklistPicker();
      }
    });
  }

  function syncAtvSettingsVisibility() {
    const show = !!(CFG && CFG.roles && CFG.roles.appletv);
    ["appletv-favorites-section", "appletv-blacklist-section"].forEach((id) => {
      const el = $(id);
      if (el) el.classList.toggle("hidden", !show);
    });
  }

  function maybeRefreshXboxCatalog() {
    const xbox = CFG.roles.xbox ? (states[CFG.roles.xbox] || {}) : {};
    const sig = String(xbox.state || "");
    if (sig === lastXboxBrowseState) return;
    const prev = lastXboxBrowseState;
    lastXboxBrowseState = sig;
    if (!xboxEntityInteractive()) return;
    if (prev && prev === sig) return;
    refreshXboxAppCatalog().then(() => {
      renderXboxAppsStrip();
      if (settingsSheet && !settingsSheet.classList.contains("hidden")) {
        renderFavoritesSettings();
        renderBlacklistSettings();
        renderLibraryPicker();
        renderBlacklistPicker();
      }
    });
  }

  function currentTheme() {
    const id = document.documentElement.getAttribute("data-theme");
    return THEME_IDS.includes(id) ? id : "ember";
  }

  function applyTheme(id) {
    const theme = THEME_IDS.includes(id) ? id : "ember";
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem(STORAGE_THEME, theme); } catch (_) {}
    document.querySelectorAll("[data-look]").forEach((btn) => {
      btn.setAttribute("aria-pressed", btn.dataset.look === theme ? "true" : "false");
    });
  }

  function fmtClock(sec) {
    if (!Number.isFinite(sec) || sec < 0) return "";
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h) return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    return m + ":" + String(s).padStart(2, "0");
  }

  function mediaClock(st) {
    const a = (st && st.attributes) || {};
    const dur = Number(a.media_duration);
    let pos = Number(a.media_position);
    if (!Number.isFinite(dur) || dur <= 0) return null;
    if (!Number.isFinite(pos) || pos < 0) pos = 0;
    if (st.state === "playing" && a.media_position_updated_at) {
      const t = Date.parse(a.media_position_updated_at);
      if (!Number.isNaN(t)) pos += (Date.now() - t) / 1000;
    }
    pos = Math.max(0, Math.min(dur, pos));
    return { pos, dur };
  }

  function artSrc(st) {
    const a = (st && st.attributes) || {};
    const pic = a.entity_picture || a.entity_picture_local || "";
    if (!pic) return "";
    if (/^https?:\/\//i.test(pic)) return pic;
    if (pic.charAt(0) === "/") return "/media-art?src=" + encodeURIComponent(pic);
    return "";
  }

  const MEDIA_KIND = {
    game: "Game",
    movie: "Movie",
    tvshow: "TV",
    episode: "Episode",
    music: "Music",
    channel: "App",
    video: "Video",
    app: "App",
  };

  function fillNowPlaying(prefix, st) {
    const box = $(prefix + "-now");
    if (!box) return;
    const art = $(prefix + "-art");
    const titleEl = $(prefix + "-title");
    const subEl = $(prefix + "-sub");
    const track = $(prefix + "-track");
    const fill = $(prefix + "-fill");
    const a = (st && st.attributes) || {};
    const title = a.media_title || a.media_album_name || a.app_name || "";
    const kind = MEDIA_KIND[a.media_content_type] || "";
    const extra = a.media_artist || a.media_series_title || a.media_channel || "";
    const clock = mediaClock(st);
    const src = artSrc(st);
    const has = !!(title || clock || src || extra || kind);
    box.classList.toggle("hidden", !has);
    if (!has) return;
    titleEl.textContent = title || (st.state === "paused" ? "Paused" : "Playing");
    const bits = [];
    if (kind) bits.push(kind);
    if (extra && extra !== title) bits.push(extra);
    if (clock) bits.push(fmtClock(clock.pos) + " / " + fmtClock(clock.dur));
    subEl.textContent = bits.join(" · ");
    subEl.classList.toggle("hidden", !bits.length);
    if (clock) {
      track.classList.remove("hidden");
      fill.style.width = ((clock.pos / clock.dur) * 100) + "%";
    } else track.classList.add("hidden");
    if (src) {
      art.classList.remove("hidden");
      if (art.dataset.src !== src) {
        art.dataset.src = src;
        art.src = src;
      }
    } else {
      art.classList.add("hidden");
      art.removeAttribute("src");
      delete art.dataset.src;
    }
  }

  function mediaTicking() {
    const roles = [CFG.roles.xbox, CFG.roles.bluray, CFG.roles.appletv].filter(Boolean);
    return roles.some((id) => mediaClock(states[id] || {}));
  }

  function avrAudioInfo(avr) {
    const info = (avr.attributes || {}).audio_information;
    return info && typeof info === "object" ? info : {};
  }

  function avrAudioFormat(avr) {
    const info = avrAudioInfo(avr);
    return String(info.input_signal_format || info.format || "").trim();
  }

  function avrAudioShort(format) {
    const s = String(format || "");
    if (!s) return "";
    if (/atmos/i.test(s)) return "Atmos";
    if (/truehd/i.test(s)) return "TrueHD";
    if (/dts:?x/i.test(s)) return "DTS:X";
    if (/dts-?hd|master audio/i.test(s)) return "DTS-HD";
    if (/digital\s*plus|dd\+/i.test(s)) return "DD+";
    if (/dolby\s*digital|\bdd\b/i.test(s)) return "DD";
    if (/\bpcm\b/i.test(s)) return "PCM";
    if (s.length > 12) return s.slice(0, 11) + "…";
    return s;
  }

  function avrModeLabel(avr) {
    const codec = avrAudioShort(avrAudioFormat(avr));
    if (codec && avr.state === "on") return codec;
    const attrs = avr.attributes || {};
    const game = String(attrs.source || "").includes("GAME");
    const mode = String(attrs.sound_mode || "");
    let short = avr.state || "";
    if (mode === "DIRECT") short = "Direct";
    else if (/ATMOS/i.test(mode)) short = "Atmos";
    else if (mode) short = mode.split(/[·\/]/)[0].trim() || mode;
    if (short.length > 12) short = short.slice(0, 11) + "…";
    return game ? "GAME · " + short : short;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function activityIconSvg(icon, uid) {
    const id = String(uid || "x").replace(/[^a-zA-Z0-9_-]/g, "");
    if (icon === "disc") {
      return `<svg class="activity-icon disc" viewBox="0 0 24 24" overflow="visible" aria-hidden="true">
        <defs>
          <radialGradient id="disc-fill-${id}" cx="36%" cy="30%">
            <stop offset="0%" stop-color="var(--text)" stop-opacity="0.42"/>
            <stop offset="24%" stop-color="var(--accent)"/>
            <stop offset="52%" stop-color="var(--panel)"/>
            <stop offset="76%" stop-color="var(--accent)" stop-opacity="0.82"/>
            <stop offset="100%" stop-color="var(--bg)"/>
          </radialGradient>
        </defs>
        <circle cx="12" cy="12" r="10.5" fill="url(#disc-fill-${id})" stroke="var(--accent)" stroke-width="1.2"/>
        <circle cx="12" cy="12" r="8.2" fill="none" stroke="var(--accent-line-strong)" stroke-width="0.55"/>
        <circle cx="12" cy="12" r="3.35" fill="var(--panel)" stroke="var(--accent)" stroke-width="0.7"/>
        <circle cx="12" cy="12" r="1.3" fill="var(--bg)"/>
        <text x="12" y="18.28" text-anchor="middle" dominant-baseline="middle" fill="var(--accent)" font-size="3.35" font-weight="800" font-family="Arial, Helvetica, sans-serif">4K</text>
      </svg>`;
    }
    if (icon === "xbox") {
      return `<svg class="activity-icon xbox" viewBox="0 0 160 104" overflow="hidden" aria-hidden="true">
        <defs>
          <clipPath id="xbox-face-${id}"><path d="M42 22C48 10 64 7 80 7C96 7 112 10 118 22C124 34 130 48 134 62C137 72 136 84 128 90C120 94 116 86 114 76C112 68 102 65 80 65C58 65 48 68 46 76C44 86 40 94 32 90C24 84 23 72 26 62C30 48 36 34 42 22Z"/></clipPath>
        </defs>
        <path fill="var(--control)" stroke="var(--accent)" stroke-width="2.2" stroke-linejoin="round" d="M42 22C48 10 64 7 80 7C96 7 112 10 118 22C124 34 130 48 134 62C137 72 136 84 128 90C120 94 116 86 114 76C112 68 102 65 80 65C58 65 48 68 46 76C44 86 40 94 32 90C24 84 23 72 26 62C30 48 36 34 42 22Z"/>
        <g clip-path="url(#xbox-face-${id})">
          <circle cx="56" cy="28" r="6.4" fill="var(--bg)" stroke="var(--accent-line-strong)" stroke-width="1.1"/>
          <circle cx="56" cy="28" r="2.2" fill="var(--muted)"/>
          <path fill="var(--muted)" d="M53.1 42.6h5.8v4.6h4.6v5.8h-4.6v4.6h-5.8v-4.6h-4.6v-5.8h4.6z"/>
          <circle cx="80" cy="18" r="5.2" fill="var(--accent)"/>
          <rect x="66.2" y="31.2" width="4.6" height="2.4" rx="0.6" fill="var(--muted)"/>
          <rect x="89.2" y="31.2" width="4.6" height="2.4" rx="0.6" fill="var(--muted)"/>
          <circle cx="104" cy="25.2" r="2.7" fill="var(--face-y)"/>
          <circle cx="97.2" cy="32" r="2.7" fill="var(--face-x)"/>
          <circle cx="110.8" cy="32" r="2.7" fill="var(--face-b)"/>
          <circle cx="104" cy="38.8" r="2.7" fill="var(--face-a)"/>
          <circle cx="104" cy="51.5" r="6.4" fill="var(--bg)" stroke="var(--accent-line-strong)" stroke-width="1.1"/>
          <circle cx="104" cy="51.5" r="2.2" fill="var(--muted)"/>
        </g>
      </svg>`;
    }
    if (icon === "tv" || icon === "roku") {
      return `<svg class="activity-icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="2.5" y="4.5" width="19" height="12.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/>
        <path d="M8 20h8M12 17v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>`;
    }
    return `<svg class="activity-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/>
      <circle cx="12" cy="12" r="2.2" fill="currentColor"/>
    </svg>`;
  }

  function powerIconSvg() {
    return `<svg class="activity-icon power" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M12 3.2v8.2"/>
      <path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M7.05 6.2a8 8 0 1 0 9.9 0"/>
    </svg>`;
  }

  function bindActivityButtons(root) {
    if (!root) return;
    root.querySelectorAll("[data-script]").forEach((btn) => {
      if (btn.dataset.bound === "1") return;
      btn.dataset.bound = "1";
      bindImmediate(btn, () => {
        if (btn.dataset.script === "shutdown") {
          openShutdownConfirm();
          return;
        }
        startScript(btn.dataset.script);
      });
    });
  }

  function renderActivityRow() {
    if (!activitiesEl) return;
    const tiles = ACTIVITIES.map((a) => {
      const icon = activityIconSvg(a.icon || "generic", a.id);
      return `<button type="button" class="activity" data-script="${esc(a.id)}" data-deck-ref="${esc(a.deck || "")}">${icon}<span>${esc(a.tile || a.label)}</span></button>`;
    }).join("");
    activitiesEl.innerHTML =
      `<div class="activity-scroll" id="activity-scroll">${tiles}</div>` +
      `<button type="button" class="activity danger power" data-script="shutdown" aria-label="Shutdown" title="Shutdown">${powerIconSvg()}</button>`;
    bindActivityButtons(activitiesEl);
    if (Controls && Controls.isIos()) {
      activitiesEl.querySelectorAll(".activity").forEach((el) => Controls.ensureHapticOverlay(el));
    }
  }

  function activityForScriptKey(key) {
    return ACTIVITY_BY_ID[key] || null;
  }

  function activityForLabel(label) {
    return ACTIVITY_BY_LABEL[label] || null;
  }

  function activeDeckId(settled, key) {
    if (key && activityForScriptKey(key)) {
      return activityForScriptKey(key).deck || null;
    }
    const act = activityForLabel(settled);
    return act && act.deck ? act.deck : null;
  }

  function pretty(s) {
    const raw = String(s || "").trim();
    if (!raw || raw === "unknown" || raw === "unavailable" || raw === "none") return "";
    const map = {
      frame_adapt_hdr: "Frame Adapt HDR",
      hdr10: "HDR10",
      "hdr10+": "HDR10+",
      hlg: "HLG",
      sdr: "SDR",
      sdr1: "SDR 1",
      sdr2: "SDR 2",
      hdr1: "HDR 1",
      hdr2: "HDR 2",
      filmmaker: "Filmmaker",
      cinema: "Cinema",
      natural: "Natural",
      hdmi1: "HDMI 1",
      hdmi2: "HDMI 2",
      bt2020: "BT.2020",
      "bt2020(constant_luminance)": "BT.2020",
      "bt2020(non-constant_luminance)": "BT.2020",
      bt709: "BT.709",
      no_data: "",
    };
    if (map[raw.toLowerCase()]) return map[raw.toLowerCase()];
    return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function entityReady(st) {
    const s = String((st && st.state) || "").toLowerCase();
    return !!s && s !== "unavailable" && s !== "unknown";
  }

  function factRow(label, value, locked) {
    const v = value == null || value === "" ? "—" : String(value);
    return `<div class="fact"><dt>${esc(label)}</dt><dd class="${locked ? "locked" : ""}">${esc(v)}</dd></div>`;
  }

  function factsBox(rows) {
    return `<dl class="facts">${rows.join("")}</dl>`;
  }

  function chip(label, selected, attrs) {
    return `<button type="button" class="mode-chip${selected ? " active" : ""}" ${attrs}>${esc(label)}</button>`;
  }

  function st(role) {
    return states[CFG.roles[role]] || {};
  }

  function sheetSignature() {
    const avr = st("avr");
    return [
      sheetDevice,
      st("display").state,
      st("displayInput").state,
      st("displayPictureMode").state,
      st("displaySource").state,
      st("displayContentType").state,
      st("processor").state,
      st("processorInput").state,
      st("processorVideo").state,
      avr.state,
      (avr.attributes || {}).sound_mode,
      avrAudioFormat(avr),
      (avr.attributes || {}).is_volume_muted,
      st("bluray").state,
      st("xbox").state,
      st("appletv").state,
      (st("appletv").attributes || {}).app_name,
    ].join("|");
  }

  function sheetContext() {
    return {
      st, deviceKicker, deviceTitle, deviceLive, deviceBody,
      entityReady, pretty, factsBox, factRow, chip, esc, isOn,
    };
  }

  function renderSheet(force) {
    if (!sheetDevice || !deviceSheet) return;
    deviceSheet.classList.remove("hidden");
    const sig = sheetSignature();
    if (!force && sig === sheetSig && deviceBody.childElementCount) {
      if (sheetDevice === "xbox") fillNowPlaying("sheet-xbox", st("xbox"));
      if (sheetDevice === "panasonic") fillNowPlaying("sheet-disc", st("bluray"));
      if (sheetDevice === "appletv") fillNowPlaying("sheet-appletv", st("appletv"));
      return;
    }
    sheetSig = sig;
    const registered = sheetDevice === "appletv" && window.TheaterSheets && window.TheaterSheets.appletv;
    if (typeof registered === "function") registered(sheetContext());
    else {
      const html = {
        jvc: sheetJvc,
        lumagen: sheetLumagen,
        onkyo: sheetOnkyo,
        panasonic: sheetPanasonic,
        xbox: sheetXbox,
      }[sheetDevice];
      if (!html) return;
      html();
    }
    applySheetHeading(sheetDevice);
    deviceBody.querySelectorAll("button").forEach((btn) => {
      bindImmediate(btn, () => handleSheetButton(btn));
    });
    if (sheetDevice === "xbox") fillNowPlaying("sheet-xbox", st("xbox"));
    if (sheetDevice === "panasonic") fillNowPlaying("sheet-disc", st("bluray"));
    if (sheetDevice === "appletv") fillNowPlaying("sheet-appletv", st("appletv"));
  }

  function roomName() {
    const name = CFG && typeof CFG.name === "string" ? CFG.name.trim() : "";
    return name;
  }

  function applyRoomName() {
    const name = roomName();
    if (!name) return;
    document.querySelectorAll("[data-room-name]").forEach((el) => {
      el.textContent = name;
    });
  }

  function applyShutdownCopy() {
    const title = $("shutdown-confirm-title");
    const hint = $("shutdown-confirm-hint");
    const shutdownTitle = CFG && typeof CFG.shutdownTitle === "string" ? CFG.shutdownTitle : "";
    const shutdownHint = CFG && typeof CFG.shutdownHint === "string" ? CFG.shutdownHint : "";
    if (title && shutdownTitle) title.textContent = shutdownTitle;
    if (hint && shutdownHint) hint.textContent = shutdownHint;
  }

  function applySheetHeading(id) {
    const pills = CFG && Array.isArray(CFG.pills) ? CFG.pills : [];
    const pill = pills.find((item) => item && item.id === id);
    if (deviceTitle) deviceTitle.textContent = (pill && pill.label) || id || "Device";
    if (deviceKicker) deviceKicker.textContent = (pill && pill.kicker) || "";
  }

  function sheetJvc() {
    const power = st("display");
    const input = st("displayInput");
    const picture = st("displayPictureMode");
    const hours = st("displayHours");
    deviceLive.textContent = power.state || "—";
    const hourVal = entityReady(hours) && !Number.isNaN(Number(hours.state))
      ? Number(hours.state) + " h"
      : pretty(hours.state);
    const opts = (picture.attributes && picture.attributes.options) || [];
    const modeBtns = entityReady(picture)
      ? `<div class="mode-row">${opts.map((opt) => chip(pretty(opt) || opt, picture.state === opt, `data-select="displayPictureMode" data-option="${esc(opt)}"`)).join("")}</div>`
      : "";
    deviceBody.innerHTML = [
      factsBox([
        factRow("Power", power.state),
        factRow("Input", pretty(input.state) || input.state, true),
        factRow("Signal", pretty(st("displaySource").state) || st("displaySource").state),
        factRow("Content", pretty(st("displayContentType").state) || st("displayContentType").state),
        factRow("Colorimetry", pretty(st("displayColorimetry").state) || st("displayColorimetry").state),
        factRow("Laser hours", hourVal),
      ]),
      modeBtns,
    ].join("");
  }

  function sheetLumagen() {
    const power = st("processor");
    const input = st("processorInput");
    const on = power.state === "on";
    deviceLive.textContent = on
      ? (pretty(st("processorVideo").state) || input.state || "on")
      : (power.state || "off");
    const src = [st("processorSourceRes").state, st("processorSourceRefresh").state, pretty(st("processorSourceHdr").state)]
      .filter((x) => entityReady({ state: x }))
      .join(" ");
    const out = [st("processorOutputRes").state, st("processorOutputRefresh").state, pretty(st("processorOutputColor").state)]
      .filter((x) => entityReady({ state: x }))
      .join(" ");
    const cms = [pretty(st("processorCms").state), pretty(st("processorStyle").state)].filter(Boolean).join(" / ");
    deviceBody.innerHTML = [
      factsBox([
        factRow("Power", power.state),
        factRow("Input", (input.state || "").replace(/\s*\(\d+\)\s*$/, "") || input.state, true),
        factRow("Memory", st("processorMemory").state, true),
        factRow("Video", pretty(st("processorVideo").state) || st("processorVideo").state),
        factRow("Source", src),
        factRow("Output", out),
        factRow("CMS / style", cms),
        factRow("Bridge", "Serial-to-Ethernet"),
      ]),
      `<div class="sheet-actions">
        <button type="button" data-sheet="lumagenRestart"${on ? "" : " disabled"}>Restart outputs</button>
        <button type="button" data-sheet="lumagenReload">Reload</button>
      </div>`,
    ].join("");
  }

  function sheetOnkyo() {
    const avr = st("avr");
    const attrs = avr.attributes || {};
    deviceLive.textContent = avrModeLabel(avr) || avr.state || "—";
    const info = avrAudioInfo(avr);
    const format = avrAudioFormat(avr);
    const vol = typeof attrs.volume_level === "number" ? Math.round(attrs.volume_level * 100) + "%" : "—";
    const modes = attrs.sound_mode_list || [];
    const current = attrs.sound_mode || "";
    const on = avr.state === "on";
    const dis = on ? "" : " disabled";
    const chips = on && modes.length
      ? `<div class="mode-row">${modes.slice(0, 12).map((m) => chip(m, m === current, `data-sound="${esc(m)}"`)).join("")}</div>`
      : "";
    const arrow = (dir, label, path) =>
      `<button type="button" class="arrow ${dir}" data-osd="${dir}" aria-label="${label}"${dis}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
    deviceBody.innerHTML = [
      factsBox([
        factRow("Power", avr.state),
        factRow("Source", String(attrs.source || "").includes("GAME") ? "GAME" : (attrs.source || "—"), true),
        factRow("Input audio", format || "—"),
        factRow("Sample rate", info.input_frequency || "—"),
        factRow("Output", info.output_channels || "—"),
        factRow("Listening", current || info.listening_mode || "—"),
        factRow("Volume", vol),
        factRow("Mute", attrs.is_volume_muted ? "Muted" : "Off"),
      ]),
      chips,
      `<div class="sheet-actions">
        <button type="button" data-osd="setup"${dis}>Setup</button>
        <button type="button" data-osd="quick"${dis}>Quick</button>
        <button type="button" data-osd="home"${dis}>Home</button>
        <button type="button" data-osd="exit"${dis}>Exit</button>
      </div>`,
      `<div class="sheet-nav">
        <div class="disc-arrows" role="group" aria-label="Setup arrows">
          ${arrow("up", "Up", "M6 14l6-6 6 6")}
          ${arrow("left", "Left", "M14 6l-6 6 6 6")}
          ${arrow("right", "Right", "M10 6l6 6-6 6")}
          ${arrow("down", "Down", "M6 10l6 6 6-6")}
        </div>
        <button type="button" class="disc-ok" data-osd="enter"${dis}>OK</button>
      </div>`,
    ].join("");
  }

  function sheetPanasonic() {
    const disc = st("bluray");
    deviceLive.textContent = disc.state || "—";
    const dead = !disc.state || disc.state === "unavailable";
    const dis = dead ? " disabled" : "";
    deviceBody.innerHTML = [
      `<div class="now-playing sheet-now hidden" id="sheet-disc-now">
        <img class="now-art hidden" id="sheet-disc-art" alt="" />
        <div class="now-meta">
          <p class="now-title" id="sheet-disc-title"></p>
          <p class="now-sub" id="sheet-disc-sub"></p>
          <div class="now-track hidden" id="sheet-disc-track"><div class="now-fill" id="sheet-disc-fill"></div></div>
        </div>
      </div>`,
      `<div class="sheet-keys">
        <button type="button" data-disc="SKIP"${dis}>Skip +</button>
        <button type="button" data-disc="REVSKIP"${dis}>Skip −</button>
        <button type="button" data-disc="FWD"${dis}>FF</button>
        <button type="button" data-disc="REV"${dis}>REW</button>
        <button type="button" data-disc="AUDIO"${dis}>Audio</button>
        <button type="button" data-disc="SUBTITLE"${dis}>Subtitle</button>
        <button type="button" data-disc="TOPMENU"${dis}>Top menu</button>
        <button type="button" data-disc="PUPMENU"${dis}>Popup</button>
        <button type="button" data-disc="OP_CL"${dis}>Tray</button>
      </div>`,
    ].join("");
  }

  function sheetXbox() {
    const xbox = st("xbox");
    deviceLive.textContent = xbox.state || "—";
    const ready = isOn(xbox.state);
    const dis = ready ? "" : " disabled";
    deviceBody.innerHTML = [
      `<div class="now-playing sheet-now hidden" id="sheet-xbox-now">
        <img class="now-art hidden" id="sheet-xbox-art" alt="" />
        <div class="now-meta">
          <p class="now-title" id="sheet-xbox-title"></p>
          <p class="now-sub" id="sheet-xbox-sub"></p>
          <div class="now-track hidden" id="sheet-xbox-track"><div class="now-fill" id="sheet-xbox-fill"></div></div>
        </div>
      </div>`,
      `<form class="xbox-type">
        <input type="password" name="q" enterkeyhint="send" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" placeholder="" aria-label="Send text to Xbox"${dis} />
        <button type="submit" class="xsys" aria-label="Send"${dis}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19 5v7a4 4 0 0 1-4 4H6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
            <path d="M10 12.5 5.5 16 10 19.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </form>`,
      `<div class="sheet-actions xbox-shoulders">
        <button type="button" data-xbox="LeftShoulder"${dis}>LB</button>
        <button type="button" data-xbox="RightShoulder"${dis}>RB</button>
        <button type="button" data-xbox="Nexus"${dis} title="Xbox Guide">Guide</button>
        <button type="button" data-sheet="openSettings">Settings</button>
      </div>`,
    ].join("");
  }

  function handleSheetButton(btn) {
    if (btn.disabled) return;
    if (btn.dataset.select && btn.dataset.option) {
      callService("select", "select_option", {
        entity_id: CFG.roles[btn.dataset.select],
        option: btn.dataset.option,
      }, false).catch(() => {
        banner.textContent = "Could not change picture mode.";
        banner.classList.remove("hidden");
      });
      return;
    }
    if (btn.dataset.sound) {
      callService("media_player", "select_sound_mode", {
        entity_id: CFG.roles.avr,
        sound_mode: btn.dataset.sound,
      }, false).catch(() => {
        banner.textContent = "Could not change listening mode.";
        banner.classList.remove("hidden");
      });
      return;
    }
    if (btn.dataset.osd) {
      fetch("/onkyo-osd?cmd=" + encodeURIComponent(btn.dataset.osd), {
        method: "POST",
        cache: "no-store",
      }).then((res) => {
        if (!res.ok) throw new Error("osd");
      }).catch(() => {
        banner.textContent = "Onkyo setup command failed.";
        banner.classList.remove("hidden");
      });
      return;
    }
    if (btn.dataset.sheet === "lumagenRestart") {
      helpUntil = Date.now() + 4000;
      callService("button", "press", { entity_id: CFG.roles.lumagenRestart }, false).catch(() => {
        helpUntil = 0;
        banner.textContent = "Lumagen output restart failed.";
        banner.classList.remove("hidden");
      });
      return;
    }
    if (btn.dataset.sheet === "lumagenReload") {
      callService("button", "press", { entity_id: CFG.roles.processorReload }, false).catch(() => {
        banner.textContent = "Lumagen reload failed.";
        banner.classList.remove("hidden");
      });
      return;
    }
    if (btn.dataset.sheet === "openSettings") {
      closeSheet();
      openSettings();
      return;
    }
    if (btn.dataset.disc) {
      callService("remote", "send_command", {
        entity_id: CFG.roles.blurayRemote,
        command: btn.dataset.disc,
      }, false).catch(() => {
        banner.textContent = "Panasonic command failed.";
        banner.classList.remove("hidden");
      });
      return;
    }
    if (btn.dataset.xbox) {
      callService("remote", "send_command", {
        entity_id: CFG.roles.xboxRemote,
        command: btn.dataset.xbox,
      }, false).catch(() => {
        banner.textContent = "Xbox command failed.";
        banner.classList.remove("hidden");
      });
    }
  }

  function openSheet(id) {
    sheetDevice = id;
    render();
  }

  function closeSheet() {
    sheetDevice = null;
    sheetSig = "";
    if (deviceSheet) deviceSheet.classList.add("hidden");
  }

  function pillDetail(st) {
    const t = String(((st.attributes || {}).media_title) || "").trim();
    const s = String(st.state || "").toLowerCase();
    if (t && ["playing", "paused", "idle"].includes(s)) {
      return t.length > 14 ? t.slice(0, 13) + "…" : t;
    }
    return st.state;
  }

  function pillText(spec) {
    const role = (spec.roles && spec.roles[0]) || "";
    const primary = states[CFG.roles[role]] || {};
    if (spec.detail === "processor") {
      const power = states[CFG.roles.processor] || primary;
      const input = states[CFG.roles.processorInput] || {};
      if (power.state === "on") return (input.state || "on").replace(/\s*\(\d+\)\s*$/, "");
      return power.state || "off";
    }
    if (spec.detail === "avr") return avrModeLabel(states[CFG.roles.avr] || primary);
    if (spec.detail === "media") return pillDetail(primary);
    return primary.state;
  }

  function visiblePills() {
    const pills = Array.isArray(CFG.pills) ? CFG.pills : [];
    const act = activityForLabel(currentActivity());
    const activityId = act ? act.id : "";
    const seen = new Set();
    const out = [];
    pills.forEach((spec) => {
      const key = spec.exclusive || "";
      if (!key) {
        out.push(spec);
        return;
      }
      if (seen.has(key)) return;
      seen.add(key);
      const group = pills.filter((item) => item.exclusive === key);
      const match = group.find((item) => item.activity && item.activity === activityId);
      out.push(match || group.find((item) => !item.activity) || group[0]);
    });
    return out;
  }

  function pill(id, name, state, detail, mismatch) {
    const warn = state === "warming" || state === "cooling";
    const cls = warn ? "warn" : isOn(state) ? "on" : "off";
    return `<button type="button" class="pill${mismatch ? " mismatch" : ""}" data-device="${id}" aria-label="${esc(name)} details"><span class="name">${esc(name)}</span><span class="val"><span class="dot ${cls}"></span>${esc(detail || state || "—")}</span><span class="chev" aria-hidden="true">›</span></button>`;
  }

  function currentActivity() {
    return (states[CFG.helpers.activity] || {}).state || "Idle";
  }

  function runningScriptKey() {
    return SCRIPT_KEYS.find((key) => {
      const st = states[CFG.scripts[key]];
      return st && st.state === "on";
    }) || null;
  }

  function specOk(st, spec) {
    const state = String((st && st.state) || "");
    const attrs = (st && st.attributes) || {};
    if (spec.state && state !== spec.state) return false;
    if (spec.state_in && spec.state_in.indexOf(state) < 0) return false;
    if (spec.not_state && spec.not_state.some((s) => s.toLowerCase() === state.toLowerCase())) return false;
    if (spec.attr) {
      for (const [k, v] of Object.entries(spec.attr)) {
        if (attrs[k] !== v) return false;
      }
    }
    if (spec.source_contains && String(attrs.source || "").indexOf(spec.source_contains) < 0) return false;
    return true;
  }

  function contractFor() {
    if (startKey === "shutdown" || runningScriptKey() === "shutdown") return CONTRACTS.Idle || null;
    return CONTRACTS[currentActivity()] || null;
  }

  function unmet(bucket) {
    const c = contractFor();
    if (!c) return [];
    return (c[bucket] || []).filter((spec) => !specOk(states[CFG.roles[spec.role]] || {}, spec));
  }

  function isSettling() {
    if (!settleUntil || Date.now() > settleUntil) return false;
    const err = ((states[CFG.helpers.error] || {}).state || "").trim();
    if (err) return false;
    return unmet("required").length > 0;
  }

  function isStarting() {
    if (contractFor() && unmet("required").length === 0) return false;
    if (startKey && Date.now() - startAt < 2500) return true;
    if (isSettling()) return true;
    return !!(runningScriptKey() && unmet("required").length);
  }

  function startingKey() {
    const run = runningScriptKey();
    if (run) return run;
    if (startKey) return startKey;
    if (isSettling()) {
      const a = currentActivity();
      const act = activityForLabel(a);
      if (act) return act.id;
      if (a === "Idle") return "shutdown";
    }
    return null;
  }

  function displayedActivity() {
    const key = startingKey();
    if (key === "shutdown") {
      if (!unmet("required").length) return "Idle";
      return "Shutting down";
    }
    if (key === "resync") return currentActivity() === "Idle" ? "Resync" : currentActivity();
    if (key && ACTIVITY_LABEL[key]) return ACTIVITY_LABEL[key];
    return currentActivity();
  }

  function progressCopy(key) {
    const jvc = (states[CFG.roles.display] || {}).state || "";
    const lumagen = (states[CFG.roles.processor] || {}).state || "";
    const avr = (states[CFG.roles.avr] || {}).state || "";
    const disc = (states[CFG.roles.bluray] || {}).state || "";
    const xbox = (states[CFG.roles.xbox] || {}).state || "";
    if (key === "shutdown") {
      if (jvc === "cooling") return ["Shutting down", "Projector cooling"];
      return ["Shutting down", "Powering devices off"];
    }
    if (key === "resync") return ["Resyncing", "Re-applying the last activity"];
    const title = "Starting " + (ACTIVITY_LABEL[key] || "activity");
    if (jvc !== "on" && jvc !== "warming") return [title, "Powering projector"];
    if (lumagen !== "on") return [title, "Powering processor"];
    if (avr !== "on") return [title, "Powering receiver"];
    if (key === "play_xbox" && !isOn(xbox)) return [title, "Waking Xbox"];
    if (key === "watch_bluray" && !isOn(disc)) return [title, "Powering disc player"];
    if (jvc === "warming") return [title, "Projector warming"];
    const waiting = unmet("required")[0];
    if (waiting) {
      const labels = {
        display: "projector",
        processor: "processor",
        processorInput: "Lumagen input",
        processorMemory: "Lumagen memory",
        avr: "receiver",
        bluray: "disc player",
        xbox: "Xbox",
      };
      return [title, "Waiting for " + (labels[waiting.role] || waiting.role)];
    }
    return [title, "Setting inputs"];
  }

  function render() {
    if (mainEl.classList.contains("hidden")) return;
    if (startKey && Date.now() - startAt >= 2500 && !runningScriptKey()) startKey = null;
    const requiredMiss = unmet("required");
    if (contractFor() && !requiredMiss.length) {
      startKey = null;
      settleUntil = 0;
      settleNote = "";
    } else if (settleUntil && Date.now() > settleUntil && requiredMiss.length) {
      settleNote = "Not all devices reached the expected state. Tap Resync.";
    }

    const starting = isStarting();
    const key = startingKey();
    const activity = displayedActivity();
    activityTitle.textContent = activity;
    const err = ((states[CFG.helpers.error] || {}).state || "").trim() || settleNote;
    banner.textContent = err;
    banner.classList.toggle("hidden", !err);

    if (starting && key && (requiredMiss.length || !contractFor())) {
      const copy = progressCopy(key);
      progressTitle.textContent = copy[0];
      progressDetail.textContent = copy[1];
      progressEl.classList.remove("hidden");
    } else if (Date.now() < helpUntil) {
      progressTitle.textContent = "Help";
      progressDetail.textContent = "Restarting Lumagen output";
      progressEl.classList.remove("hidden");
    } else {
      progressEl.classList.add("hidden");
    }

    const avr = states[CFG.roles.avr] || {};
    const disc = states[CFG.roles.bluray] || {};
    const xbox = states[CFG.roles.xbox] || {};

    const bad = new Set(requiredMiss.concat(unmet("warn")).map((s) => s.role));
    const pills = visiblePills();
    statusEl.innerHTML = pills.map((spec) => {
      const role = (spec.roles && spec.roles[0]) || "";
      const primary = states[CFG.roles[role]] || {};
      return pill(spec.id, spec.label, primary.state, pillText(spec), (spec.roles || []).some((name) => bad.has(name)));
    }).join("");
    if (Controls && Controls.isIos()) {
      statusEl.querySelectorAll("[data-device]").forEach((el) => Controls.ensureHapticOverlay(el));
    }

    const settled = currentActivity();
    document.querySelectorAll(".activities [data-script], header [data-script]").forEach((btn) => {
      const scriptKey = btn.dataset.script;
      const act = activityForScriptKey(scriptKey);
      const active = !!(act && settled === act.label);
      btn.classList.toggle("active", active && !starting);
      btn.classList.toggle("starting", starting && key === scriptKey);
      btn.disabled = false;
    });

    const vol = avr.attributes && typeof avr.attributes.volume_level === "number"
      ? Math.round(avr.attributes.volume_level * 100)
      : null;
    if (!volumeBusy && vol !== null) {
      volume.value = String(vol);
      volumeLabel.textContent = vol + "%";
    } else if (vol === null) {
      volumeLabel.textContent = "—";
    }
    const muted = !!(avr.attributes && avr.attributes.is_volume_muted);
    muteBtn.textContent = muted ? "Muted" : "Mute";
    muteBtn.classList.toggle("muted", muted);
    volume.disabled = avr.state !== "on";
    muteBtn.disabled = avr.state !== "on";
    volUp.disabled = avr.state !== "on";
    volDown.disabled = avr.state !== "on";
    if (helpBtn && hasLumagenHelp) {
      const processorOn = CFG.roles.processor
        ? (states[CFG.roles.processor] || {}).state === "on"
        : true;
      helpBtn.disabled = !processorOn;
      helpBtn.classList.toggle("busy", Date.now() < helpUntil);
    }

    const deckId = activeDeckId(settled, key);
    document.querySelectorAll("[data-deck]").forEach((el) => {
      el.classList.toggle("hidden", !deckId || el.dataset.deck !== deckId);
    });
    if (idleDeck) idleDeck.classList.toggle("hidden", !!deckId);

    xboxState.textContent = xbox.state || "—";
    discState.textContent = disc.state || "—";
    const atvPlaying = CFG.roles.appletv ? (states[CFG.roles.appletv] || {}) : {};
    if (appletvState) appletvState.textContent = atvPlaying.state || "—";
    fillNowPlaying("xbox", xbox);
    fillNowPlaying("disc", disc);
    fillNowPlaying("appletv", atvPlaying);
    const xboxReady = isOn(xbox.state);
    document.querySelectorAll("[data-xbox]").forEach((btn) => {
      btn.disabled = !xboxReady;
    });
    document.querySelectorAll(".xbox-type input, .xbox-type button").forEach((el) => {
      el.disabled = !xboxReady;
    });
    renderXboxAppsStrip();
    renderAtvAppsStrip();
    maybeApplyDefaultVolume(avr);
    maybeRefreshXboxCatalog();
    maybeRefreshAtvCatalog();
    document.querySelectorAll("[data-disc]").forEach((btn) => {
      btn.disabled = !disc.state || disc.state === "unavailable";
    });
    const appletvRemote = CFG.roles.appletvRemote;
    const appletvReady = !!(appletvRemote && states[appletvRemote] && states[appletvRemote].state !== "unavailable");
    document.querySelectorAll("[data-appletv]").forEach((btn) => {
      btn.disabled = !appletvReady;
    });
    if (sheetDevice) renderSheet();
    else if (deviceSheet) deviceSheet.classList.add("hidden");
    schedulePadScale();
  }

  function scalePadStacks() {
    document.querySelectorAll(".abxy-wrap, .disc-nav").forEach((wrap) => {
      const stack = wrap.querySelector(".pad-stack, .disc-pad-stack");
      if (!stack || wrap.closest(".hidden")) return;
      // Prefer zoom over transform:scale so layout boxes and touch
      // hit-testing stay aligned with the visible ABXY / D-pad (Safari).
      stack.style.zoom = "";
      stack.style.transform = "none";
      stack.style.marginBlock = "0";
      const cs = window.getComputedStyle(wrap);
      const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      const available = wrap.clientHeight - padY;
      const need = stack.offsetHeight;
      if (need < 8 || available < 8) return;
      const s = Math.min(1, available / need);
      if (s < 1) stack.style.zoom = String(s);
    });
  }

  let padScaleFrame = 0;
  function schedulePadScale() {
    if (padScaleFrame) return;
    padScaleFrame = requestAnimationFrame(() => {
      padScaleFrame = 0;
      scalePadStacks();
    });
  }

  function handleMessage(ev) {
    const msg = JSON.parse(ev.data);
    if (msg.type === "auth_required") {
      ws.send(JSON.stringify({ type: "auth", access_token: token }));
      return;
    }
    if (msg.type === "auth_invalid") {
      wantLive = false;
      setLive(false);
      pending.forEach((p) => p.reject(new Error("auth")));
      pending.clear();
      return;
    }
    if (msg.type === "auth_ok") {
      reconnectAttempt = 0;
      setLive(true);
      send({ type: "get_states" })
        .then((list) => {
          states = {};
          for (const s of list || []) {
            if (entityIds.includes(s.entity_id)) states[s.entity_id] = s;
          }
          render();
          return send({ type: "subscribe_entities", entity_ids: entityIds });
        })
        .catch(() => {});
      return;
    }
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.success === false) p.reject(new Error((msg.error && msg.error.message) || "failed"));
      else p.resolve(msg.result);
      return;
    }
    if (msg.type === "event" && msg.event) {
      applyEntityDiff(msg.event);
      render();
    }
  }

  function clearReconnectTimer() {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = 0;
  }

  function scheduleReconnect() {
    if (!wantLive || reconnectTimer) return;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    const delay = reconnectAttempt === 0 ? 0 : Math.min(8000, 400 * Math.pow(2, reconnectAttempt - 1));
    reconnectAttempt += 1;
    setLive(false);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = 0;
      connectWs();
    }, delay);
    if (typeof reconnectTimer.unref === "function") reconnectTimer.unref();
  }

  function ensureConnected() {
    if (!wantLive) return;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    reconnectAttempt = 0;
    connectWs();
  }

  function onWake() {
    if (!wantLive) return;
    reconnectAttempt = 0;
    connectWs();
  }

  let backgrounded = document.visibilityState === "hidden";
  function onVisibility() {
    if (document.visibilityState === "hidden") {
      backgrounded = true;
      return;
    }
    if (backgrounded) {
      backgrounded = false;
      onWake();
    }
  }

  function onPageShow(ev) {
    if (ev && ev.persisted) onWake();
    else ensureConnected();
  }

  function connectWs() {
    if (!wantLive) return;
    clearReconnectTimer();
    const prev = ws;
    ws = null;
    if (prev) {
      try { prev.close(); } catch (_) {}
    }
    pending.forEach((p) => p.reject(new Error("reconnect")));
    pending.clear();
    const sock = new WebSocket(wsUrl());
    ws = sock;
    sock.addEventListener("open", () => {
      if (ws === sock) setLive(false);
    });
    sock.addEventListener("close", () => {
      if (ws !== sock) return;
      setLive(false);
      scheduleReconnect();
    });
    sock.addEventListener("error", () => {
      if (ws === sock) setLive(false);
    });
    sock.addEventListener("message", handleMessage);
  }

  function showMain() {
    setupEl.classList.add("hidden");
    mainEl.classList.remove("hidden");
    wantLive = true;
    reconnectAttempt = 0;
    connectWs();
  }

  function saveSetup() {
    const err = $("setup-error");
    err.classList.add("hidden");
    haUrl = $("ha-url").value.trim().replace(/\/$/, "");
    token = $("ha-token").value.trim();
    const probe = new WebSocket(wsUrl());
    const timer = setTimeout(() => {
      probe.close();
      err.textContent = "Could not reach Home Assistant WebSocket.";
      err.classList.remove("hidden");
    }, 8000);
    probe.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "auth_required") {
        probe.send(JSON.stringify({ type: "auth", access_token: token }));
      }
      if (msg.type === "auth_ok") {
        clearTimeout(timer);
        probe.close();
        localStorage.setItem(STORAGE_URL, haUrl);
        localStorage.setItem(STORAGE_TOKEN, token);
        showMain();
      }
      if (msg.type === "auth_invalid") {
        clearTimeout(timer);
        probe.close();
        err.textContent = "Token rejected. Create a new long-lived token in HA.";
        err.classList.remove("hidden");
      }
    });
    probe.addEventListener("error", () => {
      clearTimeout(timer);
      err.textContent = "Could not connect. Check URL.";
      err.classList.remove("hidden");
    });
  }

  const Controls = window.TheaterControls;
  function bindImmediate(el, fn) {
    if (Controls && Controls.bindImmediate) {
      Controls.bindImmediate(el, fn);
      return;
    }
    el.addEventListener("click", (e) => {
      if (el.disabled) return;
      fn(e);
    });
  }

  function startScript(key) {
    if (key === "shutdown") {
      const running = runningScriptKey();
      if (running === "shutdown" || startKey === "shutdown") {
        closeShutdownConfirm();
        return;
      }
      const idle = CONTRACTS.Idle;
      const alreadyOff = idle && (idle.required || []).every((spec) => specOk(states[CFG.roles[spec.role]] || {}, spec));
      if (alreadyOff) {
        closeShutdownConfirm();
        startKey = null;
        settleUntil = 0;
        callService("input_select", "select_option", {
          entity_id: CFG.helpers.activity,
          option: "Idle",
        }, false).catch(() => {});
        render();
        return;
      }
    }
    startKey = key;
    startAt = Date.now();
    settleUntil = Date.now() + 180000;
    settleNote = "";
    banner.classList.add("hidden");
    render();
    callService("script", "turn_on", { entity_id: CFG.scripts[key] }, false).catch(() => {
      startKey = null;
      banner.textContent = "Could not start activity.";
      banner.classList.remove("hidden");
      render();
    });
  }

  const shutdownConfirm = $("shutdown-confirm");
  function openShutdownConfirm() {
    shutdownConfirm.classList.remove("hidden");
  }
  function closeShutdownConfirm() {
    shutdownConfirm.classList.add("hidden");
  }

  function openSettings() {
    if (!settingsSheet) return;
    settingsSheet.classList.remove("hidden");
    syncSettingsVolumeUi();
    renderFavoritesSettings();
    renderBlacklistSettings();
    renderAtvFavoritesSettings();
    renderAtvBlacklistSettings();
    refreshXboxAppCatalog().then(() => {
      renderFavoritesSettings();
      renderBlacklistSettings();
      renderLibraryPicker();
      renderBlacklistPicker();
      renderXboxAppsStrip();
    });
    refreshAtvCatalog().then(() => {
      renderAtvFavoritesSettings();
      renderAtvBlacklistSettings();
      renderAtvLibraryPicker();
      renderAtvBlacklistPicker();
      renderAtvAppsStrip();
    });
  }

  function closeSettings() {
    if (!settingsSheet) return;
    settingsSheet.classList.add("hidden");
  }

  $("save-setup").addEventListener("click", saveSetup);
  $("reconnect").addEventListener("click", () => {
    wantLive = true;
    reconnectAttempt = 0;
    setLive(false);
    connectWs();
  });
  if (openSettingsBtn) bindImmediate(openSettingsBtn, openSettings);
  if (idleOpenSettingsBtn) bindImmediate(idleOpenSettingsBtn, openSettings);
  if (settingsBackBtn) bindImmediate(settingsBackBtn, closeSettings);
  if (settingsSheet) {
    settingsSheet.addEventListener("click", (ev) => {
      if (ev.target === settingsSheet) closeSettings();
    });
  }
  const openXboxAppsBtn = $("open-xbox-apps");
  const xboxAppsBackBtn = $("xbox-apps-back");
  const xboxAppsSheet = $("xbox-apps-sheet");
  if (openXboxAppsBtn) bindImmediate(openXboxAppsBtn, openXboxAppsSheet);
  if (xboxAppsBackBtn) bindImmediate(xboxAppsBackBtn, closeXboxAppsSheet);
  if (xboxAppsSheet) {
    xboxAppsSheet.addEventListener("click", (ev) => {
      if (ev.target === xboxAppsSheet) closeXboxAppsSheet();
    });
  }
  const openAtvAppsBtn = $("open-appletv-apps");
  const atvAppsBackBtn = $("appletv-apps-back");
  const atvAppsSheet = $("appletv-apps-sheet");
  if (openAtvAppsBtn) bindImmediate(openAtvAppsBtn, openAtvAppsSheet);
  if (atvAppsBackBtn) bindImmediate(atvAppsBackBtn, closeAtvAppsSheet);
  if (atvAppsSheet) {
    atvAppsSheet.addEventListener("click", (ev) => {
      if (ev.target === atvAppsSheet) closeAtvAppsSheet();
    });
  }
  const addAtvFavBtn = $("appletv-favorites-add");
  if (addAtvFavBtn) {
    bindImmediate(addAtvFavBtn, () => {
      const picker = $("appletv-library-picker");
      if (!picker) return;
      const open = picker.classList.contains("hidden");
      picker.classList.toggle("hidden", !open);
      if (open) {
        const blPicker = $("appletv-blacklist-picker");
        if (blPicker) blPicker.classList.add("hidden");
        refreshAtvCatalog().then(() => {
          renderAtvLibraryPicker();
          renderAtvFavoritesSettings();
        });
        renderAtvLibraryPicker();
      }
    });
  }
  const addAtvBlBtn = $("appletv-blacklist-add");
  if (addAtvBlBtn) {
    bindImmediate(addAtvBlBtn, () => {
      const picker = $("appletv-blacklist-picker");
      if (!picker) return;
      const open = picker.classList.contains("hidden");
      picker.classList.toggle("hidden", !open);
      if (open) {
        const favPicker = $("appletv-library-picker");
        if (favPicker) favPicker.classList.add("hidden");
        refreshAtvCatalog().then(() => {
          renderAtvBlacklistPicker();
          renderAtvBlacklistSettings();
        });
        renderAtvBlacklistPicker();
      }
    });
  }
  const settingsVol = $("settings-default-volume");
  if (settingsVol) {
    settingsVol.addEventListener("input", () => {
      const v = Number(settingsVol.value);
      setDefaultVolume(v);
      const label = $("settings-default-volume-label");
      if (label) label.textContent = v + "%";
      defaultVolumeApplied = false;
    });
  }
  const clearDefaultVol = $("settings-clear-default-volume");
  if (clearDefaultVol) {
    bindImmediate(clearDefaultVol, () => {
      setDefaultVolume(null);
      syncSettingsVolumeUi();
      defaultVolumeApplied = false;
    });
  }
  const addFavBtn = $("xbox-favorites-add");
  if (addFavBtn) {
    bindImmediate(addFavBtn, () => {
      const picker = $("xbox-library-picker");
      if (!picker) return;
      const open = picker.classList.contains("hidden");
      picker.classList.toggle("hidden", !open);
      if (open) {
        const blPicker = $("xbox-blacklist-picker");
        if (blPicker) blPicker.classList.add("hidden");
        refreshXboxAppCatalog().then(() => {
          renderLibraryPicker();
          renderFavoritesSettings();
        });
        renderLibraryPicker();
      }
    });
  }
  const addBlBtn = $("xbox-blacklist-add");
  if (addBlBtn) {
    bindImmediate(addBlBtn, () => {
      const picker = $("xbox-blacklist-picker");
      if (!picker) return;
      const open = picker.classList.contains("hidden");
      picker.classList.toggle("hidden", !open);
      if (open) {
        const favPicker = $("xbox-library-picker");
        if (favPicker) favPicker.classList.add("hidden");
        refreshXboxAppCatalog().then(() => {
          renderBlacklistPicker();
          renderBlacklistSettings();
        });
        renderBlacklistPicker();
      }
    });
  }
  if (helpBtn && hasLumagenHelp) {
    bindImmediate(helpBtn, () => {
      helpUntil = Date.now() + 4000;
      render();
      callService("button", "press", { entity_id: CFG.roles.lumagenRestart }, false).catch(() => {
        helpUntil = 0;
        banner.textContent = "Lumagen output restart failed.";
        banner.classList.remove("hidden");
        render();
      });
    });
  }

  syncAtvSettingsVisibility();
  renderActivityRow();
  document.querySelectorAll("header [data-script]").forEach((btn) => {
    bindImmediate(btn, () => {
      startScript(btn.dataset.script);
    });
  });
  bindImmediate($("shutdown-cancel"), closeShutdownConfirm);
  bindImmediate($("shutdown-ok"), () => {
    closeShutdownConfirm();
    startScript("shutdown");
  });
  shutdownConfirm.addEventListener("pointerdown", (e) => {
    if (e.target === shutdownConfirm) closeShutdownConfirm();
  });

  volume.addEventListener("input", () => {
    volumeBusy = true;
    volumeLabel.textContent = volume.value + "%";
  });
  volume.addEventListener("change", async () => {
    try {
      await callService("media_player", "volume_set", {
        entity_id: CFG.roles.avr,
        volume_level: Number(volume.value) / 100,
      });
    } finally {
      volumeBusy = false;
    }
  });
  bindImmediate(muteBtn, () => {
    const avr = states[CFG.roles.avr] || {};
    const muted = !!(avr.attributes && avr.attributes.is_volume_muted);
    callService("media_player", "volume_mute", {
      entity_id: CFG.roles.avr,
      is_volume_muted: !muted,
    }, false);
  });

  function nudgeVolume(service) {
    callService("media_player", service, { entity_id: CFG.roles.avr }, false);
  }
  bindImmediate(volUp, () => nudgeVolume("volume_up"));
  bindImmediate(volDown, () => nudgeVolume("volume_down"));
  bindImmediate(deviceBack, closeSheet);
  statusEl.addEventListener("pointerdown", (e) => {
    const pillEl = e.target.closest("[data-device]");
    if (!pillEl) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pillEl._pressSent = true;
    openSheet(pillEl.dataset.device);
  });
  statusEl.addEventListener("click", (e) => {
    const pillEl = e.target.closest("[data-device]");
    if (!pillEl || pillEl._pressSent) {
      if (pillEl) pillEl._pressSent = false;
      return;
    }
    openSheet(pillEl.dataset.device);
  });

  ["xbox-art", "disc-art", "appletv-art"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("error", () => {
      el.classList.add("hidden");
      delete el.dataset.src;
    });
  });

  document.querySelectorAll("[data-disc]").forEach((btn) => {
    bindImmediate(btn, () => {
      callService("remote", "send_command", {
        entity_id: CFG.roles.blurayRemote,
        command: btn.dataset.disc,
      }, false).catch(() => {
        banner.textContent = "Panasonic command failed.";
        banner.classList.remove("hidden");
      });
    });
  });

  document.querySelectorAll("[data-xbox]").forEach((btn) => {
    bindImmediate(btn, () => {
      callService("remote", "send_command", {
        entity_id: CFG.roles.xboxRemote,
        command: btn.dataset.xbox,
      }, false).catch(() => {
        banner.textContent = "Xbox command failed.";
        banner.classList.remove("hidden");
      });
    });
  });

  document.querySelectorAll("[data-appletv]").forEach((btn) => {
    bindImmediate(btn, () => {
      const entity = CFG.roles.appletvRemote;
      if (!entity) return;
      callService("remote", "send_command", {
        entity_id: entity,
        command: btn.dataset.appletv,
      }, false).catch(() => {
        banner.textContent = "Apple TV command failed.";
        banner.classList.remove("hidden");
      });
    });
  });

  applyTheme(currentTheme());
  document.querySelectorAll("[data-look]").forEach((btn) => {
    bindImmediate(btn, () => {
      applyTheme(btn.dataset.look);
    });
  });

  document.addEventListener("submit", (ev) => {
    const form = ev.target && ev.target.closest ? ev.target.closest(".xbox-type") : null;
    if (!form) return;
    ev.preventDefault();
    const input = form.querySelector("input");
    const command = xboxTextCommand(input && input.value);
    if (!command) return;
    callService("remote", "send_command", {
      entity_id: CFG.roles.xboxRemote,
      command,
    }, false).then(() => {
      if (input) input.value = "";
    }).catch(() => {
      banner.textContent = "Xbox command failed.";
      banner.classList.remove("hidden");
    });
  });

  async function loadInjectedAuth() {
    try {
      const res = await fetch("/auth.json", { cache: "no-store" });
      if (!res.ok) return;
      const auth = await res.json();
      if (auth && CFG) {
        if (auth.haUrl) CFG.haUrl = auth.haUrl;
        if (auth.token) CFG.token = auth.token;
      }
    } catch (_) {}
    try {
      const cres = await fetch("contracts.json?v=114", { cache: "no-store" });
      if (cres.ok) CONTRACTS = await cres.json();
    } catch (_) {}
  }

  function finishBoot() {
    const boot = $("boot");
    if (boot) boot.classList.add("hidden");
    haUrl = ((CFG && CFG.haUrl) || localStorage.getItem(STORAGE_URL) || defaultHaUrl()).replace(/\/$/, "");
    token = (CFG && CFG.token) || localStorage.getItem(STORAGE_TOKEN) || "";
    $("ha-url").value = haUrl;
    if (token) showMain();
    else setupEl.classList.remove("hidden");
  }

  loadInjectedAuth().then(finishBoot);
  const tickTimer = setInterval(() => {
    if (mainEl.classList.contains("hidden")) return;
    if (startKey || runningScriptKey() || Date.now() < helpUntil || isSettling() || mediaTicking()) render();
  }, 400);
  if (tickTimer && typeof tickTimer.unref === "function") tickTimer.unref();

  let padObserver = null;
  if (typeof ResizeObserver === "function") {
    padObserver = new ResizeObserver(() => schedulePadScale());
    document.querySelectorAll(".abxy-wrap, .disc-nav, #main, .stage").forEach((el) => {
      padObserver.observe(el);
    });
  }
  window.addEventListener("resize", schedulePadScale);
  window.addEventListener("orientationchange", schedulePadScale);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", schedulePadScale);
  }
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pageshow", onPageShow);
  window.addEventListener("focus", ensureConnected);
  window.addEventListener("online", ensureConnected);
  document.addEventListener("resume", onWake);

  window.TheaterApp = {
    stop() {
      wantLive = false;
      clearReconnectTimer();
      clearInterval(tickTimer);
      if (padObserver) padObserver.disconnect();
      window.removeEventListener("resize", schedulePadScale);
      window.removeEventListener("orientationchange", schedulePadScale);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", schedulePadScale);
      }
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", ensureConnected);
      window.removeEventListener("online", ensureConnected);
      document.removeEventListener("resume", onWake);
      if (ws) {
        try { ws.close(); } catch (_) {}
        ws = null;
      }
    },
  };
})();
