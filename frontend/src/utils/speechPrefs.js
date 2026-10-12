// Read-aloud preferences, per device (localStorage): speed, and for each
// non-English app language whether to listen in English or that language.
const KEY = "speech.prefs";
const listeners = new Set();

export const SPEEDS = { slow: 0.8, normal: 0.95 };
export const LANG_NAMES = { sw: "Kiswahili", fr: "Français", ar: "العربية", en: "English" };

export function getSpeechPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { speed: p.speed === "normal" ? "normal" : "slow", langChoice: p.langChoice || {}, voice: p.voice || {} };
  } catch {
    return { speed: "slow", langChoice: {}, voice: {} };
  }
}

export function setSpeechPrefs(patch) {
  const next = { ...getSpeechPrefs(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  listeners.forEach((fn) => fn(next));
  return next;
}

export function onSpeechPrefsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
