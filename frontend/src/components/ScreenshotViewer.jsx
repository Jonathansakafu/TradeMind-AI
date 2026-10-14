import { createPortal } from "react-dom";
import { X } from "lucide-react";

// A trade's pictures: the chart at the close (how TP / SL was hit) and the
// screenshot saved with the trade.
function ScreenshotViewer({ trade, onClose }) {
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
          {shots.map(([label, url]) => (
            <figure key={url}>
              <figcaption className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">{label}</figcaption>
              <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={label} className="w-full rounded-xl border border-slate-200 dark:border-slate-800" /></a>
            </figure>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default ScreenshotViewer;
