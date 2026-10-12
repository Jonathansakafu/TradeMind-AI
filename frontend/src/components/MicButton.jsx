import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Capacitor } from "@capacitor/core";
import { SpeechRecognition as NativeRecognition } from "@capacitor-community/speech-recognition";
import { Mic, Square, Loader2 } from "lucide-react";

// 🎤 voice typing for Ask AI / the chat widget: speak in any of the app's
// languages and the words land in the text box (not sent -- the trader
// checks them first). Android app: the phone's Google speech dialog via
// @capacitor-community/speech-recognition (the WebView has no speech API).
// Browsers: the Web Speech API (Chrome, Edge, Safari); hidden where missing.

const isNative = Capacitor.isNativePlatform();
const WebRecognition = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);

const MIC_LANGS = [
  { code: "en", locale: "en-US", label: "English" },
  { code: "sw", locale: "sw-TZ", label: "Kiswahili" },
  { code: "fr", locale: "fr-FR", label: "Français" },
  { code: "ar", locale: "ar-SA", label: "العربية" },
  { code: "zh", locale: "zh-CN", label: "中文" },
  { code: "ko", locale: "ko-KR", label: "한국어" },
  { code: "ja", locale: "ja-JP", label: "日本語" },
];
const KEY = "tm.micLang";

function savedLang(appLang) {
  try {
    const s = localStorage.getItem(KEY);
    if (MIC_LANGS.some((l) => l.code === s)) return s;
  } catch { /* storage blocked */ }
  return MIC_LANGS.some((l) => l.code === appLang) ? appLang : "en";
}

const join = (base, add) => [base.trim(), add.trim()].filter(Boolean).join(" ");

function MicButton({ value, onChange, disabled, compact = false }) {
  const { i18n } = useTranslation();
  const [lang, setLang] = useState(() => savedLang((i18n.language || "en").slice(0, 2)));
  const [listening, setListening] = useState(false);
  const [menu, setMenu] = useState(null); // chip position while the language menu is open
  const [notice, setNotice] = useState(null);
  const rec = useRef(null);

  useEffect(() => {
    if (!notice) return undefined;
    const id = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(id);
  }, [notice]);
  useEffect(() => () => rec.current?.abort?.(), []);

  if (!isNative && !WebRecognition) return null;
  const current = MIC_LANGS.find((l) => l.code === lang) || MIC_LANGS[0];

  const pickLang = (code) => {
    setLang(code);
    setMenu(null);
    try { localStorage.setItem(KEY, code); } catch { /* ignore */ }
  };

  const startNative = async () => {
    const { available } = await NativeRecognition.available().catch(() => ({ available: false }));
    if (!available) return setNotice("Voice typing isn't available on this phone — install or update the Google app.");
    const perm = await NativeRecognition.requestPermissions().catch(() => null);
    if (perm?.speechRecognition !== "granted") return setNotice("Allow the microphone for TradeMind in your phone settings to use voice typing.");
    setListening(true);
    try {
      const res = await NativeRecognition.start({ language: current.locale, maxResults: 1, popup: true, partialResults: false, prompt: current.label });
      const text = res?.matches?.[0];
      if (text) onChange(join(value, text));
      else setNotice("Didn't catch that — tap 🎤 and try again.");
    } catch (err) {
      if (!/cancel/i.test(err?.message || "")) setNotice("Didn't catch that — tap 🎤 and try again.");
    } finally {
      setListening(false);
    }
  };

  const startWeb = () => {
    const r = new WebRecognition();
    r.lang = current.locale;
    r.interimResults = true;
    r.continuous = false;
    const base = value;
    r.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      onChange(join(base, text));
    };
    r.onerror = (e) => {
      const msg = {
        "not-allowed": "Microphone blocked — allow it for this site in your browser settings.",
        "service-not-allowed": "Microphone blocked — allow it for this site in your browser settings.",
        network: "Voice typing needs an internet connection.",
        "no-speech": "Didn't hear anything — tap 🎤 and speak.",
        "language-not-supported": `This browser can't type ${current.label} by voice — try Chrome.`,
      }[e.error];
      if (msg) setNotice(msg);
    };
    r.onend = () => { setListening(false); rec.current = null; };
    rec.current = r;
    setListening(true);
    try { r.start(); } catch { setListening(false); }
  };

  const toggle = () => {
    setNotice(null);
    if (listening) {
      if (isNative) NativeRecognition.stop().catch(() => {});
      else rec.current?.stop();
      return;
    }
    if (isNative) startNative();
    else startWeb();
  };

  const size = compact ? 14 : 16;

  return (
    <div className="relative flex items-stretch gap-1 flex-shrink-0">
      <button type="button" onClick={(e) => setMenu(menu ? null : e.currentTarget.getBoundingClientRect())} aria-label={`Voice typing language: ${current.label}`} aria-expanded={!!menu}
        className={`rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold ${compact ? "px-1.5 text-[10px]" : "px-2 text-xs"}`}>
        {current.code.toUpperCase()}
      </button>
      <button type="button" onClick={toggle} disabled={disabled && !listening}
        aria-label={listening ? "Stop voice typing" : `Speak your question (${current.label})`} aria-pressed={listening}
        className={`flex items-center justify-center rounded-xl transition disabled:opacity-50 ${compact ? "px-2.5" : "px-3.5"} ${listening ? "bg-red-500 text-white animate-pulse" : "bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-green-600 dark:text-green-400"}`}>
        {listening ? (isNative ? <Loader2 size={size} className="animate-spin" /> : <Square size={size} />) : <Mic size={size} />}
      </button>

      {menu && createPortal(
        <>
          <div className="fixed inset-0 z-[90]" onClick={() => setMenu(null)} />
          <div role="menu" dir="ltr"
            className="fixed z-[91] w-40 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-1"
            style={{ bottom: window.innerHeight - menu.top + 6, left: Math.max(8, Math.min(menu.left, window.innerWidth - 168)) }}>
            <p className="px-2 py-1 text-[11px] text-slate-500 dark:text-slate-400">I'll speak in…</p>
            {MIC_LANGS.map((l) => (
              <button key={l.code} type="button" role="menuitemradio" aria-checked={l.code === lang} onClick={() => pickLang(l.code)}
                className={`w-full text-left px-2 py-1.5 rounded-lg text-sm ${l.code === lang ? "bg-green-500/15 text-green-700 dark:text-green-400 font-semibold" : "text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"}`}>
                {l.label}
              </button>
            ))}
          </div>
        </>,
        document.body
      )}

      {notice && (
        <div role="status" dir="auto"
          className="absolute bottom-full mb-2 end-0 w-60 rounded-xl bg-slate-900 text-white dark:bg-slate-700 text-xs p-2.5 shadow-lg z-20">
          {notice}
        </div>
      )}
    </div>
  );
}

export default MicButton;
