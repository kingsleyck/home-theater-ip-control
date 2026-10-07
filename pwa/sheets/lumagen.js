(function (global) {
  const registry = global.TheaterSheets || (global.TheaterSheets = {});
  registry.lumagen = function (ctx) {
    const power = ctx.st("processor");
    const input = ctx.st("processorInput");
    const on = power.state === "on";
    ctx.deviceLive.textContent = on
      ? (ctx.pretty(ctx.st("processorVideo").state) || input.state || "on")
      : (power.state || "off");
    const src = [ctx.st("processorSourceRes").state, ctx.st("processorSourceRefresh").state, ctx.pretty(ctx.st("processorSourceHdr").state)]
      .filter((x) => ctx.entityReady({ state: x }))
      .join(" ");
    const out = [ctx.st("processorOutputRes").state, ctx.st("processorOutputRefresh").state, ctx.pretty(ctx.st("processorOutputColor").state)]
      .filter((x) => ctx.entityReady({ state: x }))
      .join(" ");
    const cms = [ctx.pretty(ctx.st("processorCms").state), ctx.pretty(ctx.st("processorStyle").state)].filter(Boolean).join(" / ");
    ctx.deviceBody.innerHTML = [
      ctx.factsBox([
        ctx.factRow("Power", power.state),
        ctx.factRow("Input", (input.state || "").replace(/\s*\(\d+\)\s*$/, "") || input.state, true),
        ctx.factRow("Memory", ctx.st("processorMemory").state, true),
        ctx.factRow("Video", ctx.pretty(ctx.st("processorVideo").state) || ctx.st("processorVideo").state),
        ctx.factRow("Source", src),
        ctx.factRow("Output", out),
        ctx.factRow("CMS / style", cms),
        ctx.factRow("Bridge", "Serial-to-Ethernet"),
      ]),
      `<div class="sheet-actions">
        <button type="button" data-sheet="lumagenRestart"${on ? "" : " disabled"}>Restart outputs</button>
        <button type="button" data-sheet="lumagenReload">Reload</button>
      </div>`,
    ].join("");
  };
})(typeof window !== "undefined" ? window : globalThis);
