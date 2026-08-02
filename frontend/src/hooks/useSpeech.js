import { useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";

// Thin wrapper around the browser's built-in speech synthesis (works inside
// the native app's WebView too, no extra plugin/API key needed). Picks a
// voice matching the current UI language if the device has one installed;
// falls back to the device default otherwise rather than failing silently.
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
    if (typeof window === "undefined" || !window.speechSynthesis || !text) return;
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
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  }, []);

  const isSupported = typeof window !== "undefined" && !!window.speechSynthesis;

  return { speak, stop, speaking, isSupported };
}

export default useSpeech;
