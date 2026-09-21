importScripts("shared/settings.js");

const { DEFAULTS, normalizeSettings } = StatuslineSettings;

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.sync.get(null);
  if (Object.keys(current).length === 0) {
    await chrome.storage.sync.set(DEFAULTS);
    return;
  }
  await chrome.storage.sync.set(normalizeSettings(current));
});

function tabContext(sender) {
  if (!sender.tab?.id || sender.tab.windowId === undefined) {
    throw new Error("No active tab context is available.");
  }
  return sender.tab;
}

function normalizedTabIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter(Number.isInteger))];
}

async function tabsInSenderWindow(sender, tabIds) {
  const current = tabContext(sender);
  const ids = normalizedTabIds(tabIds);
  const tabs = await Promise.all(ids.map((id) => chrome.tabs.get(id)));
  if (tabs.some((tab) => tab.windowId !== current.windowId)) {
    throw new Error("All selected tabs must belong to the current window.");
  }
  return tabs.sort((a, b) => a.index - b.index);
}

async function captureVisibleTab(sender) {
  const tab = tabContext(sender);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: "png"
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return {
    ok: true,
    dataUrl,
    filename: `statusline-capture-${stamp}.png`,
    message: "Captured visible tab."
  };
}

async function listWindowTabs(sender) {
  const current = tabContext(sender);
  const tabs = await chrome.tabs.query({ windowId: current.windowId });
  return {
    ok: true,
    splitSupported: typeof chrome.tabs.createSplit === "function",
    tabs: tabs
      .sort((a, b) => a.index - b.index)
      .map((tab) => ({
        id: tab.id,
        index: tab.index,
        title: tab.title || "Untitled tab",
        url: tab.url || "",
        favIconUrl: tab.favIconUrl || "",
        active: Boolean(tab.active),
        pinned: Boolean(tab.pinned),
        groupId: tab.groupId
      }))
  };
}

async function stackTabs(sender, requestedIds) {
  const tabs = await tabsInSenderWindow(sender, requestedIds);
  if (tabs.length < 2) {
    return {
      ok: false,
      code: "NEED_MULTIPLE_TABS",
      error: "Choose two or more tabs to stack."
    };
  }
  const tabIds = tabs.map((tab) => tab.id);
  await chrome.tabs.group({ tabIds });
  return {
    ok: true,
    message: `Stacked ${tabIds.length} tabs.`
  };
}

async function tileTabs(sender, requestedIds) {
  const tabs = await tabsInSenderWindow(sender, requestedIds);
  if (tabs.length !== 2) {
    return {
      ok: false,
      code: "NEED_TWO_TABS",
      error: "Choose exactly two tabs to tile."
    };
  }

  if (typeof chrome.tabs.createSplit !== "function") {
    return {
      ok: false,
      code: "SPLIT_API_UNAVAILABLE",
      error: "This Edge build does not expose native Split View to extensions."
    };
  }

  if (tabs.some((tab) => tab.splitViewId !== undefined && tab.splitViewId !== -1)) {
    return {
      ok: false,
      code: "ALREADY_SPLIT",
      error: "One of the chosen tabs is already tiled."
    };
  }
  if (tabs[0].pinned !== tabs[1].pinned || tabs[0].groupId !== tabs[1].groupId) {
    return {
      ok: false,
      code: "INCOMPATIBLE_TABS",
      error: "Tile requires tabs with the same pinned and group state."
    };
  }

  if (tabs[1].index !== tabs[0].index + 1) {
    await chrome.tabs.move(tabs[1].id, { index: tabs[0].index + 1 });
  }

  const tabIds = tabs.map((tab) => tab.id);
  const splitViewId = await chrome.tabs.createSplit(tabIds);
  return {
    ok: true,
    splitViewId,
    message: "Tiled two tabs."
  };
}


function shortcutWindowStorageKey(shortcutId) {
  const safeId = String(shortcutId || "").replace(/[^a-zA-Z0-9._-]/g, "_");
  return `shortcut-window:${safeId}`;
}

async function shortcutWindowId(shortcutId) {
  if (!chrome.storage.session) {
    return null;
  }
  const key = shortcutWindowStorageKey(shortcutId);
  const stored = await chrome.storage.session.get(key);
  return Number.isInteger(stored[key]) ? stored[key] : null;
}

async function rememberShortcutWindow(shortcutId, windowId) {
  if (!chrome.storage.session || !Number.isInteger(windowId)) {
    return;
  }
  const key = shortcutWindowStorageKey(shortcutId);
  await chrome.storage.session.set({ [key]: windowId });
}

