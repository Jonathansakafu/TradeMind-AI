const webpush = require("web-push");
const User = require("../models/User");
const AppConfig = require("../models/AppConfig");
const { sendSignalEmail } = require("../utils/sendEmail");
const pipelineStats = require("./pipelineStats");
const { suggestedLot } = require("../utils/lotSize");

// Fans a freshly created Notification out to channels that reach the
// trader when the app isn't open: browser Web Push, Android push (FCM),
// and email. Triggered from Notification's own post-save hook (see
// models/Notification.js), so every creation path -- AI auto-generate,
// Quick Trade, News Impact, TradingView webhooks -- gets it without each
// call site having to remember to. Every channel failure is logged and
// swallowed: delivery is best-effort and must never break generation.

// Caps one user's signal emails per UTC day. Resend's free tier allows
// 100/day for the whole account, password-reset emails included, so this
// leaves headroom for those.
const EMAIL_DAILY_CAP = 50;

// ---------- Web Push (VAPID) ----------

// Env vars win if set; otherwise a key pair is generated once and kept in
// Mongo, so browser push works with zero manual Render configuration.
// The pair must never change afterwards -- every existing subscription is
// bound to the public key it was created with.
let vapidReady = null;
function getVapidKeys() {
  if (!vapidReady) {
    vapidReady = (async () => {
      let keys;
      if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
        keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
      } else {
        const existing = await AppConfig.findOne({ key: "vapidKeys" });
        if (existing?.value?.publicKey) {
          keys = existing.value;
        } else {
          const generated = webpush.generateVAPIDKeys();
          // $setOnInsert so two instances racing on first boot both end up
          // with whichever pair was written first, never two different ones.
          const saved = await AppConfig.findOneAndUpdate(
            { key: "vapidKeys" },
            { $setOnInsert: { value: generated } },
            { upsert: true, returnDocument: "after" }
          );
          keys = saved.value;
        }
      }
      webpush.setVapidDetails(
        `mailto:${process.env.VAPID_CONTACT_EMAIL || "alerts@trademind.ai"}`,
        keys.publicKey,
        keys.privateKey
      );
      return keys;
    })().catch((err) => {
      vapidReady = null; // retry on the next call instead of caching a failure
      throw err;
    });
  }
  return vapidReady;
}

async function getVapidPublicKey() {
  return (await getVapidKeys()).publicKey;
}

// ---------- Android push (Firebase Cloud Messaging) ----------

// FIREBASE_SERVICE_ACCOUNT holds the service-account JSON downloaded from
// the Firebase console (raw JSON or base64 of it). Not set = Android push
// is simply off; nothing else is affected.
let firebaseMessaging;
function getFirebaseMessaging() {
  if (firebaseMessaging !== undefined) return firebaseMessaging;
  firebaseMessaging = null;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const json = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const admin = require("firebase-admin");
    const app = admin.initializeApp({ credential: admin.credential.cert(JSON.parse(json)) }, "trademind-push");
    firebaseMessaging = app.messaging();
  } catch (err) {
    console.error("Firebase init failed -- Android push disabled:", err.message);
  }
  return firebaseMessaging;
}

// ---------- Message formatting ----------

function fmtPrice(n) {
  if (!n) return null;
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 5 : 2 });
}

// "💼 0.19 lot (cent) → SL −$7.98 · TP +$15.96" from Settings → Risk.
function lotLine(notification, rs) {
  if (!rs || notification.type === "quick_trade" || !["buy", "sell"].includes(notification.signal)) return null;
  const s = suggestedLot({ ...notification.toObject?.() ?? notification, stopLoss: notification.initialStopLoss ?? notification.stopLoss }, rs);
  if (!s) return null;
  const cur = rs.currency || "USD";
  if (s.tooSmall) return `💼 Smallest lot risks ${cur} ${s.minRisk.toFixed(2)} — over your ${cur} ${s.riskAmount.toFixed(2)}${s.cent ? "" : " (a cent account fixes this)"}`;
  return `💼 ${s.lot.toFixed(2)} lot${s.cent ? " (cent)" : ""} → SL −${cur} ${s.actualRisk.toFixed(2)}${s.reward ? ` · TP +${cur} ${s.reward.toFixed(2)}` : ""}`;
}

