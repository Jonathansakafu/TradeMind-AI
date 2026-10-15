import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { domToBlob } from "modern-screenshot";
import { AlertTriangle, CheckCircle2, XCircle, Loader2, Lock, MinusCircle, Camera, UploadCloud, Clock } from "lucide-react";
import TradeSnapshot from "./TradeSnapshot";
import SignalChart from "./SignalChart";
import { API_URL } from "../config/api";
import { useTheme } from "../hooks/useTheme";
import { tradeFromSignal } from "../utils/groupRecord";

// Record many signals as trades in one go (Notifications > Record trades,
// added 2026-10-14). Each trade is built exactly from its signal: entry,
// SL, TP; exit = TP if TradeMind saw it hit TP, SL if it hit SL, otherwise
// saved open; lot size chosen once for all; a chart screenshot generated
// per trade. Group-recorded trades are locked (the server refuses edits;
// an open one can still be closed once).

const fmtTime = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
};

const money = (v) => `${Number(v) >= 0 ? "+" : "-"}$${Math.abs(Number(v)).toFixed(2)}`;

// ---------- selection bar ----------

export function GroupRecordBar({ selectedCount, todaysCount, lot, onLot, onSelectToday, onClear, onRecord, onCancel }) {
  return (
    // Sits above the floating AI chat button so it can use the full width.
    <div className="fixed left-0 right-0 z-[60] px-3 lg:pl-72" style={{ bottom: "calc(env(safe-area-inset-bottom) + 5.25rem)" }}>
      <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 backdrop-blur shadow-2xl p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-bold text-slate-900 dark:text-white whitespace-nowrap">{selectedCount} selected</p>
          <div className="flex items-center gap-1.5">
            <button onClick={onSelectToday} disabled={!todaysCount}
              className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 disabled:opacity-40 whitespace-nowrap">
              Today's ({todaysCount})
            </button>
            {selectedCount > 0 && (
              <button onClick={onClear} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg text-slate-500 dark:text-slate-400">Clear</button>
            )}
            <button onClick={onCancel} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg text-slate-500 dark:text-slate-400">Cancel</button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 flex-shrink-0" htmlFor="group-lot">
            Lot
            <input id="group-lot" type="number" step="0.01" min="0.01" inputMode="decimal" value={lot} onChange={(e) => onLot(e.target.value)}
              className="w-20 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:border-green-500 px-2 py-2 rounded-lg outline-none font-mono text-sm text-slate-900 dark:text-white" />
          </label>
          <button onClick={onRecord} disabled={!selectedCount || !(Number(lot) > 0)}
            className="flex-1 bg-green-500 hover:bg-green-600 disabled:opacity-40 text-slate-950 font-bold text-sm py-2.5 rounded-xl transition">
            Record {selectedCount || ""} trade{selectedCount === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- warning + progress ----------

const STATUS = {
  waiting: { icon: Clock, text: "Waiting", cls: "text-slate-400" },
  chart: { icon: Camera, text: "Creating chart", cls: "text-blue-500", spin: false },
  saving: { icon: UploadCloud, text: "Saving", cls: "text-blue-500" },
  saved: { icon: CheckCircle2, text: "Saved", cls: "text-green-600 dark:text-green-400" },
  skipped: { icon: MinusCircle, text: "Already recorded", cls: "text-amber-600 dark:text-amber-400" },
  failed: { icon: XCircle, text: "Failed", cls: "text-red-500" },
};

export function GroupRecordFlow({ signals, lot, headers, onClose, onFinished }) {
  const [stage, setStage] = useState("warn"); // warn | run | done
  const [understood, setUnderstood] = useState(false);
  const [items, setItems] = useState(() => signals.map((n) => ({ ...tradeFromSignal(n, Number(lot)), status: "waiting", error: null })));
  const [current, setCurrent] = useState(null);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const snapRef = useRef(null);
  const chartRef = useRef(null);
  const chartWait = useRef(null); // resolves true when the trade's chart has drawn, false if it failed
  const listRef = useRef(null);
  const cancelRef = useRef(false);
  const { theme } = useTheme();

  const wins = items.filter((t) => t.pl?.outcome === "win").length;
  const losses = items.filter((t) => t.pl?.outcome === "loss").length;
  const open = items.filter((t) => !t.pl).length;
  const total = items.reduce((s, t) => s + (t.pl ? Number(t.pl.pl) : 0), 0);
  const finishedCount = items.filter((t) => ["saved", "skipped", "failed"].includes(t.status)).length;
  const savedCount = items.filter((t) => t.status === "saved").length;
  const failedCount = items.filter((t) => t.status === "failed").length;
  const skippedCount = items.filter((t) => t.status === "skipped").length;
  const pct = items.length ? Math.round((finishedCount / items.length) * 100) : 0;

  useEffect(() => {
    if (stage !== "run") return undefined;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [stage]);

  const setStatus = (id, status, error = null) =>
    setItems((list) => list.map((t) => (t.id === id ? { ...t, status, error } : t)));

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const run = async (only) => {
    cancelRef.current = false;
    setStage("run");
    const t0 = Date.now();
    setStartedAt(t0);
    setNow(t0);
    const batchId = `batch-${t0}`;
    const queue = items.filter((t) => (only ? only.includes(t.status) : t.status === "waiting"));
    if (only) setItems((list) => list.map((t) => (only.includes(t.status) ? { ...t, status: "waiting", error: null } : t)));
    for (const t of queue) {
      if (cancelRef.current) break;
      listRef.current?.querySelector(`[data-id="${t.id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      try {
        setStatus(t.id, "chart");
        // The real candle chart with the signal's drawings; the plain
        // snapshot if it can't load within 15 s.
        const ready = new Promise((resolve) => {
          chartWait.current = resolve;
          setTimeout(() => resolve(false), 15000);
        });
        setCurrent(t);
        const drawn = await ready;
        await nextFrame();
        let blob = drawn && chartRef.current ? await chartRef.current.capture().catch(() => null) : null;
        if (!blob && snapRef.current) {
          blob = await domToBlob(snapRef.current, { backgroundColor: theme === "dark" ? "#020617" : "#ffffff", scale: 2, type: "image/png" });
        }
        setStatus(t.id, "saving");
        const fd = new FormData();
        const fields = {
          pair: t.pair, direction: t.direction, entryPrice: t.entryPrice, stopLoss: t.stopLoss, takeProfit: t.takeProfit,
          lotSize: t.lotSize, openedAt: t.openedAt, session: t.session, notes: t.notes,
          notificationId: t.id, locked: "true", batchId,
        };
        if (t.exitPrice != null) {
          Object.assign(fields, { exitPrice: t.exitPrice, status: "closed", closedAt: t.closedAt, profitLoss: t.pl.pl, outcome: t.pl.outcome });
        }
        Object.entries(fields).forEach(([k, v]) => { if (v != null && v !== "") fd.append(k, v); });
        if (blob) fd.append("screenshot", new File([blob], `trade-${t.pair}-${t.id}.png`, { type: "image/png" }));
        await axios.post(`${API_URL}/api/trades`, fd, { headers: { ...headers, "Content-Type": "multipart/form-data" } });
        setStatus(t.id, "saved");
      } catch (err) {
        if (err.response?.status === 409) setStatus(t.id, "skipped");
        else setStatus(t.id, "failed", err.response?.data?.message || "Network error");
      }
    }
    setCurrent(null);
    setNow(Date.now());
    setStage("done");
    onFinished?.();
  };

  const elapsed = stage === "warn" ? 0 : now - startedAt;
  const perItem = finishedCount ? elapsed / finishedCount : 0;
  const remaining = perItem ? perItem * (items.length - finishedCount) : 0;
  const R = 38, C = 2 * Math.PI * R;

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-label="Record trades"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl w-full max-w-md shadow-2xl max-h-[92vh] flex flex-col">

        {stage === "warn" ? (
          <>
            <div className="px-5 pt-5 pb-3 flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-500/15 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="text-amber-500" size={20} />
              </div>
              <div>
                <p className="font-bold text-slate-900 dark:text-white">Record {items.length} trade{items.length === 1 ? "" : "s"} as a group?</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Lot size {Number(lot)} for each</p>
              </div>
            </div>
            <div className="px-5 space-y-3 overflow-y-auto">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-green-500/10 p-2"><p className="text-lg font-bold text-green-600 dark:text-green-400">{wins}</p><p className="text-[11px] text-slate-500 dark:text-slate-400">hit TP</p></div>
                <div className="rounded-xl bg-red-500/10 p-2"><p className="text-lg font-bold text-red-500">{losses}</p><p className="text-[11px] text-slate-500 dark:text-slate-400">hit SL</p></div>
                <div className="rounded-xl bg-slate-100 dark:bg-slate-800 p-2"><p className="text-lg font-bold text-slate-700 dark:text-slate-200">{open}</p><p className="text-[11px] text-slate-500 dark:text-slate-400">ongoing</p></div>
              </div>
              {wins + losses > 0 && (
                <p className="text-sm text-slate-600 dark:text-slate-300">Result of the closed ones: <b className={total >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500"}>{money(total)}</b></p>
              )}
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200 space-y-1.5">
                <p className="font-bold flex items-center gap-1.5"><Lock size={13} /> Group-recorded trades can't be edited</p>
                <p>Each trade is saved exactly from its signal: entry, SL and TP; exit = <b>TP</b> if it hit TP, <b>SL</b> if it hit SL, otherwise it is saved as <b>ongoing</b>. A chart screenshot is generated for each.</p>
                {open > 0 && <p>Ongoing trades don't count in your performance until they close: TradeMind closes them itself the moment price hits their TP or SL, or you close them in Trade History. If a signal expires without hitting either, you'll be reminded to close it.</p>}
                <p>Afterwards you can't change prices, lot size or results. If a trade was different, record it on its own with <b>Add Trade</b> instead.</p>
              </div>
              <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
                <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="mt-0.5 w-4 h-4 accent-green-500 flex-shrink-0" />
                I understand these trades can't be edited after recording.
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3 p-4 mt-2 border-t border-slate-200 dark:border-slate-800">
              <button onClick={onClose} className="py-3 rounded-xl font-semibold text-sm bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">Cancel</button>
              <button onClick={() => run()} disabled={!understood}
                className="py-3 rounded-xl font-bold text-sm bg-green-500 hover:bg-green-600 disabled:opacity-40 text-slate-950">Record trades</button>
            </div>
          </>
        ) : (
          <>
            <div className="px-5 pt-5 pb-4 flex items-center gap-4 border-b border-slate-200 dark:border-slate-800">
              <div className="relative w-24 h-24 flex-shrink-0">
                <svg viewBox="0 0 96 96" className="w-24 h-24 -rotate-90">
                  <circle cx="48" cy="48" r={R} fill="none" strokeWidth="8" className="stroke-slate-200 dark:stroke-slate-800" />
                  <circle cx="48" cy="48" r={R} fill="none" strokeWidth="8" strokeLinecap="round"
                    className={failedCount && stage === "done" ? "stroke-amber-500" : "stroke-green-500"}
                    strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} style={{ transition: "stroke-dashoffset 0.4s ease" }} />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xl font-bold tabular-nums text-slate-900 dark:text-white">{pct}%</span>
                </div>
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
                  {stage === "done" ? "Finished" : "Recording trades"}
                </p>
                <p className="text-3xl font-bold tabular-nums text-slate-900 dark:text-white leading-tight" aria-live="polite">
                  {finishedCount}<span className="text-slate-400 dark:text-slate-500 text-xl"> / {items.length}</span>
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  {fmtTime(elapsed)} elapsed{stage === "run" && remaining > 0 ? ` · ~${fmtTime(remaining)} left` : ""}
                </p>
                <p className="text-xs mt-0.5 tabular-nums">
                  <span className="text-green-600 dark:text-green-400">{savedCount} saved</span>
                  {skippedCount > 0 && <span className="text-amber-600 dark:text-amber-400"> · {skippedCount} already recorded</span>}
                  {failedCount > 0 && <span className="text-red-500"> · {failedCount} failed</span>}
                </p>
              </div>
            </div>

            <ul ref={listRef} className="overflow-y-auto px-3 py-2 divide-y divide-slate-100 dark:divide-slate-800">
              {items.map((t, i) => {
                const st = STATUS[t.status];
                const Icon = st.icon;
                const busy = t.status === "chart" || t.status === "saving";
                return (
                  <li key={t.id} data-id={t.id} className={`flex items-center gap-3 px-2 py-2 ${busy ? "bg-blue-500/5 rounded-lg" : ""}`}>
                    <span className="w-6 text-right text-xs tabular-nums text-slate-400">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        <span className={t.direction === "buy" ? "text-green-600 dark:text-green-400" : "text-red-500"}>{t.direction.toUpperCase()}</span> {t.pair}
                        <span className="font-normal text-xs text-slate-500 dark:text-slate-400"> · {t.pl ? `${t.pl.outcome === "win" ? "TP" : "SL"} ${money(t.pl.pl)}` : "ongoing"}</span>
                      </p>
                      {t.error && <p className="text-xs text-red-500 truncate">{t.error}</p>}
                    </div>
                    <span className={`flex items-center gap-1 text-xs font-semibold ${st.cls}`}>
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
                      {st.text}
                    </span>
                  </li>
                );
              })}
            </ul>

            <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex gap-3">
              {stage === "run" ? (
                <button onClick={() => { cancelRef.current = true; }}
                  className="flex-1 py-3 rounded-xl font-semibold text-sm bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
                  Stop after this one
                </button>
              ) : (
                <>
                  {(failedCount > 0 || items.some((t) => t.status === "waiting")) && (
                    <button onClick={() => run(["failed", "waiting"])}
                      className="flex-1 py-3 rounded-xl font-semibold text-sm bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
                      Retry {failedCount + items.filter((t) => t.status === "waiting").length}
                    </button>
                  )}
                  <button onClick={onClose} className="flex-1 py-3 rounded-xl font-bold text-sm bg-green-500 hover:bg-green-600 text-slate-950">Done</button>
                </>
              )}
            </div>
          </>
        )}

        {/* Chart for the trade being saved, drawn off-screen and captured. */}
        {current && (
          <div aria-hidden="true" style={{ position: "fixed", left: -10000, top: 0, width: 720 }}>
            <SignalChart
              key={current.id}
              ref={chartRef}
              compact
              preset="key"
              height={380}
              query={{
                pair: current.pair, dir: current.direction, entry: current.entryPrice, sl: current.stopLoss, tp: current.takeProfit,
                at: current.openedAt, exit: current.exitPrice ?? undefined, exitAt: current.closedAt ?? undefined, outcome: current.pl?.outcome,
              }}
              onLoaded={() => setTimeout(() => chartWait.current?.(true), 400)}
              onError={() => chartWait.current?.(false)}
            />
            <TradeSnapshot
              ref={snapRef}
              pair={current.pair}
              direction={current.direction}
              entry={current.entryPrice}
              stopLoss={current.stopLoss}
              takeProfit={current.takeProfit}
              markerPrice={current.exitPrice ?? current.entryPrice}
              markerLabel={current.exitPrice != null ? "Exit" : "Entry"}
              isClosing={current.exitPrice != null}
              pnl={current.pl?.pl}
              pips={current.pl?.pips}
              outcome={current.pl?.outcome}
            />
          </div>
        )}
      </div>
    </div>
  );
}
