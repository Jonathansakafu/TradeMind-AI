import { riskReward, formatRR, breakevenWinRate } from "../utils/riskReward";

// Text tone by quality: under 1:1 you risk more than you can make.
function tone(rr) {
  if (rr == null) return "text-slate-500 dark:text-slate-400";
  if (rr < 1) return "text-red-600 dark:text-red-400";
  if (rr >= 2) return "text-green-600 dark:text-green-400";
  return "text-slate-900 dark:text-white";
}

function hint(rr) {
  if (rr == null) return "Risk:reward — needs both a stop loss and a take profit";
  return `Risk:reward ${formatRR(rr)} — risking 1 to make ${rr.toFixed(2)}. Break-even win rate: ${Math.round(breakevenWinRate(rr))}%`;
}

// Tile matching the Entry / SL / TP tiles it sits beside. `compact` for
// the bell dropdown's smaller tiles.
export function RiskRewardTile({ entry, stopLoss, takeProfit, compact = false, className = "" }) {
  const rr = riskReward(entry, stopLoss, takeProfit);
  return (
    <div
      title={hint(rr)}
      className={`bg-blue-500/10 border border-blue-500/20 text-center min-w-0 ${compact ? "rounded-lg px-1 py-1" : "rounded-xl px-2 py-2.5"} ${className}`}
    >
      <p className={`text-xs whitespace-nowrap ${compact ? "text-slate-500" : "text-slate-400 dark:text-slate-500 mb-1"}`}>R:R</p>
      <p className={`font-mono whitespace-nowrap ${compact ? "text-xs" : "font-bold text-sm"} ${tone(rr)}`}>{formatRR(rr)}</p>
    </div>
  );
}

// Inline text form, for tables and one-line summaries.
export function RiskRewardText({ entry, stopLoss, takeProfit, className = "" }) {
  const rr = riskReward(entry, stopLoss, takeProfit);
  return <span title={hint(rr)} className={`font-mono whitespace-nowrap ${tone(rr)} ${className}`}>{formatRR(rr)}</span>;
}
