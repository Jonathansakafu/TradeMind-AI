import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import axios from "axios";
import MainLayout from "../layouts/MainLayout";
import { Save, User, Lock, CheckCircle, Palette, LogOut, BellRing, Wallet, Volume2, Mic, Moon, Sun, SunMoon } from "lucide-react";
import { API_URL } from "../config/api";
import SpeakButton from "../components/SpeakButton";
import AlertSettings from "../components/AlertSettings";
import SettingsSection from "../components/SettingsSection";
import { useTheme } from "../hooks/useTheme";
import { useRiskSettings } from "../hooks/useRiskSettings";
import { getSpeechPrefs, onSpeechPrefsChange } from "../utils/speechPrefs";

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "sw", label: "Kiswahili" },
  { code: "fr", label: "Français" },
  { code: "ar", label: "العربية" },
  { code: "zh", label: "中文" },
  { code: "ko", label: "한국어" },
  { code: "ja", label: "日本語" },
];
import RiskSettings from "../components/RiskSettings";
import ReadAloudSettings from "../components/ReadAloudSettings";
import WakeWordSettings from "../components/WakeWordSettings";
import { useAuth } from "../hooks/useAuth";

function Settings() {
  const { t, i18n } = useTranslation(["settings", "common"]);
  const { mode, setMode } = useTheme();
  const { settings: riskSettings } = useRiskSettings();
  const [openSection, setOpenSection] = useState(null);
  const [speech, setSpeech] = useState(getSpeechPrefs);
  useEffect(() => onSpeechPrefsChange(setSpeech), []);
  const readAloudSummary = `${speech.speed === "slow" ? "Slow & clear" : "Normal speed"} · ${speech.voice.en ? "your chosen voice" : "male voice when available"}`;
  const navigate = useNavigate();
  const { user, headers, logout, updateUser } = useAuth();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const [profile, setProfile] = useState({
    name: user.name || "",
    email: user.email || "",
  });

  const [password, setPassword] = useState({
    current: "", newPass: "", confirm: "",
  });

  const [profileMsg, setProfileMsg] = useState(null);
  const [passMsg, setPassMsg] = useState(null);
  const [loading, setLoading] = useState(false);

  const updateProfile = async () => {
    setLoading(true);
    try {
      const res = await axios.put(
        `${API_URL}/api/auth/profile`,
        { name: profile.name },
        { headers }
      );
      updateUser(res.data);
      setProfileMsg({ type: "success", text: t("profile.updated", { ns: "settings" }) });
    } catch (err) {
      setProfileMsg({ type: "error", text: err.response?.data?.message || t("profile.failed", { ns: "settings" }) });
    } finally {
      setLoading(false);
    }
  };

  const updatePassword = async () => {
    if (password.newPass !== password.confirm) {
      return setPassMsg({ type: "error", text: t("password.noMatch", { ns: "settings" }) });
    }
    if (password.newPass.length < 6) {
      return setPassMsg({ type: "error", text: t("password.tooShort", { ns: "settings" }) });
    }
    setLoading(true);
    try {
      await axios.put(
        `${API_URL}/api/auth/password`,
        { currentPassword: password.current, newPassword: password.newPass },
        { headers }
      );
      setPassMsg({ type: "success", text: t("password.updated", { ns: "settings" }) });
      setPassword({ current: "", newPass: "", confirm: "" });
    } catch (err) {
      setPassMsg({ type: "error", text: err.response?.data?.message || t("password.failed", { ns: "settings" }) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <MainLayout>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-slate-900 dark:text-white">{t("title", { ns: "settings" })}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("subtitle", { ns: "settings" })}</p>
        </div>
        <SpeakButton text={`${t("title", { ns: "settings" })}. ${t("subtitle", { ns: "settings" })}`} />
      </div>

      <div className="max-w-xl space-y-3">

        <SettingsSection id="appearance" icon={Palette} open={openSection === "appearance"} onToggle={setOpenSection}
          title={t("appearance", { ns: "settings" })}
          summary={`${t(`theme.${mode}`, { ns: "settings" })} · ${LANGUAGES.find((l) => l.code === i18n.resolvedLanguage)?.label || "English"}`}>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{t("theme.title", { ns: "settings" })}</p>
          <div className="grid grid-cols-3 gap-2 mb-4">
            {[["dark", Moon], ["light", Sun], ["auto", SunMoon]].map(([m, Icon]) => (
              <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m}
                className={`min-w-0 flex items-center justify-center gap-1 rounded-xl border px-1.5 py-2 text-xs sm:text-sm font-semibold transition ${mode === m ? "border-green-500 bg-green-500/10 text-green-700 dark:text-green-400" : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"}`}>
                <Icon size={14} className="flex-shrink-0" /> <span className="truncate">{t(`theme.${m}`, { ns: "settings" })}</span>
              </button>
            ))}
          </div>
          {mode === "auto" && <p className="text-xs text-slate-500 dark:text-slate-400 -mt-2 mb-4">{t("theme.autoNote", { ns: "settings" })}</p>}
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{t("language", { ns: "settings" })}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {LANGUAGES.map((l) => (
              <button key={l.code} onClick={() => i18n.changeLanguage(l.code)} aria-pressed={i18n.resolvedLanguage === l.code}
                className={`rounded-xl border px-2 py-2 text-sm font-semibold transition ${i18n.resolvedLanguage === l.code ? "border-green-500 bg-green-500/10 text-green-700 dark:text-green-400" : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"}`}>
                {l.label}
              </button>
            ))}
          </div>
        </SettingsSection>

        <SettingsSection id="alerts" icon={BellRing} open={openSection === "alerts"} onToggle={setOpenSection}
          title={t("alerts.title", { ns: "settings" })} summary={t("alerts.subtitle", { ns: "settings" })}>
          <AlertSettings />
        </SettingsSection>

        <SettingsSection id="risk" icon={Wallet} open={openSection === "risk"} onToggle={setOpenSection}
          title="Risk"
          summary={riskSettings?.balance ? `${riskSettings.currency} ${Number(riskSettings.balance).toLocaleString()} · ${riskSettings.riskPercent}% per trade · ${riskSettings.dailyLossLimitPercent}% daily limit` : "Set your balance to see lot sizes on signals"}>
          <RiskSettings />
        </SettingsSection>

        <SettingsSection id="read" icon={Volume2} open={openSection === "read"} onToggle={setOpenSection}
          title="Read aloud" summary={readAloudSummary}>
          <ReadAloudSettings />
        </SettingsSection>

        <SettingsSection id="wake" icon={Mic} open={openSection === "wake"} onToggle={setOpenSection}
          title="Hey TradeMind" summary="Call Ask AI by voice, even with the app closed">
          <WakeWordSettings />
        </SettingsSection>

        <SettingsSection id="profile" icon={User} open={openSection === "profile"} onToggle={setOpenSection}
          title={t("profile.title", { ns: "settings" })} summary={[user.name, user.email].filter(Boolean).join(" · ")}>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{t("profile.name", { ns: "settings" })}</label>
              <input type="text" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm rounded-xl outline-none focus:border-green-500 transition text-slate-900 dark:text-white" />
            </div>
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{t("profile.email", { ns: "settings" })}</label>
              <input type="email" value={profile.email} disabled className="w-full bg-slate-100/50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm rounded-xl text-slate-400 dark:text-slate-500 cursor-not-allowed" />
            </div>
            {profileMsg && (
              <p className={`text-sm ${profileMsg.type === "success" ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>{profileMsg.text}</p>
            )}
            <button onClick={updateProfile} disabled={loading} className="flex items-center gap-2 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-slate-950 font-semibold text-sm px-4 py-2 rounded-xl transition">
              <Save size={15} /> {t("profile.saveProfile", { ns: "settings" })}
            </button>
          </div>
        </SettingsSection>

        <SettingsSection id="password" icon={Lock} open={openSection === "password"} onToggle={setOpenSection}
          title={t("password.title", { ns: "settings" })}>
          <div className="space-y-3">
            {["current", "newPass", "confirm"].map((field) => (
              <div key={field}>
                <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">
                  {field === "current" ? t("password.current", { ns: "settings" })
                    : field === "newPass" ? t("password.new", { ns: "settings" })
                    : t("password.confirm", { ns: "settings" })}
                </label>
                <input type="password" value={password[field]} onChange={(e) => setPassword({ ...password, [field]: e.target.value })} className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm rounded-xl outline-none focus:border-green-500 transition text-slate-900 dark:text-white" />
              </div>
            ))}
            {passMsg && (
              <p className={`text-sm ${passMsg.type === "success" ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>{passMsg.text}</p>
            )}
            <button onClick={updatePassword} disabled={loading} className="flex items-center gap-2 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-slate-950 font-semibold text-sm px-4 py-2 rounded-xl transition">
              <CheckCircle size={15} /> {t("password.update", { ns: "settings" })}
            </button>
          </div>
        </SettingsSection>

        <button onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 font-semibold text-sm px-4 py-3 transition">
          <LogOut size={16} /> {t("account.logout", { ns: "settings" })}
        </button>

      </div>
    </MainLayout>
  );
}

export default Settings;