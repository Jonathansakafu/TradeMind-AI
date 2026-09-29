import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { PieChart, ArrowLeft } from "lucide-react";
import MainLayout from "../layouts/MainLayout";
import { API_URL } from "../config/api";
import { useAuth } from "../hooks/useAuth";
import { computeStats, filterTrades, formatMoney } from "../utils/tradeStats";
import { formatRR, breakevenWinRate } from "../utils/riskReward";
import {
  OutcomeDonut, OutcomeBars, OutcomeLegend, TradeLine, BreakdownBars, TradeTable,
} from "../components/PerformanceCharts";

// Chart colors per theme (see PerformanceCharts.jsx for why these hues).
const VIZ_STYLE = `
.perf-viz {
  --viz-win: #1baf7a; --viz-loss: #eb6834; --viz-neutral: #a3a19b;
  --viz-line: #2a78d6; --viz-track: #e3e0d8; --viz-grid: #dcd8cf;
  --viz-grid-strong: #9a968d; --viz-surface: #f3f1ec;
}
.dark .perf-viz {
  --viz-win: #199e70; --viz-loss: #d95926; --viz-neutral: #6b6a65;
  --viz-line: #3987e5; --viz-track: #1e293b; --viz-grid: #1e293b;
  --viz-grid-strong: #475569; --viz-surface: #0f172a;
}`;

// Remembers the viewer's chart choices (display preference only).
function usePref(key, initial) {
  const [value, setValue] = useState(() => {
    try { return localStorage.getItem(`perf.${key}`) || initial; } catch { return initial; }
  });
  const set = (v) => {
    setValue(v);
    try { localStorage.setItem(`perf.${key}`, v); } catch { /* ignore */ }
  };
  return [value, set];
}

