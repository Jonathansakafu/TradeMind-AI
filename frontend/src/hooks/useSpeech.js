import { useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import axios from "axios";
import { Capacitor } from "@capacitor/core";
import { TextToSpeech } from "@capacitor-community/text-to-speech";
import { speechChunks } from "../utils/speechText";
import { getSpeechPrefs, SPEEDS, LANG_NAMES } from "../utils/speechPrefs";
import { loadVoices, pickVoice } from "../utils/voices";
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
const LOCALES = { en: "en-US", sw: "sw-KE", fr: "fr-FR", ar: "ar-SA", zh: "zh-CN", ko: "ko-KR", ja: "ja-JP" };

function useSpeech() {
  const { i18n, t } = useTranslation();
  const { headers } = useAuth();
  const [speaking, setSpeaking] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [notice, setNotice] = useState(null);
  const cancelled = useRef(false);

  const appLang = (i18n.language || "en").slice(0, 2);

  // Chosen voice for a language: the user's pick (Settings) or a male
  // on-device voice; pitch is lowered only when no male voice exists.
  const voiceFor = useCallback(async (lang) => {
    const voices = await loadVoices();
    const prefix = lang.slice(0, 2).toLowerCase();
    const v = pickVoice(voices, prefix, getSpeechPrefs().voice[prefix]);
    return { v, any: voices.some((x) => x.lang.toLowerCase().startsWith(prefix)) };
  }, []);

  const speakNative = useCallback(async (chunks, lang, rate) => {
    const { v, any } = await voiceFor(lang);
    if (!any && lang !== "en-US") return false; // no voice for this language
    const opts = { lang: v?.lang || lang, rate, pitch: v?.male ? 1.0 : 0.85, ...(v ? { voice: v.index } : {}) };
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
  }, [voiceFor]);

  const speakWeb = useCallback(async (chunks, lang, rate) => {
    const { v, any } = await voiceFor(lang);
    if (!any && !lang.startsWith("en")) return false;
    const synth = window.speechSynthesis;
    return new Promise((resolve) => {
      let i = 0;
      const next = () => {
        if (cancelled.current || i >= chunks.length) return resolve(true);
        const u = new SpeechSynthesisUtterance(chunks[i++]);
        if (v?.raw) u.voice = v.raw;
        u.lang = v?.lang || lang;
        u.rate = rate;
        u.pitch = v?.male ? 1.0 : 0.85;
        u.onend = next;
        u.onerror = next;
        synth.speak(u);
      };
      // Chrome can delay or drop speech queued right after cancel() -- only
      // cancel when something is actually playing.
      if (synth.speaking || synth.pending) synth.cancel();
      next();
    });
  }, [voiceFor]);

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

  // Reads text that is already in the right language (e.g. an answer to a
  // voice question, which comes back in the language spoken).
  const speakAs = useCallback(async (text, locale) => {
    if (!text) return;
    cancelled.current = false;
    setNotice(null);
    setSpeaking(true);
    try {
      const ok = await run(speechChunks(text), locale, SPEEDS[getSpeechPrefs().speed]);
      if (!ok) setNotice(t("speech.noVoice", { lang: LANG_NAMES[locale.slice(0, 2)] || locale }));
    } finally {
      setSpeaking(false);
    }
  }, [run, t]);

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

  return { speak, speakAs, stop, speaking, preparing, notice, clearNotice, isSupported, appLang };
}

export default useSpeech;
