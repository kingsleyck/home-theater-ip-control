(function (global) {
  const registry = global.TheaterSheets || (global.TheaterSheets = {});
  registry.panasonic = function (ctx) {
    const disc = ctx.st("bluray");
    ctx.deviceLive.textContent = disc.state || "—";
    const dead = !disc.state || disc.state === "unavailable";
    const dis = dead ? " disabled" : "";
    ctx.deviceBody.innerHTML = [
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
  };
})(typeof window !== "undefined" ? window : globalThis);
