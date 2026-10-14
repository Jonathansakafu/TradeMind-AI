import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { useLiveQuotes, useNow } from "../hooks/useLiveQuotes";
import { floatingPL, fmtDuration, openedTime } from "../utils/livePL";

// MT5-style "Trade" panel for Trade History (added 2026-10-14): the total
// floating profit / loss of all open trades at the top, balance and equity,
// and each position (pair, direction, lot, entry -> current price, live
// profit, time open) -- refreshed every 3 s from live bid / ask. Blue =
// profit, red = loss, like MT5.

const fmt = (v, d = 2) => Number(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const signed = (v) => `${v > 0 ? "" : v < 0 ? "-" : ""}${fmt(Math.abs(v))}`;
const plColor = (v) => (v > 0 ? "text-blue-600 dark:text-blue-400" : v < 0 ? "text-red-500" : "text-slate-500");
const digits = (pair) => (pair === "XAUUSD" ? 2 : /JPY$/.test(pair) ? 3 : 5);

function Ago({ at }) {
  const now = useNow(1000);
  if (!at) return null;
  const s = Math.max(0, Math.round((now - at) / 1000));
  return <>{s < 2 ? "just now" : `${s}s ago`}</>;
}

export function LiveDuration({ trade }) {
  const now = useNow(1000);
  return <>{fmtDuration(now - openedTime(trade))}</>;
}

function Position({ trade, quote }) {
  const [open, setOpen] = useState(false);
  const live = floatingPL(trade, quote);
  const d = digits(trade.pair);
  return (
    <li className="border-t border-slate-200 dark:border-slate-800">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full text-left px-4 py-3 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-bold text-slate-900 dark:text-white">
            {trade.pair}{" "}
            <span className={trade.direction === "buy" ? "text-blue-600 dark:text-blue-400" : "text-red-500"}>{trade.direction} {trade.lotSize || 0.01}</span>
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {fmt(trade.entryPrice, d)} → {live ? fmt(live.price, d) : "…"}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className={`text-xl font-bold tabular-nums ${live ? plColor(live.pl) : "text-slate-400"}`}>{live ? signed(live.pl) : "—"}</p>
          <p className="text-xs text-slate-400 tabular-nums">⏱ <LiveDuration trade={trade} /></p>
        </div>
        <ChevronDown size={16} className={`text-slate-400 transition flex-shrink-0 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-4 pb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          <span>Opened</span><span className="text-right text-slate-700 dark:text-slate-200">{new Date(openedTime(trade)).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          <span>S / L</span><span className="text-right font-mono text-red-500">{trade.stopLoss ? fmt(trade.stopLoss, d) : "—"}</span>
          <span>T / P</span><span className="text-right font-mono text-green-600 dark:text-green-400">{trade.takeProfit ? fmt(trade.takeProfit, d) : "—"}</span>
          <span>Pips</span><span className="text-right font-mono">{live ? fmt(live.pips, 1) : "—"}</span>
          <span>Price</span><span className="text-right">{quote ? `${quote.source}${quote.stale ? " (delayed)" : ""}` : "—"}</span>
          {trade.locked && <span className="col-span-2 text-amber-600 dark:text-amber-400 mt-1">Group trade — closes itself at TP / SL.</span>}
        </div>
      )}
    </li>
  );
}

function LivePositions({ trades, headers, balance, todayClosedPL }) {
  const open = trades.filter((t) => !t.outcome && t.entryPrice);
  const { quotes, updatedAt } = useLiveQuotes(open.map((t) => t.pair), headers);
  if (!open.length) return null;

  const lives = open.map((t) => floatingPL(t, quotes[t.pair]));
  const priced = lives.filter(Boolean);
  const total = priced.reduce((s, x) => s + x.pl, 0);
  const bal = Number(balance) || null;

  return (
    <section className="mb-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden" aria-label="Open positions">
      <div className="px-4 pt-4 pb-3 text-center">
        <p className={`text-3xl font-bold tabular-nums ${priced.length ? plColor(total) : "text-slate-400"}`} aria-live="polite">
          {priced.length ? `${signed(total)} USD` : "…"}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Floating P/L · {open.length} open trade{open.length === 1 ? "" : "s"} · updated <Ago at={updatedAt} />
        </p>
      </div>
      <dl className="px-4 pb-3 grid grid-cols-2 gap-y-1 text-sm">
        {bal != null ? (
          <>
            <dt className="text-slate-500 dark:text-slate-400">Balance</dt><dd className="text-right tabular-nums text-slate-900 dark:text-white">{fmt(bal)}</dd>
            <dt className="text-slate-500 dark:text-slate-400">Equity</dt><dd className="text-right tabular-nums text-slate-900 dark:text-white">{fmt(bal + total)}</dd>
          </>
        ) : (
          <dd className="col-span-2 text-xs text-slate-500 dark:text-slate-400">
            Add your balance in <Link to="/settings" className="underline">Settings → Risk</Link> to see equity.
          </dd>
        )}
        {todayClosedPL != null && (
          <>
            <dt className="text-slate-500 dark:text-slate-400">Closed today</dt>
            <dd className={`text-right tabular-nums ${plColor(todayClosedPL)}`}>{signed(todayClosedPL)}</dd>
          </>
        )}
      </dl>
      <p className="px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/40">Positions</p>
      <ul>
        {open.map((t) => <Position key={t._id} trade={t} quote={quotes[t.pair]} />)}
      </ul>
      <p className="px-4 py-2 text-[11px] text-slate-400 border-t border-slate-200 dark:border-slate-800">
        Live bid / ask (BUY valued at bid, SELL at ask). Your broker's prices and spread can differ slightly. Ongoing trades don't count in performance until closed.
      </p>
    </section>
  );
}

export default LivePositions;
