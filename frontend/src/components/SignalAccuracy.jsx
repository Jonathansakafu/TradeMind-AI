import { useEffect, useState } from "react";
import axios from "axios";
import { API_URL } from "../config/api";
import { useAuth } from "../hooks/useAuth";

// How the AI's forex/gold signals actually played out (checked against real
// prices on the server, taken or not): win rate and net result in R per
// pair and direction. R = multiples of the risk (stop distance).
function SignalAccuracy({ days = 30, card }) {
  const { headers } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => {
    axios.get(`${API_URL}/api/notifications/signal-stats`, { headers, params: { days } })
      .then((r) => setData(r.data))
      .catch(() => setData({ rows: [], pending: 0 }));
  }, [headers, days]);

  if (!data) return null;
  const totals = data.rows.reduce((t, r) => ({ wins: t.wins + r.wins, losses: t.losses + r.losses, expired: t.expired + r.expired, R: t.R + r.totalR }), { wins: 0, losses: 0, expired: 0, R: 0 });
  const decided = totals.wins + totals.losses;
  const rows = [...data.rows].sort((a, b) => (b.wins + b.losses) - (a.wins + a.losses));

  return (
    <div className={`${card} mt-6`}>
      <h3 className="font-bold text-slate-900 dark:text-white">AI signal accuracy (last {days} days)</h3>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Every forex/gold signal is checked against real prices: did it reach take profit or stop loss first? Counted whether or not you took it.</p>
      {decided === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No signals finished yet{data.pending ? ` — ${data.pending} being tracked` : ""}. Results appear as signals reach their target or stop.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm mb-4">
            <span className="text-slate-700 dark:text-slate-300">Hit target: <b className="text-slate-900 dark:text-white">{Math.round((totals.wins / decided) * 100)}%</b> ({totals.wins}/{decided})</span>
            <span className="text-slate-700 dark:text-slate-300">Net: <b className={totals.R >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>{totals.R >= 0 ? "+" : ""}{totals.R.toFixed(1)}R</b></span>
            {totals.expired > 0 && <span className="text-slate-500 dark:text-slate-400">{totals.expired} expired</span>}
            {data.pending > 0 && <span className="text-slate-500 dark:text-slate-400">{data.pending} still open</span>}
          </div>
          <ul className="space-y-3">
            {rows.map((r) => {
              const d = r.wins + r.losses;
              const wr = d ? (r.wins / d) * 100 : 0;
              return (
                <li key={`${r.pair}-${r.signal}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm mb-1">
                    <span className="font-semibold text-slate-900 dark:text-white">{r.pair} {r.signal.toUpperCase()}</span>
                    <span className="text-slate-600 dark:text-slate-300">
                      <b className="text-slate-900 dark:text-white">{d ? `${Math.round(wr)}%` : "—"}</b> · {r.wins}/{d} hit target ·{" "}
                      <span className={r.totalR >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>{r.totalR >= 0 ? "+" : ""}{r.totalR.toFixed(1)}R</span>
                    </span>
                  </div>
                  <div className="h-2.5 rounded-full" style={{ background: "var(--viz-track)" }}>
                    <div className="h-2.5 rounded-full" style={{ width: `${Math.max(wr, 1.5)}%`, background: "var(--viz-line)" }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

export default SignalAccuracy;
