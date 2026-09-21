import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let messageListener;
let windowTabs = [];
let groupedIds = [];
let movedTab = null;
let createdTab = null;
let createdWindow = null;
let updatedWindow = null;
let sessionStore = {};

const sandbox = {
  console,
  Date,
  Promise,
  URL,
  setTimeout,
  clearTimeout,
  globalThis: null,
  chrome: {
    storage: {
      sync: {
        async get() { return {}; },
        async set() {}
      },
      session: {
        async get(key) {
          if (typeof key === "string") return { [key]: sessionStore[key] };
          return { ...sessionStore };
        },
        async set(values) { Object.assign(sessionStore, values); },
        async remove(key) { delete sessionStore[key]; }
      }
    },
    runtime: {
      onInstalled: { addListener() {} },
      onMessage: {
        addListener(listener) { messageListener = listener; }
      },
      openOptionsPage() {}
    },
    tabs: {
      async captureVisibleTab() { return "data:image/png;base64,TEST"; },
      async query() { return windowTabs; },
      async get(id) {
        const found = windowTabs.find((tab) => tab.id === id);
        if (!found) {
          throw new Error(`Missing tab ${id}`);
        }
        return { ...found };
      },
      async group({ tabIds }) {
        groupedIds = [...tabIds];
        return 7;
      },
      async move(id, options) {
        movedTab = { id, ...options };
      },
      async create(options) {
        createdTab = options;
        return { id: 99, ...options };
      },
      async getZoom() { return 1; },
      async setZoom() {},
      sendMessage() { return Promise.resolve(); },
      onZoomChange: { addListener() {} }
    },
    windows: {
      async get(id) {
        if (id === 2) return { id: 2, left: 100, top: 80, width: 1200, height: 900 };
        if (createdWindow?.id === id) return { ...createdWindow };
        throw new Error(`Missing window ${id}`);
      },
      async create(options) {
        createdWindow = { id: 55, ...options };
        return { ...createdWindow };
      },
      async update(id, options) {
        updatedWindow = { id, ...options };
        return { id, ...options };
      }
    },
    commands: { onCommand: { addListener() {} } }
  }
};
sandbox.globalThis = sandbox;
sandbox.importScripts = (...files) => {
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    vm.runInContext(source, context, { filename: file });
  }
};
const context = vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(root, "background.js"), "utf8"),
  context,
  { filename: "background.js" }
);
assert.equal(typeof messageListener, "function");

function send(message) {
  return new Promise((resolve) => {
    const sender = { tab: { id: 10, windowId: 2 } };
    const returned = messageListener(message, sender, resolve);
    if (returned !== true && returned !== undefined) {
      resolve(returned);
    }
  });
}

windowTabs = [
  {
    id: 10,
    windowId: 2,
    index: 0,
    active: true,
    pinned: false,
    groupId: -1,
    title: "Current",
    url: "https://current.example/",
    favIconUrl: "https://current.example/favicon.ico"
  },
  {
    id: 11,
    windowId: 2,
    index: 1,
    active: false,
    pinned: false,
    groupId: -1,
    title: "Second",
    url: "https://second.example/",
    favIconUrl: ""
  },
  {
    id: 12,
    windowId: 2,
    index: 3,
    active: false,
    pinned: false,
    groupId: -1,
    title: "Third",
    url: "https://third.example/",
    favIconUrl: ""
  }
];

const capture = await send({ type: "CAPTURE_VISIBLE_TAB" });
assert.equal(capture.ok, true);
assert.match(capture.dataUrl, /^data:image\/png/);
assert.match(capture.filename, /^statusline-capture-/);

const listed = await send({ type: "LIST_WINDOW_TABS" });
assert.equal(listed.ok, true);
assert.equal(listed.tabs.length, 3);
assert.equal(listed.tabs[0].active, true);
assert.equal(listed.splitSupported, false);

const stackMissing = await send({ type: "STACK_TABS", tabIds: [10] });
assert.equal(stackMissing.ok, false);
assert.equal(stackMissing.code, "NEED_MULTIPLE_TABS");

const stack = await send({ type: "STACK_TABS", tabIds: [10, 11, 10] });
assert.equal(stack.ok, true);
assert.deepEqual(groupedIds, [10, 11]);

const tileUnavailable = await send({ type: "TILE_TABS", tabIds: [10, 11] });
assert.equal(tileUnavailable.ok, false);
assert.equal(tileUnavailable.code, "SPLIT_API_UNAVAILABLE");

sandbox.chrome.tabs.createSplit = async (tabIds) => {
  assert.deepEqual(Array.from(tabIds), [10, 12]);
  return 42;
};
const tile = await send({ type: "TILE_TABS", tabIds: [10, 12] });
assert.equal(tile.ok, true);
assert.equal(tile.splitViewId, 42);
assert.deepEqual(movedTab, { id: 12, index: 1 });

const open = await send({ type: "OPEN_TAB", url: "https://example.com/panel" });
assert.equal(open.ok, true);
assert.equal(createdTab.windowId, 2);
assert.equal(createdTab.url, "https://example.com/panel");

const rejectScheme = await send({ type: "OPEN_TAB", url: "javascript:alert(1)" });
assert.equal(rejectScheme.ok, false);

const shortcutOpen = await send({
  type: "OPEN_SHORTCUT_WINDOW",
  shortcutId: "dispatch",
  url: "https://dispatch.pydemia.ai/"
});
assert.equal(shortcutOpen.ok, true);
assert.equal(shortcutOpen.reused, false);
assert.equal(createdWindow.type, "popup");
assert.equal(createdWindow.url, "https://dispatch.pydemia.ai/");
assert.equal(createdWindow.focused, true);
assert.equal(createdWindow.left, 124);
assert.ok(createdWindow.width >= 380 && createdWindow.width <= 520);
assert.ok(createdWindow.height >= 480 && createdWindow.height <= 760);

const shortcutReuse = await send({
  type: "OPEN_SHORTCUT_WINDOW",
  shortcutId: "dispatch",
  url: "https://dispatch.pydemia.ai/"
});
assert.equal(shortcutReuse.ok, true);
assert.equal(shortcutReuse.reused, true);
assert.deepEqual(updatedWindow, { id: 55, focused: true, state: "normal" });

const shortcutReject = await send({
  type: "OPEN_SHORTCUT_WINDOW",
  shortcutId: "bad",
  url: "javascript:alert(1)"
});
assert.equal(shortcutReject.ok, false);

console.log("Statusline background action tests passed.");
