import { useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Capacitor } from "@capacitor/core";
import { TextToSpeech } from "@capacitor-community/text-to-speech";
import { speechChunks } from "../utils/speechText";

// `window.speechSynthesis` (the browser Web Speech API) is what the website
// uses, but Android's Capacitor WebView doesn't reliably expose it -- on a
// real device it's simply undefined, so the old implementation silently
// hid the "read aloud" button in the native app while it worked fine on
// the website. `@capacitor-community/text-to-speech` wraps the actual
// native Android/iOS TTS engines instead, so it works inside the app too.
const isNative = Capacitor.isNativePlatform();

// App language -> speech locale. If the phone/browser has no voice for it
// (common for Swahili), English is used instead of staying silent -- the
// old code swallowed that error and nothing was read at all.
const LOCALES = { en: "en-US", sw: "sw-KE", fr: "fr-FR", ar: "ar-SA" };

// Languages the phone turned down this session -> spoken in English
// straight away next time instead of failing first again.
const unsupported = new Set();

function useSpeech() {
  const { i18n } = useTranslation();
  const [speaking, setSpeaking] = useState(false);
  const cancelled = useRef(false);

  const appLang = (i18n.language || "en").slice(0, 2);
  const locale = LOCALES[appLang] || "en-US";

  const pickVoice = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return null;
    const voices = window.speechSynthesis.getVoices();
    return voices.find((v) => v.lang.toLowerCase().startsWith(appLang))
      || voices.find((v) => v.lang.toLowerCase().startsWith("en"))
      || null;
  }, [appLang]);

  // Speaks straight away -- no separate "is this language supported?"
  // round trip first (that waited on the TTS engine and delayed every
  // start); the plugin's speak() rejects at once for a missing voice, and
  // only then is English used (and remembered for the session).
  const speakNative = useCallback(async (chunks) => {
    let lang = unsupported.has(locale) ? "en-US" : locale;
    for (const chunk of chunks) {
      if (cancelled.current) break;
      try {
        await TextToSpeech.speak({ text: chunk, lang, rate: 1.0 });
      } catch {
        if (lang === "en-US" || cancelled.current) break;
        unsupported.add(lang);
        lang = "en-US";
        await TextToSpeech.speak({ text: chunk, lang }).catch(() => {});
      }
    }
  }, [locale]);

  const speakWeb = useCallback((chunks) => new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const voice = pickVoice();
    let i = 0;
    const next = () => {
      if (cancelled.current || i >= chunks.length) return resolve();
      const u = new SpeechSynthesisUtterance(chunks[i++]);
      if (voice) u.voice = voice;
      u.lang = voice?.lang || locale;
      u.onend = next;
      u.onerror = next;
      synth.speak(u);
    };
    // Chrome can delay or drop speech queued right after cancel() -- only
    // cancel when something is actually playing.
    if (synth.speaking || synth.pending) synth.cancel();
    next();
  }), [pickVoice, locale]);

  const speak = useCallback(async (text) => {
    const chunks = speechChunks(text);
    if (!chunks.length) return;
    cancelled.current = false;
    setSpeaking(true);
    try {
      if (isNative) await speakNative(chunks);
      else if (typeof window !== "undefined" && window.speechSynthesis) await speakWeb(chunks);
    } finally {
      setSpeaking(false);
    }
  }, [speakNative, speakWeb]);

  const stop = useCallback(() => {
    cancelled.current = true;
    if (isNative) {
      TextToSpeech.stop().catch(() => {});
    } else if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  }, []);

  const isSupported = isNative || (typeof window !== "undefined" && !!window.speechSynthesis);

  return { speak, stop, speaking, isSupported };
}

export default useSpeech;
