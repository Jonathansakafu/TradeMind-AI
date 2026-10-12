import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getSpeechPrefs, setSpeechPrefs, onSpeechPrefsChange, LANG_NAMES } from "../utils/speechPrefs";
import { loadVoices, voicesFor, pickVoice } from "../utils/voices";
import SpeakButton from "./SpeakButton";

// Settings card for the 🔊 read-aloud button: speed, and (for non-English
// app languages) whether to listen in English or the app language.
function ReadAloudSettings() {
  const { i18n } = useTranslation();
  const appLang = (i18n.language || "en").slice(0, 2);
  const [prefs, setPrefs] = useState(getSpeechPrefs);
  const [voices, setVoices] = useState([]);
  useEffect(() => onSpeechPrefsChange(setPrefs), []);
  useEffect(() => { loadVoices().then(setVoices).catch(() => {}); }, []);
  const english = voicesFor(voices, "en");
  const current = pickVoice(voices, "en", prefs.voice.en);
  const setVoice = (id) => setSpeechPrefs({ voice: { ...prefs.voice, en: id || undefined } });

  const seg = (value, current, onClick, label) => (
    <button key={value} onClick={onClick} aria-pressed={current === value}
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${current === value ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow" : "text-slate-500 dark:text-slate-400"}`}>
      {label}
    </button>
  );
  const group = "inline-flex flex-wrap rounded-xl border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-100 dark:bg-slate-800";
  const langChoice = prefs.langChoice[appLang] || "ask";

  return (
    <div>
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
            {voices.length > 0 && (() => {
              const v = pickVoice(voices, appLang, prefs.voice[appLang]);
              return v ? (
                <p className="text-xs text-green-700 dark:text-green-400 mt-1">✓ {LANG_NAMES[appLang]} voice on this device: {v.name}{v.local ? "" : " (online — needs internet)"}</p>
              ) : (
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">✗ This device has no {LANG_NAMES[appLang]} voice, so it reads in English. Add one: phone Settings → Accessibility → Text-to-speech → Preferred engine (Google) → ⚙ → Install voice data → {LANG_NAMES[appLang]}. Then reopen TradeMind.</p>
              );
            })()}
          </div>
        )}
        {english.length > 0 && (
          <div>
            <label className="text-sm text-slate-500 dark:text-slate-400 mb-1 block" htmlFor="tm-voice">Voice</label>
            <select id="tm-voice" value={prefs.voice.en || ""} onChange={(e) => setVoice(e.target.value)}
              className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2 rounded-xl text-slate-900 dark:text-white text-sm">
              <option value="">Automatic — {current ? `${current.male ? "male" : "default"} voice (${current.name})` : "device default"}</option>
              {english.map((v) => (
                <option key={v.id} value={v.id}>{v.male ? "♂ Male · " : ""}{v.name} · {v.lang}{v.local ? "" : " · online (slower to start)"}</option>
              ))}
            </select>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {english.some((v) => v.male) ? "Male voices are marked ♂ and listed first." : "No male voice was found on this device — the app lowers the pitch instead. You can download more voices in your phone's text-to-speech settings."} Pick one and press the 🔊 below to test it.
            </p>
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
