import { useMemo, useState } from "react";
import { closedTime, openedTime, fmtDuration } from "../utils/livePL";
import { useNow } from "../hooks/useLiveQuotes";

// Day summary for Trade History (added 2026-10-14): for the chosen day, the
// best and the worst single trade (and when they closed), and when the
// day's running P/L was highest and lowest, with a small curve. Always
// computed from the current trade list, so edits, new trades and automatic
// TP / SL closes show at once.

const dayKey = (ms) => new Date(ms).toDateString();
const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const money = (v) => `${v >= 0 ? "+" : "-"}$${Math.abs(v).toFixed(2)}`;
const color = (v) => (v > 0 ? "text-green-600 dark:text-green-400" : v < 0 ? "text-red-500" : "text-slate-500");
const doneAt = (t) => closedTime(t) ?? openedTime(t);

function Stat({ label, value, sub, cls }) {
  return (
    <div className="rounded-xl bg-slate-100 dark:bg-slate-800/60 p-3 min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${cls || "text-slate-900 dark:text-white"}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 dark:text-slate-400">{sub}</p>}
    </div>
  );
}

function Curve({ points, high, low }) {
  if (points.length < 2) return null;
  const W = 300, H = 70, pad = 6;
  const ys = [0, ...points.map((p) => p.cum)];
  const min = Math.min(...ys), max = Math.max(...ys);
  const t0 = points[0].t, t1 = points.at(-1).t || t0 + 1;
  const x = (t) => pad + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * pad);
  const y = (v) => H - pad - ((v - min) / Math.max(1e-9, max - min)) * (H - 2 * pad);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.cum).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16" role="img" aria-label="Running P/L through the day">
      <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} className="stroke-slate-300 dark:stroke-slate-700" strokeDasharray="3 3" />
      <path d={d} fill="none" strokeWidth="2" className={points.at(-1).cum >= 0 ? "stroke-green-500" : "stroke-red-500"} />
      <circle cx={x(high.t)} cy={y(high.cum)} r="4" className="fill-green-500" />
      <circle cx={x(low.t)} cy={y(low.cum)} r="4" className="fill-red-500" />
    </svg>
  );
}

function DaySummary({ trades }) {
  const todayKey = dayKey(useNow(60000)); // rolls over at midnight
  const days = useMemo(() => {
    const set = new Map();
    for (const t of trades) if (t.outcome) set.set(dayKey(doneAt(t)), doneAt(t));
    return [...set.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }, [trades]);
  const [chosen, setChosen] = useState(null);
  const day = chosen && days.includes(chosen) ? chosen : days[0];

  const s = useMemo(() => {
    if (!day) return null;
    const list = trades.filter((t) => t.outcome && dayKey(doneAt(t)) === day).sort((a, b) => doneAt(a) - doneAt(b));
    if (!list.length) return null;
    let cum = 0;
    const points = list.map((t) => ({ t: doneAt(t), cum: (cum += Number(t.profitLoss) || 0), trade: t }));
    const best = list.reduce((a, b) => ((Number(b.profitLoss) || 0) > (Number(a.profitLoss) || 0) ? b : a));
    const worst = list.reduce((a, b) => ((Number(b.profitLoss) || 0) < (Number(a.profitLoss) || 0) ? b : a));
    const high = points.reduce((a, b) => (b.cum > a.cum ? b : a));
    const low = points.reduce((a, b) => (b.cum < a.cum ? b : a));
    const wins = list.filter((t) => t.outcome === "win").length;
    const losses = list.filter((t) => t.outcome === "loss").length;
    const avgDur = list.reduce((a, t) => a + Math.max(0, doneAt(t) - openedTime(t)), 0) / list.length;
    return { list, points, best, worst, high, low, total: cum, wins, losses, avgDur };
  }, [trades, day]);

  if (!days.length || !s) return null;
  const label = (t) => `${t.pair} ${String(t.direction).toUpperCase()}`;
  const isToday = day === todayKey;

  return (
    <section className="mb-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4" aria-label="Day summary">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <p className="font-bold text-slate-900 dark:text-white">{isToday ? "Today" : new Date(day).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {s.list.length} closed · {s.wins} W / {s.losses} L · avg {fmtDuration(s.avgDur)} open
          </p>
        </div>
        <div className="text-right">
          <p className={`text-xl font-bold tabular-nums ${color(s.total)}`}>{money(s.total)}</p>
          <select value={day} onChange={(e) => setChosen(e.target.value)} aria-label="Day"
            className="mt-1 text-xs bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-slate-700 dark:text-slate-200">
            {days.slice(0, 60).map((k) => (
              <option key={k} value={k}>{k === todayKey ? "Today" : new Date(k).toLocaleDateString([], { day: "numeric", month: "short", year: "2-digit" })}</option>
            ))}
          </select>
        </div>
      </div>

      <Curve points={s.points} high={s.high} low={s.low} />

      <div className="grid grid-cols-2 gap-2 mt-2">
        <Stat label="Best trade" value={money(Number(s.best.profitLoss) || 0)} cls={color(Number(s.best.profitLoss) || 0)} sub={`${label(s.best)} · ${time(doneAt(s.best))}`} />
        <Stat label="Worst trade" value={money(Number(s.worst.profitLoss) || 0)} cls={color(Number(s.worst.profitLoss) || 0)} sub={`${label(s.worst)} · ${time(doneAt(s.worst))}`} />
        <Stat label="Day's P/L peak" value={money(s.high.cum)} cls={color(s.high.cum)} sub={`at ${time(s.high.t)} 🟢`} />
        <Stat label="Day's P/L low" value={money(s.low.cum)} cls={color(s.low.cum)} sub={`at ${time(s.low.t)} 🔴`} />
      </div>
    </section>
  );
}

export default DaySummary;
