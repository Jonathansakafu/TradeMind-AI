import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { CalendarDays, Zap, Loader2, ArrowUp, ArrowDown } from "lucide-react";
import MainLayout from "../layouts/MainLayout";
import { API_URL } from "../config/api";
import { useAuth } from "../hooks/useAuth";

// Economic Calendar: this week's high-impact releases with a "Check impact"
// button -- expected move and higher/lower-than-forecast scenarios before a
// release, the measured market reaction after it (GET /api/market/calendar,
// /api/market/news-impact; services/newsImpact.js on the server).

const MY_CCYS = ["USD", "EUR", "GBP"];
const localTime = (d) => new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const utcTime = (d) => new Date(d).toISOString().slice(11, 16);
const dayLabel = (d) => new Date(d).toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });

function countdown(time) {
  const mins = Math.round((new Date(time) - Date.now()) / 60000);
  const abs = Math.abs(mins);
  const txt = abs >= 1440 ? `${Math.floor(abs / 1440)}d ${Math.floor((abs % 1440) / 60)}h` : abs >= 60 ? `${Math.floor(abs / 60)}h ${abs % 60}m` : `${abs} min`;
  return mins > 0 ? `in ${txt}` : `released ${txt} ago`;
}

const card = "min-w-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4";

function Move({ value }) {
  if (!value) return <span className="text-slate-400">—</span>;
  const up = value.startsWith("+");
  return (
    <span className={`font-mono font-semibold whitespace-nowrap ${up ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
      {up ? <ArrowUp size={12} className="inline -mt-0.5" /> : <ArrowDown size={12} className="inline -mt-0.5" />}{value.replace(/^[+-]/, "")}
    </span>
  );
}

function ImpactPanel({ result }) {
  if (result.error) return <p className="text-sm text-red-500 mt-3">{result.error}</p>;
  const { released, perPair, scenarios, quietWindow, summary, currency } = result;
  return (
    <div className="mt-4 space-y-4 border-t border-slate-200 dark:border-slate-800 pt-4">
      {summary && (
        <div className="rounded-xl bg-green-500/10 border border-green-500/20 p-3 text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
          <p className="text-xs font-semibold text-green-700 dark:text-green-400 mb-1">AI read</p>
          {summary}
        </div>
      )}

      {released ? (
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-white mb-2">Market reaction</p>
          <div className="space-y-2">
            {perPair.map((p) => (
              <div key={p.pair} className="rounded-xl bg-slate-100 dark:bg-slate-800 p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="font-bold text-slate-900 dark:text-white">{p.pair}</span>
                  {p.reaction ? (
                    <span className="text-slate-600 dark:text-slate-300">
                      <Move value={p.reaction.sinceRelease} /> in {p.reaction.minutes} min
                      {p.reaction.atrMultiple != null && <> · {p.reaction.atrMultiple.toFixed(1)}× normal hourly move</>}
                    </span>
                  ) : <span className="text-slate-500 text-xs">{p.error || "price data not available yet"}</span>}
                </div>
                {p.reaction && (
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2 text-xs text-slate-600 dark:text-slate-400">
                    <span>After 15 min: <Move value={p.reaction.after15} /></span>
                    <span>After 1 hour: <Move value={p.reaction.after60} /></span>
                    <span>Biggest up: <Move value={p.reaction.biggestUp} /></span>
                    <span>Biggest down: <Move value={p.reaction.biggestDown} /></span>
                    <span className="col-span-2">{currency} went <b className="text-slate-900 dark:text-white">{p.reaction.currencyWent}</b></span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white mb-2">Expected move</p>
            <div className="space-y-1.5">
              {perPair.map((p) => (
                <div key={p.pair} className="flex flex-wrap justify-between gap-x-3 text-sm">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{p.pair}</span>
                  <span className="text-slate-600 dark:text-slate-300">
                    {p.expected ? <>±{p.unit === "$" ? "$" : ""}{Math.round(p.expected.low)}–{Math.round(p.expected.high)}{p.unit === "pips" ? " pips" : ""}</> : "—"}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Typical size of the first move, from each pair's normal hourly range.</p>
          </div>
          {scenarios && (
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white mb-2">If the result is…</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                {[["higher", "Higher than forecast"], ["lower", "Lower than forecast"]].map(([k, label]) => (
                  <div key={k} className="rounded-xl bg-slate-100 dark:bg-slate-800 p-3">
                    <p className="font-semibold text-slate-900 dark:text-white">{label}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{currency} {scenarios[k].currency}</p>
                    {Object.entries(scenarios[k].pairs).map(([pair, dir]) => (
                      <p key={pair} className="flex justify-between">
                        <span className="text-slate-700 dark:text-slate-300">{pair}</span>
                        <span className={dir.startsWith("↑") ? "text-green-600 dark:text-green-400 font-semibold" : "text-red-600 dark:text-red-400 font-semibold"}>{dir}</span>
                      </p>
                    ))}
                  </div>
                ))}
              </div>
              {scenarios.note && <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">{scenarios.note}</p>}
            </div>
          )}
        </>
      )}

      <p className="text-xs text-slate-500 dark:text-slate-400">
        TradeMind pauses new signals for these pairs from {localTime(quietWindow.from)} to {localTime(quietWindow.to)} ({utcTime(quietWindow.from)}–{utcTime(quietWindow.to)} UTC).
      </p>
    </div>
  );
}

function Calendar() {
  const { headers } = useAuth();
  const [events, setEvents] = useState(null);
  const [mine, setMine] = useState(true);
  const [open, setOpen] = useState({}); // id -> result | "loading"

  useEffect(() => {
    axios.get(`${API_URL}/api/market/calendar`, { headers })
      .then((r) => setEvents(r.data.events || []))
      .catch(() => setEvents([]));
  }, [headers]);

  const check = async (id) => {
    setOpen((o) => ({ ...o, [id]: "loading" }));
    try {
      const r = await axios.get(`${API_URL}/api/market/news-impact`, { headers, params: { id } });
      setOpen((o) => ({ ...o, [id]: r.data }));
    } catch (err) {
      setOpen((o) => ({ ...o, [id]: { error: err.response?.data?.message || "Couldn't check the impact — try again." } }));
    }
  };

  const days = useMemo(() => {
    const list = (events || []).filter((e) => !mine || MY_CCYS.includes(e.currency));
    const map = new Map();
    for (const e of list) {
      const k = new Date(e.time).toDateString();
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(e);
    }
    return [...map.entries()];
  }, [events, mine]);

  return (
    <MainLayout>
      <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold flex items-center gap-3 mb-1">
        <CalendarDays className="text-green-600 dark:text-green-400" size={30} /> Economic Calendar
      </h2>
      <p className="text-slate-500 dark:text-slate-400 mb-5">This week's high-impact news. Tap <b>Check impact</b> to see what a release can do — or did — to your pairs.</p>

      <div className="inline-flex flex-wrap rounded-xl border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-100 dark:bg-slate-800 mb-5">
        {[[true, "My pairs (USD · EUR · GBP)"], [false, "All currencies"]].map(([v, label]) => (
          <button key={label} onClick={() => setMine(v)} aria-pressed={mine === v}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${mine === v ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow" : "text-slate-500 dark:text-slate-400"}`}>
            {label}
          </button>
        ))}
      </div>

      {events === null ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-green-500" /></div>
      ) : days.length === 0 ? (
        <div className={`${card} text-center py-12 text-slate-500 dark:text-slate-400`}>No high-impact releases this week{mine ? " for your pairs" : ""} (or the calendar is unavailable right now).</div>
      ) : (
        <div className="space-y-6">
          {days.map(([day, list]) => (
            <section key={day}>
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">{dayLabel(list[0].time)}</h3>
              <div className="space-y-3">
                {list.map((e) => {
                  const state = open[e.id];
                  const upcoming = new Date(e.time) > new Date();
                  return (
                    <div key={e.id} className={card}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <span className="font-mono text-sm font-bold text-slate-900 dark:text-white">{localTime(e.time)}</span>
                            <span className="text-xs text-slate-500">{utcTime(e.time)} UTC</span>
                            <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200">{e.currency}</span>
                            {e.topTier && <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-red-500/15 text-red-600 dark:text-red-400">TOP-TIER</span>}
                          </div>
                          {e.events.map((ev) => (
                            <p key={ev.title} className="text-sm text-slate-800 dark:text-slate-200">
                              <span className="font-semibold">{ev.title}</span>
                              {(ev.forecast || ev.previous) && <span className="text-slate-500 dark:text-slate-400"> · f {ev.forecast || "—"} · p {ev.previous || "—"}</span>}
                            </p>
                          ))}
                          <p className={`text-xs mt-1 ${upcoming ? "text-amber-600 dark:text-amber-400" : "text-slate-500 dark:text-slate-400"}`}>
                            {countdown(e.time)}{e.pairs.length ? ` · affects ${e.pairs.join(", ")}` : " · doesn't affect your pairs"}
                          </p>
                        </div>
                      </div>
                      {e.pairs.length > 0 && (
                        <button onClick={() => check(e.id)} disabled={state === "loading"}
                          className="mt-3 inline-flex items-center gap-2 bg-green-500 hover:bg-green-600 disabled:opacity-60 text-slate-950 font-semibold text-sm px-4 py-2 rounded-xl transition">
                          {state === "loading" ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
                          {state && state !== "loading" ? "Refresh impact" : "Check impact"}
                        </button>
                      )}
                      {state && state !== "loading" && <ImpactPanel result={state} />}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-6">Times in your phone's time zone, with UTC. Source: ForexFactory high-impact calendar. Not financial advice.</p>
    </MainLayout>
  );
}

export default Calendar;