function buildMessage(notification, riskSettings) {
  const side = notification.signal === "buy" ? "🟢 BUY" : notification.signal === "sell" ? "🔴 SELL" : "⏸ WAIT";
  const conf = notification.confidence != null ? ` · ${Math.round(notification.confidence)}%` : "";
  const title = `${side} ${notification.pair || ""}${conf}`.trim();

  const parts = [];
  if (notification.type === "quick_trade") {
    parts.push(`Quick Trade · expires in ${notification.expiresInMinutes || 5} min`);
  } else {
    const levels = [
      fmtPrice(notification.entry) && `Entry ${fmtPrice(notification.entry)}`,
      fmtPrice(notification.stopLoss) && `SL ${fmtPrice(notification.stopLoss)}`,
      fmtPrice(notification.takeProfit) && `TP ${fmtPrice(notification.takeProfit)}`,
    ].filter(Boolean);
    if (levels.length) parts.push(levels.join(" · "));
  }
  const lot = lotLine(notification, riskSettings);
  if (lot) parts.push(lot);
  if (notification.sourceLabel) parts.push(notification.sourceLabel);
  const body = parts.join("\n");

  // Quick Trade signals go stale in minutes -- tell push services not to
  // deliver one after it's useless (e.g. a phone that was offline).
  const ttlSeconds = notification.type === "quick_trade"
    ? Math.max(60, (notification.expiresInMinutes || 5) * 60)
    : 6 * 60 * 60;

  // Tapping the alert opens this signal on the Notifications page.
  return { title, body, url: `/notifications?id=${notification._id}`, id: String(notification._id), ttlSeconds };
}

// ---------- Channel senders ----------

async function sendWebPush(user, msg) {
  const subs = user.pushSubscriptions || [];
  if (!subs.length) return { devices: 0, sent: 0 };
  await getVapidKeys();

  const payload = JSON.stringify({ title: msg.title, body: msg.body, url: msg.url, tag: msg.id, image: msg.image || undefined });
  const dead = [];
  let sent = 0;
  let lastError = null;
  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        payload,
        { TTL: msg.ttlSeconds, urgency: "high" }
      );
      sent++;
    } catch (err) {
      // 404/410 = the browser dropped this subscription (permission
      // revoked, site data cleared) -- it will never work again.
      if (err.statusCode === 404 || err.statusCode === 410) dead.push(sub.endpoint);
      else lastError = err.body || err.message;
    }
  }));
  if (dead.length) {
    await User.updateOne({ _id: user._id }, { $pull: { pushSubscriptions: { endpoint: { $in: dead } } } });
  }
  return { devices: subs.length, sent, removed: dead.length, error: lastError };
}

async function sendFcm(user, msg) {
  const tokens = user.fcmTokens || [];
  if (!tokens.length) return { devices: 0, sent: 0 };
  const messaging = getFirebaseMessaging();
  if (!messaging) return { devices: tokens.length, sent: 0, error: "FIREBASE_SERVICE_ACCOUNT is not configured on the server" };

  const res = await messaging.sendEachForMulticast({
    tokens,
    // imageUrl: the signal chart, shown as a big picture in the notification.
    notification: { title: msg.title, body: msg.body, ...(msg.image ? { imageUrl: msg.image } : {}) },
    data: { url: msg.url, notificationId: msg.id },
    android: {
      priority: "high",
      ttl: msg.ttlSeconds * 1000,
      // Messaging-app style (heads-up pop-up, sound, vibration, lock screen):
      // the "signals" channel is created by the app on every start
      // (src/utils/pushNotifications.js) with high importance, and is also
      // AndroidManifest's default channel. ic_stat_tm is the white
      // status-bar silhouette; color tints it and the app name.
      notification: {
        channelId: "signals",
        icon: "ic_stat_tm",
        color: "#22C55E",
        sound: "default",
        defaultVibrateTimings: true,
        priority: "max",
        visibility: "public",
        tag: msg.id,
      },
    },
  });

  const dead = [];
  let lastError = null;
  res.responses.forEach((r, i) => {
    if (r.success) return;
    const code = r.error?.code;
    if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
      dead.push(tokens[i]);
    } else {
      lastError = r.error?.message || code;
    }
  });
  if (dead.length) {
    await User.updateOne({ _id: user._id }, { $pull: { fcmTokens: { $in: dead } } });
  }
  return { devices: tokens.length, sent: res.successCount, removed: dead.length, error: lastError };
}

// Atomically claims one of today's EMAIL_DAILY_CAP slots for this user;
// false once the cap is hit.
async function claimEmailSlot(userId) {
  const today = new Date().toISOString().slice(0, 10);
  await User.updateOne(
    { _id: userId, emailSentDate: { $ne: today } },
    { $set: { emailSentDate: today, emailSentCount: 0 } }
  );
  const res = await User.updateOne(
    { _id: userId, emailSentDate: today, emailSentCount: { $lt: EMAIL_DAILY_CAP } },
    { $inc: { emailSentCount: 1 } }
  );
  return res.modifiedCount === 1;
}

async function sendEmail(user, notification, msg) {
  if (!(await claimEmailSlot(user._id))) {
    return { sent: false, error: `Daily email limit (${EMAIL_DAILY_CAP}) reached` };
  }
  try {
    await sendSignalEmail(user.email, notification, msg);
  } catch (err) {
    // Give the slot back -- a rejected send shouldn't count toward the cap.
    await User.updateOne({ _id: user._id }, { $inc: { emailSentCount: -1 } });
    throw err;
  }
  return { sent: true };
}

