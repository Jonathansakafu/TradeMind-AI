import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Volume2 } from "lucide-react";
import { getSpeechPrefs, setSpeechPrefs, onSpeechPrefsChange, LANG_NAMES } from "../utils/speechPrefs";
import SpeakButton from "./SpeakButton";

// Settings card for the 🔊 read-aloud button: speed, and (for non-English
// app languages) whether to listen in English or the app language.
function ReadAloudSettings() {
  const { i18n } = useTranslation();
  const appLang = (i18n.language || "en").slice(0, 2);
  const [prefs, setPrefs] = useState(getSpeechPrefs);
  useEffect(() => onSpeechPrefsChange(setPrefs), []);

  const seg = (value, current, onClick, label) => (
    <button key={value} onClick={onClick} aria-pressed={current === value}
      className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${current === value ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow" : "text-slate-500 dark:text-slate-400"}`}>
      {label}
    </button>
  );
  const group = "inline-flex flex-wrap rounded-xl border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-100 dark:bg-slate-800";
  const langChoice = prefs.langChoice[appLang] || "ask";

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
      <h3 className="text-xl font-bold flex items-center gap-2 mb-2 text-slate-900 dark:text-white">
        <Volume2 size={20} className="text-green-600 dark:text-green-400" /> Read aloud
      </h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">For the 🔊 button. A male voice is used when your device has one.</p>
      <div className="space-y-4">
        <div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Speed</p>
          <div className={group}>
            {seg("slow", prefs.speed, () => setSpeechPrefs({ speed: "slow" }), "Slow & clear")}
            {seg("normal", prefs.speed, () => setSpeechPrefs({ speed: "normal" }), "Normal")}
          </div>
        </div>
        {appLang !== "en" && (
          <div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Listen in</p>
            <div className={group}>
              {seg("native", langChoice, () => setSpeechPrefs({ langChoice: { ...prefs.langChoice, [appLang]: "native" } }), LANG_NAMES[appLang] || appLang)}
              {seg("en", langChoice, () => setSpeechPrefs({ langChoice: { ...prefs.langChoice, [appLang]: "en" } }), "English")}
              {seg("ask", langChoice, () => { const lc = { ...prefs.langChoice }; delete lc[appLang]; setSpeechPrefs({ langChoice: lc }); }, "Ask me")}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Trading terms and numbers always stay in English so their meaning doesn't change.</p>
          </div>
        )}
        <div className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-300">
          <SpeakButton text="BUY gold. Entry 4194.6, stop loss 4180, take profit 4222. Risk to reward 1 to 2." size={20} />
          <span>Test the voice</span>
        </div>
      </div>
    </div>
  );
}

export default ReadAloudSettings;
