import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Download, Loader2, Maximize2, Minimize2 } from "lucide-react";
import SignalChart from "./SignalChart";
import { downloadBinaryFile } from "../utils/nativeDownload";

// Full chart for a signal or trade: 1H / 15m, the drawing layers, the
// numbered reasons and the AI's own notes, and a PNG download.
const LEGEND = [
  ["Position", "red = risk (entry → SL), green = target (entry → TP)"],
  ["BOS / CHoCH", "break of structure (continuation) / change of character (first sign of reversal); solid = major swings, dashed = internal"],
  ["HH · HL · LH · LL", "higher high, higher low, lower high, lower low"],
  ["OB", "order block — last opposite candle before the move that broke structure"],
  ["FVG", "fair value gap — 3-candle imbalance price often returns to"],
  ["Premium / Discount", "upper / lower half of the current swing range (sell from premium, buy from discount)"],
  ["PDH / PDL · Asia", "previous day high / low and the Asian session range — common liquidity levels"],
  ["EQH / EQL · Sweep", "equal highs / lows (resting stops) and a wick that took them and closed back"],
  ["EMA", "orange 20, blue 50"],
  ["Your drawings", "amber — lines, boxes and notes you draw (saved on this device, included in downloads)"],
];

function ChartModal({ notificationId, tradeId, query, title, onClose }) {
  const [tf, setTf] = useState("1h");
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState(false);
  const chartRef = useRef(null);
  // Big screens (computer, TV) start full screen; phones / tablets can switch.
  const [full, setFull] = useState(() => typeof window !== "undefined" && window.innerWidth >= 1600);
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // Chart height for this screen: fills the window in full screen, else a
  // comfortable share of it (phones keep room for the controls below).
  const chartHeight = full
    ? Math.max(320, size.h - (size.w < 640 ? 300 : size.w >= 2000 ? 220 * Math.min(2.4, size.w / 1600) : 220))
    : size.w < 640 ? 360 : Math.round(Math.min(Math.max(420, size.h * 0.6), 900));

  const download = async () => {
    setSaving(true);
    try {
      const blob = await chartRef.current?.capture();
      if (!blob) return;
      const b64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.readAsDataURL(blob); });
      await downloadBinaryFile(`TradeMind-${(title || "chart").replace(/\W+/g, "-")}-${tf}.png`, b64, "image/png");
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[999] bg-black/75 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Signal chart" onClick={(e) => e.stopPropagation()}
        className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 overflow-y-auto shadow-2xl ${full ? "fixed inset-0 rounded-none max-w-none" : "rounded-2xl w-full max-w-4xl 2xl:max-w-6xl max-h-[94vh]"}`}>
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-800 sticky top-0 bg-white dark:bg-slate-900 z-10"
          style={size.w >= 2000 ? { zoom: Math.min(2.4, size.w / 1600) } : undefined}>
          <p className="font-bold text-slate-900 dark:text-white truncate">{title || "Signal chart"}</p>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-100 dark:bg-slate-800">
              {[["1h", "1H"], ["15m", "15m"]].map(([v, l]) => (
                <button key={v} type="button" onClick={() => setTf(v)} aria-pressed={tf === v}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold ${tf === v ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow" : "text-slate-500 dark:text-slate-400"}`}>{l}</button>
              ))}
            </div>
            <button type="button" onClick={() => setFull((f) => !f)} aria-label={full ? "Exit full screen" : "Full screen"} title={full ? "Exit full screen" : "Full screen"} className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white">
              {full ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
            </button>
            <button type="button" onClick={download} disabled={saving} aria-label="Download chart" className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white">
              {saving ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />}
            </button>
            <button type="button" onClick={onClose} aria-label="Close" className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white"><X size={18} /></button>
          </div>
        </div>
        <div className="p-3 sm:p-4">
          <SignalChart key={tf} ref={chartRef} notificationId={notificationId} tradeId={tradeId} query={query} tf={tf}
            height={chartHeight} />
          <div style={size.w >= 2000 ? { zoom: Math.min(2.4, size.w / 1600) } : undefined}>
          <button type="button" onClick={() => setInfo((v) => !v)} className="mt-3 text-xs font-semibold text-green-700 dark:text-green-400">
            {info ? "Hide" : "What do the drawings mean?"}
          </button>
          {info && (
            <dl className="mt-2 grid gap-1.5 text-xs">
              {LEGEND.map(([k, v]) => (
                <div key={k} className="flex gap-2"><dt className="font-bold text-slate-800 dark:text-slate-200 w-28 flex-shrink-0">{k}</dt><dd className="text-slate-600 dark:text-slate-400">{v}</dd></div>
              ))}
              <p className="text-slate-500 dark:text-slate-400 mt-1">Drawn from the candles up to the signal's time (no hindsight); candles after it show how it played out. Prices from Yahoo (gold adjusted to spot) — your broker's chart can differ slightly.</p>
            </dl>
          )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default ChartModal;
