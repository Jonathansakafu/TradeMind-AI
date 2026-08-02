import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import axios from "axios";
import MainLayout from "../layouts/MainLayout";
import { Save, User, Lock, CheckCircle, Palette, LogOut } from "lucide-react";
import { API_URL } from "../config/api";
import ThemeToggle from "../components/ThemeToggle";
import LanguageToggle from "../components/LanguageToggle";
import SpeakButton from "../components/SpeakButton";

function Settings() {
  const { t } = useTranslation(["settings", "common"]);
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const token = localStorage.getItem("token");
  const headers = { Authorization: `Bearer ${token}` };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
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
      localStorage.setItem("user", JSON.stringify(res.data));
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
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-4xl font-bold text-slate-900 dark:text-white">{t("title", { ns: "settings" })}</h2>
          <p className="text-slate-500 dark:text-slate-400 mt-2">{t("subtitle", { ns: "settings" })}</p>
        </div>
        <SpeakButton text={`${t("title", { ns: "settings" })}. ${t("subtitle", { ns: "settings" })}`} />
      </div>

      <div className="max-w-xl space-y-6">

        {/* Appearance */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
          <h3 className="text-xl font-bold flex items-center gap-2 mb-6 text-slate-900 dark:text-white">
            <Palette size={20} className="text-green-600 dark:text-green-400" /> {t("appearance", { ns: "settings" })}
          </h3>
          <ThemeToggle variant="inline" />
          <div className="mt-4">
            <label className="text-sm text-slate-500 dark:text-slate-400 mb-1 block">{t("language", { ns: "settings" })}</label>
            <LanguageToggle />
          </div>
        </div>

        {/* Profile */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
          <h3 className="text-xl font-bold flex items-center gap-2 mb-6 text-slate-900 dark:text-white">
            <User size={20} className="text-green-600 dark:text-green-400" /> {t("profile.title", { ns: "settings" })}
          </h3>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-slate-500 dark:text-slate-400 mb-1 block">{t("profile.name", { ns: "settings" })}</label>
              <input
                type="text"
                value={profile.name}
                onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 rounded-xl outline-none focus:border-green-500 transition text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="text-sm text-slate-500 dark:text-slate-400 mb-1 block">{t("profile.email", { ns: "settings" })}</label>
              <input
                type="email"
                value={profile.email}
                disabled
                className="w-full bg-slate-100/50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-3 rounded-xl text-slate-400 dark:text-slate-500 cursor-not-allowed"
              />
            </div>
            {profileMsg && (
              <p className={`text-sm ${profileMsg.type === "success" ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
                {profileMsg.text}
              </p>
            )}
            <button
              onClick={updateProfile} disabled={loading}
              className="flex items-center gap-2 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-slate-950 font-bold px-6 py-3 rounded-xl transition"
            >
              <Save size={16} /> {t("profile.saveProfile", { ns: "settings" })}
            </button>
          </div>
        </div>

        {/* Password */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
          <h3 className="text-xl font-bold flex items-center gap-2 mb-6 text-slate-900 dark:text-white">
            <Lock size={20} className="text-green-600 dark:text-green-400" /> {t("password.title", { ns: "settings" })}
          </h3>
          <div className="space-y-4">
            {["current", "newPass", "confirm"].map((field) => (
              <div key={field}>
                <label className="text-sm text-slate-500 dark:text-slate-400 mb-1 block capitalize">
                  {field === "current" ? t("password.current", { ns: "settings" })
                    : field === "newPass" ? t("password.new", { ns: "settings" })
                    : t("password.confirm", { ns: "settings" })}
                </label>
                <input
                  type="password"
                  value={password[field]}
                  onChange={(e) => setPassword({ ...password, [field]: e.target.value })}
                  className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 rounded-xl outline-none focus:border-green-500 transition text-slate-900 dark:text-white"
                />
              </div>
            ))}
            {passMsg && (
              <p className={`text-sm ${passMsg.type === "success" ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
                {passMsg.text}
              </p>
            )}
            <button
              onClick={updatePassword} disabled={loading}
              className="flex items-center gap-2 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-slate-950 font-bold px-6 py-3 rounded-xl transition"
            >
              <CheckCircle size={16} /> {t("password.update", { ns: "settings" })}
            </button>
          </div>
        </div>

        {/* Account */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
          <h3 className="text-xl font-bold flex items-center gap-2 mb-6 text-slate-900 dark:text-white">
            <LogOut size={20} className="text-red-500 dark:text-red-400" /> {t("account.title", { ns: "settings" })}
          </h3>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-500 dark:text-red-400 font-bold px-6 py-3 rounded-xl transition"
          >
            <LogOut size={16} /> {t("account.logout", { ns: "settings" })}
          </button>
        </div>

      </div>
    </MainLayout>
  );
}

export default Settings;