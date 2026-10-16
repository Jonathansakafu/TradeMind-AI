import { suggestedLot } from "../utils/lotSize";

// Tracked result of a signal against real prices (services/signalOutcomes.js
// on the server), shown whether or not the trader took it.
export function SignalResultBadge({ notification: n }) {
  if (n.type === "quick_trade" || !n.stopLoss || !n.takeProfit || n.signal === "wait") return null;
  const r = n.simR != null ? `${n.simR >= 0 ? "+" : ""}${Number(n.simR).toFixed(1)}R` : "";
  // Strategy signals trail their stop and close after maxHoldHours, so a
  // win can be at the trailed stop and "expired" is a real close.
  const trailedWin = n.simOutcome === "win" && n.simExitPrice != null && n.simExitPrice !== n.takeProfit;
  const map = {
    win: [trailedWin ? `✅ Closed in profit by the trailing stop at ${n.simExitPrice}` : "✅ Hit take profit", "text-green-600 dark:text-green-400", r],
    loss: [n.initialStopLoss && n.simExitPrice != null && n.simExitPrice !== n.initialStopLoss ? `❌ Trailing stop hit at ${n.simExitPrice}` : "❌ Hit stop loss", "text-red-600 dark:text-red-400", r],
    expired: [n.strategy ? `⌛ Closed at the ${n.maxHoldHours || 48} h time limit` : "⌛ Neither hit in 24h", "text-slate-500 dark:text-slate-400", r],
    unfilled: ["⏸ Entry never reached (no trade)", "text-slate-500 dark:text-slate-400", ""],
  };
  const trailing = n.initialStopLoss && n.stopLoss !== n.initialStopLoss ? ` · 🔒 stop moved to ${n.stopLoss}` : "";
  const [label, cls, extra] = map[n.simOutcome] || (n.simFilledAt
    ? [`▶ Entered — running${trailing}`, "text-blue-600 dark:text-blue-400", ""]
    : ["⏳ Waiting for the entry price…", "text-slate-500 dark:text-slate-400", ""]);
  return (
    <span className={`text-xs font-semibold ${cls}`} title="Checked automatically against real prices">
      Signal result: {label}{extra ? ` (${extra})` : ""}
      {n.research?.verdict && n.research.verdict !== "no price data" && (
        <span className="block font-normal text-slate-600 dark:text-slate-400 mt-0.5">🔍 {n.research.verdict}</span>
      )}
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
  // Sized on the first stop (the risk taken), not a later trailed one.
  const s = suggestedLot({ ...n, stopLoss: n.initialStopLoss ?? n.stopLoss }, settings);
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
