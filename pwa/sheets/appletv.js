(function (global) {
  const registry = global.TheaterSheets || (global.TheaterSheets = {});
  registry.appletv = function (ctx) {
    const atv = ctx.st("appletv");
    const attrs = atv.attributes || {};
    ctx.deviceLive.textContent = atv.state || "—";
    ctx.deviceBody.innerHTML = [
      ctx.factsBox([
        ctx.factRow("Power", atv.state),
        ctx.factRow("App", attrs.app_name || attrs.source || "—", true),
      ]),
      `<div class="now-playing sheet-now hidden" id="sheet-appletv-now">
        <img class="now-art hidden" id="sheet-appletv-art" alt="" />
        <div class="now-meta">
          <p class="now-title" id="sheet-appletv-title"></p>
          <p class="now-sub" id="sheet-appletv-sub"></p>
          <div class="now-track hidden" id="sheet-appletv-track"><div class="now-fill" id="sheet-appletv-fill"></div></div>
        </div>
      </div>`,
    ].join("");
  };
})(typeof window !== "undefined" ? window : globalThis);
