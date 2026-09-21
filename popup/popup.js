document.querySelector("#version").textContent = chrome.runtime.getManifest().version;
const { normalizeSettings } = StatuslineSettings;
const enabled = document.querySelector("#enabled");
const position = document.querySelector("#position");
const siteRow = document.querySelector("#site-row");
const siteEnabled = document.querySelector("#site-enabled");
const siteHost = document.querySelector("#site-host");
let settings;
let hostname = "";

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getPageInfo() {
  const tab = await activeTab();
  if (!tab?.id) {
    return null;
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_INFO" });
  } catch {
    return null;
  }
}

enabled.addEventListener("change", async () => {
  settings.enabled = enabled.checked;
  await chrome.storage.sync.set({ enabled: settings.enabled });
});

position.addEventListener("change", async () => {
  settings.position = position.value;
  await chrome.storage.sync.set({ position: settings.position });
});

siteEnabled.addEventListener("change", async () => {
  if (!hostname) {
    return;
  }
  const hosts = new Set(settings.disabledHosts);
  if (siteEnabled.checked) {
    hosts.delete(hostname);
  } else {
    hosts.add(hostname);
  }
  settings.disabledHosts = [...hosts];
  await chrome.storage.sync.set({ disabledHosts: settings.disabledHosts });
});

document.querySelector("#settings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

(async () => {
  settings = normalizeSettings(await chrome.storage.sync.get(null));
  enabled.checked = settings.enabled;
  position.value = settings.position;

  const info = await getPageInfo();
  if (!info?.hostname) {
    siteRow.classList.add("hidden");
    return;
  }
  hostname = info.hostname;
  siteHost.textContent = hostname;
  siteEnabled.checked = !settings.disabledHosts.includes(hostname);
})();
