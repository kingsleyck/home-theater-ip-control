(function (global) {
  const registry = global.TheaterSheets || (global.TheaterSheets = {});
  registry.xbox = function (ctx) {
    const xbox = ctx.st("xbox");
    ctx.deviceLive.textContent = xbox.state || "—";
    const ready = ctx.isOn(xbox.state);
    const dis = ready ? "" : " disabled";
    ctx.deviceBody.innerHTML = [
      `<div class="now-playing sheet-now hidden" id="sheet-xbox-now">
        <img class="now-art hidden" id="sheet-xbox-art" alt="" />
        <div class="now-meta">
          <p class="now-title" id="sheet-xbox-title"></p>
          <p class="now-sub" id="sheet-xbox-sub"></p>
          <div class="now-track hidden" id="sheet-xbox-track"><div class="now-fill" id="sheet-xbox-fill"></div></div>
        </div>
      </div>`,
      `<form class="xbox-type">
        <input type="password" name="q" enterkeyhint="enter" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" placeholder="Type" aria-label="Type to Xbox"${dis} />
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
  };
})(typeof window !== "undefined" ? window : globalThis);
