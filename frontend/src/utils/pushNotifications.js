import axios from "axios";
import { Capacitor } from "@capacitor/core";
import { API_URL } from "../config/api";

// Registers this device for alerts that arrive while TradeMind isn't open:
// Web Push (public/sw.js) in browsers, Firebase Cloud Messaging in the
// Android app. The backend (services/notifyDispatcher.js) decides what to
// send; this only hands it somewhere to send to.

// Only true in Android builds made with a google-services.json present
// (see .github/workflows/android-release.yml). Calling the native plugin's
// register() without Firebase configured crashes the app outright, so the
// plugin is never touched unless this is set.
const FCM_ENABLED = import.meta.env.VITE_FCM_ENABLED === "true";

const isAndroidApp = () => Capacitor.getPlatform() === "android";
const isNative = () => Capacitor.isNativePlatform();

// Imported lazily so the web bundle never evaluates the native plugin.
const nativePush = () =>
  import("@capacitor/push-notifications").then((m) => m.PushNotifications);

function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// "unsupported" | "needs-app-update" | "denied" | "off" | "on"
export async function getPushState() {
  if (isNative()) {
    if (!isAndroidApp()) return "unsupported";
    if (!FCM_ENABLED) return "needs-app-update";
    const PushNotifications = await nativePush();
    const { receive } = await PushNotifications.checkPermissions();
    if (receive === "denied") return "denied";
    if (receive !== "granted") return "off";
    return localStorageGet("fcmToken") ? "on" : "off";
  }

  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "off";
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "on" : "off";
}

// Must be called from a user tap (browsers require a user gesture for the
// permission prompt). Throws a readable Error on failure.
export async function enablePush(headers) {
  if (isNative()) return enableNative(headers);

  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notifications are blocked for this site. Allow them in your browser's site settings and try again.");
  }

  const { data } = await axios.get(`${API_URL}/api/push/vapid-public-key`);
  let sub = await reg.pushManager.getSubscription();
  // A subscription made against a different server key can't receive
  // anything from this server -- replace it.
  const currentKey = sub?.options?.applicationServerKey;
  if (sub && currentKey && !sameKey(currentKey, data.publicKey)) {
    await sub.unsubscribe();
    sub = null;
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(data.publicKey),
    });
  }
  await axios.post(`${API_URL}/api/push/subscribe`, sub.toJSON(), { headers });
}

function sameKey(buffer, base64) {
  const a = new Uint8Array(buffer);
  const b = urlBase64ToUint8Array(base64);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function enableNative(headers) {
  if (!isAndroidApp()) throw new Error("Push alerts aren't available on this device yet.");
  if (!FCM_ENABLED) throw new Error("This version of the app doesn't support push alerts yet. Update the app and try again.");

  const PushNotifications = await nativePush();
  // High importance = heads-up pop-up with sound. Must match the
  // channelId the backend sends with (notifyDispatcher.js's sendFcm).
  await PushNotifications.createChannel({
    id: "signals",
    name: "Trading signals",
    description: "New AI trading signals",
    importance: 5,
    visibility: 1,
    sound: "default",
    vibration: true,
  }).catch(() => {});

  let { receive } = await PushNotifications.checkPermissions();
  if (receive !== "granted") ({ receive } = await PushNotifications.requestPermissions());
  if (receive !== "granted") {
    throw new Error("Notifications are blocked for TradeMind AI. Allow them in Android Settings → Apps → TradeMind AI → Notifications.");
  }

  const token = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out registering with Firebase.")), 20000);
    const handles = [];
    const done = (fn) => (value) => {
      clearTimeout(timer);
      handles.forEach((h) => h.remove());
      fn(value);
    };
    Promise.all([
      PushNotifications.addListener("registration", done((t) => resolve(t.value))),
      PushNotifications.addListener("registrationError", done((e) => reject(new Error(e?.error || "Firebase registration failed")))),
    ]).then((hs) => {
      handles.push(...hs);
      PushNotifications.register();
    });
  });

  await axios.post(`${API_URL}/api/push/fcm-token`, { token }, { headers });
  localStorageSet("fcmToken", token);
}

// Removes this device from the account (Settings toggle-off and logout),
// so a logged-out phone/browser stops receiving the account's signals.
export async function disablePush(headers) {
  if (isNative()) {
    const token = localStorageGet("fcmToken");
    localStorageSet("fcmToken", null);
    if (token) await axios.post(`${API_URL}/api/push/fcm-token/remove`, { token }, { headers });
    if (isAndroidApp() && FCM_ENABLED) {
      const PushNotifications = await nativePush();
      await PushNotifications.unregister().catch(() => {});
    }
    return;
  }
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await axios.post(`${API_URL}/api/push/unsubscribe`, { endpoint: sub.endpoint }, { headers }).catch(() => {});
  await sub.unsubscribe();
}

// Called once per app start while logged in. Tokens/subscriptions can
// rotate silently (FCM refreshes tokens, the backend may have pruned a
// dead one) -- re-sending an already-granted registration keeps delivery
// working without the user revisiting Settings. Never prompts.
export async function refreshPushRegistration(headers) {
  try {
    if ((await getPushState()) === "on") await enablePush(headers);
  } catch (err) {
    console.warn("Push refresh failed:", err.message);
  }
}

// localStorage can throw (private mode, blocked storage) -- never let that
// break push setup.
function localStorageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function localStorageSet(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* ignore */ }
}
