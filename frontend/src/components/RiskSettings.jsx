import { useState } from "react";
import { useRiskSettings } from "../hooks/useRiskSettings";

// Settings card: account balance, account type (standard / cent), risk per
// trade as a fixed amount or a % (drives the suggested lot size on every
// signal and in alerts) and daily loss limit (pauses MT5 auto-send and
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
    riskAmount: settings.riskAmount != null ? String(settings.riskAmount) : "",
    accountType: settings.accountType || "standard",
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
        riskAmount: form.riskAmount === "" ? null : Number(form.riskAmount),
        accountType: form.accountType,
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

  const input = "w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm rounded-xl outline-none focus:border-green-500 text-slate-900 dark:text-white";
  const label = "text-sm text-slate-500 dark:text-slate-400 mb-1 block";
  const field = (key, text, props = {}) => (
    <div className="min-w-0">
      <label className={label}>{text}</label>
      <input className={input} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...props} />
    </div>
  );

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        {field("balance", "Account balance", { type: "number", min: 1, inputMode: "decimal", placeholder: "e.g. 1000" })}
        {field("currency", "Currency", { maxLength: 3 })}
        {field("riskAmount", "Risk per trade (amount)", { type: "number", min: 0.01, step: 0.01, inputMode: "decimal", placeholder: "e.g. 8 — or leave empty" })}
        {field("riskPercent", "…or risk per trade (%)", { type: "number", min: 0.1, max: 10, step: 0.1, inputMode: "decimal", disabled: form.riskAmount !== "" })}
        <div className="min-w-0">
          <label className={label}>Account type</label>
          <select className={input} value={form.accountType} onChange={(e) => setForm({ ...form, accountType: e.target.value })}>
            <option value="standard">Standard</option>
            <option value="cent">Cent (lots ÷100)</option>
          </select>
        </div>
        {field("dailyLossLimitPercent", "Daily loss limit (%)", { type: "number", min: 0.5, max: 50, step: 0.5, inputMode: "decimal" })}
      </div>
      <p className="text-xs mt-3 text-slate-500 dark:text-slate-400">
        A fixed amount (e.g. 8) means every signal shows the lot that loses exactly that at the stop loss and wins 2× at the target.
        Gold's tested stops are ~$40–80 of price, so on a standard account even 0.01 lot risks that much — small accounts need a cent account.
      </p>
      {form.riskAmount !== "" && Number(form.balance) > 0 && Number(form.riskAmount) / Number(form.balance) > 0.05 && (
        <p className="text-xs mt-2 text-amber-600 dark:text-amber-400 font-medium">
          ⚠️ {form.currency} {form.riskAmount} is {((Number(form.riskAmount) / Number(form.balance)) * 100).toFixed(0)}% of your balance per trade —
          {" "}{Math.ceil(Number(form.balance) / Number(form.riskAmount))} losses in a row empty the account (losing runs that long happen in testing).
        </p>
      )}
      {(
        <p className={`text-sm mt-4 ${settings.dailyLimitHit ? "text-red-600 dark:text-red-400 font-semibold" : "text-slate-500 dark:text-slate-400"}`}>
          Today's closed P/L: {settings.todayPL >= 0 ? "+" : ""}{Number(settings.todayPL || 0).toFixed(2)} {settings.currency}
          {settings.dailyLimitHit ? " — daily loss limit reached" : ""}
        </p>
      )}
      {msg && <p className={`text-sm mt-3 ${msg.type === "success" ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>{msg.text}</p>}
      <button onClick={submit} disabled={busy}
        className="mt-4 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-slate-950 font-semibold text-sm px-4 py-2 rounded-xl transition">
        Save risk settings
      </button>
    </div>
  );
}

export default RiskSettings;
