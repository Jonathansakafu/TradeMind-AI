import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Volume2, VolumeX, Loader2 } from "lucide-react";
import useSpeech from "../hooks/useSpeech";
import { getSpeechPrefs, setSpeechPrefs, LANG_NAMES } from "../utils/speechPrefs";

// Reusable "read this aloud" icon button. Renders nothing if the device
// doesn't support speech at all. When the app language isn't English, the
// first tap asks whether to listen in English or that language (remembered;
// changeable in Settings -> Read aloud).
function SpeakButton({ text, className = "", size = 16 }) {
  const { speak, stop, speaking, preparing, notice, clearNotice, isSupported, appLang } = useSpeech();
  const [asking, setAsking] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(clearNotice, 6000);
    return () => clearTimeout(t);
  }, [notice, clearNotice]);

  if (!isSupported || !text) return null;

  const start = (mode) => speak(text, mode);
  const onClick = (e) => {
    e.stopPropagation();
    if (speaking) return stop();
    if (appLang === "en") return start("en");
    const choice = getSpeechPrefs().langChoice[appLang];
    if (!choice) return setAsking(true);
    start(choice);
  };
  const choose = (mode) => {
    setSpeechPrefs({ langChoice: { ...getSpeechPrefs().langChoice, [appLang]: mode } });
    setAsking(false);
    start(mode);
  };

  return (
    <span className="relative inline-flex">
      <button
        onClick={onClick}
        aria-label={speaking ? t("speech.stop") : t("speech.read")}
        className={`p-2 -m-2 rounded-lg text-slate-400 dark:text-slate-500 hover:text-green-600 dark:hover:text-green-400 transition flex-shrink-0 ${
          speaking ? "text-green-600 dark:text-green-400 animate-pulse" : ""
        } ${className}`}
      >
        {preparing ? <Loader2 size={size} className="animate-spin" /> : speaking ? <VolumeX size={size} /> : <Volume2 size={size} />}
      </button>

      {notice && (
        <span role="status" className="absolute z-50 top-full mt-2 right-0 w-60 rounded-xl bg-slate-900 text-white dark:bg-slate-700 text-xs p-2.5 shadow-xl font-normal leading-snug tracking-normal">
          {notice}
        </span>
      )}

      {/* Rendered at the page root: the button often sits inside a big
          bold page title, whose font the dialog would otherwise inherit. */}
      {asking && createPortal(
        <div className="fixed inset-0 z-[1100] flex items-end sm:items-center justify-center bg-black/50 p-4 text-base font-normal leading-normal tracking-normal"
          onClick={() => setAsking(false)}>
          <div role="dialog" aria-label={t("speech.question")} onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-5 text-left shadow-2xl">
            <p className="text-lg font-bold text-slate-900 dark:text-white mb-1">{t("speech.question")}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{t("speech.note")}</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => choose("native")} className="rounded-xl bg-green-500 hover:bg-green-600 text-slate-950 font-semibold text-base py-3">
                {LANG_NAMES[appLang] || appLang}
              </button>
              <button onClick={() => choose("en")} className="rounded-xl border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-100 font-semibold text-base py-3">
                English
              </button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-3">{t("speech.remember")}</p>
          </div>
        </div>,
        document.body
      )}
    </span>
  );
}

export default SpeakButton;
