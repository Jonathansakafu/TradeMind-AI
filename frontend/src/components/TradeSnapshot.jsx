import { forwardRef } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";

// A self-rendered visual record of a trade's levels -- captured via
// html2canvas into an image and used as the trade's screenshot. Exists
// because a website cannot silently screenshot another application
// (MT5, TradingView) on the trader's device; this instead generates its
// own accurate, always-available visual from data the app already has
// (live price + the trade's own entry/SL/TP), no permissions needed.
//
// Trade-off worth knowing: this shows exact price *levels*, not real
// candlesticks/chart patterns, so the AI strategy-detection feature
// (which looks for visual patterns like order blocks or structure
// breaks) can't read anything meaningful from it. For that specific
// feature, a real chart screenshot (upload or screen-capture) is still
// what actually works.
const TradeSnapshot = forwardRef(({
  pair, direction, entry, stopLoss, takeProfit,
  markerPrice, markerLabel = "Current", isClosing = false,
  pnl, pips, outcome,
}, ref) => {
  const sl = stopLoss ? parseFloat(stopLoss) : null;
  const tp = takeProfit ? parseFloat(takeProfit) : null;
  const entryNum = parseFloat(entry);
  const marker = markerPrice ? parseFloat(markerPrice) : null;

  const hasRange = sl != null && tp != null;
  const rangeLow = hasRange ? Math.min(sl, tp) : null;
  const rangeHigh = hasRange ? Math.max(sl, tp) : null;
  const posOf = (price) => {
    if (!hasRange || price == null || rangeHigh === rangeLow) return 50;
    return Math.max(2, Math.min(98, ((price - rangeLow) / (rangeHigh - rangeLow)) * 100));
  };

  return (
    <div ref={ref} className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold text-slate-900 dark:text-white">{pair || "—"}</span>
          <span className={`flex items-center gap-1 text-sm font-bold px-2.5 py-1 rounded-lg ${
            direction === "buy" ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-red-500/10 text-red-500 dark:text-red-400"
          }`}>
            {direction === "buy" ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            {direction?.toUpperCase() || "—"}
          </span>
        </div>
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {new Date().toLocaleString()}
        </span>
      </div>

      {/* Price ladder */}
      {hasRange && (
        <div className="mb-6">
          <div className="relative h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-visible mt-8 mb-8">
            <div className="absolute inset-0 rounded-full bg-gradient-to-r from-red-500/30 via-slate-400/30 dark:via-slate-700/30 to-green-500/30" />
            <div className="absolute top-0 bottom-0 w-0.5 bg-red-500" style={{ left: `${posOf(sl)}%` }}>
              <span className="absolute -top-6 -translate-x-1/2 text-[11px] font-semibold text-red-500 dark:text-red-400 whitespace-nowrap">SL {sl}</span>
            </div>
            <div className="absolute top-0 bottom-0 w-0.5 bg-blue-400" style={{ left: `${posOf(entryNum)}%` }}>
              <span className="absolute -top-6 -translate-x-1/2 text-[11px] font-semibold text-blue-500 dark:text-blue-400 whitespace-nowrap">Entry {entryNum}</span>
            </div>
            <div className="absolute top-0 bottom-0 w-0.5 bg-green-500" style={{ left: `${posOf(tp)}%` }}>
              <span className="absolute -top-6 -translate-x-1/2 text-[11px] font-semibold text-green-600 dark:text-green-400 whitespace-nowrap">TP {tp}</span>
            </div>
            {marker != null && (
              <div
                className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-white dark:border-slate-950 ${
                  outcome === "win" ? "bg-green-400" : outcome === "loss" ? "bg-red-400" : "bg-slate-900 dark:bg-white"
                }`}
                style={{ left: `${posOf(marker)}%`, transform: "translate(-50%, -50%)" }}
              >
                <span className="absolute -bottom-6 -translate-x-1/2 left-1/2 text-[11px] font-bold text-slate-900 dark:text-white whitespace-nowrap">
                  {markerLabel} {marker}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Numeric grid */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-center">
          <p className="text-xs text-slate-400 dark:text-slate-500 mb-1">Entry</p>
          <p className="font-mono font-bold text-blue-500 dark:text-blue-400 text-sm">{entry || "—"}</p>
        </div>
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-center">
          <p className="text-xs text-slate-400 dark:text-slate-500 mb-1">Stop Loss</p>
          <p className="font-mono font-bold text-red-500 dark:text-red-400 text-sm">{stopLoss || "—"}</p>
        </div>
        <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3 text-center">
          <p className="text-xs text-slate-400 dark:text-slate-500 mb-1">Take Profit</p>
          <p className="font-mono font-bold text-green-600 dark:text-green-400 text-sm">{takeProfit || "—"}</p>
        </div>
      </div>

      {/* Result (close flow only) */}
      {isClosing && (
        <div className={`rounded-xl p-4 border ${
          outcome === "win" ? "bg-green-500/10 border-green-500/30"
          : outcome === "loss" ? "bg-red-500/10 border-red-500/30"
          : "bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700"
        }`}>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Exit Price</p>
              <p className="font-mono font-bold text-slate-900 dark:text-white text-sm">{markerPrice || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">P&amp;L</p>
              <p className={`font-mono font-bold text-sm ${Number(pnl) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
                {Number(pnl) >= 0 ? "+" : ""}{pnl != null ? `$${pnl}` : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Pips</p>
              <p className={`font-mono font-bold text-sm ${Number(pips) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
                {Number(pips) >= 0 ? "+" : ""}{pips ?? "—"}
              </p>
            </div>
          </div>
          <div className={`text-center mt-3 py-1.5 rounded-lg font-bold text-sm ${
            outcome === "win" ? "bg-green-500/20 text-green-600 dark:text-green-400"
            : outcome === "loss" ? "bg-red-500/20 text-red-500 dark:text-red-400"
            : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
          }`}>
            {outcome === "win" ? "✅ WIN" : outcome === "loss" ? "❌ LOSS" : "➖ BREAKEVEN"}
          </div>
        </div>
      )}

      <p className="text-center text-[10px] text-slate-400 dark:text-slate-600 mt-4">
        TradeMind AI — auto-generated trade record
      </p>
    </div>
  );
});

TradeSnapshot.displayName = "TradeSnapshot";
export default TradeSnapshot;
