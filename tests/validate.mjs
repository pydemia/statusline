import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, "1.0.0");
assert.ok(!fs.readFileSync(path.join(root, "content/statusline.js"), "utf8").includes("<iframe"));
assert.equal(manifest.background.service_worker, "background.js");
const contentScript = fs.readFileSync(path.join(root, "content/statusline.js"), "utf8");
assert.ok(!contentScript.includes('setReservedStyle(records, root, "overflow", "hidden")'));
assert.ok(!contentScript.includes('setReservedStyle(records, body, "transform", "translateZ(0)")'));
assert.ok(!contentScript.includes("learnus.org"));
assert.ok(!contentScript.includes("chatgpt.com"));
assert.ok(!contentScript.includes("openai.com"));
assert.ok(contentScript.includes("sampledLayoutElements"));
assert.ok(contentScript.includes("primaryViewportShell"));
assert.ok(contentScript.includes("insetEdgeControls"));

const required = [
  manifest.background.service_worker,
  manifest.options_page,
  manifest.action.default_popup,
  ...Object.values(manifest.icons),
  ...manifest.content_scripts.flatMap((entry) => entry.js)
];
for (const relative of required) {
  assert.ok(fs.existsSync(path.join(root, relative)), `Missing manifest file: ${relative}`);
}

const sandbox = { globalThis: {}, URL };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(root, "shared/settings.js"), "utf8"),
  sandbox
);

const api = sandbox.StatuslineSettings;
assert.ok(api);
const normalized = api.normalizeSettings({
  height: 500,
  opacity: 0.1,
  panels: [
    { id: "docs", name: "Docs", url: "https://example.com/docs" },
    { id: "bad", name: "Bad", url: "javascript:alert(1)" }
  ],
  widgets: [
    { id: "clock", enabled: true, side: "left" },
    { id: "unknown", enabled: true, side: "right" }
  ]
});
assert.equal(normalized.height, 52);
assert.equal(normalized.opacity, 0.75);
assert.equal(normalized.widgets[0].id, "panels");
assert.equal(normalized.widgets[0].side, "left");
const clockConfig = normalized.widgets.find((item) => item.id === "clock");
assert.equal(clockConfig.side, "right");
assert.equal(normalized.widgets.length, api.WIDGETS.length);
assert.ok(!normalized.widgets.some((item) => item.id === "unknown"));
for (const id of ["panels", "capture", "devtools", "tile", "stack"]) {
  assert.ok(api.WIDGETS.some((widget) => widget.id === id), `Missing widget: ${id}`);
}
assert.equal(normalized.panels.length, 1);
assert.equal(normalized.panels[0].url, "https://example.com/docs");
assert.equal(api.DEFAULTS.height, 36);

assert.equal(api.DEFAULTS.reserveSpace, true);
assert.equal(api.DEFAULTS.layoutMode, "docked");
const dockedMigration = api.normalizeSettings({ reserveSpace: false });
assert.equal(dockedMigration.layoutMode, "docked");
assert.equal(dockedMigration.reserveSpace, true);
const overlaySetting = api.normalizeSettings({ layoutMode: "overlay", reserveSpace: false });
assert.equal(overlaySetting.layoutMode, "overlay");
assert.equal(overlaySetting.reserveSpace, false);
assert.deepEqual(Array.from(api.DEFAULTS.panels), []);
const migratedWidgets = api.normalizeSettings({
  widgets: [
    { id: "host", enabled: true, side: "left" },
    { id: "capture", enabled: true, side: "right" },
    { id: "clock", enabled: true, side: "right" }
  ]
}).widgets;
assert.equal(migratedWidgets[0].id, "panels");
assert.equal(migratedWidgets[0].side, "left");
assert.ok(!migratedWidgets.some((item) => item.id === "host"));
for (const item of migratedWidgets.filter((item) => item.id !== "panels")) {
  assert.equal(item.side, "right", `${item.id} should be in the right zone`);
}
const migrated = api.normalizeSettings({ height: 26, fontSize: 12 });
assert.equal(migrated.height, 36);
assert.equal(migrated.fontSize, 13);
assert.equal(api.DEFAULTS.dateTimeFormat, "YYYY-MM-DD ddd HH:mm");
assert.ok(api.isValidTimeZone("Asia/Seoul"));
assert.ok(!api.isValidTimeZone("Mars/Olympus"));
assert.ok(!api.WIDGETS.some((widget) => widget.id === "title"));
assert.ok(!api.WIDGETS.some((widget) => widget.id === "load"));
assert.ok(!api.WIDGETS.some((widget) => widget.id === "host"));
const clockSettings = api.normalizeSettings({
  clockTimeZone: "Asia/Seoul",
  worldClocks: ["UTC", "America/New_York", "UTC", "Mars/Olympus"]
});
assert.equal(clockSettings.clockTimeZone, "Asia/Seoul");
assert.deepEqual(Array.from(clockSettings.worldClocks), ["UTC", "America/New_York"]);
const dedupedPrimary = api.normalizeSettings({
  clockTimeZone: "UTC",
  worldClocks: ["UTC", "Asia/Seoul"]
});
assert.deepEqual(Array.from(dedupedPrimary.worldClocks), ["Asia/Seoul"]);
assert.equal(
  api.normalizeSettings({ timeFormat: "12h", showSeconds: true, dateStyle: "none" }).dateTimeFormat,
  "h:mm:ss A"
);
assert.equal(
  api.normalizeSettings({ dateTimeFormat: "YYYY.MM.DD [at] HH:mm" }).dateTimeFormat,
  "YYYY.MM.DD [at] HH:mm"
);

console.log("Statusline validation passed.");
