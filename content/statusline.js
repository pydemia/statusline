(() => {
  if (globalThis.__statuslineLoaded) {
    return;
  }
  globalThis.__statuslineLoaded = true;

  const { normalizeSettings } = StatuslineSettings;
  const HOST_ID = "__statusline_extension_host__";
  const ZOOM_STEPS = [
    0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2,
    2.5, 3, 4, 5
  ];

  let settings;
  let host;
  let shadow;
  let barElement;
  let leftZone;
  let rightZone;
  let currentZoom = 1;
  let clockTimer = null;
  let scrollFrame = null;
  let selectionTimer = null;
  let originalInset = null;
  let currentLink = "";
  let floatingSurface = null;
  let floatingAnchor = null;
  let activeSurfaceKey = "";
  let pendingSurfaceRestore = "";
  let activeScrollElement = null;
  let captureInProgress = false;
  let draggedShortcutButton = null;
  let shortcutDropCommitted = false;
  let documentMountObserver = null;
  let bodyMountObserver = null;
  let observedBody = null;
  let mountCheckScheduled = false;
  let dockRefreshTimer = null;
  let lastKnownUrl = location.href;
  const widgetElements = new Map();

  const COMMON_TIME_ZONES = [
    "UTC",
    "Asia/Seoul",
    "Asia/Tokyo",
    "Asia/Shanghai",
    "Asia/Hong_Kong",
    "Asia/Singapore",
    "Asia/Taipei",
    "Asia/Kolkata",
    "Asia/Dubai",
    "Australia/Sydney",
    "Europe/London",
    "Europe/Berlin",
    "Europe/Paris",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Toronto",
    "America/Sao_Paulo"
  ];

  function validatedTimeZone(value) {
    const zone = String(value || "").trim();
    if (!zone) {
      throw new Error("Enter an IANA time zone such as Asia/Seoul.");
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date());
      return zone;
    } catch {
      throw new Error(`Unknown time zone: ${zone}`);
    }
  }

  function zonedDateParts(now, timeZone = settings.clockTimeZone) {
    const zone = validatedTimeZone(timeZone);
    const numeric = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      }).formatToParts(now).map((part) => [part.type, part.value])
    );
    const monthLong = new Intl.DateTimeFormat(undefined, {
      timeZone: zone,
      month: "long"
    }).format(now);
    const monthShort = new Intl.DateTimeFormat(undefined, {
      timeZone: zone,
      month: "short"
    }).format(now);
    const weekdayLong = new Intl.DateTimeFormat(undefined, {
      timeZone: zone,
      weekday: "long"
    }).format(now);
    const weekdayShort = new Intl.DateTimeFormat(undefined, {
      timeZone: zone,
      weekday: "short"
    }).format(now);
    const dayPeriod = new Intl.DateTimeFormat(undefined, {
      timeZone: zone,
      hour: "numeric",
      hour12: true
    }).formatToParts(now).find((part) => part.type === "dayPeriod")?.value || "";
    const offset = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "shortOffset"
    }).formatToParts(now).find((part) => part.type === "timeZoneName")?.value || zone;
    return {
      zone,
      year: Number(numeric.year),
      month: Number(numeric.month),
      day: Number(numeric.day),
      hour: Number(numeric.hour),
      minute: Number(numeric.minute),
      second: Number(numeric.second),
      monthLong,
      monthShort,
      weekdayLong,
      weekdayShort,
      dayPeriod,
      offset
    };
  }

  function formatDateTime(now, pattern = settings.dateTimeFormat, timeZone = settings.clockTimeZone) {
    const parts = zonedDateParts(now, timeZone);
    const pad = (value, length = 2) => String(value).padStart(length, "0");
    const hour12 = parts.hour % 12 || 12;
    const tokens = {
      YYYY: String(parts.year),
      YY: pad(parts.year % 100),
      MMMM: parts.monthLong,
      MMM: parts.monthShort,
      MM: pad(parts.month),
      M: String(parts.month),
      DD: pad(parts.day),
      D: String(parts.day),
      dddd: parts.weekdayLong,
      ddd: parts.weekdayShort,
      HH: pad(parts.hour),
      H: String(parts.hour),
      hh: pad(hour12),
      h: String(hour12),
      mm: pad(parts.minute),
      m: String(parts.minute),
      ss: pad(parts.second),
      s: String(parts.second),
      A: parts.dayPeriod.toUpperCase(),
      a: parts.dayPeriod.toLowerCase()
    };
    const tokenPattern = /YYYY|MMMM|dddd|MMM|ddd|YY|MM|DD|HH|hh|mm|ss|M|D|H|h|m|s|A|a/g;
    return String(pattern || "")
      .split(/(\[[^\]]*\])/g)
      .map((part) => {
        if (part.startsWith("[") && part.endsWith("]")) {
          return part.slice(1, -1);
        }
        return part.replace(tokenPattern, (token) => tokens[token]);
      })
      .join("");
  }

  function clockUsesSeconds(pattern = settings.dateTimeFormat) {
    const unescaped = String(pattern || "").replace(/\[[^\]]*\]/g, "");
    return /ss|s/.test(unescaped);
  }

  function timeZoneLabel(timeZone) {
    const city = String(timeZone || "").split("/").at(-1) || timeZone;
    return city.replaceAll("_", " ");
  }

  function buildStyle() {
    const topRule = settings.position === "top" ? "top: 0;" : "bottom: 0;";
    return `
      :host {
        all: initial;
        position: fixed;
        ${topRule}
        left: 0;
        right: 0;
        z-index: 2147483647;
        height: ${settings.height}px;
        pointer-events: none;
        color-scheme: light dark;
        --sl-height: ${settings.height}px;
        --sl-font-size: ${settings.fontSize}px;
        --sl-opacity: ${settings.opacity};
      }

      .bar {
        box-sizing: border-box;
        position: relative;
        display: flex;
        align-items: stretch;
        width: 100%;
        height: 100%;
        overflow: hidden;
        border-${settings.position === "top" ? "bottom" : "top"}: 1px solid var(--sl-border);
        background: color-mix(in srgb, var(--sl-bg) calc(var(--sl-opacity) * 100%), transparent);
        color: var(--sl-fg);
        box-shadow: 0 ${settings.position === "top" ? "1px 6px" : "-1px 6px"} rgb(0 0 0 / 0.12);
        backdrop-filter: blur(8px) saturate(1.1);
        font: 500 var(--sl-font-size)/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
        padding-inline: 14px;
        pointer-events: auto;
        user-select: none;
      }

      .bar[data-theme="light"],
      .toast[data-theme="light"],
      .floating-surface[data-theme="light"] {
        --sl-bg: #f4f4f4;
        --sl-fg: #202020;
        --sl-muted: #666;
        --sl-border: rgb(0 0 0 / 0.18);
        --sl-hover: rgb(0 0 0 / 0.07);
        --sl-accent: #315ea8;
      }

      .bar[data-theme="dark"],
      .toast[data-theme="dark"],
      .floating-surface[data-theme="dark"] {
        --sl-bg: #202124;
        --sl-fg: #e9eaec;
        --sl-muted: #aeb2b8;
        --sl-border: rgb(255 255 255 / 0.15);
        --sl-hover: rgb(255 255 255 / 0.09);
        --sl-accent: #8ab4f8;
      }

      .zone {
        display: flex;
        min-width: 0;
        height: 100%;
        align-items: stretch;
      }

      .zone-left {
        flex: 0 0 auto;
        justify-content: flex-start;
        min-width: 0;
        overflow: hidden;
        border-right: 1px solid color-mix(in srgb, var(--sl-border) 82%, transparent);
      }


      .zone-right {
        flex: 1 1 auto;
        justify-content: flex-end;
        min-width: 0;
        margin-left: auto;
        overflow: hidden;
      }

      .widget {
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        min-width: 0;
        height: 100%;
        padding: 0 8px;
        border: 0;
        border-right: 1px solid color-mix(in srgb, var(--sl-border) 70%, transparent);
        background: transparent;
        color: inherit;
        font: inherit;
        white-space: nowrap;
      }

      .zone-right .widget:last-child {
        border-right: 0;
      }

      button.widget,
      .zoom-button,
      .zoom-value {
        cursor: pointer;
      }

      button.widget:hover,
      .zoom-button:hover,
      .zoom-value:hover {
        background: var(--sl-hover);
      }

      button.widget:focus-visible,
      .zoom-button:focus-visible,
      .zoom-value:focus-visible {
        outline: 2px solid var(--sl-accent);
        outline-offset: -2px;
      }

      .truncate {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .status-widget {
        flex: 1 1 160px;
        max-width: 52vw;
      }

      .status-widget.is-empty {
        flex: 1 1 16px;
        padding: 0;
        border-right: 0;
      }


      .metric-widget {
        color: var(--sl-muted);
      }

      .selection-widget.is-empty {
        display: none;
      }

      .scroll-widget {
        gap: 7px;
        color: var(--sl-muted);
      }

      .scroll-word {
        font-size: 10px;
        font-weight: 650;
        letter-spacing: 0.045em;
        text-transform: uppercase;
      }

      .scroll-track {
        position: relative;
        width: 8px;
        height: 22px;
        border: 1px solid color-mix(in srgb, var(--sl-muted) 46%, transparent);
        border-radius: 999px;
        background: color-mix(in srgb, var(--sl-muted) 9%, transparent);
      }

      .scroll-thumb {
        position: absolute;
        top: 1px;
        left: 1px;
        width: 4px;
        height: 7px;
        border-radius: 999px;
        background: var(--sl-accent);
        transform: translateY(0);
        transition: transform 70ms linear, height 100ms ease;
      }

      .action-button {
        justify-content: center;
        min-width: calc(var(--sl-height) - 4px);
        padding: 0 9px;
        cursor: pointer;
        color: var(--sl-muted);
      }

      .action-button:hover {
        color: var(--sl-fg);
      }

      .action-button:active {
        background: var(--sl-hover);
        box-shadow: inset 0 0 0 1px var(--sl-border);
      }

      .action-button[aria-busy="true"] {
        opacity: 0.55;
        cursor: progress;
      }

      .action-icon {
        display: block;
        width: 17px;
        height: 17px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.65;
        stroke-linecap: round;
        stroke-linejoin: round;
        pointer-events: none;
      }

      .panel-dock {
        gap: 0;
        padding: 0 3px;
      }

      .panel-launcher {
        position: relative;
        display: inline-grid;
        place-items: center;
        width: calc(var(--sl-height) - 6px);
        min-width: 28px;
        height: 100%;
        padding: 0;
        border: 0;
        border-radius: 0;
        background: transparent;
        color: var(--sl-muted);
        cursor: pointer;
      }

      .panel-launcher:hover,
      .panel-launcher[aria-pressed="true"] {
        background: var(--sl-hover);
        color: var(--sl-fg);
      }

      .panel-launcher:focus-visible {
        outline: 2px solid var(--sl-accent);
        outline-offset: -2px;
      }

      .panel-launcher[data-panel-id] {
        cursor: grab;
      }

      .panel-launcher[data-panel-id]:active {
        cursor: grabbing;
      }

      .panel-launcher.is-dragging {
        opacity: 0.32;
      }

      .panel-launcher.drag-before {
        box-shadow: inset 2px 0 0 var(--sl-accent);
      }

      .panel-launcher.drag-after {
        box-shadow: inset -2px 0 0 var(--sl-accent);
      }

      .panel-launcher > svg {
        width: 17px;
        height: 17px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.7;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .panel-favicon {
        position: relative;
        display: grid;
        place-items: center;
        width: 19px;
        height: 19px;
        overflow: hidden;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 700;
        background: color-mix(in srgb, var(--sl-muted) 13%, transparent);
        color: var(--sl-fg);
      }

      .panel-favicon img {
        position: absolute;
        inset: 2px;
        width: 15px;
        height: 15px;
        object-fit: contain;
      }

      .floating-surface {
        position: absolute;
        ${settings.position === "top" ? "top: calc(var(--sl-height) + 8px);" : "bottom: calc(var(--sl-height) + 8px);"}
        left: 10px;
        z-index: 3;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        width: min(480px, calc(100vw - 20px));
        height: min(68vh, 640px);
        min-width: min(320px, calc(100vw - 20px));
        min-height: 240px;
        max-width: calc(100vw - 20px);
        max-height: calc(100vh - var(--sl-height) - 20px);
        overflow: hidden;
        resize: both;
        border: 1px solid var(--sl-border);
        border-radius: 8px;
        background: var(--sl-bg);
        color: var(--sl-fg);
        box-shadow: 0 14px 42px rgb(0 0 0 / 0.28);
        font: 500 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        pointer-events: auto;
      }

      .floating-header {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 40px;
        padding: 0 6px 0 12px;
        border-bottom: 1px solid var(--sl-border);
        background: color-mix(in srgb, var(--sl-bg) 94%, var(--sl-fg) 6%);
      }

      .floating-title {
        min-width: 0;
        flex: 1 1 auto;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 650;
      }

      .floating-header-actions {
        display: flex;
        height: 100%;
        align-items: stretch;
      }

      .surface-icon-button {
        display: inline-grid;
        place-items: center;
        min-width: 34px;
        height: 34px;
        padding: 0 8px;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: var(--sl-muted);
        font: inherit;
        cursor: pointer;
      }

      .surface-icon-button:hover {
        background: var(--sl-hover);
        color: var(--sl-fg);
      }

      .surface-icon-button:focus-visible {
        outline: 2px solid var(--sl-accent);
        outline-offset: -2px;
      }

      .surface-icon-button svg {
        width: 17px;
        height: 17px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.7;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .floating-body {
        display: flex;
        flex: 1 1 auto;
        min-height: 0;
        overflow: hidden;
        background: var(--sl-bg);
      }

      .panel-manager,
      .tab-picker {
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        overflow: auto;
        padding: 12px;
      }

      .panel-manager-list,
      .tab-list {
        display: grid;
        align-content: start;
        grid-auto-rows: max-content;
        gap: 6px;
      }

      .panel-manager-row,
      .tab-row {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: 9px;
        min-width: 0;
        padding: 8px 9px;
        border: 1px solid var(--sl-border);
        border-radius: 6px;
        background: color-mix(in srgb, var(--sl-bg) 96%, var(--sl-fg) 4%);
      }

      .panel-manager-copy,
      .tab-copy {
        flex: 1 1 auto;
        min-width: 0;
      }

      .panel-manager-copy strong,
      .tab-copy strong,
      .panel-manager-copy small,
      .tab-copy small {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .panel-manager-copy small,
      .tab-copy small,
      .surface-help {
        color: var(--sl-muted);
        font-size: 11px;
      }

      .panel-form {
        display: grid;
        gap: 8px;
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid var(--sl-border);
      }

      .panel-form-row {
        display: grid;
        grid-template-columns: 1fr 1.8fr auto;
        gap: 7px;
      }

      .panel-form input {
        box-sizing: border-box;
        min-width: 0;
        height: 34px;
        padding: 0 9px;
        border: 1px solid var(--sl-border);
        border-radius: 5px;
        background: var(--sl-bg);
        color: var(--sl-fg);
        font: inherit;
        user-select: text;
      }

      .surface-button {
        min-height: 34px;
        padding: 0 11px;
        border: 1px solid var(--sl-border);
        border-radius: 5px;
        background: color-mix(in srgb, var(--sl-bg) 90%, var(--sl-fg) 10%);
        color: var(--sl-fg);
        font: inherit;
        cursor: pointer;
      }

      .surface-button:hover {
        background: var(--sl-hover);
      }

      .surface-button.primary {
        border-color: color-mix(in srgb, var(--sl-accent) 60%, var(--sl-border));
        background: color-mix(in srgb, var(--sl-accent) 17%, var(--sl-bg));
      }

      .surface-button:disabled {
        cursor: not-allowed;
        opacity: 0.48;
      }

      .surface-error {
        margin: 8px 0 0;
        color: #b42318;
        font-size: 12px;
      }

      .tab-picker {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .tab-list {
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto;
      }

      .tab-row {
        cursor: pointer;
      }

      .tab-row input {
        flex: 0 0 auto;
      }

      .tab-row.is-disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .tab-favicon {
        width: 16px;
        height: 16px;
        object-fit: contain;
        flex: 0 0 auto;
      }

      .tab-picker-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding-top: 10px;
        border-top: 1px solid var(--sl-border);
      }

      .tab-picker-status {
        min-width: 0;
        color: var(--sl-muted);
        font-size: 12px;
      }

      .capture-surface {
        width: min(420px, calc(100vw - 20px));
        height: auto;
        min-height: 0;
        resize: none;
      }

      .capture-menu {
        display: grid;
        width: 100%;
        padding: 8px;
        gap: 4px;
      }

      .capture-option {
        display: grid;
        grid-template-columns: 28px 1fr;
        gap: 10px;
        align-items: center;
        min-height: 48px;
        padding: 7px 9px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: var(--sl-fg);
        text-align: left;
        font: inherit;
        cursor: pointer;
      }

      .capture-option:hover,
      .capture-option:focus-visible {
        background: var(--sl-hover);
      }

      .capture-option:focus-visible {
        outline: 2px solid var(--sl-accent);
        outline-offset: -2px;
      }

      .capture-option-icon {
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border: 1px solid var(--sl-border);
        border-radius: 5px;
        color: var(--sl-muted);
        font-size: 13px;
        font-weight: 700;
      }

      .capture-option-copy strong,
      .capture-option-copy small {
        display: block;
      }

      .capture-option-copy small {
        margin-top: 2px;
        color: var(--sl-muted);
        font-size: 11px;
        font-weight: 500;
      }

      .capture-selection-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        cursor: crosshair;
        pointer-events: auto;
        background: rgb(0 0 0 / 0.12);
      }

      .capture-selection-rect {
        position: fixed;
        border: 1px solid #fff;
        outline: 1px solid #315ea8;
        background: rgb(49 94 168 / 0.12);
        box-shadow: 0 0 0 99999px rgb(0 0 0 / 0.18);
        pointer-events: none;
      }

      .capture-selection-help {
        position: fixed;
        top: 18px;
        left: 50%;
        transform: translateX(-50%);
        padding: 6px 9px;
        border-radius: 5px;
        background: rgb(25 25 25 / 0.9);
        color: #fff;
        font: 500 12px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        pointer-events: none;
      }

      .toast {
        position: absolute;
        ${settings.position === "top" ? "top: calc(var(--sl-height) + 8px);" : "bottom: calc(var(--sl-height) + 8px);"}
        right: 10px;
        max-width: min(420px, calc(100vw - 20px));
        padding: 8px 11px;
        border: 1px solid var(--sl-border);
        border-radius: 7px;
        background: var(--sl-bg);
        color: var(--sl-fg);
        box-shadow: 0 5px 22px rgb(0 0 0 / 0.22);
        font: 500 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        opacity: 0;
        transform: translateY(${settings.position === "top" ? "-4px" : "4px"});
        transition: opacity 120ms ease, transform 120ms ease;
        pointer-events: none;
      }

      .toast.is-visible {
        opacity: 1;
        transform: translateY(0);
      }

      .zoom-widget {
        gap: 0;
        padding: 0;
      }

      .zoom-button,
      .zoom-value {
        box-sizing: border-box;
        display: inline-grid;
        place-items: center;
        min-width: 24px;
        height: 100%;
        padding: 0 6px;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
      }

      .zoom-value {
        width: 52px;
        min-width: 52px;
        text-align: center;
        color: var(--sl-muted);
        user-select: text;
      }

      input.zoom-value {
        outline: 0;
      }

      input.zoom-value:focus {
        background: var(--sl-bg);
        color: var(--sl-fg);
        box-shadow: inset 0 0 0 1px var(--sl-accent);
      }

      .clock-widget {
        font-variant-numeric: tabular-nums;
        cursor: pointer;
      }

      .clock-widget[aria-pressed="true"] {
        background: var(--sl-hover);
        color: var(--sl-fg);
      }

      .clock-date {
        color: var(--sl-muted);
      }

      .clock-surface {
        width: min(440px, calc(100vw - 20px));
        height: auto;
        min-height: 0;
        max-height: min(76vh, 720px);
        resize: none;
      }

      .clock-panel {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        width: 100%;
        min-height: 0;
        max-height: calc(min(76vh, 720px) - 42px);
        overflow: auto;
        padding: 12px;
        gap: 14px;
      }

      .clock-primary {
        display: grid;
        grid-template-columns: 58px minmax(0, 1fr);
        align-items: center;
        gap: 12px;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--sl-border);
      }

      .analog-clock {
        display: block;
        width: 46px;
        height: 46px;
        color: var(--sl-fg);
      }

      .analog-clock .face {
        fill: color-mix(in srgb, var(--sl-bg) 94%, var(--sl-fg) 6%);
        stroke: var(--sl-border);
        stroke-width: 1.2;
      }

      .analog-clock .tick {
        stroke: var(--sl-muted);
        stroke-width: 1;
        stroke-linecap: round;
      }

      .analog-clock .hour-hand,
      .analog-clock .minute-hand,
      .analog-clock .second-hand {
        transform-origin: 24px 24px;
        stroke-linecap: round;
      }

      .analog-clock .hour-hand {
        stroke: currentColor;
        stroke-width: 2.2;
      }

      .analog-clock .minute-hand {
        stroke: currentColor;
        stroke-width: 1.6;
      }

      .analog-clock .second-hand {
        stroke: var(--sl-accent);
        stroke-width: 1;
      }

      .clock-fields {
        display: grid;
        gap: 8px;
      }

      .clock-field {
        display: grid;
        gap: 4px;
        min-width: 0;
      }

      .clock-field > span,
      .world-clock-heading {
        color: var(--sl-muted);
        font-size: 11px;
        font-weight: 650;
      }

      .clock-field input,
      .world-clock-add input {
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
        height: 34px;
        padding: 0 9px;
        border: 1px solid var(--sl-border);
        border-radius: 5px;
        outline: 0;
        background: var(--sl-bg);
        color: var(--sl-fg);
        font: inherit;
        user-select: text;
      }

      .clock-field input:focus,
      .world-clock-add input:focus {
        border-color: color-mix(in srgb, var(--sl-accent) 62%, var(--sl-border));
        box-shadow: 0 0 0 1px color-mix(in srgb, var(--sl-accent) 25%, transparent);
      }

      .clock-field-help {
        margin: 0;
        color: var(--sl-muted);
        font-size: 10px;
        line-height: 1.4;
      }

      .clock-primary-actions {
        display: flex;
        justify-content: flex-end;
        margin-top: 2px;
      }

      .world-clock-section {
        display: grid;
        gap: 8px;
      }

      .world-clock-add {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 7px;
      }

      .world-clock-list {
        display: grid;
        gap: 5px;
      }

      .world-clock-row {
        display: grid;
        grid-template-columns: 52px minmax(0, 1fr) auto;
        align-items: center;
        gap: 10px;
        min-height: 60px;
        padding: 6px 6px 6px 8px;
        border: 1px solid var(--sl-border);
        border-radius: 6px;
        background: color-mix(in srgb, var(--sl-bg) 96%, var(--sl-fg) 4%);
      }

      .world-clock-copy {
        min-width: 0;
      }

      .world-clock-copy strong,
      .world-clock-copy span,
      .world-clock-copy small {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .world-clock-copy strong {
        font-size: 12px;
      }

      .world-clock-copy span {
        margin-top: 2px;
        font-size: 13px;
        font-variant-numeric: tabular-nums;
      }

      .world-clock-copy small {
        margin-top: 1px;
        color: var(--sl-muted);
        font-size: 10px;
      }

      .world-clock-empty {
        margin: 2px 0 0;
        color: var(--sl-muted);
        font-size: 11px;
      }

      .hidden {
        display: none !important;
      }

      @media (prefers-reduced-transparency: reduce) {
        .bar {
          backdrop-filter: none;
          background: var(--sl-bg);
        }
      }
    `;
  }

  function resolvedTheme() {
    if (settings.theme !== "auto") {
      return settings.theme;
    }
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function createTextWidget(id, className = "") {
    const element = document.createElement("div");
    element.className = `widget ${className}`.trim();
    element.dataset.widget = id;
    return element;
  }

  const ACTION_ICONS = {
    capture: [
      "M4.5 6.5h2l1-1.5h4.8l1 1.5h2.2",
      "M4 6.5h12v8H4z",
      "M10 9a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"
    ],
    devtools: [
      "M7.5 6 4 10l3.5 4",
      "M12.5 6 16 10l-3.5 4",
      "M11.5 4.5 8.5 15.5"
    ],
    tile: [
      "M3.5 4.5h13v11h-13z",
      "M10 4.5v11"
    ],
    stack: [
      "M5 5.5h10v7H5z",
      "M7 3.5h10v7",
      "M3 7.5v7h10"
    ]
  };

  function createActionIcon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("action-icon");
    svg.setAttribute("viewBox", "0 0 20 20");
    svg.setAttribute("aria-hidden", "true");
    for (const pathData of ACTION_ICONS[name] || []) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", pathData);
      svg.append(path);
    }
    return svg;
  }

  const SURFACE_ICONS = {
    plus: ["M10 4v12", "M4 10h12"],
    close: ["M5 5l10 10", "M15 5 5 15"],
    external: ["M8 5H5v10h10v-3", "M10 5h5v5", "M15 5 8.5 11.5"],
    trash: ["M6 6h8", "M8 6V4.5h4V6", "M7 6.5l.6 9h4.8l.6-9", "M9 9v4", "M11 9v4"],
    panel: ["M4 4.5h12v11H4z", "M4 8h12"],
    current: ["M10 4.5v11", "M4.5 10h11"]
  };

  function createSurfaceIcon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 20 20");
    svg.setAttribute("aria-hidden", "true");
    for (const pathData of SURFACE_ICONS[name] || []) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", pathData);
      svg.append(path);
    }
    return svg;
  }

  function createActionWidget(id, label) {
    const element = document.createElement("button");
    element.className = "widget action-button";
    element.dataset.widget = id;
    element.type = "button";
    element.title = label;
    element.setAttribute("aria-label", label);
    if (id === "capture" || id === "tile" || id === "stack") {
      element.setAttribute("aria-pressed", "false");
    }
    element.append(createActionIcon(id));
    element.addEventListener("click", () => runAction(id, element));
    return element;
  }

  function createZoomWidget() {
    const element = createTextWidget("zoom", "zoom-widget");

    const minus = document.createElement("button");
    minus.className = "zoom-button";
    minus.type = "button";
    minus.textContent = "−";
    minus.setAttribute("aria-label", "Zoom out");
    minus.addEventListener("click", () => setAdjacentZoom(-1));

    const value = document.createElement("input");
    value.className = "zoom-value";
    value.type = "text";
    value.inputMode = "numeric";
    value.value = "100%";
    value.title = "Click and enter a zoom percentage";
    value.setAttribute("aria-label", "Page zoom percentage");
    value.addEventListener("focus", () => {
      value.value = String(Math.round(currentZoom * 100));
      value.select();
    });
    value.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitZoomInput(value);
      } else if (event.key === "Escape") {
        event.preventDefault();
        value.blur();
      }
    });
    value.addEventListener("blur", () => updateZoom(currentZoom));

    const plus = document.createElement("button");
    plus.className = "zoom-button";
    plus.type = "button";
    plus.textContent = "+";
    plus.setAttribute("aria-label", "Zoom in");
    plus.addEventListener("click", () => setAdjacentZoom(1));

    element.append(minus, value, plus);
    element.zoomValue = value;
    return element;
  }

  function createScrollWidget() {
    const element = createTextWidget("scroll", "scroll-widget");
    element.title = "Scroll position";

    const word = document.createElement("span");
    word.className = "scroll-word";
    word.textContent = "Scroll";

    const track = document.createElement("span");
    track.className = "scroll-track";
    track.setAttribute("aria-hidden", "true");
    const thumb = document.createElement("span");
    thumb.className = "scroll-thumb";
    track.append(thumb);

    element.append(word, track);
    element.scrollThumb = thumb;
    return element;
  }

  function panelInitial(name) {
    return String(name || "?").trim().charAt(0).toUpperCase() || "?";
  }

  function createPanelLauncher(panel) {
    const button = document.createElement("button");
    button.className = "panel-launcher";
    button.type = "button";
    button.draggable = true;
    button.title = `${panel.name} — drag to reorder`;
    button.setAttribute("aria-label", `Open ${panel.name} shortcut`);
    button.setAttribute("aria-grabbed", "false");
    button.dataset.panelId = panel.id;

    const icon = document.createElement("span");
    icon.className = "panel-favicon";
    icon.textContent = panelInitial(panel.name);
    button.append(icon);

    button.addEventListener("click", (event) => {
      if (button.dataset.justDragged === "true") {
        event.preventDefault();
        button.dataset.justDragged = "false";
        return;
      }
      void openShortcutWindow(panel, button);
    });
    button.addEventListener("dragstart", (event) => {
      draggedShortcutButton = button;
      shortcutDropCommitted = false;
      button.classList.add("is-dragging");
      button.setAttribute("aria-grabbed", "true");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", panel.id);
      }
    });
    button.addEventListener("dragend", () => {
      button.classList.remove("is-dragging");
      button.setAttribute("aria-grabbed", "false");
      button.dataset.justDragged = "true";
      setTimeout(() => {
        if (button.isConnected) {
          button.dataset.justDragged = "false";
        }
      }, 0);
      shadow?.querySelectorAll(".panel-launcher.drag-before, .panel-launcher.drag-after")
        .forEach((item) => item.classList.remove("drag-before", "drag-after"));
      draggedShortcutButton = null;
      shortcutDropCommitted = false;
    });
    return button;
  }

  async function saveShortcutOrderFromDock(dock) {
    const ids = Array.from(dock.querySelectorAll(".panel-launcher[data-panel-id]"))
      .map((button) => button.dataset.panelId)
      .filter(Boolean);
    const currentIds = settings.panels.map((panel) => panel.id);
    if (ids.length !== currentIds.length || ids.every((id, index) => id === currentIds[index])) {
      return;
    }
    const byId = new Map(settings.panels.map((panel) => [panel.id, panel]));
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
    await savePanels(ordered, false);
  }

  function createPanelDockWidget() {
    const element = createTextWidget("panels", "panel-dock");
    element.setAttribute("role", "group");
    element.setAttribute("aria-label", "Shortcuts");

    for (const panel of settings.panels) {
      element.append(createPanelLauncher(panel));
    }

    const add = document.createElement("button");
    add.className = "panel-launcher";
    add.type = "button";
    add.title = "Add or manage shortcuts";
    add.dataset.panelManage = "true";
    add.setAttribute("aria-label", "Add or manage shortcuts");
    add.append(createSurfaceIcon("plus"));
    add.addEventListener("click", () => openPanelManager(add));
    element.append(add);

    element.addEventListener("dragover", (event) => {
      if (!draggedShortcutButton?.isConnected) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
      const target = event.target instanceof Element
        ? event.target.closest(".panel-launcher[data-panel-id]")
        : null;
      element.querySelectorAll(".panel-launcher.drag-before, .panel-launcher.drag-after")
        .forEach((item) => item.classList.remove("drag-before", "drag-after"));
      if (!target || target === draggedShortcutButton) {
        element.insertBefore(draggedShortcutButton, add);
        return;
      }
      const rect = target.getBoundingClientRect();
      const midpoint = rect.left + rect.width / 2;
      const launchers = Array.from(element.querySelectorAll(".panel-launcher[data-panel-id]"));
      const draggedIndex = launchers.indexOf(draggedShortcutButton);
      const targetIndex = launchers.indexOf(target);
      const nearMidpoint = Math.abs(event.clientX - midpoint) <= 1;
      const before = event.clientX < midpoint || (nearMidpoint && draggedIndex > targetIndex);
      target.classList.add(before ? "drag-before" : "drag-after");
      element.insertBefore(
        draggedShortcutButton,
        before ? target : target.nextSibling || add
      );
    });
    element.addEventListener("drop", async (event) => {
      if (!draggedShortcutButton?.isConnected || shortcutDropCommitted) {
        return;
      }
      event.preventDefault();
      shortcutDropCommitted = true;
      await saveShortcutOrderFromDock(element);
    });

    element.manageButton = add;
    return element;
  }

  function createClockWidget() {
    const element = document.createElement("button");
    element.className = "widget clock-widget";
    element.dataset.widget = "clock";
    element.type = "button";
    element.setAttribute("aria-label", "Date, time, and world clocks");
    element.setAttribute("aria-pressed", "false");

    const date = document.createElement("span");
    date.className = "clock-date";
    const time = document.createElement("span");
    time.className = "clock-time";
    element.append(date, time);
    element.dateNode = date;
    element.timeNode = time;
    element.addEventListener("click", () => openClockPanel(element));
    return element;
  }

  function createAnalogClock(timeZone, role = "world") {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.classList.add("analog-clock");
    svg.setAttribute("viewBox", "0 0 48 48");
    svg.setAttribute("aria-hidden", "true");
    svg.dataset.timeZone = timeZone;
    svg.dataset.clockRole = role;

    const face = document.createElementNS(ns, "circle");
    face.classList.add("face");
    face.setAttribute("cx", "24");
    face.setAttribute("cy", "24");
    face.setAttribute("r", "21");
    svg.append(face);

    for (let index = 0; index < 12; index += 1) {
      const angle = index * Math.PI / 6;
      const inner = index % 3 === 0 ? 17 : 18.5;
      const outer = 20;
      const tick = document.createElementNS(ns, "line");
      tick.classList.add("tick");
      tick.setAttribute("x1", String(24 + Math.sin(angle) * inner));
      tick.setAttribute("y1", String(24 - Math.cos(angle) * inner));
      tick.setAttribute("x2", String(24 + Math.sin(angle) * outer));
      tick.setAttribute("y2", String(24 - Math.cos(angle) * outer));
      svg.append(tick);
    }

    const hour = document.createElementNS(ns, "line");
    hour.classList.add("hour-hand");
    hour.setAttribute("x1", "24");
    hour.setAttribute("y1", "24");
    hour.setAttribute("x2", "24");
    hour.setAttribute("y2", "13");

    const minute = document.createElementNS(ns, "line");
    minute.classList.add("minute-hand");
    minute.setAttribute("x1", "24");
    minute.setAttribute("y1", "24");
    minute.setAttribute("x2", "24");
    minute.setAttribute("y2", "9");

    const second = document.createElementNS(ns, "line");
    second.classList.add("second-hand");
    second.setAttribute("x1", "24");
    second.setAttribute("y1", "27");
    second.setAttribute("x2", "24");
    second.setAttribute("y2", "8");

    const center = document.createElementNS(ns, "circle");
    center.setAttribute("cx", "24");
    center.setAttribute("cy", "24");
    center.setAttribute("r", "1.6");
    center.setAttribute("fill", "currentColor");

    svg.append(hour, minute, second, center);
    svg.hourHand = hour;
    svg.minuteHand = minute;
    svg.secondHand = second;
    updateAnalogClock(svg, new Date(), timeZone);
    return svg;
  }

  function updateAnalogClock(clock, now, timeZone = clock?.dataset?.timeZone) {
    if (!clock) {
      return;
    }
    const parts = zonedDateParts(now, timeZone);
    const hourAngle = ((parts.hour % 12) + parts.minute / 60 + parts.second / 3600) * 30;
    const minuteAngle = (parts.minute + parts.second / 60) * 6;
    const secondAngle = parts.second * 6;
    clock.hourHand?.setAttribute("transform", `rotate(${hourAngle} 24 24)`);
    clock.minuteHand?.setAttribute("transform", `rotate(${minuteAngle} 24 24)`);
    clock.secondHand?.setAttribute("transform", `rotate(${secondAngle} 24 24)`);
  }

  function buildTimeZoneDatalist(id) {
    const list = document.createElement("datalist");
    list.id = id;
    for (const zone of COMMON_TIME_ZONES) {
      const option = document.createElement("option");
      option.value = zone;
      list.append(option);
    }
    return list;
  }

  async function persistClockSettings(patch) {
    const next = normalizeSettings({ ...settings, ...patch });
    pendingSurfaceRestore = "clock";
    settings = next;
    await chrome.storage.sync.set({
      dateTimeFormat: next.dateTimeFormat,
      clockTimeZone: next.clockTimeZone,
      worldClocks: next.worldClocks
    });
  }

  function renderWorldClockList(container) {
    container.replaceChildren();
    if (settings.worldClocks.length === 0) {
      const empty = document.createElement("p");
      empty.className = "world-clock-empty";
      empty.textContent = "Add time zones to keep several clocks here.";
      container.append(empty);
      return;
    }

    const now = new Date();
    for (const timeZone of settings.worldClocks) {
      const row = document.createElement("div");
      row.className = "world-clock-row";
      row.dataset.timeZone = timeZone;

      const analog = createAnalogClock(timeZone);
      const copy = document.createElement("div");
      copy.className = "world-clock-copy";
      const label = document.createElement("strong");
      label.textContent = timeZoneLabel(timeZone);
      const time = document.createElement("span");
      time.className = "world-clock-time";
      time.textContent = formatDateTime(now, settings.dateTimeFormat, timeZone);
      const meta = document.createElement("small");
      meta.className = "world-clock-meta";
      const parts = zonedDateParts(now, timeZone);
      meta.textContent = `${timeZone} · ${parts.offset}`;
      copy.append(label, time, meta);

      const remove = createHeaderButton("trash", `Remove ${timeZone}`, async () => {
        await persistClockSettings({
          worldClocks: settings.worldClocks.filter((zone) => zone !== timeZone)
        });
      });
      row.append(analog, copy, remove);
      container.append(row);
    }
  }

  function updateOpenClockPanel(now = new Date()) {
    if (activeSurfaceKey !== "clock" || !floatingSurface?.isConnected) {
      return;
    }
    floatingSurface.querySelectorAll(".analog-clock").forEach((clock) => {
      updateAnalogClock(clock, now, clock.dataset.timeZone);
    });
    floatingSurface.querySelectorAll(".world-clock-row").forEach((row) => {
      const timeZone = row.dataset.timeZone;
      const time = row.querySelector(".world-clock-time");
      const meta = row.querySelector(".world-clock-meta");
      if (time) {
        time.textContent = formatDateTime(now, settings.dateTimeFormat, timeZone);
      }
      if (meta) {
        meta.textContent = `${timeZone} · ${zonedDateParts(now, timeZone).offset}`;
      }
    });
  }

  function openClockPanel(anchor = null) {
    const shell = createFloatingSurface("clock", "Clock", anchor);
    if (!shell) {
      scheduleClock();
      return;
    }
    shell.surface.classList.add("clock-surface");

    const panel = document.createElement("div");
    panel.className = "clock-panel";
    const timeZoneListId = `statusline-timezones-${Date.now()}`;
    const timeZoneList = buildTimeZoneDatalist(timeZoneListId);

    const primary = document.createElement("section");
    primary.className = "clock-primary";
    const analog = createAnalogClock(settings.clockTimeZone, "primary");

    const fields = document.createElement("div");
    fields.className = "clock-fields";
    const formatLabel = document.createElement("label");
    formatLabel.className = "clock-field";
    const formatTitle = document.createElement("span");
    formatTitle.textContent = "Format";
    const formatInput = document.createElement("input");
    formatInput.type = "text";
    formatInput.maxLength = 80;
    formatInput.value = settings.dateTimeFormat;
    formatInput.placeholder = "YYYY-MM-DD ddd HH:mm";
    formatInput.setAttribute("aria-label", "Date and time format");
    formatLabel.append(formatTitle, formatInput);

    const zoneLabel = document.createElement("label");
    zoneLabel.className = "clock-field";
    const zoneTitle = document.createElement("span");
    zoneTitle.textContent = "Time zone";
    const zoneInput = document.createElement("input");
    zoneInput.type = "text";
    zoneInput.value = settings.clockTimeZone;
    zoneInput.placeholder = "Asia/Seoul";
    zoneInput.setAttribute("list", timeZoneListId);
    zoneInput.setAttribute("aria-label", "Primary clock time zone");
    zoneLabel.append(zoneTitle, zoneInput);

    const help = document.createElement("p");
    help.className = "clock-field-help";
    help.textContent = "Use an IANA time zone. Format tokens match Statusline Settings.";
    const error = document.createElement("p");
    error.className = "surface-error hidden";
    error.setAttribute("role", "alert");

    const actions = document.createElement("div");
    actions.className = "clock-primary-actions";
    const save = document.createElement("button");
    save.className = "surface-button primary";
    save.type = "button";
    save.textContent = "Apply";
    save.addEventListener("click", async () => {
      try {
        const format = formatInput.value.trim();
        if (!format) {
          throw new Error("Enter a date/time format.");
        }
        const timeZone = validatedTimeZone(zoneInput.value);
        error.classList.add("hidden");
        await persistClockSettings({
          dateTimeFormat: format,
          clockTimeZone: timeZone,
          worldClocks: settings.worldClocks.filter((zone) => zone !== timeZone)
        });
      } catch (caught) {
        error.textContent = caught?.message || "Could not update the clock.";
        error.classList.remove("hidden");
      }
    });
    actions.append(save);
    fields.append(formatLabel, zoneLabel, help, error, actions);
    primary.append(analog, fields);

    const world = document.createElement("section");
    world.className = "world-clock-section";
    const worldHeading = document.createElement("div");
    worldHeading.className = "world-clock-heading";
    worldHeading.textContent = "World clocks";
    const addRow = document.createElement("form");
    addRow.className = "world-clock-add";
    const worldInput = document.createElement("input");
    worldInput.type = "text";
    worldInput.placeholder = "Europe/London";
    worldInput.setAttribute("list", timeZoneListId);
    worldInput.setAttribute("aria-label", "World clock time zone");
    const addButton = document.createElement("button");
    addButton.className = "surface-button";
    addButton.type = "submit";
    addButton.textContent = "Add";
    const worldError = document.createElement("p");
    worldError.className = "surface-error hidden";
    worldError.setAttribute("role", "alert");
    addRow.append(worldInput, addButton);

    const list = document.createElement("div");
    list.className = "world-clock-list";
    renderWorldClockList(list);

    addRow.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const timeZone = validatedTimeZone(worldInput.value);
        if (timeZone === settings.clockTimeZone) {
          throw new Error("That time zone is already the primary clock.");
        }
        if (settings.worldClocks.includes(timeZone)) {
          throw new Error("That world clock is already in the list.");
        }
        if (settings.worldClocks.length >= 12) {
          throw new Error("Statusline supports up to 12 world clocks.");
        }
        worldError.classList.add("hidden");
        await persistClockSettings({
          worldClocks: [...settings.worldClocks, timeZone]
        });
      } catch (caught) {
        worldError.textContent = caught?.message || "Could not add the world clock.";
        worldError.classList.remove("hidden");
      }
    });

    world.append(worldHeading, addRow, worldError, list);
    panel.append(timeZoneList, primary, world);
    shell.body.append(panel);
    positionFloatingSurface(shell.surface, anchor);
    updateOpenClockPanel();
    scheduleClock();
  }

  function createWidget(id) {
    const actionLabels = {
      capture: "Capture",
      devtools: "Developer tools",
      tile: "Tile tabs",
      stack: "Stack tabs"
    };
    if (actionLabels[id]) {
      return createActionWidget(id, actionLabels[id]);
    }
    if (id === "panels") {
      return createPanelDockWidget();
    }
    if (id === "zoom") {
      return createZoomWidget();
    }
    if (id === "scroll") {
      return createScrollWidget();
    }
    if (id === "clock") {
      return createClockWidget();
    }

    const classById = {
      status: "status-widget truncate",
      selection: "metric-widget selection-widget",
      viewport: "metric-widget"
    };
    const element = createTextWidget(id, classById[id] || "");
    if (id === "status") {
      element.classList.add("is-empty");
    }
    if (id === "selection") {
      element.classList.add("is-empty");
    }
    return element;
  }

  function ensureHost() {
    const mountParent = document.documentElement;
    let changed = false;

    if (!host || !shadow) {
      document.getElementById(HOST_ID)?.remove();
      host = document.createElement("div");
      host.id = HOST_ID;
      shadow = host.attachShadow({ mode: "open" });
      changed = true;
    }

    if (!host.isConnected || host.parentNode !== mountParent) {
      mountParent.append(host);
      changed = true;
    }

    return changed;
  }

  function render() {
    ensureHost();
    shadow.replaceChildren();
    floatingSurface = null;
    floatingAnchor = null;
    activeSurfaceKey = "";
    widgetElements.clear();

    const style = document.createElement("style");
    style.textContent = buildStyle();

    const bar = document.createElement("div");
    barElement = bar;
    bar.className = "bar";
    bar.dataset.theme = resolvedTheme();
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Statusline browser status bar");

    leftZone = document.createElement("div");
    leftZone.className = "zone zone-left";
    rightZone = document.createElement("div");
    rightZone.className = "zone zone-right";

    const panelConfig = settings.widgets.find((config) => config.id === "panels");
    if (panelConfig?.enabled) {
      const panelDock = createWidget("panels");
      widgetElements.set("panels", panelDock);
      leftZone.append(panelDock);
    }

    for (const config of settings.widgets) {
      if (!config.enabled || config.id === "panels") {
        continue;
      }
      const element = createWidget(config.id);
      widgetElements.set(config.id, element);
      rightZone.append(element);
    }

    bar.append(leftZone, rightZone);
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.dataset.theme = resolvedTheme();
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    shadow.append(style, bar, toast);

    updateZoneLayout();
    updateVisibility();
    applyPageInset();
    updateAll();
    requestZoom();
    scheduleClock();
  }

  function updateZoneLayout() {}

  function updateVisibility() {
    if (!host) {
      return;
    }
    const disabledOnHost = settings.disabledHosts.includes(location.hostname);
    const fullscreenHidden = settings.hideOnFullscreen && Boolean(document.fullscreenElement);
    host.style.display = settings.enabled && !disabledOnHost && !fullscreenHidden ? "block" : "none";
  }

  function rememberInlineStyle(records, node, property, appliedValue = "") {
    records.push({
      node,
      property,
      value: node.style.getPropertyValue(property),
      priority: node.style.getPropertyPriority(property),
      appliedValue
    });
  }

  function setReservedStyle(records, node, property, value) {
    if (!node) {
      return;
    }
    rememberInlineStyle(records, node, property, value);
    node.style.setProperty(property, value, "important");
  }

  function withStatuslineHidden(callback) {
    const previousDisplay = host?.style.display || "";
    if (host) {
      host.style.display = "none";
    }
    try {
      return callback();
    } finally {
      if (host) {
        host.style.display = previousDisplay;
      }
    }
  }

  function elementDepthFromBody(element) {
    let depth = 0;
    let node = element;
    while (node && node !== document.body) {
      depth += 1;
      node = node.parentElement;
    }
    return node === document.body ? depth : Number.POSITIVE_INFINITY;
  }

  function visibleRectArea(rect) {
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    const right = Math.min(innerWidth, rect.right);
    const bottom = Math.min(innerHeight, rect.bottom);
    return Math.max(0, right - left) * Math.max(0, bottom - top);
  }

  function sampledLayoutElements() {
    if (!document.body) {
      return [];
    }
    const found = new Set();
    const xs = [0.06, 0.24, 0.5, 0.76, 0.94];
    const ys = [0.05, 0.25, 0.5, 0.72, 0.88];

    withStatuslineHidden(() => {
      for (const xRatio of xs) {
        for (const yRatio of ys) {
          const stack = document.elementsFromPoint(
            Math.max(1, Math.min(innerWidth - 1, innerWidth * xRatio)),
            Math.max(1, Math.min(innerHeight - 1, innerHeight * yRatio))
          );
          for (const element of stack.slice(0, 4)) {
            let node = element;
            while (
              node instanceof Element &&
              node !== document.body &&
              node !== document.documentElement
            ) {
              if (node !== host && !node.closest?.(`#${HOST_ID}`)) {
                found.add(node);
              }
              node = node.parentElement;
            }
          }
        }
      }
    });

    for (const element of document.body.children) {
      if (
        element !== host &&
        !["SCRIPT", "STYLE", "LINK", "NOSCRIPT"].includes(element.tagName)
      ) {
        found.add(element);
      }
    }
    return [...found];
  }

  function scrollRange(element) {
    if (!element) {
      return 0;
    }
    return Math.max(0, element.scrollHeight - element.clientHeight);
  }

  function isScrollableCandidate(element, style = getComputedStyle(element)) {
    if (!(element instanceof Element)) {
      return false;
    }
    if (scrollRange(element) <= 12) {
      return false;
    }
    return ["auto", "scroll", "overlay"].includes(style.overflowY);
  }

  function primaryScrollContainer(scope, sampled = sampledLayoutElements()) {
    const documentScroller = document.scrollingElement || document.documentElement;
    const candidates = [];
    const add = (element, bonus = 0) => {
      if (!(element instanceof Element)) {
        return;
      }
      if (scope && scope !== document.body && !scope.contains(element) && element !== scope) {
        return;
      }
      const style = getComputedStyle(element);
      if (!isScrollableCandidate(element, style)) {
        return;
      }
      const rect = element.getBoundingClientRect();
      const area = visibleRectArea(rect);
      const viewportArea = Math.max(1, innerWidth * innerHeight);
      const areaRatio = area / viewportArea;
      const score = areaRatio * 100 + Math.min(25, scrollRange(element) / 200) + bonus;
      candidates.push({ element, rect, style, score });
    };

    if (activeScrollElement instanceof Element && activeScrollElement.isConnected) {
      add(activeScrollElement, 30);
    }
    for (const element of sampled) {
      add(element);
    }
    add(documentScroller);

    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.element || documentScroller;
  }

  function primaryViewportShell(body, sampled = sampledLayoutElements()) {
    if (!body) {
      return null;
    }
    const viewportArea = Math.max(1, innerWidth * innerHeight);
    const all = new Set(sampled);
    for (const child of body.children) {
      if (child !== host) {
        all.add(child);
      }
    }

    const candidates = [...all]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const depth = elementDepthFromBody(element);
        const areaRatio = visibleRectArea(rect) / viewportArea;
        const widthRatio = Math.min(1, Math.max(0, rect.width / Math.max(1, innerWidth)));
        const heightRatio = Math.min(1, Math.max(0, rect.height / Math.max(1, innerHeight)));
        const topFit = Math.abs(rect.top) <= Math.max(48, innerHeight * 0.08);
        const bottomFit = rect.bottom >= innerHeight * 0.78;
        const layoutBonus = ["flex", "grid", "block"].includes(style.display) ? 5 : 0;
        const overflowBonus = ["hidden", "clip", "auto", "scroll", "overlay"].includes(style.overflowY)
          ? 8
          : 0;
        const positionPenalty = style.position === "fixed" && heightRatio > 0.9 ? 18 : 0;
        const depthPenalty = Number.isFinite(depth) ? Math.max(0, depth - 1) * 1.5 : 20;
        const score = areaRatio * 70 + widthRatio * 10 + heightRatio * 15
          + (topFit ? 8 : 0) + (bottomFit ? 6 : 0)
          + layoutBonus + overflowBonus - positionPenalty - depthPenalty;
        return { element, rect, style, depth, areaRatio, widthRatio, heightRatio, score };
      })
      .filter(({ rect, widthRatio, heightRatio }) => (
        widthRatio >= 0.68 &&
        heightRatio >= 0.62 &&
        rect.top <= Math.max(96, innerHeight * 0.14) &&
        rect.bottom >= innerHeight * 0.72
      ))
      .sort((a, b) => {
        if (Math.abs(b.score - a.score) > 2) {
          return b.score - a.score;
        }
        return a.depth - b.depth;
      });
    return candidates[0] || null;
  }

  function classifyDockLayout(body) {
    const root = document.documentElement;
    if (!body || !root) {
      return { kind: "document", shell: null, scroller: null, reason: "missing-root" };
    }

    const sampled = sampledLayoutElements();
    const shellCandidate = primaryViewportShell(body, sampled);
    const rootStyle = getComputedStyle(root);
    const bodyStyle = getComputedStyle(body);
    const documentScroller = document.scrollingElement || root;
    const documentRange = Math.max(
      scrollRange(documentScroller),
      Math.max(0, root.scrollHeight - innerHeight),
      Math.max(0, body.scrollHeight - innerHeight)
    );
    const viewportLocked = [rootStyle.overflowY, bodyStyle.overflowY]
      .some((value) => ["hidden", "clip"].includes(value));

    const scope = shellCandidate?.element || body;
    const scroller = primaryScrollContainer(scope, sampled);
    const scrollerRect = scroller?.getBoundingClientRect?.();
    const scrollerOwnsViewport = Boolean(
      scroller &&
      scroller !== documentScroller &&
      scrollRange(scroller) > 24 &&
      scrollerRect &&
      visibleRectArea(scrollerRect) >= innerWidth * innerHeight * 0.36
    );
    const documentOwnsScroll = documentRange > Math.max(96, settings.height * 2)
      && !viewportLocked;

    // Pattern 1: conventional document scrolling. Do not rewrite viewport
    // geometry; reserve only trailing content space and edge controls.
    if (documentOwnsScroll && !scrollerOwnsViewport) {
      return {
        kind: "document",
        shell: null,
        scroller: documentScroller,
        reason: "document-scroll"
      };
    }

    // Pattern 2: application viewport. The root/body typically locks the
    // viewport or a large nested scroller owns most visible scrolling.
    if (
      shellCandidate &&
      (viewportLocked || scrollerOwnsViewport || documentRange <= settings.height * 2)
    ) {
      return {
        kind: "app",
        shell: shellCandidate.element,
        scroller,
        reason: viewportLocked ? "locked-viewport" : "nested-scroll"
      };
    }

    return {
      kind: "document",
      shell: null,
      scroller: documentScroller,
      reason: "safe-default"
    };
  }

  function reserveDocumentFlow(records, body) {
    const bodyStyle = getComputedStyle(body);
    const root = document.documentElement;
    const rootStyle = getComputedStyle(root);
    const property = settings.position === "top" ? "padding-top" : "padding-bottom";
    const scrollProperty = settings.position === "top"
      ? "scroll-padding-top"
      : "scroll-padding-bottom";
    const existingPadding = parseFloat(
      settings.position === "top" ? bodyStyle.paddingTop : bodyStyle.paddingBottom
    ) || 0;
    const existingScrollPadding = parseFloat(
      settings.position === "top" ? rootStyle.scrollPaddingTop : rootStyle.scrollPaddingBottom
    ) || 0;

    // Document layouts often already reserve footer/bottom spacing. Adding the
    // Statusline height on top of that creates an artificial extra scroll tail
    // on otherwise simple pages. Reserve only the missing amount instead.
    if (existingPadding < settings.height) {
      setReservedStyle(records, body, property, `${settings.height}px`);
    }
    if (existingScrollPadding < settings.height) {
      setReservedStyle(records, root, scrollProperty, `${settings.height}px`);
    }
  }

  function reserveViewportApp(records, shell, scroller) {
    if (!shell) {
      return false;
    }
    const rect = shell.getBoundingClientRect();
    if (rect.width < innerWidth * 0.62 || rect.height < innerHeight * 0.58) {
      return false;
    }

    const topInset = settings.position === "top" ? settings.height : 0;
    const bottomInset = settings.position === "bottom" ? settings.height : 0;
    const shellTop = Math.max(0, rect.top);
    const availableHeight = Math.max(1, innerHeight - shellTop - bottomInset - topInset);
    const targetHeight = `${Math.floor(availableHeight)}px`;
    const style = getComputedStyle(shell);

    setReservedStyle(records, shell, "box-sizing", "border-box");
    setReservedStyle(records, shell, "height", targetHeight);
    setReservedStyle(records, shell, "max-height", targetHeight);
    const minHeight = parseFloat(style.minHeight) || 0;
    if (minHeight >= innerHeight * 0.55) {
      setReservedStyle(records, shell, "min-height", targetHeight);
    }
    if (settings.position === "top") {
      const currentMarginTop = parseFloat(style.marginTop) || 0;
      setReservedStyle(records, shell, "margin-top", `${currentMarginTop + settings.height}px`);
    }

    if (scroller instanceof Element && scroller !== document.scrollingElement) {
      const scrollProperty = settings.position === "top"
        ? "scroll-padding-top"
        : "scroll-padding-bottom";
      setReservedStyle(records, scroller, scrollProperty, `${settings.height}px`);
    }
    return true;
  }

  function dockEdgeElements() {
    if (!document.body) {
      return [];
    }
    const found = new Set();
    const xs = [0.03, 0.15, 0.3, 0.5, 0.7, 0.85, 0.97];
    const distances = [
      2,
      Math.max(8, settings.height * 0.45),
      Math.max(18, settings.height),
      Math.max(72, settings.height * 2),
      Math.max(112, settings.height * 3)
    ];

    withStatuslineHidden(() => {
      for (const xRatio of xs) {
        for (const distance of distances) {
          const y = settings.position === "top"
            ? Math.min(innerHeight - 1, distance)
            : Math.max(1, innerHeight - distance);
          const x = Math.max(1, Math.min(innerWidth - 1, innerWidth * xRatio));
          for (const element of document.elementsFromPoint(x, y).slice(0, 5)) {
            let node = element;
            while (
              node instanceof Element &&
              node !== document.body &&
              node !== document.documentElement
            ) {
              if (node !== host && !node.closest?.(`#${HOST_ID}`)) {
                found.add(node);
              }
              node = node.parentElement;
            }
          }
        }
      }
    });

    for (const element of document.body.children) {
      const style = getComputedStyle(element);
      if (["fixed", "sticky"].includes(style.position)) {
        found.add(element);
      }
    }
    return [...found];
  }

  function edgeRailCandidates() {
    if (!document.body) {
      return [];
    }

    const found = new Set();
    const xPositions = [
      2,
      Math.min(innerWidth - 2, Math.max(18, innerWidth * 0.02)),
      Math.max(2, innerWidth - Math.max(18, innerWidth * 0.02)),
      Math.max(2, innerWidth - 2)
    ];
    const yRatios = [0.08, 0.25, 0.5, 0.75, 0.9];

    withStatuslineHidden(() => {
      for (const x of xPositions) {
        for (const yRatio of yRatios) {
          const y = Math.max(1, Math.min(innerHeight - 1, innerHeight * yRatio));
          for (const element of document.elementsFromPoint(x, y).slice(0, 8)) {
            let node = element;
            while (
              node instanceof Element &&
              node !== document.body &&
              node !== document.documentElement
            ) {
              if (node !== host && !node.closest?.(`#${HOST_ID}`)) {
                found.add(node);
              }
              node = node.parentElement;
            }
          }
        }
      }
    });

    return [...found].filter((element) => {
      const rect = element.getBoundingClientRect();
      if (visibleRectArea(rect) <= 0) {
        return false;
      }
      const touchesLeft = rect.left <= Math.max(10, innerWidth * 0.015);
      const touchesRight = rect.right >= innerWidth - Math.max(10, innerWidth * 0.015);
      const tall = rect.height >= innerHeight * 0.58;
      const railWidth = rect.width >= 48 && rect.width <= innerWidth * 0.42;
      const reachesDock = settings.position === "bottom"
        ? rect.bottom > innerHeight - settings.height + 1
        : rect.top < settings.height - 1;
      return tall && railWidth && (touchesLeft || touchesRight) && reachesDock;
    });
  }

  function insetEdgeRails(records) {
    const dockEdge = settings.position === "bottom"
      ? innerHeight - settings.height
      : settings.height;

    const candidates = edgeRailCandidates()
      .map((element) => ({
        element,
        depth: elementDepthFromBody(element),
        area: visibleRectArea(element.getBoundingClientRect())
      }))
      .sort((a, b) => a.depth - b.depth || b.area - a.area)
      .map(({ element }) => element);

    for (const element of candidates) {
      if (!(element instanceof Element) || element === host || element.closest?.(`#${HOST_ID}`)) {
        continue;
      }

      let rect = element.getBoundingClientRect();
      let style = getComputedStyle(element);
      const availableHeight = settings.position === "bottom"
        ? Math.max(1, dockEdge - Math.max(0, rect.top))
        : Math.max(1, rect.bottom - dockEdge);

      if (settings.position === "bottom") {
        if (style.position === "fixed" && style.bottom !== "auto") {
          setReservedStyle(
            records,
            element,
            "bottom",
            `calc(${style.bottom} + ${settings.height}px)`
          );
        } else {
          setReservedStyle(records, element, "max-height", `${Math.floor(availableHeight)}px`);
          if (rect.height > availableHeight + 2 && (
            style.position === "fixed" ||
            style.position === "absolute" ||
            rect.height >= innerHeight * 0.82
          )) {
            setReservedStyle(records, element, "height", `${Math.floor(availableHeight)}px`);
          }
        }
      } else if (style.position === "fixed" && style.top !== "auto") {
        setReservedStyle(
          records,
          element,
          "top",
          `calc(${style.top} + ${settings.height}px)`
        );
      } else {
        setReservedStyle(records, element, "max-height", `${Math.floor(availableHeight)}px`);
      }

      // Re-read after adjustment. A nested edge column can become fully
      // contained by an ancestor rail and should not receive a second offset.
      rect = element.getBoundingClientRect();
      style = getComputedStyle(element);
      if (settings.position === "bottom" && rect.bottom <= dockEdge + 1) {
        continue;
      }
      if (settings.position === "top" && rect.top >= dockEdge - 1) {
        continue;
      }
    }
  }

  function insetEdgeControls(records) {
    const edge = settings.position === "top" ? settings.height : innerHeight - settings.height;
    const viewportArea = Math.max(1, innerWidth * innerHeight);
    const elements = dockEdgeElements()
      .map((element) => ({
        element,
        area: element instanceof Element
          ? visibleRectArea(element.getBoundingClientRect())
          : 0,
        depth: element instanceof Element ? elementDepthFromBody(element) : Number.POSITIVE_INFINITY
      }))
      // Process large portal roots before their descendants. This lets the
      // descendants reflow against the reduced portal viewport before we
      // decide whether any additional edge correction is still required.
      .sort((a, b) => b.area - a.area || a.depth - b.depth)
      .map(({ element }) => element);

    for (const element of elements) {
      if (!(element instanceof Element) || element === host || element.closest?.(`#${HOST_ID}`)) {
        continue;
      }
      let style = getComputedStyle(element);
      if (!["fixed", "sticky"].includes(style.position)) {
        continue;
      }
      let rect = element.getBoundingClientRect();
      if (rect.width < 24 || rect.height < 12 || visibleRectArea(rect) <= 0) {
        continue;
      }

      const overlapsDock = settings.position === "bottom"
        ? rect.bottom > edge + 1
        : rect.top < edge - 1;
      if (!overlapsDock) {
        // The control already reflowed above/below the dock because an
        // ancestor viewport was resized. Do not apply a second offset.
        continue;
      }

      const areaRatio = visibleRectArea(rect) / viewportArea;
      const isTallViewportSurface = rect.height > innerHeight * 0.55
        && rect.width > Math.min(280, innerWidth * 0.18)
        && (rect.top <= innerHeight * 0.12 || rect.bottom >= innerHeight * 0.88);
      const isLargeOverlayRoot = areaRatio > 0.42 || isTallViewportSurface;

      // Full-screen fixed portal roots frequently own side panels, drawers,
      // menus, and other independently rendered surfaces. Padding does not
      // change the containing block used by absolutely positioned children,
      // so shrink the portal viewport itself at the docked edge.
      if (isLargeOverlayRoot && style.position === "fixed") {
        if (settings.position === "bottom") {
          if (style.bottom !== "auto") {
            setReservedStyle(
              records,
              element,
              "bottom",
              `calc(${style.bottom} + ${settings.height}px)`
            );
          } else if (style.top !== "auto") {
            const available = Math.max(1, edge - rect.top);
            setReservedStyle(records, element, "height", `${Math.floor(available)}px`);
            setReservedStyle(records, element, "max-height", `${Math.floor(available)}px`);
          }
        } else if (style.top !== "auto") {
          setReservedStyle(
            records,
            element,
            "top",
            `calc(${style.top} + ${settings.height}px)`
          );
        } else if (style.bottom !== "auto") {
          const available = Math.max(1, rect.bottom - settings.height);
          setReservedStyle(records, element, "height", `${Math.floor(available)}px`);
          setReservedStyle(records, element, "max-height", `${Math.floor(available)}px`);
        }
        continue;
      }

      // Re-read geometry after an ancestor portal root may have been resized.
      style = getComputedStyle(element);
      rect = element.getBoundingClientRect();
      const stillOverlaps = settings.position === "bottom"
        ? rect.bottom > edge + 1
        : rect.top < edge - 1;
      if (!stillOverlaps) {
        continue;
      }

      if (settings.position === "bottom") {
        const bottom = style.bottom;
        if (bottom === "auto" || rect.top < innerHeight * 0.18) {
          continue;
        }
        setReservedStyle(records, element, "bottom", `calc(${bottom} + ${settings.height}px)`);
      } else {
        const top = style.top;
        if (top === "auto" || rect.bottom > innerHeight * 0.82) {
          continue;
        }
        setReservedStyle(records, element, "top", `calc(${top} + ${settings.height}px)`);
      }
    }
  }

  function applyPageInset() {
    restorePageInset();
    if (
      settings.layoutMode !== "docked" ||
      !settings.enabled ||
      settings.disabledHosts.includes(location.hostname)
    ) {
      host?.removeAttribute("data-statusline-dock-profile");
      return;
    }

    const body = document.body;
    if (!body || !document.documentElement) {
      return;
    }

    const records = [];
    const profile = classifyDockLayout(body);
    let appliedProfile = profile.kind;

    if (profile.kind === "app" && reserveViewportApp(records, profile.shell, profile.scroller)) {
      insetEdgeRails(records);
      insetEdgeControls(records);
    } else {
      reserveDocumentFlow(records, body);
      insetEdgeRails(records);
      insetEdgeControls(records);
      appliedProfile = "document";
    }

    if (host) {
      host.setAttribute("data-statusline-dock-profile", `${appliedProfile}:${profile.reason}`);
    }
    originalInset = { records, profile: appliedProfile };
  }

  function restorePageInset() {
    if (!originalInset) {
      return;
    }
    for (const record of originalInset.records || []) {
      if (!record.node?.style) {
        continue;
      }
      const currentValue = record.node.style.getPropertyValue(record.property);
      const currentPriority = record.node.style.getPropertyPriority(record.property);
      if (currentValue !== record.appliedValue || currentPriority !== "important") {
        continue;
      }
      if (record.value) {
        record.node.style.setProperty(
          record.property,
          record.value,
          record.priority || ""
        );
      } else {
        record.node.style.removeProperty(record.property);
      }
    }
    host?.removeAttribute("data-statusline-dock-profile");
    originalInset = null;
  }

  function updateAll() {
    updateViewport();
    updateSelection();
    updateScroll();
    updateLinkStatus(currentLink);
    updateClock();
  }

  function updateViewport() {
    const element = widgetElements.get("viewport");
    if (!element) {
      return;
    }
    element.textContent = `${innerWidth}×${innerHeight}`;
    element.title = "Viewport size";
  }

  function updateSelection() {
    const element = widgetElements.get("selection");
    if (!element) {
      return;
    }
    const length = String(document.getSelection()?.toString() || "").length;
    if (!length) {
      element.textContent = "";
      element.classList.add("is-empty");
      return;
    }
    element.textContent = `sel ${length}`;
    element.title = `${length} selected characters`;
    element.classList.remove("is-empty");
  }

  function scrollMetrics(target = activeScrollElement) {
    const root = document.scrollingElement || document.documentElement;
    const node = target instanceof Element ? target : root;
    const isRoot = node === root || node === document.documentElement || node === document.body;
    const scrollTop = isRoot ? root.scrollTop : node.scrollTop;
    const scrollHeight = isRoot ? root.scrollHeight : node.scrollHeight;
    const clientHeight = isRoot ? innerHeight : node.clientHeight;
    return { node, isRoot, scrollTop, scrollHeight, clientHeight, maximum: Math.max(0, scrollHeight - clientHeight) };
  }

  function updateScroll(target = activeScrollElement) {
    const element = widgetElements.get("scroll");
    if (!element?.scrollThumb) {
      return;
    }
    const metrics = scrollMetrics(target);
    const progress = metrics.maximum > 0
      ? Math.min(1, Math.max(0, metrics.scrollTop / metrics.maximum))
      : 0;
    const trackInnerHeight = 20;
    const visibleRatio = metrics.scrollHeight > 0
      ? Math.min(1, metrics.clientHeight / metrics.scrollHeight)
      : 1;
    const thumbHeight = metrics.maximum > 0
      ? Math.max(4, Math.round(trackInnerHeight * visibleRatio))
      : trackInnerHeight;
    const travel = Math.max(0, trackInnerHeight - thumbHeight);
    element.scrollThumb.style.height = `${thumbHeight}px`;
    element.scrollThumb.style.transform = `translateY(${Math.round(progress * travel)}px)`;
    element.title = metrics.maximum > 0
      ? `Scroll position: ${Math.round(progress * 100)}%`
      : "No vertical scrolling in the active scroll area";
  }

  function updateLinkStatus(url) {
    const element = widgetElements.get("status");
    if (!element) {
      return;
    }
    currentLink = url || "";
    element.textContent = currentLink;
    element.title = currentLink;
    element.classList.toggle("is-empty", !currentLink);
  }

  function updateClock() {
    const element = widgetElements.get("clock");
    const now = new Date();
    if (element) {
      element.dateNode.textContent = "";
      element.dateNode.classList.add("hidden");
      element.timeNode.textContent = formatDateTime(now);
      element.title = `${settings.clockTimeZone} · ${settings.dateTimeFormat}`;
    }
    updateOpenClockPanel(now);
  }

  function scheduleClock() {
    clearInterval(clockTimer);
    const needsLiveAnalog = activeSurfaceKey === "clock";
    clockTimer = setInterval(
      updateClock,
      needsLiveAnalog || clockUsesSeconds() ? 1000 : 15000
    );
  }

  let toastTimer = null;

  function showToast(message, anchor = null) {
    const toast = shadow?.querySelector(".toast");
    if (!toast) {
      return;
    }
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.style.left = "";
    toast.style.right = "10px";
    toast.classList.add("is-visible");
    if (anchor?.isConnected) {
      const margin = 8;
      const viewportWidth = Math.max(document.documentElement.clientWidth || 0, innerWidth || 0);
      const anchorRect = anchor.getBoundingClientRect();
      const toastRect = toast.getBoundingClientRect();
      let left = anchorRect.left + anchorRect.width / 2 - toastRect.width / 2;
      left = Math.max(margin, Math.min(left, viewportWidth - toastRect.width - margin));
      toast.style.right = "auto";
      toast.style.left = `${Math.round(left)}px`;
    }
    toastTimer = setTimeout(() => {
      toast.classList.remove("is-visible");
    }, 2600);
  }

  function syncSurfacePressedState() {
    if (!shadow) {
      return;
    }
    shadow.querySelectorAll(".panel-launcher[data-panel-id]").forEach((button) => {
      button.setAttribute("aria-pressed", "false");
    });
    const manage = shadow.querySelector(".panel-launcher[data-panel-manage]");
    manage?.setAttribute("aria-pressed", String(activeSurfaceKey === "manager"));
    for (const id of ["capture", "tile", "stack"]) {
      const button = widgetElements.get(id);
      const key = id === "capture" ? "capture" : `tabs:${id}`;
      button?.setAttribute("aria-pressed", String(activeSurfaceKey === key));
    }
    widgetElements.get("clock")?.setAttribute(
      "aria-pressed",
      String(activeSurfaceKey === "clock")
    );
  }

  function closeFloatingSurface() {
    const closingClock = activeSurfaceKey === "clock";
    floatingSurface?.remove();
    floatingSurface = null;
    floatingAnchor = null;
    activeSurfaceKey = "";
    syncSurfacePressedState();
    if (closingClock) {
      scheduleClock();
    }
  }

  function positionFloatingSurface(surface = floatingSurface, anchor = floatingAnchor) {
    if (!surface?.isConnected) {
      return;
    }
    const margin = 8;
    const viewportWidth = Math.max(document.documentElement.clientWidth || 0, innerWidth || 0);
    const surfaceRect = surface.getBoundingClientRect();
    let left = margin;
    if (anchor?.isConnected) {
      const anchorRect = anchor.getBoundingClientRect();
      left = anchorRect.left + anchorRect.width / 2 - surfaceRect.width / 2;
    }
    left = Math.max(margin, Math.min(left, viewportWidth - surfaceRect.width - margin));
    surface.style.left = `${Math.round(left)}px`;
  }

  function createHeaderButton(iconName, label, onClick) {
    const button = document.createElement("button");
    button.className = "surface-icon-button";
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.append(createSurfaceIcon(iconName));
    button.addEventListener("click", onClick);
    return button;
  }

  function createFloatingSurface(key, title, anchor = null) {
    if (activeSurfaceKey === key && floatingSurface?.isConnected) {
      closeFloatingSurface();
      return null;
    }
    closeFloatingSurface();

    const surface = document.createElement("section");
    surface.className = "floating-surface";
    surface.dataset.theme = resolvedTheme();
    surface.setAttribute("role", "dialog");
    surface.setAttribute("aria-label", title);

    const header = document.createElement("div");
    header.className = "floating-header";
    const titleNode = document.createElement("div");
    titleNode.className = "floating-title";
    titleNode.textContent = title;

    const actions = document.createElement("div");
    actions.className = "floating-header-actions";
    const close = createHeaderButton("close", "Close", closeFloatingSurface);
    actions.append(close);
    header.append(titleNode, actions);

    const body = document.createElement("div");
    body.className = "floating-body";
    surface.append(header, body);
    shadow.append(surface);

    floatingSurface = surface;
    floatingAnchor = anchor;
    activeSurfaceKey = key;
    positionFloatingSurface(surface, anchor);
    syncSurfacePressedState();
    return { surface, titleNode, actions, close, body };
  }

  function normalizePanelInputUrl(rawValue) {
    const raw = String(rawValue || "").trim();
    if (!raw) {
      throw new Error("Enter a URL.");
    }
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(withScheme);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Only http and https URLs can be used as shortcuts.");
    }
    return parsed.href;
  }

  function makePanelId() {
    if (typeof crypto.randomUUID === "function") {
      return `panel-${crypto.randomUUID()}`;
    }
    return `panel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  async function savePanels(nextPanels, reopenManager = false) {
    settings = normalizeSettings({ ...settings, panels: nextPanels });
    pendingSurfaceRestore = reopenManager ? "manager" : "";
    await chrome.storage.sync.set({ panels: settings.panels });
  }

  async function openShortcutWindow(panel, anchor = null) {
    const response = await sendAction("OPEN_SHORTCUT_WINDOW", {
      shortcutId: panel.id,
      url: panel.url
    });
    if (!response.ok) {
      showToast(response.error || "Could not open the shortcut.", anchor);
      return;
    }
    showToast(
      response.reused ? `Focused ${panel.name}.` : `Opened ${panel.name}.`,
      anchor
    );
  }

  function buildPanelManagerList(container) {
    if (settings.panels.length === 0) {
      const empty = document.createElement("p");
      empty.className = "surface-help";
      empty.textContent = "No shortcuts have been added yet.";
      container.append(empty);
      return;
    }

    for (const panel of settings.panels) {
      const row = document.createElement("div");
      row.className = "panel-manager-row";

      const icon = document.createElement("span");
      icon.className = "panel-favicon";
      icon.textContent = panelInitial(panel.name);

      const copy = document.createElement("div");
      copy.className = "panel-manager-copy";
      const name = document.createElement("strong");
      name.textContent = panel.name;
      const url = document.createElement("small");
      url.textContent = panel.url;
      copy.append(name, url);

      const remove = createHeaderButton("trash", `Remove ${panel.name}`, async () => {
        await savePanels(
          settings.panels.filter((item) => item.id !== panel.id),
          true
        );
      });
      row.append(icon, copy, remove);
      container.append(row);
    }
  }

  function captureShortcutManagerState() {
    if (activeSurfaceKey !== "manager" || !floatingSurface?.isConnected) {
      return null;
    }
    const name = floatingSurface.querySelector('input[aria-label="Shortcut name"]');
    const url = floatingSurface.querySelector('input[aria-label="Shortcut URL"]');
    const active = shadow?.activeElement;
    const focused = active === name ? "name" : active === url ? "url" : "";
    const focusedInput = focused === "name" ? name : focused === "url" ? url : null;
    return {
      name: name?.value || "",
      url: url?.value || "",
      focused,
      selectionStart: focusedInput?.selectionStart ?? null,
      selectionEnd: focusedInput?.selectionEnd ?? null
    };
  }

  function restoreShortcutManagerState(state, name, url) {
    if (!state) {
      name.focus();
      return;
    }
    name.value = state.name || "";
    url.value = state.url || "";
    const input = state.focused === "url" ? url : state.focused === "name" ? name : null;
    if (!input) {
      return;
    }
    queueMicrotask(() => {
      if (!input.isConnected) {
        return;
      }
      input.focus({ preventScroll: true });
      if (Number.isInteger(state.selectionStart) && Number.isInteger(state.selectionEnd)) {
        input.setSelectionRange(state.selectionStart, state.selectionEnd);
      }
    });
  }

  function openPanelManager(anchor = null, restoreState = null) {
    const shell = createFloatingSurface("manager", "Shortcuts", anchor);
    if (!shell) {
      return;
    }

    const manager = document.createElement("div");
    manager.className = "panel-manager";
    const help = document.createElement("p");
    help.className = "surface-help";
    help.textContent =
      "Shortcuts open in compact browser windows and share the current browser profile session.";
    manager.append(help);

    const list = document.createElement("div");
    list.className = "panel-manager-list";
    buildPanelManagerList(list);
    manager.append(list);

    const form = document.createElement("form");
    form.className = "panel-form";
    const row = document.createElement("div");
    row.className = "panel-form-row";

    const name = document.createElement("input");
    name.type = "text";
    name.maxLength = 48;
    name.placeholder = "Shortcut name";
    name.setAttribute("aria-label", "Shortcut name");

    const url = document.createElement("input");
    url.type = "text";
    url.inputMode = "url";
    url.placeholder = "https://example.com";
    url.setAttribute("aria-label", "Shortcut URL");

    const add = document.createElement("button");
    add.className = "surface-button primary";
    add.type = "submit";
    add.textContent = "Add";
    row.append(name, url, add);

    const useCurrent = document.createElement("button");
    useCurrent.className = "surface-button";
    useCurrent.type = "button";
    useCurrent.textContent = "Use current page";
    useCurrent.addEventListener("click", () => {
      name.value = document.title || location.hostname;
      url.value = location.href;
    });

    const error = document.createElement("p");
    error.className = "surface-error hidden";
    error.setAttribute("role", "alert");

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      error.classList.add("hidden");
      try {
        if (settings.panels.length >= 24) {
          throw new Error("A maximum of 24 shortcuts can be saved.");
        }
        const normalizedUrl = normalizePanelInputUrl(url.value);
        const parsed = new URL(normalizedUrl);
        const panelName = name.value.trim() || parsed.hostname;
        if (settings.panels.some((panel) => panel.url === normalizedUrl)) {
          throw new Error("That URL is already saved as a shortcut.");
        }
        const next = [
          ...settings.panels,
          { id: makePanelId(), name: panelName, url: normalizedUrl }
        ];
        name.value = "";
        url.value = "";
        await savePanels(next, true);
      } catch (caught) {
        error.textContent = caught?.message || "Could not add the shortcut.";
        error.classList.remove("hidden");
      }
    });

    form.append(row, useCurrent, error);
    manager.append(form);
    shell.body.append(manager);
    restoreShortcutManagerState(restoreState, name, url);
  }

  function tabDisplayUrl(rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      return parsed.hostname || parsed.protocol;
    } catch {
      return rawUrl || "Internal page";
    }
  }

  async function openTabPicker(mode, anchor = null) {
    const key = `tabs:${mode}`;
    if (activeSurfaceKey === key && floatingSurface?.isConnected) {
      closeFloatingSurface();
      return;
    }

    const response = await sendAction("LIST_WINDOW_TABS");
    if (!response.ok) {
      showToast(response.error || "Could not list browser tabs.");
      return;
    }

    const title = mode === "tile" ? "Tile tabs" : "Stack tabs";
    const shell = createFloatingSurface(key, title, anchor);
    if (!shell) {
      return;
    }

    const picker = document.createElement("div");
    picker.className = "tab-picker";
    const help = document.createElement("div");
    help.className = "surface-help";
    help.textContent = mode === "tile"
      ? "Choose two tabs. The current tab is selected first."
      : "Choose two or more tabs. The current tab is selected first.";
    picker.append(help);

    const list = document.createElement("div");
    list.className = "tab-list";
    const selected = new Set(
      response.tabs.filter((tab) => tab.active).map((tab) => tab.id)
    );
    const inputs = new Map();

    const footer = document.createElement("div");
    footer.className = "tab-picker-footer";
    const status = document.createElement("div");
    status.className = "tab-picker-status";
    const submit = document.createElement("button");
    submit.className = "surface-button primary";
    submit.type = "button";
    submit.textContent = mode === "tile" ? "Tile tabs" : "Stack tabs";

    function refreshSelectionState() {
      const count = selected.size;
      for (const [id, input] of inputs) {
        const shouldDisable = mode === "tile" && count >= 2 && !selected.has(id);
        input.disabled = shouldDisable;
        input.closest(".tab-row")?.classList.toggle("is-disabled", shouldDisable);
      }
      if (mode === "tile" && !response.splitSupported) {
        submit.disabled = true;
        status.textContent =
          "Native Split View is not exposed to extensions by this Edge build.";
        return;
      }
      const valid = mode === "tile" ? count === 2 : count >= 2;
      submit.disabled = !valid;
      status.textContent = `${count} tab${count === 1 ? "" : "s"} selected`;
    }

    for (const tab of response.tabs) {
      const row = document.createElement("label");
      row.className = "tab-row";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selected.has(tab.id);
      checkbox.value = String(tab.id);
      inputs.set(tab.id, checkbox);

      if (tab.favIconUrl) {
        const favicon = document.createElement("img");
        favicon.className = "tab-favicon";
        favicon.src = tab.favIconUrl;
        favicon.alt = "";
        favicon.addEventListener("error", () => favicon.remove(), { once: true });
        row.append(checkbox, favicon);
      } else {
        row.append(checkbox);
      }

      const copy = document.createElement("span");
      copy.className = "tab-copy";
      const tabTitle = document.createElement("strong");
      tabTitle.textContent = tab.title;
      const tabUrl = document.createElement("small");
      tabUrl.textContent = tabDisplayUrl(tab.url);
      copy.append(tabTitle, tabUrl);
      row.append(copy);

      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          selected.add(tab.id);
        } else {
          selected.delete(tab.id);
        }
        refreshSelectionState();
      });
      list.append(row);
    }

    submit.addEventListener("click", async () => {
      submit.disabled = true;
      status.textContent = mode === "tile" ? "Tiling…" : "Stacking…";
      const result = await sendAction(
        mode === "tile" ? "TILE_TABS" : "STACK_TABS",
        { tabIds: [...selected] }
      );
      if (!result.ok) {
        status.textContent = result.error || "The tab action failed.";
        refreshSelectionState();
        return;
      }
      closeFloatingSurface();
      showToast(result.message || "Done.");
    });

    footer.append(status, submit);
    picker.append(list, footer);
    shell.body.append(picker);
    refreshSelectionState();
  }

  function sendAction(type, payload = {}) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, ...payload }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { ok: false, error: "No response from extension." });
      });
    });
  }

  function triggerDownload(dataUrl, filename) {
    const anchor = document.createElement("a");
    anchor.href = dataUrl;
    anchor.download = filename || "statusline-capture.png";
    anchor.style.display = "none";
    shadow.append(anchor);
    anchor.click();
    anchor.remove();
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function nextPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  async function withCaptureUiHidden(callback) {
    const previousVisibility = host?.style.visibility || "";
    const hadInset = Boolean(originalInset);
    if (hadInset) {
      restorePageInset();
    }
    if (host) {
      host.style.visibility = "hidden";
    }
    try {
      await nextPaint();
      return await callback();
    } finally {
      if (host) {
        host.style.visibility = previousVisibility;
      }
      if (hadInset) {
        applyPageInset();
      }
    }
  }

  function captureFilename(kind) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `statusline-${kind}-${stamp}.png`;
  }

  function decodeImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Could not decode the captured image."));
      image.src = dataUrl;
    });
  }

  async function captureFrame() {
    const response = await sendAction("CAPTURE_VISIBLE_TAB");
    if (!response.ok || !response.dataUrl) {
      throw new Error(response.error || "Could not capture the current tab.");
    }
    return response.dataUrl;
  }

  async function cropCapture(dataUrl, rect) {
    const image = await decodeImage(dataUrl);
    const scaleX = image.naturalWidth / innerWidth;
    const scaleY = image.naturalHeight / innerHeight;
    const sx = Math.max(0, Math.round(rect.x * scaleX));
    const sy = Math.max(0, Math.round(rect.y * scaleY));
    const sw = Math.max(1, Math.min(image.naturalWidth - sx, Math.round(rect.width * scaleX)));
    const sh = Math.max(1, Math.min(image.naturalHeight - sy, Math.round(rect.height * scaleY)));
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas is unavailable for capture cropping.");
    }
    context.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
    return canvas.toDataURL("image/png");
  }

  function chooseCaptureRect(helpText) {
    closeFloatingSurface();
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "capture-selection-overlay";
      const selection = document.createElement("div");
      selection.className = "capture-selection-rect hidden";
      const help = document.createElement("div");
      help.className = "capture-selection-help";
      help.textContent = helpText;
      overlay.append(selection, help);
      shadow.append(overlay);

      let start = null;
      let current = null;

      const rectFromPoints = () => {
        if (!start || !current) {
          return null;
        }
        const x = Math.min(start.x, current.x);
        const y = Math.min(start.y, current.y);
        const width = Math.abs(start.x - current.x);
        const height = Math.abs(start.y - current.y);
        return { x, y, width, height };
      };

      const paintSelection = () => {
        const rect = rectFromPoints();
        if (!rect) {
          return;
        }
        selection.classList.remove("hidden");
        selection.style.left = `${rect.x}px`;
        selection.style.top = `${rect.y}px`;
        selection.style.width = `${rect.width}px`;
        selection.style.height = `${rect.height}px`;
      };

      const cleanup = (result) => {
        overlay.remove();
        removeEventListener("keydown", onKeyDown, true);
        resolve(result);
      };

      const onKeyDown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          cleanup(null);
        }
      };

      overlay.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) {
          return;
        }
        start = { x: event.clientX, y: event.clientY };
        current = { ...start };
        overlay.setPointerCapture?.(event.pointerId);
        paintSelection();
      });
      overlay.addEventListener("pointermove", (event) => {
        if (!start) {
          return;
        }
        current = { x: event.clientX, y: event.clientY };
        paintSelection();
      });
      overlay.addEventListener("pointerup", (event) => {
        if (!start) {
          return;
        }
        current = { x: event.clientX, y: event.clientY };
        const rect = rectFromPoints();
        if (!rect || rect.width < 6 || rect.height < 6) {
          start = null;
          current = null;
          selection.classList.add("hidden");
          return;
        }
        cleanup(rect);
      });
      addEventListener("keydown", onKeyDown, true);
    });
  }

  function nearestScrollableAt(rect) {
    const root = document.scrollingElement || document.documentElement;
    let node = document.elementFromPoint(
      Math.min(innerWidth - 1, Math.max(0, rect.x + rect.width / 2)),
      Math.min(innerHeight - 1, Math.max(0, rect.y + rect.height / 2))
    );
    while (node instanceof Element && node !== document.documentElement) {
      const style = getComputedStyle(node);
      const overflowY = style.overflowY;
      if (
        node.scrollHeight > node.clientHeight + 1 &&
        ["auto", "scroll", "overlay"].includes(overflowY)
      ) {
        return node;
      }
      node = node.parentElement;
    }
    return root;
  }

  function setScrollTop(target, value) {
    const metrics = scrollMetrics(target);
    if (metrics.isRoot) {
      window.scrollTo(window.scrollX, value);
    } else {
      metrics.node.scrollTop = value;
    }
  }

  async function captureScrollingRegion(target, rect, startAtTop) {
    const metrics = scrollMetrics(target);
    const startTop = startAtTop ? 0 : metrics.scrollTop;
    const endTop = metrics.maximum;
    if (endTop <= startTop + 1) {
      throw new Error(startAtTop
        ? "This page does not have additional vertical content to capture."
        : "The selected scroll area is already at the bottom.");
    }

    const outputWidth = Math.max(1, Math.round(rect.width));
    const outputHeight = Math.max(1, Math.round(rect.height + (endTop - startTop)));
    if (outputHeight > 32767 || outputWidth * outputHeight > 100_000_000) {
      throw new Error("The scrolling capture is too large for a single browser canvas.");
    }

    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas is unavailable for scrolling capture.");
    }

    const originalTop = metrics.scrollTop;
    const scrollStyleTarget = metrics.isRoot ? document.documentElement : metrics.node;
    const originalScrollBehavior = scrollStyleTarget.style.scrollBehavior;
    scrollStyleTarget.style.scrollBehavior = "auto";

    const step = Math.max(48, Math.floor(rect.height));
    const positions = [startTop];
    for (let position = startTop + step; position < endTop; position += step) {
      positions.push(position);
    }
    if (positions.at(-1) !== endTop) {
      positions.push(endTop);
    }

    let previousPosition = startTop;
    let destinationY = 0;
    try {
      for (let index = 0; index < positions.length; index += 1) {
        const position = positions[index];
        setScrollTop(metrics.node, position);
        await nextPaint();
        if (index > 0) {
          // Chromium limits captureVisibleTab to two calls per second.
          await sleep(560);
        } else {
          await sleep(90);
        }
        const dataUrl = await captureFrame();
        const image = await decodeImage(dataUrl);
        const scaleX = image.naturalWidth / innerWidth;
        const scaleY = image.naturalHeight / innerHeight;
        const delta = index === 0
          ? rect.height
          : Math.min(rect.height, position - previousPosition);
        const sourceX = rect.x * scaleX;
        const sourceY = index === 0
          ? rect.y * scaleY
          : (rect.y + rect.height - delta) * scaleY;
        const sourceWidth = rect.width * scaleX;
        const sourceHeight = delta * scaleY;
        context.drawImage(
          image,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          0,
          destinationY,
          outputWidth,
          delta
        );
        destinationY += delta;
        previousPosition = position;
      }
    } finally {
      setScrollTop(metrics.node, originalTop);
      scrollStyleTarget.style.scrollBehavior = originalScrollBehavior;
      await nextPaint();
    }
    return canvas.toDataURL("image/png");
  }

  function captureOption(iconText, title, description, onClick) {
    const button = document.createElement("button");
    button.className = "capture-option";
    button.type = "button";
    const icon = document.createElement("span");
    icon.className = "capture-option-icon";
    icon.textContent = iconText;
    const copy = document.createElement("span");
    copy.className = "capture-option-copy";
    const strong = document.createElement("strong");
    strong.textContent = title;
    const small = document.createElement("small");
    small.textContent = description;
    copy.append(strong, small);
    button.append(icon, copy);
    button.addEventListener("click", onClick);
    return button;
  }

  function openCaptureMenu(anchor = null) {
    const shell = createFloatingSurface("capture", "Capture", anchor);
    if (!shell) {
      return;
    }
    shell.surface.classList.add("capture-surface");
    positionFloatingSurface(shell.surface, anchor);
    const menu = document.createElement("div");
    menu.className = "capture-menu";
    menu.append(
      captureOption("▣", "Visible area", "Capture the current page viewport.", () => runCaptureMode("visible")),
      captureOption("⌖", "Select area", "Drag a box and capture only that region.", () => runCaptureMode("selection")),
      captureOption("↓", "Scroll down", "Select a region and capture it from the current scroll position to the bottom.", () => runCaptureMode("scroll")),
      captureOption("↕", "Full page", "Auto-scroll the page and stitch the complete document.", () => runCaptureMode("full"))
    );
    shell.body.append(menu);
  }

  async function runCaptureMode(mode) {
    if (captureInProgress) {
      return;
    }
    captureInProgress = true;
    try {
      let rect = null;
      if (mode === "selection" || mode === "scroll") {
        rect = await chooseCaptureRect(mode === "scroll"
          ? "Drag a region to capture while scrolling down · Esc cancels"
          : "Drag a region to capture · Esc cancels");
        if (!rect) {
          return;
        }
      } else {
        closeFloatingSurface();
      }

      showToast(mode === "full" || mode === "scroll" ? "Capturing and stitching…" : "Capturing…");
      let dataUrl;
      if (mode === "visible") {
        dataUrl = await withCaptureUiHidden(() => captureFrame());
      } else if (mode === "selection") {
        dataUrl = await withCaptureUiHidden(async () => {
          const frame = await captureFrame();
          return cropCapture(frame, rect);
        });
      } else if (mode === "scroll") {
        const target = nearestScrollableAt(rect);
        dataUrl = await withCaptureUiHidden(() => captureScrollingRegion(target, rect, false));
      } else if (mode === "full") {
        const root = document.scrollingElement || document.documentElement;
        const fullRect = { x: 0, y: 0, width: innerWidth, height: innerHeight };
        dataUrl = await withCaptureUiHidden(() => captureScrollingRegion(root, fullRect, true));
      } else {
        return;
      }
      triggerDownload(dataUrl, captureFilename(mode));
      showToast("Capture saved.");
    } catch (error) {
      showToast(error?.message || "Capture failed.");
    } finally {
      captureInProgress = false;
    }
  }

  function commitZoomInput(input) {
    const parsed = Number.parseFloat(String(input.value || "").replace("%", "").trim());
    if (!Number.isFinite(parsed)) {
      showToast("Enter a zoom value between 25% and 500%.");
      updateZoom(currentZoom);
      input.select();
      return;
    }
    const percent = Math.min(500, Math.max(25, parsed));
    setZoom(percent / 100);
    input.blur();
  }

  async function runAction(id, button) {
    if (button.getAttribute("aria-busy") === "true") {
      return;
    }
    button.setAttribute("aria-busy", "true");
    try {
      if (id === "devtools") {
        const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
        showToast(isMac
          ? "Open Developer Tools with ⌥⌘I. Edge does not expose an API that extensions can invoke directly."
          : "Open Developer Tools with F12 or Ctrl+Shift+I. Edge does not expose an API that extensions can invoke directly.", button);
        return;
      }

      if (id === "capture") {
        openCaptureMenu(button);
        return;
      }

      if (id === "tile" || id === "stack") {
        await openTabPicker(id, button);
        return;
      }
    } finally {
      button.removeAttribute("aria-busy");
    }
  }

  function requestZoom() {
    chrome.runtime.sendMessage({ type: "GET_ZOOM" }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        return;
      }
      updateZoom(response.zoom);
    });
  }

  function updateZoom(zoom) {
    currentZoom = zoom || 1;
    const element = widgetElements.get("zoom");
    if (element?.zoomValue && shadow?.activeElement !== element.zoomValue) {
      element.zoomValue.value = `${Math.round(currentZoom * 100)}%`;
    }
  }

  function setZoom(zoom) {
    chrome.runtime.sendMessage({ type: "SET_ZOOM", zoom }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        return;
      }
      updateZoom(response.zoom);
    });
  }

  function setAdjacentZoom(direction) {
    const epsilon = 0.001;
    if (direction < 0) {
      const candidates = ZOOM_STEPS.filter((step) => step < currentZoom - epsilon);
      setZoom(candidates.at(-1) ?? ZOOM_STEPS[0]);
      return;
    }
    const next = ZOOM_STEPS.find((step) => step > currentZoom + epsilon);
    setZoom(next ?? ZOOM_STEPS.at(-1));
  }

  function linkFromEvent(event) {
    const path = event.composedPath?.() || [];
    for (const node of path) {
      if (node instanceof HTMLAnchorElement && node.href) {
        return node.href;
      }
    }
    const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
    return target?.href || "";
  }

  function handlePointerOver(event) {
    const link = linkFromEvent(event);
    if (link) {
      updateLinkStatus(link);
    }
  }

  function handlePointerOut(event) {
    if (!currentLink) {
      return;
    }
    const related = event.relatedTarget;
    if (related instanceof Element && related.closest?.("a[href]")) {
      return;
    }
    updateLinkStatus("");
  }

  function scrollTargetFromEvent(event) {
    const root = document.scrollingElement || document.documentElement;
    const target = event?.target;
    if (target instanceof Element && target.scrollHeight > target.clientHeight + 1) {
      return target;
    }
    return root;
  }

  function handleScroll(event) {
    activeScrollElement = scrollTargetFromEvent(event);
    if (scrollFrame) {
      return;
    }
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = null;
      updateScroll(activeScrollElement);
    });
  }

  function handleSelection() {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(updateSelection, 80);
  }

  function installUiEventBoundary() {
    if (!shadow) {
      return;
    }
    const events = [
      "keydown", "keyup", "keypress", "beforeinput", "input",
      "compositionstart", "compositionupdate", "compositionend",
      "pointerdown", "pointerup", "mousedown", "mouseup", "click",
      "dblclick", "contextmenu", "wheel", "touchstart", "touchmove",
      "touchend", "dragstart", "dragover", "dragleave", "drop", "dragend"
    ];
    for (const type of events) {
      shadow.addEventListener(type, (event) => {
        event.stopPropagation();
      });
    }
  }

  function bindBodyMountObserver() {
    const body = document.body;
    if (body === observedBody) {
      return false;
    }

    bodyMountObserver?.disconnect();
    bodyMountObserver = null;
    observedBody = body;

    if (!body) {
      return true;
    }

    bodyMountObserver = new MutationObserver(() => {
      scheduleMountCheck();
      scheduleDockRefresh();
    });
    bodyMountObserver.observe(body, { childList: true, subtree: true });
    return true;
  }

  function restoreMountIfNeeded() {
    mountCheckScheduled = false;
    const bodyChanged = bindBodyMountObserver();

    const wasDisconnected = !host?.isConnected;
    const mountParent = document.documentElement;
    const wasMoved = Boolean(
      host?.isConnected && host.parentNode !== mountParent
    );
    const remounted = ensureHost();

    if (bodyChanged || wasDisconnected || wasMoved || remounted) {
      updateVisibility();
      applyPageInset();
      updateZoneLayout();
      updateAll();
      positionFloatingSurface();
    }

    if (location.href !== lastKnownUrl) {
      lastKnownUrl = location.href;
      updateHost();
    }
  }

  function scheduleMountCheck() {
    if (mountCheckScheduled) {
      return;
    }
    mountCheckScheduled = true;
    queueMicrotask(restoreMountIfNeeded);
  }

  function scheduleDockRefresh() {
    if (dockRefreshTimer !== null) {
      clearTimeout(dockRefreshTimer);
    }
    dockRefreshTimer = setTimeout(() => {
      dockRefreshTimer = null;
      if (settings?.layoutMode === "docked") {
        applyPageInset();
        updateScroll(activeScrollElement);
        positionFloatingSurface();
      }
    }, 90);
  }

  function installMountGuard() {
    documentMountObserver = new MutationObserver(() => {
      scheduleMountCheck();
    });
    documentMountObserver.observe(document.documentElement, { childList: true });
    bindBodyMountObserver();

    addEventListener("pageshow", scheduleMountCheck, { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        scheduleMountCheck();
      }
    }, { passive: true });

    if ("prerendering" in document) {
      document.addEventListener(
        "prerenderingchange",
        scheduleMountCheck,
        { passive: true }
      );
    }

    if (globalThis.navigation?.addEventListener) {
      globalThis.navigation.addEventListener(
        "navigatesuccess",
        scheduleMountCheck
      );
    }
  }

  function installListeners() {
    addEventListener("resize", () => {
      applyPageInset();
      updateViewport();
      updateScroll(activeScrollElement);
      updateZoneLayout();
      positionFloatingSurface();
    }, { passive: true });
    addEventListener("scroll", handleScroll, { passive: true, capture: true });
    document.addEventListener("selectionchange", handleSelection, { passive: true });
    document.addEventListener("pointerover", handlePointerOver, { passive: true, capture: true });
    document.addEventListener("pointerout", handlePointerOut, { passive: true, capture: true });
    document.addEventListener("fullscreenchange", updateVisibility);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && activeSurfaceKey) {
        closeFloatingSurface();
      }
    }, { capture: true });

    const themeMedia = matchMedia("(prefers-color-scheme: dark)");
    themeMedia.addEventListener("change", () => {
      if (settings.theme === "auto") {
        const bar = shadow?.querySelector(".bar");
        const toast = shadow?.querySelector(".toast");
        const surface = shadow?.querySelector(".floating-surface");
        const theme = resolvedTheme();
        if (bar) {
          bar.dataset.theme = theme;
        }
        if (toast) {
          toast.dataset.theme = theme;
        }
        if (surface) {
          surface.dataset.theme = theme;
        }
      }
    });

    chrome.storage.onChanged.addListener(async (changes, areaName) => {
      if (areaName !== "sync") {
        return;
      }
      const clockChanged = Boolean(
        changes.dateTimeFormat || changes.clockTimeZone || changes.worldClocks
      );
      const managerState = captureShortcutManagerState();
      const activeRestorableSurface = activeSurfaceKey === "manager" || activeSurfaceKey === "clock"
        ? activeSurfaceKey
        : "";
      const requestedRestore = pendingSurfaceRestore;
      pendingSurfaceRestore = "";
      const restoreSurface = requestedRestore || activeRestorableSurface || (clockChanged ? "clock" : "");
      const stored = await chrome.storage.sync.get(null);
      settings = normalizeSettings(stored);
      render();
      if (restoreSurface === "manager") {
        openPanelManager(widgetElements.get("panels")?.manageButton || null, managerState);
      } else if (restoreSurface === "clock") {
        openClockPanel(widgetElements.get("clock") || null);
      }
    });

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "ZOOM_CHANGED") {
        updateZoom(message.zoom);
        return undefined;
      }
      if (message?.type === "GET_PAGE_INFO") {
        sendResponse({
          hostname: location.hostname,
          url: location.href,
          visible: Boolean(host?.isConnected && host.style.display !== "none")
        });
      }
      return undefined;
    });
  }

  async function start() {
    settings = normalizeSettings(await chrome.storage.sync.get(null));
    ensureHost();
    installUiEventBoundary();
    installListeners();
    installMountGuard();
    render();
    lastKnownUrl = location.href;
  }

  start().catch((error) => {
    console.error("Statusline failed to initialize:", error);
  });
})();
