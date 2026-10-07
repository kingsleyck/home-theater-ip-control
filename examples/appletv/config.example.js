/* Alternate sample: LG OLED C3 (webOS) + Denon AVR-X3800H + Apple TV 4K.
   No Lumagen — omit lumagenRestart so the PWA Help button stays hidden.
   Entity IDs are illustrative; Home Assistant assigns them from the names you
   choose when pairing. Replace before use. Sources for capabilities:
   https://www.home-assistant.io/integrations/webostv/
   https://www.home-assistant.io/integrations/denonavr/
   https://www.home-assistant.io/integrations/apple_tv/
   Denon AVR-X3800H Input Assign / Source Rename (owner's manual). */
window.THEATER_CONFIG = {
  name: "Living Room",
  shutdownTitle: "Shut down the living room?",
  shutdownHint: "This turns off the TV, receiver, and Apple TV.",
  activities: [
    { id: "watch_appletv", label: "Apple TV", script: "script.watch_appletv", icon: "tv", deck: "appletv" },
  ],
  scripts: {
    watch_appletv: "script.watch_appletv",
    shutdown: "script.theater_shutdown",
    resync: "script.theater_resync",
  },
  helpers: {
    activity: "input_select.theater_activity",
    error: "input_text.theater_last_error",
  },
  pills: [
    { id: "lg", label: "LG C3", kicker: "OLED", roles: ["display"], detail: "display" },
    { id: "denon", label: "Denon", kicker: "AVR-X3800H", roles: ["avr"], detail: "avr" },
    { id: "appletv", label: "Apple TV", kicker: "Apple TV", roles: ["appletv"], detail: "media" },
  ],
  roles: {
    /* webOS exposes one media_player; use media_player.select_source for HDMI. */
    display: "media_player.lg_oled_c3",
    /* denonavr media_player; factory input for HDMI 2 is "Media Player". */
    avr: "media_player.denon_avr_x3800h",
    appletv: "media_player.living_room_apple_tv",
    appletvRemote: "remote.living_room_apple_tv",
  },
};
