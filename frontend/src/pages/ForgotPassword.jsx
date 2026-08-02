import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import axios from "axios";
import { API_URL } from "../config/api";

function ForgotPassword() {
  const { t } = useTranslation(["auth", "common"]);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  const handleSubmit = async () => {
    if (!email) {
      setMessage({ type: "error", text: t("forgotPassword.enterEmail", { ns: "auth" }) });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const res = await axios.post(`${API_URL}/api/auth/forgot-password`, { email });
      setMessage({ type: "success", text: res.data.message });
    } catch (error) {
      setMessage({ type: "error", text: error.response?.data?.message || t("errors.somethingWrong", { ns: "common" }) });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleSubmit();
  };

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 flex items-center justify-center text-slate-900 dark:text-white px-4">
      <div className="bg-white dark:bg-slate-900 p-10 rounded-2xl w-full max-w-md shadow-xl">
        <h1 className="text-4xl font-bold text-center text-green-600 dark:text-green-400 mb-8">
          {t("appName", { ns: "common" })}
        </h1>
        <h2 className="text-2xl font-semibold mb-2 text-center">{t("forgotPassword.title", { ns: "auth" })}</h2>
        <p className="text-slate-500 dark:text-slate-400 text-sm text-center mb-6">
          {t("forgotPassword.subtitle", { ns: "auth" })}
        </p>
        <div className="space-y-4">
          <input
            type="email"
            placeholder={t("fields.email", { ns: "common" })}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full bg-slate-100 dark:bg-slate-800 p-4 rounded-xl outline-none placeholder-slate-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-green-500 transition"
          />
          {message && (
            <div
              className={`text-sm rounded-xl p-3 ${
                message.type === "error"
                  ? "bg-red-500/10 text-red-400 border border-red-500/20"
                  : "bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20"
              }`}
            >
              {message.text}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full bg-green-500 hover:bg-green-600 disabled:opacity-50 p-4 rounded-xl font-semibold transition flex items-center justify-center gap-2"
          >
            {loading
              ? <div className="w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
              : t("forgotPassword.sendLink", { ns: "auth" })
            }
          </button>
        </div>
        <p className="text-slate-500 dark:text-slate-400 mt-6 text-center">
          {t("forgotPassword.rememberedPassword", { ns: "auth" })}{" "}
          <Link to="/login" className="text-green-600 dark:text-green-400 hover:underline">
            {t("login.title", { ns: "auth" })}
          </Link>
        </p>
      </div>
    </div>
  );
}

export default ForgotPassword;
