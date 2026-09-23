import { useRef, useState } from "react";
import { domToBlob } from "modern-screenshot";
import { X, Camera } from "lucide-react";
import TradeSnapshot from "./TradeSnapshot";
import { useTheme } from "../hooks/useTheme";

function SnapshotCaptureModal({
  open, onClose, onCaptured,
  title = "Chart Snapshot",
  buttonLabel = "Use This as Screenshot",
  busy = false,
  ...snapshotProps
}) {
  const nodeRef = useRef(null);
  const [capturing, setCapturing] = useState(false);
  const { theme } = useTheme();

  if (!open) return null;

  const capture = async () => {
    if (!nodeRef.current) return;
    setCapturing(true);
    try {
      // modern-screenshot, not html2canvas -- this app is on Tailwind v4,
      // which compiles its whole color palette to oklch(), and
      // html2canvas's own color parser has no support for oklch()/
      // color-mix() at all, so it threw on the first colored element it
      // walked (every capture failed with a generic "Couldn't generate
      // the snapshot" error). modern-screenshot renders via an SVG
      // foreignObject the browser paints itself, so any CSS-valid color
      // just works -- no reimplemented color parsing to break.
      const blob = await domToBlob(nodeRef.current, {
        backgroundColor: theme === "dark" ? "#020617" : "#ffffff",
        scale: 2,
        type: "image/png",
      });
      if (!blob) { setCapturing(false); return; }
      const file = new File([blob], `trade-snapshot-${Date.now()}.png`, { type: "image/png" });
      await onCaptured(file);
      setCapturing(false);
      onClose();
    } catch (err) {
      console.error("Snapshot capture failed:", err);
      alert("Couldn't generate the snapshot — please try again.");
      setCapturing(false);
    }
  };

  const isBusy = capturing || busy;

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[999] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          <p className="font-bold text-slate-900 dark:text-white text-sm">{title}</p>
          <button onClick={onClose} aria-label="Close" className="p-2 -m-2 text-slate-400 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto">
          <TradeSnapshot ref={nodeRef} {...snapshotProps} />
        </div>

        <div className="p-5 pt-0 flex-shrink-0">
          <button
            onClick={capture}
            disabled={isBusy}
            className="w-full flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-slate-950 font-bold py-3.5 rounded-xl transition"
          >
            {isBusy ? (
              <div className="w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
            ) : (
              <><Camera size={16} /> {buttonLabel}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default SnapshotCaptureModal;
