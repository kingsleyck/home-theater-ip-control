(function (global) {
  const registry = global.TheaterSheets || (global.TheaterSheets = {});
  registry.jvc = function (ctx) {
    const power = ctx.st("display");
    const input = ctx.st("displayInput");
    const picture = ctx.st("displayPictureMode");
    const hours = ctx.st("displayHours");
    ctx.deviceLive.textContent = power.state || "—";
    const hourVal = ctx.entityReady(hours) && !Number.isNaN(Number(hours.state))
      ? Number(hours.state) + " h"
      : ctx.pretty(hours.state);
    const opts = (picture.attributes && picture.attributes.options) || [];
    const modeBtns = ctx.entityReady(picture)
      ? `<div class="mode-row">${opts.map((opt) => ctx.chip(ctx.pretty(opt) || opt, picture.state === opt, `data-select="displayPictureMode" data-option="${ctx.esc(opt)}"`)).join("")}</div>`
      : "";
    ctx.deviceBody.innerHTML = [
      ctx.factsBox([
        ctx.factRow("Power", power.state),
        ctx.factRow("Input", ctx.pretty(input.state) || input.state, true),
        ctx.factRow("Signal", ctx.pretty(ctx.st("displaySource").state) || ctx.st("displaySource").state),
        ctx.factRow("Content", ctx.pretty(ctx.st("displayContentType").state) || ctx.st("displayContentType").state),
        ctx.factRow("Colorimetry", ctx.pretty(ctx.st("displayColorimetry").state) || ctx.st("displayColorimetry").state),
        ctx.factRow("Laser hours", hourVal),
      ]),
      modeBtns,
    ].join("");
  };
})(typeof window !== "undefined" ? window : globalThis);