// ---------- Entry points ----------

// Backtested strategy signals (services/ruleStrategy.js) always pass: their
// "confidence" is the tested win rate (~43%), which is low by design -- the
// edge is wins larger than losses -- and would sit under any floor.
const passesEmailFloor = (n, minConf) => n.source === "strategy" || (n.confidence ?? 0) >= minConf;

// options.test: ignore the user's on/off toggles and email confidence
// floor, and return per-channel results -- backs Settings' "Send test".
async function dispatchNotification(notification, options = {}) {
  const user = await User.findById(notification.user)
    .select("email notificationPrefs riskSettings +pushSubscriptions +fcmTokens");
  if (!user) return null;

  const prefs = user.notificationPrefs || {};
  const msg = buildMessage(notification, user.riskSettings);
  // The signal's chart picture (services/signalImage.js). Never holds an
  // alert back: at most 6 s, otherwise it goes out without the picture.
  const willSend = ((prefs.push !== false) && ((user.fcmTokens || []).length || (user.pushSubscriptions || []).length))
    || (prefs.email && passesEmailFloor(notification, prefs.emailMinConfidence ?? 70));
  if (!options.test && willSend) {
    msg.image = notification.chartImage || await require("./signalImage").withTimeout(
      require("./signalImage").forNotification(notification).catch((err) => { console.error("Signal chart picture failed:", err.message); return null; }),
      6000
    );
  }
  const results = {};

  const tasks = [];
  if (options.test || prefs.push !== false) {
    tasks.push(sendWebPush(user, msg).then((r) => { results.browser = r; })
      .catch((err) => { results.browser = { sent: 0, error: err.message }; }));
    tasks.push(sendFcm(user, msg).then((r) => { results.android = r; })
      .catch((err) => { results.android = { sent: 0, error: err.message }; }));
  }
  const minConf = prefs.emailMinConfidence ?? 70;
  if (options.test || (prefs.email && passesEmailFloor(notification, minConf))) {
    tasks.push(sendEmail(user, notification, msg).then((r) => { results.email = r; })
      .catch((err) => { results.email = { sent: false, error: err.message }; }));
  }
  await Promise.all(tasks);

  for (const [channel, r] of Object.entries(results)) {
    if (r?.error) console.error(`Notify ${channel} failed for user ${user._id}:`, r.error);
    if (options.test) continue;
    const sent = r?.sent === true ? 1 : Number(r?.sent) || 0;
    if (sent) pipelineStats.inc(`delivery.${channel}.sent`, sent);
    if (r?.error) {
      pipelineStats.inc(`delivery.${channel}.error`);
      pipelineStats.recordError(`delivery.${channel}`, r.error);
    }
  }
  return results;
}

// A non-signal message (e.g. the morning brief) to one user's devices and,
// if they've switched email alerts on, their inbox. Same channels and
// prefs as signals; no confidence floor (it isn't a signal).
// options: email (default true) -- false sends push only; pref -- name of
// a notificationPrefs switch that must not be off (e.g. "newsCountdown");
// ttlSeconds -- how long a push may wait for an offline phone.
async function dispatchMessage(userId, { title, body, text, url = "/dashboard", id, email = true, pref, ttlSeconds = 6 * 60 * 60, image }) {
  const user = await User.findById(userId).select("email notificationPrefs +pushSubscriptions +fcmTokens");
  if (!user) return null;
  const prefs = user.notificationPrefs || {};
  if (pref && prefs[pref] === false) return { skipped: `${pref} off` };
  const msg = { title, body, url, id: id || `msg-${Date.now()}`, ttlSeconds, image };
  const results = {};
  if (prefs.push !== false) {
    results.browser = await sendWebPush(user, msg).catch((err) => ({ error: err.message }));
    results.android = await sendFcm(user, msg).catch((err) => ({ error: err.message }));
  }
  if (prefs.email && email) {
    results.email = await sendEmail(user, { signal: "wait", reasoning: text || body }, { ...msg, body: "" })
      .catch((err) => ({ error: err.message }));
  }
  return results;
}

// Can this user get an alert at all (push device or email on)?
async function hasChannels(userId) {
  const u = await User.findById(userId).select("notificationPrefs +pushSubscriptions +fcmTokens");
  if (!u) return false;
  const prefs = u.notificationPrefs || {};
  return !!(((prefs.push !== false) && ((u.fcmTokens || []).length || (u.pushSubscriptions || []).length)) || prefs.email);
}

module.exports = { dispatchNotification, dispatchMessage, getVapidPublicKey, buildMessage, hasChannels };
