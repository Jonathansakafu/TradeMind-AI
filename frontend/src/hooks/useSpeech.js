import { useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Capacitor } from "@capacitor/core";
import { TextToSpeech } from "@capacitor-community/text-to-speech";

// `window.speechSynthesis` (the browser Web Speech API) is what the website
// uses, but Android's Capacitor WebView doesn't reliably expose it -- on a
// real device it's simply undefined, so the old implementation silently
// hid the "read aloud" button in the native app while it worked fine on
// the website. `@capacitor-community/text-to-speech` wraps the actual
// native Android/iOS TTS engines instead, so it works inside the app too.
const isNative = Capacitor.isNativePlatform();

function useSpeech() {
  const { i18n } = useTranslation();
  const [speaking, setSpeaking] = useState(false);
  const utteranceRef = useRef(null);

  const pickVoice = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return null;
    const voices = window.speechSynthesis.getVoices();
    return voices.find((v) => v.lang.toLowerCase().startsWith(i18n.language)) || null;
  }, [i18n.language]);

  const speak = useCallback((text) => {
    if (!text) return;

    if (isNative) {
      setSpeaking(true);
      TextToSpeech.speak({ text, lang: i18n.language })
        .catch(() => {})
        .finally(() => setSpeaking(false));
      return;
    }

    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang || i18n.language;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);

    utteranceRef.current = utterance;
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }, [pickVoice, i18n.language]);

  const stop = useCallback(() => {
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
