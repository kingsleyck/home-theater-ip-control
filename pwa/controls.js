/* Shared press + haptic helpers. Loaded before app.js; also required by unit tests. */
(function (global) {
  function isIos(nav) {
    nav = nav || global.navigator || {};
    return /iP(hone|ad|od)/.test(nav.userAgent || "")
      || (nav.platform === "MacIntel" && (nav.maxTouchPoints || 0) > 1);
  }

  function ensureHapticOverlay(el, doc) {
    if (!el || !el.querySelector) return null;
    doc = doc || el.ownerDocument || global.document;
    let sw = el.querySelector(".haptic-switch");
    if (sw) return sw;
    if (!doc || !doc.createElement) return null;
    sw = doc.createElement("input");
    sw.type = "checkbox";
    sw.setAttribute("switch", "");
    sw.className = "haptic-switch";
    sw.tabIndex = -1;
    sw.setAttribute("aria-hidden", "true");
    el.appendChild(sw);
    return sw;
  }

  function hapticHitTarget(el) {
    return (el && el.querySelector && el.querySelector(".haptic-switch")) || el;
  }

  function hapticPulse(nav) {
    nav = nav || global.navigator || {};
    try {
      if (typeof nav.vibrate === "function") nav.vibrate(12);
    } catch (_) {}
  }

  function bindImmediate(el, fn, opts) {
    opts = opts || {};
    const ios = opts.ios != null ? opts.ios : isIos(opts.nav || global.navigator);
    const pulse = opts.hapticPulse || hapticPulse;
    const hit = ios ? ensureHapticOverlay(el) : el;
    (hit || el).addEventListener("pointerdown", (e) => {
      if (el.disabled) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      el._pressSent = true;
      if (!ios) pulse();
      fn(e);
    });
    el.addEventListener("click", (e) => {
      if (el._pressSent) {
        el._pressSent = false;
        return;
      }
      if (el.disabled) return;
      if (!ios) pulse();
      fn(e);
    });
  }

  function bindDoubleTap(el, fn, opts) {
    opts = opts || {};
    const windowMs = opts.windowMs != null ? opts.windowMs : 340;
    const movePx = opts.movePx != null ? opts.movePx : 12;
    const pulse = opts.hapticPulse || hapticPulse;
    let lastTapAt = 0;
    let startX = 0;
    let startY = 0;
    let tracking = false;
    let moved = false;

    function onDown(e) {
      if (el.disabled) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      tracking = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
    }

    function onMove(e) {
      if (!tracking) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if ((dx * dx + dy * dy) >= (movePx * movePx)) moved = true;
    }

    function onUp(e) {
      if (!tracking) return;
      tracking = false;
      if (moved || el.disabled) {
        lastTapAt = 0;
        return;
      }
      const now = Date.now();
      if (lastTapAt && (now - lastTapAt) <= windowMs) {
        lastTapAt = 0;
        el.classList.add("pressed");
        pulse();
        fn(e);
        setTimeout(() => el.classList.remove("pressed"), 120);
        return;
      }
      lastTapAt = now;
    }

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", () => {
      tracking = false;
      lastTapAt = 0;
    });
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  }

  global.TheaterControls = {
    isIos,
    ensureHapticOverlay,
    hapticHitTarget,
    hapticPulse,
    bindImmediate,
    bindDoubleTap,
  };
})(typeof window !== "undefined" ? window : globalThis);
