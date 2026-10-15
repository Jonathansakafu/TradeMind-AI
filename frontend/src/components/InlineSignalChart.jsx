import { useEffect, useRef, useState } from "react";
import SignalChart from "./SignalChart";

// Small chart inside a signal card (added 2026-10-14): loads only when the
// card scrolls into view, shows the drawings with numbered badges, and is
// redrawn when the signal hits TP / SL (keyed on the result). Tap for the
// full chart.
function InlineSignalChart({ notification, onOpen }) {
  const boxRef = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); io.disconnect(); } }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={boxRef} className="relative mb-4 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800" style={{ minHeight: 210 }}>
      {visible && (
        <SignalChart key={`${notification._id}-${notification.simOutcome || "open"}`} notificationId={notification._id} height={210} compact hideStepList preset="key" />
      )}
      {/* Whole chart is the "open full chart" button (no scrolling inside a card). */}
      <button type="button" onClick={onOpen} aria-label="Open the full chart" className="absolute inset-0 z-10">
        <span className="absolute right-2 bottom-8 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-black/50 text-white">Tap for full chart</span>
      </button>
    </div>
  );
}

export default InlineSignalChart;
