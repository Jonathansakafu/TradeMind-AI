import { Capacitor, registerPlugin } from "@capacitor/core";
import { API_URL } from "../config/api";
import { getSpeechPrefs } from "./speechPrefs";
import { savedMicLang, micLocale } from "./micLangs";

// "Hey TradeMind" wake word -- Android app only (native WakeWordService:
// offline Vosk recogniser in a background service). Browsers and iPhones
// can't listen with the app closed, so everything here is a no-op there.

export const wakeWordSupported = Capacitor.getPlatform() === "android";
const WakeWord = wakeWordSupported ? registerPlugin("WakeWord") : null;

export const wakeStatus = () => (WakeWord ? WakeWord.status() : Promise.resolve(null));
export const startWake = () => WakeWord.start();
export const stopWake = () => WakeWord.stop();
export const openOverlaySettings = () => WakeWord?.openOverlaySettings();
export const openBatterySettings = () => WakeWord?.openBatterySettings();

// Hand the microphone to the app's own voice typing and take it back after.
export const pauseWake = () => (WakeWord ? WakeWord.pause().catch(() => {}) : Promise.resolve());
export const resumeWake = () => (WakeWord ? WakeWord.resume().catch(() => {}) : Promise.resolve());

// Called when the phrase is heard (also on a cold start opened by it).
export function onWake(cb) {
  if (!WakeWord) return () => {};
  const handle = WakeWord.addListener("wake", cb);
  return () => { handle.then((h) => h.remove()).catch(() => {}); };
}

// How "Hey TradeMind" answers: "voice" (floating card + spoken answer),
// "text" (floating card, silent) or "app" (open Ask AI); card at the
// "bottom" or "top" of the screen.
const PREFS_KEY = "tm.wakePrefs";
const DEFAULTS = { response: "voice", position: "bottom" };
export function getWakePrefs() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") }; } catch { return { ...DEFAULTS }; }
}
export function setWakePrefs(patch) {
  const next = { ...getWakePrefs(), ...patch };
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  syncWakeConfig();
  return next;
}

// Hands the floating assistant what it needs to answer without the app
// open: login token, server, answer style, listening language, voice speed,
// and the first name and app language for its greeting.
export function syncWakeConfig() {
  if (!WakeWord) return;
  let token = "";
  let userName = "";
  try {
    token = localStorage.getItem("token") || "";
    const u = JSON.parse(localStorage.getItem("user") || "null");
    userName = String(u?.name || u?.username || "").trim().split(/\s+/)[0] || "";
  } catch { /* ignore */ }
  const appLang = (document.documentElement.lang || "en").slice(0, 2);
  const { response, position } = getWakePrefs();
  WakeWord.setConfig({
    token, apiUrl: API_URL, response, position,
    userName, appLang, // the greeting: "Yes, Jonathan?" / "Naam, Jonathan?"
    micLocale: micLocale(savedMicLang(appLang)),
    speed: getSpeechPrefs().speed,
  }).catch(() => {});
}

// Tapped the floating answer card: open that conversation in Ask AI.
export function onOpenConversation(cb) {
  if (!WakeWord) return () => {};
  const handle = WakeWord.addListener("openConversation", (d) => cb(d?.id || ""));
  return () => { handle.then((h) => h.remove()).catch(() => {}); };
}
