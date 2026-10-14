import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Capacitor } from "@capacitor/core";
import { SpeechRecognition as NativeRecognition } from "@capacitor-community/speech-recognition";
import { Mic, X } from "lucide-react";
import { pauseWake, resumeWake } from "../utils/wakeWord";

// 🎤 voice typing for Ask AI / the chat widget: speak in any of the app's
// languages and the words land in the text box (not sent -- the trader
// checks them first). While listening a full-screen glowing orb with the
// live transcript shows (Siri-style). Android app: Google's recogniser
// without its pop-up via @capacitor-community/speech-recognition (the
// WebView has no speech API). Browsers: the Web Speech API (Chrome, Edge,
// Safari); hidden where missing.

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

// autoStart: a changing key starts listening by itself ("Hey TradeMind");
// what is heard then goes to onAutoResult (sent straight away) if given.
function MicButton({ value, onChange, disabled, compact = false, autoStart = null, onAutoResult = null }) {
  const { i18n } = useTranslation();
  const [lang, setLang] = useState(() => savedLang((i18n.language || "en").slice(0, 2)));
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [lively, setLively] = useState(false); // words arriving -> orb livens up
  const [menu, setMenu] = useState(null); // chip position while the language menu is open
  const [notice, setNotice] = useState(null);
  const session = useRef(null); // the current listening run
  const livelyTimer = useRef(null);

  useEffect(() => {
    if (!notice) return undefined;
    const id = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(id);
  }, [notice]);
  useEffect(() => () => { session.current?.abort(); clearTimeout(livelyTimer.current); }, []);

  const supported = isNative || !!WebRecognition;
  const current = MIC_LANGS.find((l) => l.code === lang) || MIC_LANGS[0];

  const pickLang = (code) => {
    setLang(code);
    setMenu(null);
    try { localStorage.setItem(KEY, code); } catch { /* ignore */ }
  };

  // Shared ending for both engines: deliver what was heard (unless
  // cancelled), close the orb and give the microphone back.
  const begin = (auto) => {
    const base = value;
    const run = { last: "", done: false, cancelled: false, timers: [], cleanup: [] };
    run.update = (text) => {
      run.last = text;
      setHeard(text);
      setLively(true);
      clearTimeout(livelyTimer.current);
      livelyTimer.current = setTimeout(() => setLively(false), 700);
      if (!(auto && onAutoResult)) onChange(join(base, text));
    };
    run.finish = (problem) => {
      if (run.done) return;
      run.done = true;
      run.timers.forEach(clearTimeout);
      run.cleanup.forEach((fn) => fn());
      session.current = null;
      setListening(false);
      setHeard("");
      resumeWake();
      if (run.cancelled) return onChange(base);
      const text = run.last.trim();
      if (text) {
        if (auto && onAutoResult) onAutoResult(text);
        else onChange(join(base, text));
      } else if (problem !== false) {
        setNotice(problem || "Didn't catch that — tap 🎤 and try again.");
      }
    };
    run.later = (ms, fn) => { const id = setTimeout(fn, ms); run.timers.push(id); return id; };
    session.current = run;
    setHeard("");
    setNotice(null);
    setListening(true);
    return run;
  };

  const startNative = async (auto = false) => {
    const { available } = await NativeRecognition.available().catch(() => ({ available: false }));
    if (!available) return setNotice("Voice typing isn't available on this phone — install or update the Google app.");
    const perm = await NativeRecognition.requestPermissions().catch(() => null);
    if (perm?.speechRecognition !== "granted") return setNotice("Allow the microphone for TradeMind in your phone settings to use voice typing.");
    const run = begin(auto);
    await pauseWake(); // the "Hey TradeMind" listener lets go of the microphone
    // In live-text mode the plugin says "stopped" before the final words
    // arrive and can't report errors (silence...), so endings are timed:
    // ~1.2 s after speech ends (sooner once the final words come), 8 s
    // with nothing said, 30 s at most.
    let endTimer = null;
    const endIn = (ms) => { clearTimeout(endTimer); endTimer = run.later(ms, () => run.finish()); };
    run.stop = () => { NativeRecognition.stop().catch(() => {}); endIn(1500); };
    run.abort = () => { run.cancelled = true; NativeRecognition.stop().catch(() => {}); run.finish(); };
    let spoke = false;
    let ended = false;
    const p1 = await NativeRecognition.addListener("partialResults", (d) => {
      const text = d?.matches?.[0];
      if (!text) return;
      spoke = true;
      run.update(text);
      if (ended) endIn(400);
    });
    const p2 = await NativeRecognition.addListener("listeningState", (d) => {
      if (d?.status === "started") spoke = true;
      if (d?.status === "stopped") { ended = true; endIn(1200); }
    });
    run.cleanup.push(() => p1.remove(), () => p2.remove());
    run.later(8000, () => { if (!spoke) { NativeRecognition.stop().catch(() => {}); run.finish("Didn't hear anything — tap 🎤 and speak."); } });
    run.later(30000, () => run.stop());
    try {
      await NativeRecognition.start({ language: current.locale, maxResults: 1, popup: false, partialResults: true });
    } catch {
      run.finish();
    }
  };

  const startWeb = (auto = false) => {
    const r = new WebRecognition();
    r.lang = current.locale;
    r.interimResults = true;
    r.continuous = false;
    const run = begin(auto);
    let problem;
    run.stop = () => r.stop();
    run.abort = () => { run.cancelled = true; try { r.abort(); } catch { /* ended */ } run.finish(); };
    r.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      run.update(text);
    };
    r.onerror = (e) => {
      problem = {
        "not-allowed": "Microphone blocked — allow it for this site in your browser settings.",
        "service-not-allowed": "Microphone blocked — allow it for this site in your browser settings.",
        network: "Voice typing needs an internet connection.",
        "no-speech": "Didn't hear anything — tap 🎤 and speak.",
        "language-not-supported": `This browser can't type ${current.label} by voice — try Chrome.`,
        aborted: false,
      }[e.error];
    };
    r.onend = () => run.finish(problem);
    try { r.start(); } catch { run.finish(false); }
  };

  const toggle = () => {
    if (session.current) return session.current.stop();
    if (isNative) startNative();
    else startWeb();
  };

  useEffect(() => {
    if (!autoStart || !supported) return undefined;
    const id = setTimeout(() => (isNative ? startNative(true) : startWeb(true)), 400);
    return () => clearTimeout(id);
    // Only when a new wake-up arrives, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  if (!supported) return null;
  const size = compact ? 14 : 16;

  return (
    <div className="relative flex items-stretch gap-1 flex-shrink-0">
      <button type="button" onClick={(e) => setMenu(menu ? null : e.currentTarget.getBoundingClientRect())} aria-label={`Voice typing language: ${current.label}`} aria-expanded={!!menu}
        className={`rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold ${compact ? "px-1.5 text-[10px]" : "px-2 text-xs"}`}>
        {current.code.toUpperCase()}
      </button>
      <button type="button" onClick={toggle} disabled={disabled && !listening}
        aria-label={listening ? "Stop voice typing" : `Speak your question (${current.label})`} aria-pressed={listening}
        className={`flex items-center justify-center rounded-xl transition disabled:opacity-50 ${compact ? "px-2.5" : "px-3.5"} bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-green-600 dark:text-green-400`}>
        {listening ? <Orb size={compact ? 16 : 20} /> : <Mic size={size} />}
      </button>

      {listening && createPortal(
        <div className="fixed inset-0 z-[1000] flex flex-col items-center justify-end bg-slate-950/75 backdrop-blur-md tm-fade-in"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 3rem)" }} role="dialog" aria-label="Listening">
          <button type="button" onClick={() => session.current?.abort()} aria-label="Cancel"
            className="absolute end-4 rounded-full p-2 text-white/70 hover:text-white bg-white/10"
            style={{ top: "calc(env(safe-area-inset-top) + 1rem)" }}>
            <X size={20} />
          </button>
          <p dir="auto" aria-live="polite"
            className={`px-6 mb-10 max-w-xl text-center font-semibold leading-snug ${heard ? "text-white text-2xl" : "text-white/60 text-xl"}`}>
            {heard || "Listening…"}
          </p>
          <button type="button" onClick={() => session.current?.stop()} aria-label="Done speaking" className="rounded-full focus:outline-none">
            <Orb size={132} lively={lively} />
          </button>
          <p dir="ltr" className="mt-6 px-6 text-center text-xs text-white/60">Speak in {current.label} · tap the orb when you're done</p>
        </div>,
        document.body
      )}

      {menu && createPortal(
        <>
          <div className="fixed inset-0 z-[1001]" onClick={() => setMenu(null)} />
          <div role="menu" dir="ltr"
            className="fixed z-[1002] w-40 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-1"
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

// Glowing, slowly swirling orb (styles: .tm-orb in index.css).
function Orb({ size, lively = false }) {
  return (
    <span className={`tm-orb ${lively ? "tm-orb-lively" : ""}`} style={{ "--s": `${size}px` }} aria-hidden="true">
      <span /><span /><span /><span />
    </span>
  );
}

export default MicButton;
