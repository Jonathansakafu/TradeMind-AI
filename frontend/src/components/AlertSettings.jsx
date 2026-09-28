import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import axios from "axios";
import { BellRing, Mail, Send, Smartphone } from "lucide-react";
import { API_URL } from "../config/api";
import { useAuth } from "../hooks/useAuth";
import { disablePush, enablePush, getPushState } from "../utils/pushNotifications";

const CONFIDENCE_OPTIONS = [50, 60, 70, 80, 90];

// Settings card for alerts that reach the trader outside the app: push on
// this device (browser or Android app) and email. Backed by /api/push.
function AlertSettings() {
  const { t } = useTranslation("settings");
  const { headers } = useAuth();

  const [pushState, setPushState] = useState("loading");
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [testResults, setTestResults] = useState(null);

  const fetchState = useCallback(() =>
    Promise.all([
      getPushState().catch(() => "unsupported"),
      axios.get(`${API_URL}/api/push/status`, { headers }).catch(() => null),
    ]), [headers]);

  const applyState = ([state, res]) => {
    setPushState(state);
    if (res) setStatus(res.data);
  };
  const load = () => fetchState().then(applyState);

  useEffect(() => {
    let cancelled = false;
    fetchState().then((result) => { if (!cancelled) applyState(result); });
    return () => { cancelled = true; };
  }, [fetchState]);

  const run = async (fn) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (err) {
      setMsg({ type: "error", text: err.response?.data?.message || err.message || t("alerts.failed") });
    } finally {
      setBusy(false);
      load();
    }
  };

  const togglePush = () => run(async () => {
    if (pushState === "on") {
      await disablePush(headers);
      setMsg({ type: "success", text: t("alerts.pushDisabled") });
    } else {
      await enablePush(headers);
      setMsg({ type: "success", text: t("alerts.pushEnabled") });
    }
  });

  const updatePrefs = (patch) => run(async () => {
    setStatus((s) => s && { ...s, prefs: { ...s.prefs, ...patch } });
    await axios.put(`${API_URL}/api/push/prefs`, patch, { headers });
  });

  const sendTest = () => run(async () => {
    setTestResults(null);
    const res = await axios.post(`${API_URL}/api/push/test`, {}, { headers });
    setTestResults(res.data.results || {});
  });

  const pushLabel = {
    loading: "…",
    on: t("alerts.state.on"),
    off: t("alerts.state.off"),
    denied: t("alerts.state.denied"),
    unsupported: t("alerts.state.unsupported"),
    "needs-app-update": t("alerts.state.needsUpdate"),
  }[pushState];
  const canTogglePush = ["on", "off"].includes(pushState);
  const otherDevices = status
    ? Math.max(0, status.browserDevices + status.androidDevices - (pushState === "on" ? 1 : 0))
    : 0;

  const describe = (r) => {
    if (!r) return t("alerts.result.skipped");
    if (r.error) return `❌ ${r.error}`;
    if (r.devices === 0) return t("alerts.result.noDevices");
    if (r.sent === true || r.sent > 0) {
      return r.devices ? `✅ ${t("alerts.result.sentTo", { count: r.sent })}` : `✅ ${t("alerts.result.sent")}`;
    }
    return `❌ ${t("alerts.failed")}`;
  };

  const card = "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6";
  const btn = "flex items-center gap-2 font-bold px-5 py-2.5 rounded-xl transition disabled:opacity-50";

  return (
    <div className={card}>
      <h3 className="text-xl font-bold flex items-center gap-2 mb-2 text-slate-900 dark:text-white">
        <BellRing size={20} className="text-green-600 dark:text-green-400" /> {t("alerts.title")}
      </h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">{t("alerts.subtitle")}</p>

      <div className="space-y-6">
        {/* Push on this device */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold flex items-center gap-2 text-slate-900 dark:text-white">
              <Smartphone size={16} /> {t("alerts.pushTitle")}
            </p>
            <p className={`text-sm ${pushState === "on" ? "text-green-600 dark:text-green-400" : "text-slate-500 dark:text-slate-400"}`}>
              {pushLabel}
            </p>
            {otherDevices > 0 && (
              <p className="text-xs text-slate-400 dark:text-slate-500">{t("alerts.otherDevices", { count: otherDevices })}</p>
            )}
          </div>
          {canTogglePush && (
            <button
              onClick={togglePush}
              disabled={busy}
              className={pushState === "on"
                ? `${btn} bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700`
                : `${btn} bg-green-500 hover:bg-green-600 text-slate-950`}
            >
              {pushState === "on" ? t("alerts.turnOff") : t("alerts.turnOn")}
            </button>
          )}
        </div>

        {/* Email */}
        <div className="space-y-3">
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span className="min-w-0">
              <span className="font-semibold flex items-center gap-2 text-slate-900 dark:text-white">
                <Mail size={16} /> {t("alerts.emailTitle")}
              </span>
              <span className="text-sm text-slate-500 dark:text-slate-400 break-all">
                {status?.email ? t("alerts.emailTo", { email: status.email }) : "…"}
              </span>
            </span>
            <input
              type="checkbox"
              className="h-5 w-5 accent-green-500 shrink-0"
              checked={!!status?.prefs.email}
              disabled={!status || busy}
              onChange={(e) => updatePrefs({ email: e.target.checked })}
            />
          </label>
          {status?.prefs.email && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <span>{t("alerts.emailMinConfidence")}</span>
              <select
                value={status.prefs.emailMinConfidence}
                disabled={busy}
                onChange={(e) => updatePrefs({ emailMinConfidence: Number(e.target.value) })}
                className="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-1 rounded-lg text-slate-900 dark:text-white"
              >
                {CONFIDENCE_OPTIONS.map((c) => <option key={c} value={c}>{c}%+</option>)}
              </select>
            </div>
          )}
        </div>

        {/* Test */}
        <div>
          <button
            onClick={sendTest}
            disabled={busy}
            className={`${btn} bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700`}
          >
            <Send size={16} /> {t("alerts.sendTest")}
          </button>
          {testResults && (
            <ul className="mt-3 text-sm space-y-1 text-slate-600 dark:text-slate-300">
              <li><b>{t("alerts.channel.browser")}:</b> {describe(testResults.browser)}</li>
              <li><b>{t("alerts.channel.android")}:</b> {describe(testResults.android)}</li>
              <li><b>{t("alerts.channel.email")}:</b> {describe(testResults.email)}</li>
            </ul>
          )}
        </div>

        {msg && (
          <p className={`text-sm ${msg.type === "success" ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
            {msg.text}
          </p>
        )}
      </div>
    </div>
  );
}

export default AlertSettings;
