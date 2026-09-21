const { WIDGETS, DEFAULTS, clone, normalizeSettings } = StatuslineSettings;

const controls = {
  enabled: document.querySelector("#enabled"),
  position: document.querySelector("#position"),
  theme: document.querySelector("#theme"),
  height: document.querySelector("#height"),
  fontSize: document.querySelector("#font-size"),
  opacity: document.querySelector("#opacity"),
  dateTimeFormat: document.querySelector("#date-time-format"),
  clockTimeZone: document.querySelector("#clock-time-zone"),
  hideOnFullscreen: document.querySelector("#hide-fullscreen"),
  reserveSpace: document.querySelector("#reserve-space")
};

const widgetList = document.querySelector("#widget-list");
const saveStatus = document.querySelector("#save-status");
let settings = clone(DEFAULTS);
let draggedRow = null;

function setOutputs() {
  document.querySelector("#height-output").textContent = `${controls.height.value}px`;
  document.querySelector("#font-size-output").textContent = `${controls.fontSize.value}px`;
  document.querySelector("#opacity-output").textContent = `${Math.round(Number(controls.opacity.value) * 100)}%`;
}

function renderWidgets() {
  widgetList.replaceChildren();
  const definitions = new Map(WIDGETS.map((widget) => [widget.id, widget]));

  for (const config of settings.widgets) {
    const definition = definitions.get(config.id);
    if (!definition) {
      continue;
    }
    const row = document.createElement("div");
    row.className = "widget-row";
    const fixedPlacement = config.id === "panels";
    row.draggable = !fixedPlacement;
    row.dataset.id = config.id;

    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.textContent = fixedPlacement ? "—" : "⋮⋮";
    handle.setAttribute("aria-hidden", "true");

    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = config.enabled;
    enabled.setAttribute("aria-label", `Enable ${definition.label}`);
    enabled.addEventListener("change", () => {
      config.enabled = enabled.checked;
    });

    const copy = document.createElement("div");
    copy.className = "widget-copy";
    const label = document.createElement("strong");
    label.textContent = definition.label;
    const description = document.createElement("small");
    description.textContent = definition.description;
    copy.append(label, description);

    const side = document.createElement("select");
    side.className = "widget-side";
    side.setAttribute("aria-label", `${definition.label} placement`);
    const option = document.createElement("option");
    option.value = config.id === "panels" ? "left" : "right";
    option.textContent = config.id === "panels" ? "Far left" : "Right";
    option.selected = true;
    side.append(option);
    side.disabled = true;

    row.append(handle, enabled, copy, side);
    if (!fixedPlacement) {
      installDragHandlers(row);
    }
    widgetList.append(row);
  }
}

function installDragHandlers(row) {
  row.addEventListener("dragstart", () => {
    draggedRow = row;
    row.classList.add("dragging");
  });
  row.addEventListener("dragend", () => {
    row.classList.remove("dragging");
    widgetList.querySelectorAll(".drag-over").forEach((item) => item.classList.remove("drag-over"));
    syncWidgetOrderFromDom();
    draggedRow = null;
  });
  row.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (!draggedRow || draggedRow === row) {
      return;
    }
    row.classList.add("drag-over");
  });
  row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
  row.addEventListener("drop", (event) => {
    event.preventDefault();
    row.classList.remove("drag-over");
    if (!draggedRow || draggedRow === row) {
      return;
    }
    const rect = row.getBoundingClientRect();
    const insertAfter = event.clientY > rect.top + rect.height / 2;
    row.parentElement.insertBefore(draggedRow, insertAfter ? row.nextSibling : row);
    syncWidgetOrderFromDom();
  });
}

function syncWidgetOrderFromDom() {
  const byId = new Map(settings.widgets.map((item) => [item.id, item]));
  settings.widgets = [...widgetList.querySelectorAll(".widget-row")]
    .map((row) => byId.get(row.dataset.id))
    .filter(Boolean);
}

function populateForm() {
  controls.enabled.checked = settings.enabled;
  controls.position.value = settings.position;
  controls.theme.value = settings.theme;
  controls.height.value = settings.height;
  controls.fontSize.value = settings.fontSize;
  controls.opacity.value = settings.opacity;
  controls.dateTimeFormat.value = settings.dateTimeFormat;
  controls.clockTimeZone.value = settings.clockTimeZone;
  controls.hideOnFullscreen.checked = settings.hideOnFullscreen;
  controls.reserveSpace.checked = settings.reserveSpace;
  setOutputs();
  renderWidgets();
}

function readForm() {
  syncWidgetOrderFromDom();
  settings = normalizeSettings({
    ...settings,
    enabled: controls.enabled.checked,
    position: controls.position.value,
    theme: controls.theme.value,
    height: Number(controls.height.value),
    fontSize: Number(controls.fontSize.value),
    opacity: Number(controls.opacity.value),
    dateTimeFormat: controls.dateTimeFormat.value,
    clockTimeZone: controls.clockTimeZone.value,
    hideOnFullscreen: controls.hideOnFullscreen.checked,
    reserveSpace: controls.reserveSpace.checked,
    layoutMode: controls.reserveSpace.checked ? "docked" : "overlay"
  });
}

async function save() {
  readForm();
  await chrome.storage.sync.set(settings);
  saveStatus.textContent = "Saved.";
  setTimeout(() => {
    if (saveStatus.textContent === "Saved.") {
      saveStatus.textContent = "";
    }
  }, 1500);
}

async function reset() {
  settings = clone(DEFAULTS);
  populateForm();
  await chrome.storage.sync.set(settings);
  saveStatus.textContent = "Defaults restored.";
}

for (const control of [controls.height, controls.fontSize, controls.opacity]) {
  control.addEventListener("input", setOutputs);
}

document.querySelector("#save").addEventListener("click", save);
document.querySelector("#reset").addEventListener("click", reset);

(async () => {
  settings = normalizeSettings(await chrome.storage.sync.get(null));
  populateForm();
})();
