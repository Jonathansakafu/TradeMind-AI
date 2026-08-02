// Service worker: network I/O only. MV3 service workers are non-persistent
// and get killed well before a Quick Trade expiry would need, so the real
// polling timer lives in content.js (survives as long as the tab is open) —
// this only relays the two fetch calls content.js can't safely make itself
// (a content-script fetch() can be constrained by the host page's CSP).

async function appendStatusLog(level, message) {
  const { statusLog = [] } = await chrome.storage.local.get(["statusLog"]);
  const next = [...statusLog, { time: Date.now(), level, message }].slice(-100);
  await chrome.storage.local.set({ statusLog: next });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "poll") {
    const { backendUrl, sessionId, token } = message;
    fetch(`${backendUrl}/api/quick-trade-bot/pending?sessionId=${sessionId}&token=${token}`)
      .then((r) => r.json())
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // keep the message channel open for the async response
  }

  if (message.type === "report") {
    const { backendUrl, sessionId, token, notificationId, outcome } = message;
    fetch(`${backendUrl}/api/quick-trade-bot/executed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, token, notificationId, outcome }),
    })
      .then((r) => r.json())
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

// Secondary keep-alive/recovery check — not the primary polling loop. If
// the content script hasn't updated its heartbeat in a while, the tab is
// probably closed, backgrounded and throttled, or not on pocketoption.com,
// and that's worth surfacing in the popup rather than failing silently.
chrome.alarms.create("heartbeat-check", { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "heartbeat-check") return;
  const { sessionId, lastHeartbeat } = await chrome.storage.local.get(["sessionId", "lastHeartbeat"]);
  if (!sessionId) return; // not connected yet, nothing to check
  if (!lastHeartbeat || Date.now() - lastHeartbeat > 90 * 1000) {
    appendStatusLog("warn", "No response from the Pocket Option tab in over 90s — is it still open and focused?");
  }
});
