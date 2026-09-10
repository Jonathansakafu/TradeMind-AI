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

// fetch() only rejects on a genuine network failure -- a 400/404/500
// response is still a "successful" fetch as far as it's concerned, and
// r.json() happily parses this app's error responses too (they're always
// JSON, e.g. {message: "..."}). Without checking r.ok, a real backend
// error (the notification already resolved, an invalid token, whatever)
// would still resolve this promise chain and report {ok: true} back to
// content.js -- which would then treat a trade's outcome as successfully
// recorded when the backend actually rejected it and never created
// anything. Confirmed as a real gap: trades placed on Pocket Option
// weren't reliably becoming Trade records in the app.
async function fetchJson(url, options) {
  const r = await fetch(url, options);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.message || `HTTP ${r.status}`);
  return data;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "poll") {
    const { backendUrl, sessionId, token } = message;
    fetchJson(`${backendUrl}/api/quick-trade-bot/pending?sessionId=${sessionId}&token=${token}`)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // keep the message channel open for the async response
  }

  if (message.type === "report") {
    const { backendUrl, sessionId, token, notificationId, outcome } = message;
    fetchJson(`${backendUrl}/api/quick-trade-bot/executed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, token, notificationId, outcome }),
    })
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

  // Distinguished because the likely cause differs: a heartbeat that was
  // arriving and then stopped means the tab was probably closed,
  // backgrounded, or navigated away; one that NEVER arrived at all is the
  // single most common cause -- the tab was already open before the
  // extension was loaded/reloaded, so its content script was never
  // actually injected (a well-known MV3 gotcha, not a real failure), and
  // no amount of waiting fixes that without a refresh.
  if (!lastHeartbeat) {
    appendStatusLog("warn", "No response yet from the Pocket Option tab — if it was already open before you loaded/reloaded the extension, refresh it (Cmd+R) so the extension's code actually gets injected.");
  } else if (Date.now() - lastHeartbeat > 90 * 1000) {
    appendStatusLog("warn", "No response from the Pocket Option tab in over 90s — is it still open and focused?");
  }
});
