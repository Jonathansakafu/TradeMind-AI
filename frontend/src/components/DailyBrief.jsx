import { useEffect, useState } from "react";
import axios from "axios";
import { CalendarDays, AlertOctagon, ChevronDown } from "lucide-react";
import { API_URL } from "../config/api";
import { useAuth } from "../hooks/useAuth";
import { useRiskSettings } from "../hooks/useRiskSettings";

// Warning once today's closed losses reach the daily loss limit -- kept at
// the top of the Dashboard because it should be seen.
export function DailyLossBanner() {
  const { settings } = useRiskSettings();
  if (!settings?.dailyLimitHit) return null;
  return (
    <div className="mb-6 flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-red-700 dark:text-red-300">
      <AlertOctagon size={20} className="flex-shrink-0 mt-0.5" />
      <div className="text-sm">
        <p className="font-bold">Daily loss limit reached</p>
        <p>Today's closed P/L is {Number(settings.todayPL).toFixed(2)} {settings.currency}. MT5 auto-send is paused until tomorrow — consider stopping for today.</p>
      </div>
    </div>
  );
}

// Pulls "EURUSD: buy …" style lines out of the plan for the compact chips.
const PAIR_LINE = /^\W*(EURUSD|GBPUSD|XAUUSD)\b[^a-z]*\b(buy|sell|wait)?/i;
function parseBias(text) {
  return (text || "").split("\n").map((l) => l.match(PAIR_LINE)).filter(Boolean)
    .map((m) => ({ pair: m[1].toUpperCase(), bias: (m[2] || "").toLowerCase() }));
}
const CHIP = {
  buy: "bg-green-500/15 text-green-700 dark:text-green-400",
  sell: "bg-red-500/15 text-red-700 dark:text-red-400",
  wait: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
};

const OPEN_KEY = "dash.planOpen";
function readOpen(date) {
  try { return JSON.parse(localStorage.getItem(OPEN_KEY) || "{}")[date] === true; } catch { return false; }
}

// Today's pre-London plan (services/morningBrief.js): a compact row with a
// bias chip per pair, tap to expand the full text. Collapsed by default so
// it doesn't push the Dashboard's numbers down; the choice is remembered
// for the day.
export default function TodaysPlan() {
  const { headers } = useAuth();
  const [brief, setBrief] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    axios.get(`${API_URL}/api/notifications/brief`, { headers })
      .then((r) => {
        setBrief(r.data.brief);
        if (r.data.brief?.date) setOpen(readOpen(r.data.brief.date));
      })
      .catch(() => {});
  }, [headers]);

  if (!brief?.text || brief.status !== "sent") return null;
  const isToday = brief.date === new Date().toISOString().slice(0, 10);
  const chips = parseBias(brief.text);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(OPEN_KEY, JSON.stringify({ [brief.date]: next })); } catch { /* ignore */ }
  };

  return (
    <div className="mb-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      <button onClick={toggle} aria-expanded={open} className="w-full px-4 py-3 text-left">
        <span className="flex items-center gap-3">
          <CalendarDays size={18} className="text-green-600 dark:text-green-400 flex-shrink-0" />
          <span className="font-semibold text-slate-900 dark:text-white flex-1">{isToday ? "Today's plan" : `Plan · ${brief.date}`}</span>
          <span className="text-xs text-slate-500 dark:text-slate-400">{open ? "Hide" : "Details"}</span>
          <ChevronDown size={18} className={`text-slate-400 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
        {chips.length > 0 && (
          <span className="flex flex-wrap gap-1.5 mt-2 pl-[30px]">
            {chips.map((c) => (
              <span key={c.pair} className={`text-[11px] font-bold px-2 py-0.5 rounded-md whitespace-nowrap ${CHIP[c.bias] || CHIP.wait}`}>
                {c.pair}{c.bias ? ` ${c.bias.toUpperCase()}` : ""}
              </span>
            ))}
          </span>
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-slate-200 dark:border-slate-800 mx-4 px-0">
          <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-line leading-relaxed">{brief.text}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">Made before the London open from price structure and the news calendar. Not financial advice.</p>
        </div>
      )}
    </div>
  );
}
