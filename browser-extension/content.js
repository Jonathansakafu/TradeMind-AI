// Owns the real polling loop (survives as long as this tab stays open,
// unlike the MV3 service worker in background.js which does not). Runs
// only on pocketoption.com pages (see manifest.json content_scripts match).

const POLL_INTERVAL_MS = 20000;
const EXPIRY_BUFFER_MS = 5000;

let lastDemoWarningAt = 0;

function sendToBackground(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => resolve(response));
  });
}

async function appendStatusLog(level, message) {
  const { statusLog = [] } = await chrome.storage.local.get(["statusLog"]);
  const next = [...statusLog, { time: Date.now(), level, message }].slice(-100);
  await chrome.storage.local.set({ statusLog: next });
}

async function getConfig() {
  const { sessionId, botToken, backendUrl } = await chrome.storage.local.get([
    "sessionId", "botToken", "backendUrl",
  ]);
  return { sessionId, botToken, backendUrl };
}

async function handleNotification(config, notification) {
  const result = await window.TradeMindSelectors.placeTrade({
    pair: notification.pair,
    signal: notification.signal,
    stake: notification.stake,
    expiresInMinutes: notification.expiresInMinutes,
  });

  if (!result.ok) {
    await appendStatusLog("error", `${notification.pair}: ${result.reason}`);
    await sendToBackground({
      type: "report",
      backendUrl: config.backendUrl,
      sessionId: config.sessionId,
      token: config.botToken,
      notificationId: notification.id,
      outcome: "failed",
    });
    return;
  }

  await appendStatusLog("info", `${notification.pair}: trade placed, waiting for result...`);

  const waitMs = (notification.expiresInMinutes || 5) * 60 * 1000 + EXPIRY_BUFFER_MS;
  await new Promise((r) => setTimeout(r, waitMs));

  const outcome = window.TradeMindSelectors.readLastResult();
  await appendStatusLog(
    outcome === "unknown" ? "warn" : "info",
    `${notification.pair}: result = ${outcome}${outcome === "unknown" ? " (falling back to manual Won/Lost in the app)" : ""}`
  );

  await sendToBackground({
    type: "report",
    backendUrl: config.backendUrl,
    sessionId: config.sessionId,
    token: config.botToken,
    notificationId: notification.id,
    outcome,
  });
}

async function pollCycle() {
  const config = await getConfig();
  if (!config.sessionId || !config.botToken || !config.backendUrl) return; // not connected

  await chrome.storage.local.set({ lastHeartbeat: Date.now() });

  // Mandatory safety gate, independent of and in addition to the backend's
  // own accountType==="demo" check — the backend can't see what account
  // mode is actually selected in the live Pocket Option UI right now.
  const demo = window.TradeMindSelectors.isDemoMode();
  if (demo !== true) {
    if (Date.now() - lastDemoWarningAt > 5 * 60 * 1000) {
      await appendStatusLog("warn", "Cannot confirm Demo mode on this page — pausing until it's verified.");
      lastDemoWarningAt = Date.now();
    }
    return;
  }

  const response = await sendToBackground({
    type: "poll",
    backendUrl: config.backendUrl,
    sessionId: config.sessionId,
    token: config.botToken,
  });

  if (!response?.ok) {
    await appendStatusLog("error", `Could not reach TradeMind AI backend: ${response?.error || "unknown error"}`);
    return;
  }

  if (!response.data.active) return; // session stopped/hit a limit — stop signal, not an error

  for (const notification of response.data.notifications || []) {
    await handleNotification(config, notification);
  }
}

setInterval(pollCycle, POLL_INTERVAL_MS);
pollCycle();
