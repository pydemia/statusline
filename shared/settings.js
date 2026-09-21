(() => {
  const WIDGETS = [
    {
      id: "panels",
      label: "Shortcuts",
      description: "Launches saved shortcuts from the far-left dock.",
      side: "left"
    },
    {
      id: "status",
      label: "Link status",
      description: "Shows a link target in the right-side information area while the pointer is over a link.",
      side: "right"
    },
    {
      id: "capture",
      label: "Capture",
      description: "Captures visible, selected, scrolling, or full-page content as PNG.",
      side: "right"
    },
    {
      id: "devtools",
      label: "Developer tools",
      description: "Shows the browser shortcut for opening Developer Tools.",
      side: "right"
    },
    {
      id: "tile",
      label: "Tile tabs",
      description: "Opens a tab picker and tiles two chosen tabs when Split View is available.",
      side: "right"
    },
    {
      id: "stack",
      label: "Stack tabs",
      description: "Opens a tab picker and groups two or more chosen tabs.",
      side: "right"
    },
    {
      id: "selection",
      label: "Selection",
      description: "Shows the character count for selected text.",
      side: "right"
    },
    {
      id: "viewport",
      label: "Viewport",
      description: "Shows the current page viewport dimensions.",
      side: "right"
    },
    {
      id: "scroll",
      label: "Scroll progress",
      description: "Shows the active scroll area with a moving scrollbar thumb.",
      side: "right"
    },
    {
      id: "zoom",
      label: "Page zoom",
      description: "Shows page zoom with minus/plus controls and an editable percentage.",
      side: "right"
    },
    {
      id: "clock",
      label: "Date & time",
      description: "Shows date/time in a configurable time zone and opens the world-clock panel.",
      side: "right"
    }
  ];

  function systemTimeZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }

  function isValidTimeZone(value) {
    const zone = typeof value === "string" ? value.trim() : "";
    if (!zone) {
      return false;
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date());
      return true;
    } catch {
      return false;
    }
  }

  function normalizeWorldClocks(value) {
    const incoming = Array.isArray(value) ? value : [];
    const seen = new Set();
    const result = [];
    for (const item of incoming) {
      const zone = typeof item === "string" ? item.trim() : "";
      if (!zone || seen.has(zone) || !isValidTimeZone(zone)) {
        continue;
      }
      seen.add(zone);
      result.push(zone);
      if (result.length >= 12) {
        break;
      }
    }
    return result;
  }

  const DEFAULTS = {
    enabled: true,
    position: "bottom",
    theme: "auto",
    height: 36,
    fontSize: 13,
    opacity: 0.97,
    timeFormat: "24h",
    showSeconds: false,
    dateStyle: "iso",
    dateTimeFormat: "YYYY-MM-DD ddd HH:mm",
    clockTimeZone: systemTimeZone(),
    worldClocks: [],
    hideOnFullscreen: true,
    reserveSpace: true,
    layoutMode: "docked",
    disabledHosts: [],
    panels: [],
    widgets: WIDGETS.map((widget) => ({
      id: widget.id,
      enabled: widget.id !== "selection",
      side: widget.side
    }))
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeWidgets(value) {
    const incoming = Array.isArray(value) ? value : [];
    const known = new Map(WIDGETS.map((widget) => [widget.id, widget]));
    const seen = new Set();
    const result = [];

    for (const item of incoming) {
      if (!item || !known.has(item.id) || seen.has(item.id)) {
        continue;
      }
      seen.add(item.id);
      const fallback = known.get(item.id);
      result.push({
        id: item.id,
        enabled: item.enabled !== false,
        side: item.side === "left" || item.side === "right"
          ? item.side
          : fallback.side
      });
    }

    for (const widget of WIDGETS) {
      if (seen.has(widget.id)) {
        continue;
      }
      const defaultItem = DEFAULTS.widgets.find((item) => item.id === widget.id);
      result.push(clone(defaultItem));
    }

    // Statusline has two semantic zones: shortcuts at the far left and every
    // status/action widget aligned from the far right. Preserve user ordering
    // within the right-side group, but do not let placement settings collapse
    // the zones.
    const panelIndex = result.findIndex((item) => item.id === "panels");
    if (panelIndex > 0) {
      const [panels] = result.splice(panelIndex, 1);
      result.unshift(panels);
    }
    for (const item of result) {
      if (item.id === "panels") {
        item.side = "left";
      } else {
        item.side = "right";
      }
    }

    return result;
  }

  function normalizePanels(value) {
    const incoming = Array.isArray(value) ? value : [];
    const seen = new Set();
    const result = [];

    for (const item of incoming) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const id = typeof item.id === "string" ? item.id.trim() : "";
      const name = typeof item.name === "string" ? item.name.trim().slice(0, 48) : "";
      const rawUrl = typeof item.url === "string" ? item.url.trim() : "";
      if (!id || !name || !rawUrl || seen.has(id)) {
        continue;
      }
      let url;
      try {
        const parsed = new URL(rawUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          continue;
        }
        url = parsed.href;
      } catch {
        continue;
      }
      seen.add(id);
      result.push({ id, name, url });
      if (result.length >= 24) {
        break;
      }
    }

    return result;
  }

  function normalizeSettings(value = {}) {
    const incoming = value || {};
    const migrated = { ...incoming };
    if (Number(incoming.height) === 26) {
      migrated.height = 36;
      if (Number(incoming.fontSize) === 12) {
        migrated.fontSize = 13;
      }
    }
    if (typeof incoming.dateTimeFormat !== "string") {
      const datePart = incoming.dateStyle === "none"
        ? ""
        : incoming.dateStyle === "compact"
          ? "MM-DD ddd"
          : incoming.dateStyle === "locale"
            ? "MMM D, YYYY ddd"
            : "YYYY-MM-DD ddd";
      const hourPart = incoming.timeFormat === "12h"
        ? `h:mm${incoming.showSeconds ? ":ss" : ""} A`
        : `HH:mm${incoming.showSeconds ? ":ss" : ""}`;
      migrated.dateTimeFormat = `${datePart}${datePart ? " " : ""}${hourPart}`;
    }
    if (typeof incoming.layoutMode !== "string") {
      // v0.7.3 changes the default from an overlay to a docked layout.
      // Older versions persisted reserveSpace=false as the default, so use a
      // separate migration marker instead of preserving that obsolete default.
      migrated.layoutMode = "docked";
      migrated.reserveSpace = true;
    }
    const merged = { ...clone(DEFAULTS), ...migrated };
    merged.enabled = merged.enabled !== false;
    merged.position = merged.position === "top" ? "top" : "bottom";
    merged.theme = ["auto", "light", "dark"].includes(merged.theme)
      ? merged.theme
      : "auto";
    merged.height = Math.min(52, Math.max(28, Number(merged.height) || 36));
    merged.fontSize = Math.min(16, Math.max(11, Number(merged.fontSize) || 13));
    merged.opacity = Math.min(1, Math.max(0.75, Number(merged.opacity) || 0.97));
    merged.timeFormat = merged.timeFormat === "12h" ? "12h" : "24h";
    merged.showSeconds = Boolean(merged.showSeconds);
    merged.dateStyle = ["iso", "locale", "compact", "none"].includes(merged.dateStyle)
      ? merged.dateStyle
      : "iso";
    merged.dateTimeFormat = typeof merged.dateTimeFormat === "string"
      ? merged.dateTimeFormat.trim().slice(0, 80)
      : DEFAULTS.dateTimeFormat;
    if (!merged.dateTimeFormat) {
      merged.dateTimeFormat = DEFAULTS.dateTimeFormat;
    }
    merged.clockTimeZone = isValidTimeZone(merged.clockTimeZone)
      ? merged.clockTimeZone.trim()
      : DEFAULTS.clockTimeZone;
    merged.worldClocks = normalizeWorldClocks(merged.worldClocks)
      .filter((zone) => zone !== merged.clockTimeZone);
    merged.hideOnFullscreen = merged.hideOnFullscreen !== false;
    merged.layoutMode = merged.layoutMode === "overlay" ? "overlay" : "docked";
    merged.reserveSpace = merged.layoutMode === "docked";
    merged.disabledHosts = Array.isArray(merged.disabledHosts)
      ? [...new Set(merged.disabledHosts.filter((host) => typeof host === "string" && host))]
      : [];
    merged.panels = normalizePanels(merged.panels);
    merged.widgets = normalizeWidgets(merged.widgets);
    return merged;
  }

  globalThis.StatuslineSettings = Object.freeze({
    WIDGETS,
    DEFAULTS,
    clone,
    systemTimeZone,
    isValidTimeZone,
    normalizeWorldClocks,
    normalizePanels,
    normalizeSettings
  });
})();
