import { useRef, useState } from "react";
import { domToBlob } from "modern-screenshot";
import { X, CheckCircle, Pencil } from "lucide-react";
import TradeSnapshot from "./TradeSnapshot";
import { useTheme } from "../hooks/useTheme";
import { calculatePL } from "../utils/tradePL";

// "Save Trade" confirmation (added 2026-10-14): the entry and exit prices
// (editable here -- exit was filled from the signal's TP / SL when
// TradeMind scored it), the P/L they give, and the chart screenshot that
// will be saved: the trader's own, or one generated now from entry / SL /
// TP / exit if none was attached.
function ConfirmTradeModal({ form, screenshotPreview, onChangePrices, onConfirm, onClose, saving }) {
  const nodeRef = useRef(null);
  const { theme } = useTheme();
  const [busy, setBusy] = useState(false);
  const pl = calculatePL(form.pair, form.direction, form.entryPrice, form.exitPrice, form.lotSize);

  const confirm = async () => {
    setBusy(true);
    try {
      let file = null;
      if (!screenshotPreview && nodeRef.current) {
        const blob = await domToBlob(nodeRef.current, {
          backgroundColor: theme === "dark" ? "#020617" : "#ffffff",
          scale: 2,
          type: "image/png",
        });
        if (blob) file = new File([blob], `trade-snapshot-${Date.now()}.png`, { type: "image/png" });
      }
      await onConfirm(file);
    } catch (err) {
      console.error("Confirm trade failed:", err);
      alert("Couldn't create the chart screenshot — please try again or attach one.");
    } finally {
      setBusy(false);
    }
  };

  const input = "w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:border-green-500 p-3 rounded-xl outline-none transition text-slate-900 dark:text-white font-mono text-sm";
  const isBusy = busy || saving;
  const color = pl ? (pl.outcome === "win" ? "text-green-600 dark:text-green-400" : pl.outcome === "loss" ? "text-red-500" : "text-slate-500") : "text-slate-500";

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[999] flex items-center justify-center p-4" onClick={isBusy ? undefined : onClose}>
      <div role="dialog" aria-modal="true" aria-label="Confirm trade"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          <div>
            <p className="font-bold text-slate-900 dark:text-white">Confirm trade</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{form.pair} · {String(form.direction).toUpperCase()} · {form.lotSize} lot</p>
          </div>
          <button onClick={onClose} disabled={isBusy} aria-label="Close" className="p-2 -m-2 text-slate-400 hover:text-slate-900 dark:hover:text-white transition">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1" htmlFor="ct-entry">Entry price <Pencil size={11} /></label>
              <input id="ct-entry" type="number" step="any" inputMode="decimal" value={form.entryPrice}
                onChange={(e) => onChangePrices({ entryPrice: e.target.value })} className={input} />
            </div>
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1" htmlFor="ct-exit">Exit price <Pencil size={11} /></label>
              <input id="ct-exit" type="number" step="any" inputMode="decimal" value={form.exitPrice} placeholder="Still open"
                onChange={(e) => onChangePrices({ exitPrice: e.target.value })} className={input} />
            </div>
          </div>
          <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>SL <b className="font-mono text-red-500">{form.stopLoss || "—"}</b></span>
            <span>TP <b className="font-mono text-green-600 dark:text-green-400">{form.takeProfit || "—"}</b></span>
            <span>
              {pl ? <>Result <b className={`font-mono ${color}`}>{Number(pl.pl) >= 0 ? "+" : ""}${pl.pl}</b> ({pl.pips} pips, {pl.outcome})</> : "No exit yet — saved as an open trade"}
            </span>
          </div>
          {form.exitFilledFrom && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Exit filled with the signal's {form.exitFilledFrom === "tp" ? "take profit" : "stop loss"} because TradeMind saw price hit it. Change it if you closed at a different price.
            </p>
          )}

          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{screenshotPreview ? "Your screenshot" : "Chart screenshot (generated)"}</p>
            {screenshotPreview ? (
              <img src={screenshotPreview} alt="Trade screenshot" className="w-full rounded-xl object-cover max-h-60 border border-slate-200 dark:border-slate-700" />
            ) : (
              <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
                <TradeSnapshot
                  ref={nodeRef}
                  pair={form.pair}
                  direction={form.direction}
                  entry={form.entryPrice}
                  stopLoss={form.stopLoss}
                  takeProfit={form.takeProfit}
                  markerPrice={form.exitPrice || form.entryPrice}
                  markerLabel={form.exitPrice ? "Exit" : "Entry"}
                  isClosing={!!form.exitPrice}
                  pnl={pl?.pl}
                  pips={pl?.pips}
                  outcome={pl?.outcome}
                />
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 p-4 border-t border-slate-200 dark:border-slate-800 flex-shrink-0">
          <button onClick={onClose} disabled={isBusy}
            className="py-3 rounded-xl font-semibold text-sm bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700">
            Edit trade
          </button>
          <button onClick={confirm} disabled={isBusy || !form.entryPrice}
            className="py-3 rounded-xl font-bold text-sm bg-green-500 hover:bg-green-600 disabled:opacity-50 text-slate-950 flex items-center justify-center gap-2">
            {isBusy ? <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" /> : <CheckCircle size={16} />}
            Confirm & save
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmTradeModal;
