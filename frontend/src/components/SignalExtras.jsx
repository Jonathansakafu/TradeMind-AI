import { suggestedLot } from "../utils/lotSize";

// Tracked result of a signal against real prices (services/signalOutcomes.js
// on the server), shown whether or not the trader took it.
export function SignalResultBadge({ notification: n }) {
  if (n.type === "quick_trade" || !n.stopLoss || !n.takeProfit || n.signal === "wait") return null;
  const r = n.simR != null ? `${n.simR >= 0 ? "+" : ""}${Number(n.simR).toFixed(1)}R` : "";
  const map = {
    win: ["✅ Hit take profit", "text-green-600 dark:text-green-400", r],
    loss: ["❌ Hit stop loss", "text-red-600 dark:text-red-400", r],
    expired: ["⌛ Neither hit in 24h", "text-slate-500 dark:text-slate-400", r],
  };
  const [label, cls, extra] = map[n.simOutcome] || ["⏳ Tracking result…", "text-slate-500 dark:text-slate-400", ""];
  return (
    <span className={`text-xs font-semibold ${cls}`} title="Checked automatically against real prices">
      Signal result: {label}{extra ? ` (${extra})` : ""}
    </span>
  );
}

// Suggested lot size from Settings -> Risk.
export function LotSuggestion({ notification: n, settings, compact = false }) {
  if (n.type === "quick_trade" || !n.stopLoss || n.signal === "wait") return null;
  if (!settings) return null;
  if (!settings.balance) {
    return <p className="text-xs text-slate-500 dark:text-slate-400">💼 Set your balance in Settings → Risk to see a lot size</p>;
  }
  const s = suggestedLot(n, settings);
  if (!s) return null;
  const cur = settings.currency || "USD";
  if (s.tooSmall) {
    const minRisk = s.riskAmount / (s.lotRaw || 1e-9) * 0.01;
    return (
      <p className="text-xs text-amber-600 dark:text-amber-400">
        💼 The smallest lot (0.01) risks {cur} {minRisk.toFixed(2)} ({((minRisk / settings.balance) * 100).toFixed(1)}% of balance) — more than your {settings.riskPercent}% limit
      </p>
    );
  }
  return (
    <p className={`text-xs text-slate-700 dark:text-slate-300 ${compact ? "" : "font-medium"}`}>
      💼 Suggested lot <span className="font-bold font-mono">{s.lot.toFixed(2)}</span> · risks {cur} {s.actualRisk.toFixed(2)} ({settings.riskPercent}% of {cur} {Number(settings.balance).toLocaleString()})
    </p>
  );
}
