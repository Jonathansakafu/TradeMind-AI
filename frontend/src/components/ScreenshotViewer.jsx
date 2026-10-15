import { useState } from "react";
import { createPortal } from "react-dom";
import { X, Maximize2 } from "lucide-react";
import ImageLightbox from "./ImageLightbox";
import CopyImageButton from "./CopyImageButton";

// A trade's pictures: the chart at the close (how TP / SL was hit) and the
// screenshot saved with the trade.
function ScreenshotViewer({ trade, onClose }) {
  const [full, setFull] = useState(null); // index shown full screen
  const shots = [];
  if (trade.resultScreenshot?.url) shots.push(["At the close", trade.resultScreenshot.url]);
  if (trade.screenshot?.url && trade.screenshot.url !== trade.resultScreenshot?.url) shots.push([trade.resultScreenshot?.url ? "When recorded" : "Screenshot", trade.screenshot.url]);
  return createPortal(
    <div className="fixed inset-0 z-[999] bg-black/80 flex items-center justify-center p-3" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Trade screenshots" onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800 sticky top-0 bg-white dark:bg-slate-900">
          <p className="font-bold text-slate-900 dark:text-white">{String(trade.direction).toUpperCase()} {trade.pair}</p>
          <button type="button" onClick={onClose} aria-label="Close" className="p-2 text-slate-500"><X size={18} /></button>
        </div>
        <div className="p-3 space-y-4">
          {shots.map(([label, url], i) => (
            <figure key={url}>
              <figcaption className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                {label}
                <CopyImageButton url={url} name={`TradeMind-${trade.pair}-${label.replace(/\W+/g, "-")}`} label className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300" />
              </figcaption>
              <button type="button" onClick={() => setFull(i)} aria-label={`${label} — full screen`} className="relative block w-full">
                <img src={url} alt={label} className="w-full rounded-xl border border-slate-200 dark:border-slate-800" />
                <span className="absolute right-2 bottom-2 flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg bg-black/60 text-white">
                  <Maximize2 size={12} /> Full screen
                </span>
              </button>
            </figure>
          ))}
        </div>
      </div>
      {full != null && (
        <ImageLightbox images={shots.map(([label, url]) => ({ label, url }))} start={full} onClose={() => setFull(null)} />
      )}
    </div>,
    document.body
  );
}

export default ScreenshotViewer;
