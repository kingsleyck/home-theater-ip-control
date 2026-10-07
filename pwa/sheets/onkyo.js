(function (global) {
  const registry = global.TheaterSheets || (global.TheaterSheets = {});
  registry.onkyo = function (ctx) {
    const avr = ctx.st("avr");
    const attrs = avr.attributes || {};
    ctx.deviceLive.textContent = ctx.avrModeLabel(avr) || avr.state || "—";
    const info = ctx.avrAudioInfo(avr);
    const format = ctx.avrAudioFormat(avr);
    const vol = typeof attrs.volume_level === "number" ? Math.round(attrs.volume_level * 100) + "%" : "—";
    const modes = attrs.sound_mode_list || [];
    const current = attrs.sound_mode || "";
    const on = avr.state === "on";
    const dis = on ? "" : " disabled";
    const chips = on && modes.length
      ? `<div class="mode-row">${modes.slice(0, 12).map((m) => ctx.chip(m, m === current, `data-sound="${ctx.esc(m)}"`)).join("")}</div>`
      : "";
    const arrow = (dir, label, path) =>
      `<button type="button" class="arrow ${dir}" data-osd="${dir}" aria-label="${label}"${dis}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
    ctx.deviceBody.innerHTML = [
      ctx.factsBox([
        ctx.factRow("Power", avr.state),
        ctx.factRow("Source", String(attrs.source || "").includes("GAME") ? "GAME" : (attrs.source || "—"), true),
        ctx.factRow("Input audio", format || "—"),
        ctx.factRow("Sample rate", info.input_frequency || "—"),
        ctx.factRow("Output", info.output_channels || "—"),
        ctx.factRow("Listening", current || info.listening_mode || "—"),
        ctx.factRow("Volume", vol),
        ctx.factRow("Mute", attrs.is_volume_muted ? "Muted" : "Off"),
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
  };
})(typeof window !== "undefined" ? window : globalThis);
