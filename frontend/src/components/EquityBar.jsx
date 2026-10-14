import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, TrendingUp, TrendingDown } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useEquityLive } from "../hooks/useEquityLive";
import { useRiskSettings } from "../hooks/useRiskSettings";
import { useNow } from "../hooks/useLiveQuotes";

// Equity card on every page (added 2026-10-14): today's (or the last 7
// days') P/L now, the highest profit and the deepest loss the account's
// equity reached in that time and when -- refreshed every 3 s. Blue =
// profit, red = loss (like MT5). Hidden when there's nothing to show.

const money = (v) => `${v > 0 ? "+" : v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;
const color = (v) => (v > 0 ? "text-blue-600 dark:text-blue-400" : v < 0 ? "text-red-500" : "text-slate-500 dark:text-slate-400");
const clock = (t, period) => new Date(t).toLocaleString([], period === "7d" ? { weekday: "short", hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit" });

function Curve({ points, peak, low }) {
  if (!points || points.length < 2) return null;
  const W = 320, H = 80, pad = 6;
  const vals = [0, ...points.map((p) => p.v), peak.value, low.value];
  const min = Math.min(...vals), max = Math.max(...vals);
  const t0 = points[0].t, t1 = Math.max(points.at(-1).t, peak.at, low.at);
  const x = (t) => pad + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * pad);
  const y = (v) => H - pad - ((v - min) / Math.max(1e-9, max - min)) * (H - 2 * pad);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20" role="img" aria-label="Equity through the period">
      <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} className="stroke-slate-300 dark:stroke-slate-700" strokeDasharray="3 3" />
      <path d={d} fill="none" strokeWidth="2" className={points.at(-1).v >= 0 ? "stroke-blue-500" : "stroke-red-500"} />
      <circle cx={x(peak.at)} cy={y(peak.value)} r="4" className="fill-blue-500" />
      <circle cx={x(low.at)} cy={y(low.value)} r="4" className="fill-red-500" />
    </svg>
  );
}

function EquityBar() {
  const { headers } = useAuth();
  const [period, setPeriod] = useState("today");
  const [open, setOpen] = useState(false);
  const { data, current, peak, low, updatedAt } = useEquityLive(headers, period);
  const { settings } = useRiskSettings();
  const now = useNow(1000);

  const hasActivity = data && (data.open?.length || data.realized !== 0 || data.points?.some((p) => p.v !== 0));
  if (!data || current == null || !peak || !low || !hasActivity) return null;
  const balance = Number(settings?.balance) || null;
  const ago = updatedAt ? Math.max(0, Math.round((now - updatedAt) / 1000)) : null;
  const label = period === "today" ? "Today" : "7 days";

  return (
    <section className="mb-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden" aria-label="Equity">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left">
        <div className="min-w-0">
          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">{label} P/L{data.open?.length ? ` · ${data.open.length} open` : ""}</p>
          <p className={`text-lg font-bold tabular-nums leading-tight ${color(current)}`} aria-live="polite">{money(current)}</p>
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs tabular-nums">
          <span className="text-right" title="Highest profit equity reached">
            <span className="flex items-center justify-end gap-1 text-blue-600 dark:text-blue-400 font-semibold"><TrendingUp size={12} />{money(peak.value)}</span>
            <span className="text-slate-400">{clock(peak.at, period)}</span>
          </span>
          <span className="text-right" title="Deepest loss equity reached">
            <span className="flex items-center justify-end gap-1 text-red-500 font-semibold"><TrendingDown size={12} />{money(low.value)}</span>
            <span className="text-slate-400">{clock(low.at, period)}</span>
          </span>
          <ChevronDown size={16} className={`text-slate-400 transition ${open ? "rotate-180" : ""}`} />
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between pt-2">
            <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-100 dark:bg-slate-800">
              {[["today", "Today"], ["7d", "7 days"]].map(([v, l]) => (
                <button key={v} type="button" onClick={() => setPeriod(v)} aria-pressed={period === v}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold ${period === v ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow" : "text-slate-500 dark:text-slate-400"}`}>
                  {l}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-slate-400">updated {ago != null && ago < 2 ? "just now" : `${ago}s ago`}</span>
          </div>
          <Curve points={data.points} peak={peak} low={low} />
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl bg-blue-500/10 p-2.5">
              <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Highest profit</p>
              <p className="font-bold tabular-nums text-blue-600 dark:text-blue-400">{money(peak.value)}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">at {clock(peak.at, period)}{balance != null ? ` · equity ${(balance + peak.value).toFixed(2)}` : ""}</p>
            </div>
            <div className="rounded-xl bg-red-500/10 p-2.5">
              <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Deepest loss</p>
              <p className="font-bold tabular-nums text-red-500">{money(low.value)}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">at {clock(low.at, period)}{balance != null ? ` · equity ${(balance + low.value).toFixed(2)}` : ""}</p>
            </div>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            Closed trades plus open trades at live prices, measured from the start of the {period === "today" ? "day" : "7 days"}.{" "}
            <Link to="/history" className="underline">Trade History</Link>
          </p>
        </div>
      )}
    </section>
  );
}

export default EquityBar;
