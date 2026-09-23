import { forwardRef } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { useTheme } from "../hooks/useTheme";

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
//
// Every color below is a plain hex/rgba value passed through inline
// `style`, not a Tailwind color class -- this app is on Tailwind v4,
// which compiles its whole palette to oklch(), and html2canvas (the
// library that rasterizes this exact component, see
// SnapshotCaptureModal) has no support for oklch()/color-mix() at all.
// It throws immediately on the first element it walks that uses one,
// which given Tailwind color classes were on nearly every element here,
// meant every capture failed with a generic "Couldn't generate the
// snapshot" error. Layout classes (padding, flex, grid, rounded, font
// size/weight) are untouched -- only color ever hit the oklch problem.
const TradeSnapshot = forwardRef(({
  pair, direction, entry, stopLoss, takeProfit,
  markerPrice, markerLabel = "Current", isClosing = false,
  pnl, pips, outcome,
}, ref) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";

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

  const c = {
    cardBg: isDark ? "#020617" : "#ffffff",
    cardBorder: isDark ? "#1e293b" : "#e2e8f0",
    textPrimary: isDark ? "#ffffff" : "#0f172a",
    textMuted1: isDark ? "#64748b" : "#94a3b8",
    textMuted2: isDark ? "#94a3b8" : "#64748b",
    boxBg: isDark ? "#0f172a" : "#ffffff",
    boxBorder: isDark ? "#1e293b" : "#e2e8f0",
    trackBg: isDark ? "#1e293b" : "#f1f5f9",
    greenText: isDark ? "#4ade80" : "#16a34a",
    redText: isDark ? "#f87171" : "#ef4444",
    blueText: isDark ? "#60a5fa" : "#3b82f6",
    green: "#22c55e",
    red: "#ef4444",
    blue: "#60a5fa",
    markerBorder: isDark ? "#020617" : "#ffffff",
    neutralMarker: isDark ? "#ffffff" : "#0f172a",
    breakevenBg: isDark ? "#1e293b" : "#f1f5f9",
    breakevenBorder: isDark ? "#334155" : "#e2e8f0",
    breakevenText: isDark ? "#cbd5e1" : "#475569",
    footerText: isDark ? "#475569" : "#94a3b8",
  };

  const markerColor = outcome === "win" ? c.green : outcome === "loss" ? c.red : c.neutralMarker;

  return (
    <div
      ref={ref}
      className="rounded-2xl p-6 w-full"
      style={{ backgroundColor: c.cardBg, border: `1px solid ${c.cardBorder}` }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold" style={{ color: c.textPrimary }}>{pair || "—"}</span>
          <span
            className="flex items-center gap-1 text-sm font-bold px-2.5 py-1 rounded-lg"
            style={{
              backgroundColor: direction === "buy" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
              color: direction === "buy" ? c.greenText : c.redText,
            }}
          >
            {direction === "buy" ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            {direction?.toUpperCase() || "—"}
          </span>
        </div>
        <span className="text-xs" style={{ color: c.textMuted1 }}>
          {new Date().toLocaleString()}
        </span>
      </div>

      {/* Price ladder */}
      {hasRange && (
        <div className="mb-6">
          <div
            className="relative h-3 rounded-full overflow-visible mt-8 mb-8"
            style={{ backgroundColor: c.trackBg }}
          >
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: `linear-gradient(to right, rgba(239,68,68,0.3), ${isDark ? "rgba(51,65,85,0.3)" : "rgba(148,163,184,0.3)"}, rgba(34,197,94,0.3))`,
              }}
            />
            <div className="absolute top-0 bottom-0 w-0.5" style={{ left: `${posOf(sl)}%`, backgroundColor: c.red }}>
              <span className="absolute -top-6 -translate-x-1/2 text-[11px] font-semibold whitespace-nowrap" style={{ color: c.redText }}>SL {sl}</span>
            </div>
            <div className="absolute top-0 bottom-0 w-0.5" style={{ left: `${posOf(entryNum)}%`, backgroundColor: c.blue }}>
              <span className="absolute -top-6 -translate-x-1/2 text-[11px] font-semibold whitespace-nowrap" style={{ color: c.blueText }}>Entry {entryNum}</span>
            </div>
            <div className="absolute top-0 bottom-0 w-0.5" style={{ left: `${posOf(tp)}%`, backgroundColor: c.green }}>
              <span className="absolute -top-6 -translate-x-1/2 text-[11px] font-semibold whitespace-nowrap" style={{ color: c.greenText }}>TP {tp}</span>
            </div>
            {marker != null && (
              <div
                className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full"
                style={{
                  left: `${posOf(marker)}%`,
                  transform: "translate(-50%, -50%)",
                  backgroundColor: markerColor,
                  border: `2px solid ${c.markerBorder}`,
                }}
              >
                <span className="absolute -bottom-6 -translate-x-1/2 left-1/2 text-[11px] font-bold whitespace-nowrap" style={{ color: c.textPrimary }}>
                  {markerLabel} {marker}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Numeric grid */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="rounded-xl p-3 text-center" style={{ backgroundColor: c.boxBg, border: `1px solid ${c.boxBorder}` }}>
          <p className="text-xs mb-1" style={{ color: c.textMuted1 }}>Entry</p>
          <p className="font-mono font-bold text-sm" style={{ color: c.blueText }}>{entry || "—"}</p>
        </div>
        <div className="rounded-xl p-3 text-center" style={{ backgroundColor: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)" }}>
          <p className="text-xs mb-1" style={{ color: c.textMuted1 }}>Stop Loss</p>
          <p className="font-mono font-bold text-sm" style={{ color: c.redText }}>{stopLoss || "—"}</p>
        </div>
        <div className="rounded-xl p-3 text-center" style={{ backgroundColor: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)" }}>
          <p className="text-xs mb-1" style={{ color: c.textMuted1 }}>Take Profit</p>
          <p className="font-mono font-bold text-sm" style={{ color: c.greenText }}>{takeProfit || "—"}</p>
        </div>
      </div>

      {/* Result (close flow only) */}
      {isClosing && (
        <div
          className="rounded-xl p-4"
          style={{
            backgroundColor: outcome === "win" ? "rgba(34,197,94,0.1)" : outcome === "loss" ? "rgba(239,68,68,0.1)" : c.breakevenBg,
            border: `1px solid ${outcome === "win" ? "rgba(34,197,94,0.3)" : outcome === "loss" ? "rgba(239,68,68,0.3)" : c.breakevenBorder}`,
          }}
        >
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-xs mb-1" style={{ color: c.textMuted2 }}>Exit Price</p>
              <p className="font-mono font-bold text-sm" style={{ color: c.textPrimary }}>{markerPrice || "—"}</p>
            </div>
            <div>
              <p className="text-xs mb-1" style={{ color: c.textMuted2 }}>P&amp;L</p>
              <p className="font-mono font-bold text-sm" style={{ color: Number(pnl) >= 0 ? c.greenText : c.redText }}>
                {Number(pnl) >= 0 ? "+" : ""}{pnl != null ? `$${pnl}` : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs mb-1" style={{ color: c.textMuted2 }}>Pips</p>
              <p className="font-mono font-bold text-sm" style={{ color: Number(pips) >= 0 ? c.greenText : c.redText }}>
                {Number(pips) >= 0 ? "+" : ""}{pips ?? "—"}
              </p>
            </div>
          </div>
          <div
            className="text-center mt-3 py-1.5 rounded-lg font-bold text-sm"
            style={{
              backgroundColor: outcome === "win" ? "rgba(34,197,94,0.2)" : outcome === "loss" ? "rgba(239,68,68,0.2)" : c.breakevenBorder,
              color: outcome === "win" ? c.greenText : outcome === "loss" ? c.redText : c.breakevenText,
            }}
          >
            {outcome === "win" ? "✅ WIN" : outcome === "loss" ? "❌ LOSS" : "➖ BREAKEVEN"}
          </div>
        </div>
      )}

      <p className="text-center text-[10px] mt-4" style={{ color: c.footerText }}>
        TradeMind AI — auto-generated trade record
      </p>
    </div>
  );
});

TradeSnapshot.displayName = "TradeSnapshot";
export default TradeSnapshot;
