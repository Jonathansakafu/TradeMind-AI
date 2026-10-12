import { useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import axios from "axios";
import { Capacitor } from "@capacitor/core";
import { TextToSpeech } from "@capacitor-community/text-to-speech";
import { speechChunks } from "../utils/speechText";
import { getSpeechPrefs, SPEEDS, LANG_NAMES } from "../utils/speechPrefs";
import { API_URL } from "../config/api";
import { useAuth } from "./useAuth";

// Read-aloud for the website (Web Speech API) and the Android app
// (@capacitor-community/text-to-speech, the phone's own TTS engine).
// - A male voice wherever the device has one; otherwise a slightly lower
//   pitch. Slow by default so every word is clear (Settings -> Read aloud).
// - Non-English app languages: the user picks English or their language
//   (asked once by SpeakButton). Their language = the text is translated
//   on the server with trading terms kept in English, then read with that
//   language's voice; if the device has no such voice, English is read
//   and the user is told why.
const isNative = Capacitor.isNativePlatform();
const LOCALES = { en: "en-US", sw: "sw-KE", fr: "fr-FR", ar: "ar-SA" };

// Male voices: Google TTS codes (en-gb-x-rjs, en-us-x-iom, fr-fr-x-frd,
// ar-xa-x-ard...), Samsung (SMTm00), and well-known male voice names on
// Windows / macOS / Chrome.
const MALE_CODE = /-x-(iol|iom|tpd|gbb|gbd|rjs|aub|aud|enc|end|frb|frd|ard|arz)[-_]|smtm\d/i;
const MALE_NAME = /\bmale\b|david|mark|guy|daniel|alex\b|fred|aaron|arthur|george|ryan|james|thomas|oliver|rishi|maged|tarik|andrew|brian|christopher|eric|roger|william|liam|henri|paul\b/i;
const isMale = (v) => !/female/i.test(v.name || v.voiceURI || "") && (MALE_CODE.test(v.voiceURI || v.name || "") || MALE_NAME.test(v.name || ""));

let nativeVoices = null; // cached getSupportedVoices() result
async function nativeVoiceFor(lang) {
  if (!nativeVoices) {
    try { nativeVoices = (await TextToSpeech.getSupportedVoices()).voices || []; } catch { nativeVoices = []; }
  }
  const prefix = lang.slice(0, 2).toLowerCase();
  const same = nativeVoices.map((v, i) => ({ v, i })).filter(({ v }) => (v.lang || "").toLowerCase().replace("_", "-").startsWith(prefix));
  const male = same.find(({ v }) => isMale(v) && v.localService) || same.find(({ v }) => isMale(v));
  return { index: male?.i, male: !!male, any: same.length > 0 };
}

function webVoiceFor(prefix) {
  const voices = window.speechSynthesis.getVoices();
  const same = voices.filter((v) => v.lang.toLowerCase().startsWith(prefix));
  const male = same.find(isMale);
  return { voice: male || same.find((v) => /en-gb|en-us/i.test(v.lang)) || same[0] || null, male: !!male, any: same.length > 0 };
}

function useSpeech() {
  const { i18n, t } = useTranslation();
  const { headers } = useAuth();
  const [speaking, setSpeaking] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [notice, setNotice] = useState(null);
  const cancelled = useRef(false);

  const appLang = (i18n.language || "en").slice(0, 2);

  const speakNative = useCallback(async (chunks, lang, rate) => {
    const { index, male, any } = await nativeVoiceFor(lang);
    if (!any && lang !== "en-US") return false; // no voice for this language
    const opts = { lang, rate, pitch: male ? 1.0 : 0.85, ...(index != null ? { voice: index } : {}) };
    for (const chunk of chunks) {
      if (cancelled.current) break;
      try {
        await TextToSpeech.speak({ text: chunk, ...opts });
      } catch {
        if (lang !== "en-US") return false;
        break;
      }
    }
    return true;
  }, []);

  const speakWeb = useCallback((chunks, lang, rate) => new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const { voice, male, any } = webVoiceFor(lang.slice(0, 2).toLowerCase());
    if (!any && !lang.startsWith("en")) return resolve(false);
    let i = 0;
    const next = () => {
      if (cancelled.current || i >= chunks.length) return resolve(true);
      const u = new SpeechSynthesisUtterance(chunks[i++]);
      if (voice) u.voice = voice;
      u.lang = voice?.lang || lang;
      u.rate = rate;
      u.pitch = male ? 1.0 : 0.85;
      u.onend = next;
      u.onerror = next;
      synth.speak(u);
    };
    // Chrome can delay or drop speech queued right after cancel() -- only
    // cancel when something is actually playing.
    if (synth.speaking || synth.pending) synth.cancel();
    next();
  }), []);

  const run = useCallback(async (chunks, lang, rate) => {
    if (isNative) return speakNative(chunks, lang, rate);
    if (typeof window !== "undefined" && window.speechSynthesis) return speakWeb(chunks, lang, rate);
    return false;
  }, [speakNative, speakWeb]);

  // mode: "en" | "native" (the app language). Returns false if nothing ran.
  const speak = useCallback(async (text, mode = "en") => {
    if (!text) return;
    const { speed } = getSpeechPrefs();
    const rate = SPEEDS[speed];
    cancelled.current = false;
    setNotice(null);
    setSpeaking(true);
    try {
      if (mode === "native" && appLang !== "en") {
        setPreparing(true);
        let translated = null;
        try {
          const res = await axios.post(`${API_URL}/api/ai/speech-translate`, { text, lang: appLang }, { headers });
          translated = res.data.text;
        } catch {
          setNotice(t("speech.noTranslate"));
        } finally {
          setPreparing(false);
        }
        if (cancelled.current) return;
        if (translated) {
          const ok = await run(speechChunks(translated), LOCALES[appLang], rate);
          if (ok) return;
          setNotice(t("speech.noVoice", { lang: LANG_NAMES[appLang] }));
        }
      }
      await run(speechChunks(text), "en-US", rate);
    } finally {
      setSpeaking(false);
      setPreparing(false);
    }
  }, [appLang, headers, run, t]);

  const stop = useCallback(() => {
    cancelled.current = true;
    if (isNative) {
      TextToSpeech.stop().catch(() => {});
    } else if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
    setPreparing(false);
  }, []);

  const isSupported = isNative || (typeof window !== "undefined" && !!window.speechSynthesis);

  const clearNotice = useCallback(() => setNotice(null), []);

  return { speak, stop, speaking, preparing, notice, clearNotice, isSupported, appLang };
}

export default useSpeech;