function Segmented({ options, value, onChange, label }) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap max-w-full rounded-xl border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-100 dark:bg-slate-800">
      {options.map(([v, text]) => (
        <button key={v} onClick={() => onChange(v)} aria-pressed={value === v}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
            value === v ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow" : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
          }`}
        >{text}</button>
      ))}
    </div>
  );
}

function Tile({ label, value, sub, tone }) {
  const color = tone === "good" ? "text-green-600 dark:text-green-400" : tone === "bad" ? "text-red-600 dark:text-red-400" : "text-slate-900 dark:text-white";
  return (
    <div className="min-w-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 sm:p-4">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`text-xl sm:text-2xl font-bold mt-1 break-words ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}

// min-w-0: without it a grid/flex child can't shrink below its widest
// content (switch buttons, the trade table), which pushed cards past the
// phone screen's edge.
const card = "min-w-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5";

function Performance() {
  const { headers } = useAuth();
  const [trades, setTrades] = useState(null);
  const [period, setPeriod] = usePref("period", "all");
  const [type, setType] = usePref("type", "all");
  const [outcomeView, setOutcomeView] = usePref("outcomeView", "donut");
  const [progressView, setProgressView] = usePref("progressView", "equity");
  const [breakdownBy, setBreakdownBy] = usePref("breakdownBy", "pair");

  useEffect(() => {
    axios.get(`${API_URL}/api/trades?limit=2000`, { headers })
      .then((res) => setTrades(res.data.trades || []))
      .catch(() => setTrades([]));
  }, [headers]);

  const stats = useMemo(() => computeStats(filterTrades(trades || [], { period, type })), [trades, period, type]);

  const pf = stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2);
  const streak = stats.currentStreak;

  return (
    <MainLayout>
      <style>{VIZ_STYLE}</style>
      <div className="perf-viz min-w-0">
        <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-green-600 mb-3">
          <ArrowLeft size={14} /> Dashboard
        </Link>
        <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold flex items-center gap-3 mb-1">
          <PieChart className="text-green-600 dark:text-green-400" size={30} /> Performance
        </h2>
        <p className="text-slate-500 dark:text-slate-400 mb-6">Win rate and the statistics behind it — choose how each chart is shown.</p>

        {/* Filters: one row above everything they affect */}
        <div className="flex flex-wrap gap-3 mb-6">
          <Segmented label="Period" value={period} onChange={setPeriod}
            options={[["7d", "7 days"], ["30d", "30 days"], ["90d", "90 days"], ["all", "All time"]]} />
          <Segmented label="Trade type" value={type} onChange={setType}
            options={[["all", "All"], ["forex", "Forex / MT5"], ["quick_trade", "Quick Trade"]]} />
        </div>

        {trades === null ? (
          <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : stats.closed === 0 ? (
          <div className={`${card} text-center py-16`}>
            <p className="text-lg font-semibold text-slate-700 dark:text-slate-200">No closed trades in this range</p>
            <p className="text-sm text-slate-500 mt-1">Close some trades (or pick a longer period) to see your statistics.</p>
          </div>
        ) : (
          <>
            {/* Key numbers */}
            {/* Tiles per row follow the space actually available (sidebar or not):
                as many ~170px tiles as fit, never fewer than 2 on a phone. */}
            <div className="grid gap-3 mb-6 grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
              <Tile
                label={period === "all" && type === "all" ? "Win rate" : "Win rate (filtered)"}
                value={`${Math.round(stats.winRate)}%`}
                sub={`${stats.wins} W · ${stats.losses} L · ${stats.breakeven} BE${period === "all" && type === "all" ? "" : " — filters on, see above"}`}
                tone={stats.winRate >= 50 ? "good" : "bad"} />
              <Tile label="Net P/L" value={formatMoney(stats.netPL)} sub={`${stats.closed} closed · ${stats.open} open`} tone={stats.netPL >= 0 ? "good" : "bad"} />
              <Tile label="Profit factor" value={pf} sub="gross profit ÷ gross loss (>1 = profitable)" tone={stats.profitFactor >= 1 ? "good" : "bad"} />
              <Tile label="Expectancy" value={formatMoney(stats.expectancy)} sub="average P/L per trade" tone={stats.expectancy >= 0 ? "good" : "bad"} />
              <Tile label="Avg win / avg loss" value={`${formatMoney(stats.avgWin, { sign: false })} / ${formatMoney(stats.avgLoss, { sign: false })}`} sub={stats.winLossRatio != null ? `ratio ${stats.winLossRatio.toFixed(2)} : 1` : "no losses yet"} />
              <Tile label="Max drawdown" value={formatMoney(-stats.maxDrawdown)} sub="largest fall from a P/L peak" tone={stats.maxDrawdown > 0 ? "bad" : undefined} />
              <Tile label="Best / worst trade" value={`${formatMoney(stats.largestWin)} / ${formatMoney(stats.largestLoss)}`} />
              <Tile label="Avg risk : reward" value={formatRR(stats.avgRR)}
                sub={stats.avgRR != null
                  ? `break-even win rate ${Math.round(breakevenWinRate(stats.avgRR))}% · from ${stats.rrCount} trade${stats.rrCount === 1 ? "" : "s"} with SL & TP`
                  : "no closed trades with both SL and TP"}
                tone={stats.avgRR == null ? undefined : stats.winRate >= breakevenWinRate(stats.avgRR) ? "good" : "bad"} />
              <Tile label="Streaks" value={`${stats.longestWin}W · ${stats.longestLoss}L`}
                sub={streak ? `current: ${streak.count} ${streak.type === "win" ? "win" : streak.type === "loss" ? "loss" : "breakeven"}${streak.count > 1 ? "s" : ""}` : ""} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 sm:gap-6 mb-6">
              {/* Win / loss split */}
              <div className={`${card} lg:col-span-2`}>
                <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                  <h3 className="font-bold text-slate-900 dark:text-white">Wins vs losses</h3>
                  <Segmented label="Chart type" value={outcomeView} onChange={setOutcomeView}
                    options={[["donut", "Pie"], ["bars", "Bars"]]} />
                </div>
                {outcomeView === "bars" ? <OutcomeBars stats={stats} /> : <OutcomeDonut stats={stats} />}
                <div className="mt-4"><OutcomeLegend stats={stats} /></div>
              </div>

              {/* Over time */}
              <div className={`${card} lg:col-span-3`}>
                <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                  <h3 className="font-bold text-slate-900 dark:text-white">
                    {progressView === "winRate" ? "Win rate over time" : progressView === "table" ? "Trade by trade" : "Cumulative P/L (equity curve)"}
                  </h3>
                  <Segmented label="Chart type" value={progressView} onChange={setProgressView}
                    options={[["equity", "Cumulative P/L"], ["winRate", "Cumulative win rate"], ["table", "Table"]]} />
                </div>
                {progressView === "table"
                  ? <TradeTable series={stats.series} />
                  : <TradeLine series={stats.series} metric={progressView === "winRate" ? "winRate" : "equity"} />}
              </div>
            </div>

            {/* Breakdown */}
            <div className={card}>
              <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                <h3 className="font-bold text-slate-900 dark:text-white">Win rate by…</h3>
                <Segmented label="Break down by" value={breakdownBy} onChange={setBreakdownBy}
                  options={[["pair", "Pair"], ["direction", "Buy / Sell"], ["session", "Session"], ["weekday", "Weekday"]]} />
              </div>
              <BreakdownBars rows={stats.breakdowns[breakdownBy] || []} />
            </div>
          </>
        )}
      </div>
    </MainLayout>
  );
}

export default Performance;
