const DEFAULT_BACKEND_URL = "https://trademind-ai-backend-2tnj.onrender.com";

const sessionIdEl = document.getElementById("sessionId");
const botTokenEl = document.getElementById("botToken");
const backendUrlEl = document.getElementById("backendUrl");
const statusEl = document.getElementById("status");
const statusTextEl = document.getElementById("statusText");
const logEl = document.getElementById("log");

function renderStatus({ sessionId, lastHeartbeat }) {
  const connected = !!sessionId && !!lastHeartbeat && Date.now() - lastHeartbeat < 90000;
  statusEl.classList.toggle("connected", connected);
  if (!sessionId) {
    statusTextEl.textContent = "Not connected";
  } else if (connected) {
    statusTextEl.textContent = "Connected";
  } else {
    statusTextEl.textContent = "Connected, waiting for the Pocket Option tab...";
  }
}

function renderLog(statusLog = []) {
  if (statusLog.length === 0) {
    logEl.innerHTML = '<div class="empty">No activity yet.</div>';
    return;
  }
  logEl.innerHTML = statusLog
    .slice()
    .reverse()
    .map((entry) => {
      const time = new Date(entry.time).toLocaleTimeString();
      return `<div class="entry ${entry.level}">[${time}] ${entry.message}</div>`;
    })
    .join("");
}

async function refresh() {
  const data = await chrome.storage.local.get([
    "sessionId", "botToken", "backendUrl", "lastHeartbeat", "statusLog",
  ]);
  sessionIdEl.value = data.sessionId || "";
  botTokenEl.value = data.botToken || "";
  backendUrlEl.value = data.backendUrl || DEFAULT_BACKEND_URL;
  renderStatus(data);
  renderLog(data.statusLog);
}

document.getElementById("connectBtn").addEventListener("click", async () => {
  await chrome.storage.local.set({
    sessionId: sessionIdEl.value.trim(),
    botToken: botTokenEl.value.trim(),
    backendUrl: (backendUrlEl.value.trim() || DEFAULT_BACKEND_URL).replace(/\/$/, ""),
    statusLog: [],
  });
  refresh();
});

document.getElementById("disconnectBtn").addEventListener("click", async () => {
  await chrome.storage.local.remove(["sessionId", "botToken", "lastHeartbeat"]);
  refresh();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") refresh();
});

refresh();
