import { Capacitor } from "@capacitor/core";
import { TextToSpeech } from "@capacitor-community/text-to-speech";

// Device voices for read-aloud, shared by useSpeech and the Settings voice
// picker. Loaded once at app start (warmUpVoices) so the first tap on 🔊
// doesn't wait for it.
const isNative = Capacitor.isNativePlatform();

// Male voices: Google TTS codes (en-gb-x-rjs, en-us-x-iom...) and its
// "#male_1" variants, Samsung "SMTm", and known male names on Windows /
// macOS / Chrome. "male" must not be the end of "female".
const MALE_CODE = /-x-(iol|iom|tpd|gbb|gbd|rjs|aub|aud|enc|end|frb|frd|ard|arz)\b|smtm\d/i;
const MALE_WORD = /(^|[^e])male/i;
const MALE_NAME = /david|mark\b|guy\b|daniel|alex\b|fred\b|aaron|arthur|george|ryan|james|thomas|oliver|rishi|maged|tarik|andrew|brian|christopher|eric\b|roger|william|liam|henri|paul\b/i;
export function isMaleVoice(v) {
  const id = `${v.voiceURI || ""} ${v.name || ""}`;
  if (/female/i.test(id) && !MALE_WORD.test(id.replace(/female/gi, ""))) return false;
  return MALE_CODE.test(id) || MALE_WORD.test(id) || MALE_NAME.test(v.name || "");
}

let cache = null;
let loading = null;

// [{ id, name, lang, local, male, index }] -- index is the native plugin's
// voice index (its list order).
export function loadVoices() {
  if (cache) return Promise.resolve(cache);
  if (loading) return loading;
  loading = (async () => {
    let raw = [];
    if (isNative) {
      try { raw = (await TextToSpeech.getSupportedVoices()).voices || []; } catch { raw = []; }
    } else if (typeof window !== "undefined" && window.speechSynthesis) {
      raw = window.speechSynthesis.getVoices();
      if (!raw.length) {
        // Chrome fills the list asynchronously.
        raw = await new Promise((resolve) => {
          const done = () => resolve(window.speechSynthesis.getVoices());
          window.speechSynthesis.addEventListener?.("voiceschanged", done, { once: true });
          setTimeout(done, 1500);
        });
      }
    }
    cache = raw.map((v, index) => ({
      id: v.voiceURI || v.name,
      name: v.name || v.voiceURI,
      lang: (v.lang || "").replace("_", "-"),
      local: v.localService !== false,
      male: isMaleVoice(v),
      index,
      raw: isNative ? null : v,
    }));
    loading = null;
    return cache;
  })();
  return loading;
}

export const warmUpVoices = () => { loadVoices().catch(() => {}); };

// Best voice for a language: the user's saved pick if present, else a
// male ON-DEVICE voice (online voices download speech first -> slow start),
// else any on-device voice for that language.
export function pickVoice(voices, langPrefix, savedId) {
  const same = voices.filter((v) => v.lang.toLowerCase().startsWith(langPrefix));
  const saved = savedId && same.find((v) => v.id === savedId);
  if (saved) return saved;
  const local = same.filter((v) => v.local);
  return local.find((v) => v.male) || (isNative ? null : same.find((v) => v.male))
    || local.find((v) => /en-gb|en-us/i.test(v.lang)) || local[0]
    // No offline voice for this language (common for Arabic / Kiswahili):
    // an online one is slower to start but better than falling back to English.
    || same.find((v) => v.male) || same[0] || null;
}

export function voicesFor(voices, langPrefix) {
  return voices
    .filter((v) => v.lang.toLowerCase().startsWith(langPrefix))
    .sort((a, b) => Number(b.male) - Number(a.male) || Number(b.local) - Number(a.local) || a.name.localeCompare(b.name));
}
