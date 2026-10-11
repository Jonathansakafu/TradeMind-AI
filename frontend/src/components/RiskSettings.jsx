import { useState } from "react";
import { Wallet } from "lucide-react";
import { useRiskSettings } from "../hooks/useRiskSettings";

// Settings card: account balance, risk % per trade (drives the suggested
// lot size on every signal) and daily loss limit (pauses MT5 auto-send and
// shows a warning once today's closed losses reach it).
function RiskSettings() {
  const { settings, save } = useRiskSettings();
  if (!settings) return null; // form starts from the saved values once loaded
  return <RiskForm settings={settings} save={save} />;
}

function RiskForm({ settings, save }) {
  const [form, setForm] = useState(() => ({
    balance: settings.balance ?? "",
    riskPercent: String(settings.riskPercent ?? 1),
    dailyLossLimitPercent: String(settings.dailyLossLimitPercent ?? 3),
    currency: settings.currency || "USD",
  }));
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setMsg(null);
    try {
      await save({
        balance: form.balance === "" ? null : Number(form.balance),
        riskPercent: Number(form.riskPercent),
        dailyLossLimitPercent: Number(form.dailyLossLimitPercent),
        currency: form.currency,
      });
      setMsg({ type: "success", text: "Saved — signals now show a suggested lot size." });
    } catch (err) {
      setMsg({ type: "error", text: err.response?.data?.message || "Failed to save" });
    } finally {
      setBusy(false);
    }
  };

  const input = "w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 rounded-xl outline-none focus:border-green-500 text-slate-900 dark:text-white";
  const label = "text-sm text-slate-500 dark:text-slate-400 mb-1 block";
  const field = (key, text, props = {}) => (
    <div className="min-w-0">
      <label className={label}>{text}</label>
      <input className={input} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...props} />
    </div>
  );

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
      <h3 className="text-xl font-bold flex items-center gap-2 mb-2 text-slate-900 dark:text-white">
        <Wallet size={20} className="text-green-600 dark:text-green-400" /> Risk
      </h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">Used to suggest a lot size on every signal and to warn you when today's losses reach your limit.</p>
      <div className="grid grid-cols-2 gap-3">
        {field("balance", "Account balance", { type: "number", min: 1, inputMode: "decimal", placeholder: "e.g. 1000" })}
        {field("currency", "Currency", { maxLength: 3 })}
        {field("riskPercent", "Risk per trade (%)", { type: "number", min: 0.1, max: 10, step: 0.1, inputMode: "decimal" })}
        {field("dailyLossLimitPercent", "Daily loss limit (%)", { type: "number", min: 0.5, max: 50, step: 0.5, inputMode: "decimal" })}
      </div>
      {(
        <p className={`text-sm mt-4 ${settings.dailyLimitHit ? "text-red-600 dark:text-red-400 font-semibold" : "text-slate-500 dark:text-slate-400"}`}>
          Today's closed P/L: {settings.todayPL >= 0 ? "+" : ""}{Number(settings.todayPL || 0).toFixed(2)} {settings.currency}
          {settings.dailyLimitHit ? " — daily loss limit reached" : ""}
        </p>
      )}
      {msg && <p className={`text-sm mt-3 ${msg.type === "success" ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>{msg.text}</p>}
      <button onClick={submit} disabled={busy}
        className="mt-4 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-slate-950 font-bold px-6 py-3 rounded-xl transition">
        Save risk settings
      </button>
    </div>
  );
}

export default RiskSettings;