async function forgetShortcutWindow(shortcutId) {
  if (!chrome.storage.session) {
    return;
  }
  await chrome.storage.session.remove(shortcutWindowStorageKey(shortcutId));
}

function validatedShortcutUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || ""));
  } catch {
    throw new Error("The shortcut URL is invalid.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https shortcut URLs are supported.");
  }
  return parsed.href;
}

async function openShortcutWindow(sender, shortcutId, rawUrl) {
  const currentTab = tabContext(sender);
  const id = String(shortcutId || "").trim();
  if (!id) {
    return { ok: false, error: "The shortcut ID is missing." };
  }

  let url;
  try {
    url = validatedShortcutUrl(rawUrl);
  } catch (error) {
    return { ok: false, error: error.message };
  }

  const previousWindowId = await shortcutWindowId(id);
  if (Number.isInteger(previousWindowId)) {
    try {
      await chrome.windows.get(previousWindowId);
      await chrome.windows.update(previousWindowId, {
        focused: true,
        state: "normal"
      });
      return { ok: true, windowId: previousWindowId, reused: true };
    } catch {
      await forgetShortcutWindow(id);
    }
  }

  let currentWindow = null;
  try {
    currentWindow = await chrome.windows.get(currentTab.windowId);
  } catch {
    // Bounds are optional. The browser can choose a natural position instead.
  }

  const createData = {
    url,
    type: "popup",
    focused: true
  };

  if (currentWindow && Number.isFinite(currentWindow.width) && Number.isFinite(currentWindow.height)) {
    const width = Math.max(380, Math.min(520, currentWindow.width - 80));
    const height = Math.max(480, Math.min(760, currentWindow.height - 80));
    createData.width = Math.round(width);
    createData.height = Math.round(height);
    if (Number.isFinite(currentWindow.left)) {
      createData.left = Math.round(currentWindow.left + 24);
    }
    if (Number.isFinite(currentWindow.top)) {
      createData.top = Math.round(
        currentWindow.top + Math.max(40, (currentWindow.height - height) / 2)
      );
    }
  }

  const created = await chrome.windows.create(createData);
  if (!created || !Number.isInteger(created.id)) {
    return { ok: false, error: "Could not open the shortcut window." };
  }
  await rememberShortcutWindow(id, created.id);
  return { ok: true, windowId: created.id, reused: false };
}

async function openTab(sender, rawUrl) {
  const current = tabContext(sender);
  let parsed;
  try {
    parsed = new URL(String(rawUrl || ""));
  } catch {
    return { ok: false, error: "The shortcut URL is invalid." };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, error: "Only http and https shortcut URLs are supported." };
  }
  await chrome.tabs.create({
    windowId: current.windowId,
    url: parsed.href,
    active: true
  });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return undefined;
  }

  if (message.type === "GET_ZOOM") {
    if (!sender.tab?.id) {
      sendResponse({ ok: false, error: "No tab context." });
      return undefined;
    }
    chrome.tabs.getZoom(sender.tab.id)
      .then((zoom) => sendResponse({ ok: true, zoom }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "SET_ZOOM") {
    if (!sender.tab?.id) {
      sendResponse({ ok: false, error: "No tab context." });
      return undefined;
    }
    const requested = Math.min(5, Math.max(0.25, Number(message.zoom) || 1));
    chrome.tabs.setZoom(sender.tab.id, requested)
      .then(() => chrome.tabs.getZoom(sender.tab.id))
      .then((zoom) => sendResponse({ ok: true, zoom }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  const asyncActions = {
    CAPTURE_VISIBLE_TAB: () => captureVisibleTab(sender),
    LIST_WINDOW_TABS: () => listWindowTabs(sender),
    STACK_TABS: () => stackTabs(sender, message.tabIds),
    TILE_TABS: () => tileTabs(sender, message.tabIds),
    OPEN_TAB: () => openTab(sender, message.url),
    OPEN_SHORTCUT_WINDOW: () => openShortcutWindow(
      sender,
      message.shortcutId,
      message.url
    )
  };
  if (asyncActions[message.type]) {
    asyncActions[message.type]()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return undefined;
  }

  return undefined;
});

chrome.tabs.onZoomChange.addListener((zoomChangeInfo) => {
  chrome.tabs.sendMessage(zoomChangeInfo.tabId, {
    type: "ZOOM_CHANGED",
    zoom: zoomChangeInfo.newZoomFactor
  }).catch(() => {});
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-statusline") {
    return;
  }
  const current = normalizeSettings(await chrome.storage.sync.get(null));
  await chrome.storage.sync.set({ enabled: !current.enabled });
});
