import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Download, RotateCw } from "lucide-react";
import CopyImageButton from "./CopyImageButton";

// Full-screen picture viewer (added 2026-10-15): black background, the
// picture as large as the screen allows; pinch or mouse-wheel to zoom (up
// to 5x), drag to move, double-tap to zoom in / out, arrows or swipe for
// the next picture, Esc / X / Back to close. Uses the browser's real full
// screen where available (hides the address bar on phones).
// images: [{ url, label }]
const MAX = 5;

function ImageLightbox({ images, start = 0, onClose }) {
  const [index, setIndex] = useState(start);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false); // no smoothing while fingers move
  // Turned sideways: a wide chart fills an upright phone screen.
  const [rotated, setRotated] = useState(false);
  const rootRef = useRef(null);
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const lastTap = useRef(0);
  const img = images[index];

  const reset = () => setView({ scale: 1, x: 0, y: 0 });
  const go = useCallback((d) => {
    setIndex((i) => (i + d + images.length) % images.length);
    setView({ scale: 1, x: 0, y: 0 });
  }, [images.length]);

  // Closing: if we added a history entry (so the phone's Back button closes
  // the picture), go back through it; the popstate below then closes.
  const requestClose = useCallback(() => {
    if (window.history.state?.lightbox) window.history.back();
    else onClose();
  }, [onClose]);
  const handlers = useRef({ onClose, go, requestClose });
  useEffect(() => { handlers.current = { onClose, go, requestClose }; }, [onClose, go, requestClose]);

  // Real full screen, keys, and Back closes it. Set up once; the history
  // entry is only added if it isn't there yet.
  useEffect(() => {
    rootRef.current?.requestFullscreen?.().catch(() => {});
    if (!window.history.state?.lightbox) window.history.pushState({ lightbox: true }, "");
    const onKey = (e) => {
      if (e.key === "Escape") handlers.current.requestClose();
      if (e.key === "ArrowRight") handlers.current.go(1);
      if (e.key === "ArrowLeft") handlers.current.go(-1);
    };
    const onBack = () => handlers.current.onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("popstate", onBack);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onBack);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, []);

  const zoomAt = (factor, cx, cy) => setView((v) => {
    const scale = Math.min(MAX, Math.max(1, v.scale * factor));
    if (scale === 1) return { scale: 1, x: 0, y: 0 };
    const k = scale / v.scale;
    // keep the point under the fingers / cursor in place
    return { scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
  });

  const center = (e) => {
    const r = rootRef.current.getBoundingClientRect();
    return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2];
  };

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragging(true);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      gesture.current = { type: "pinch", dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) };
    } else if (pts.length === 1) {
      gesture.current = { type: "pan", x: e.clientX, y: e.clientY, startX: e.clientX, moved: false };
      const now = Date.now();
      if (now - lastTap.current < 300) { // double tap
        const [cx, cy] = center(e);
        if (view.scale > 1) reset(); else zoomAt(2.5, cx, cy);
        lastTap.current = 0;
      } else lastTap.current = now;
    }
  };

  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    const pts = [...pointers.current.values()];
    if (g.type === "pinch" && pts.length === 2) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const r = rootRef.current.getBoundingClientRect();
      const cx = (pts[0].x + pts[1].x) / 2 - r.left - r.width / 2, cy = (pts[0].y + pts[1].y) / 2 - r.top - r.height / 2;
      zoomAt(dist / g.dist, cx, cy);
      g.dist = dist;
    } else if (g.type === "pan") {
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      g.x = e.clientX; g.y = e.clientY;
      if (Math.abs(e.clientX - g.startX) > 6) g.moved = true;
      if (view.scale > 1) setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    }
  };

  const onPointerUp = (e) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    // Swipe left / right for the next picture (only when not zoomed in).
    if (g?.type === "pan" && view.scale === 1 && images.length > 1) {
      const dx = e.clientX - g.startX;
      if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
    }
    if (pointers.current.size === 0) {
      gesture.current = null;
      setDragging(false);
    }
  };

  const onWheel = (e) => {
    const [cx, cy] = center(e);
    zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, cx, cy);
  };

  const btn = "p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white backdrop-blur";

  return createPortal(
    <div ref={rootRef} role="dialog" aria-modal="true" aria-label="Picture, full screen"
      className="fixed inset-0 z-[2000] bg-black select-none overflow-hidden touch-none"
      // Portals pass events up the React tree: keep taps here from closing the window underneath.
      onClick={(e) => e.stopPropagation()}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel}>
      <img src={img.url} alt={img.label || "Screenshot"} draggable={false}
        className="absolute inset-0 m-auto object-contain"
        style={{
          maxWidth: rotated ? "100vh" : "100%", maxHeight: rotated ? "100vw" : "100%",
          ...(rotated ? { left: "50%", top: "50%", right: "auto", bottom: "auto", margin: 0 } : {}),
          transform: `${rotated ? "translate(-50%, -50%) " : ""}translate(${view.x}px, ${view.y}px) scale(${view.scale})${rotated ? " rotate(90deg)" : ""}`, transition: dragging ? "none" : "transform 0.15s ease-out" }} />

      <div className="absolute top-0 left-0 right-0 flex items-center justify-between gap-2 p-3 bg-gradient-to-b from-black/70 to-transparent"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }} onPointerDown={(e) => e.stopPropagation()}>
        <p className="text-white text-sm font-semibold truncate">
          {img.label}{images.length > 1 ? ` · ${index + 1} / ${images.length}` : ""}
        </p>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button type="button" onClick={() => { setRotated((r) => !r); reset(); }} aria-label={rotated ? "Turn back upright" : "Turn sideways"} aria-pressed={rotated} className={btn}><RotateCw size={18} /></button>
          <button type="button" onClick={() => zoomAt(1 / 1.5, 0, 0)} aria-label="Zoom out" className={btn}><ZoomOut size={18} /></button>
          <button type="button" onClick={() => zoomAt(1.5, 0, 0)} aria-label="Zoom in" className={btn}><ZoomIn size={18} /></button>
          <CopyImageButton url={img.url} name="TradeMind-screenshot" className={`${btn} flex items-center gap-1`} dark />
          <a href={img.url} target="_blank" rel="noreferrer" aria-label="Open original" className={btn}><Download size={18} /></a>
          <button type="button" onClick={requestClose} aria-label="Close" className={btn}><X size={20} /></button>
        </div>
      </div>

      {images.length > 1 && (
        <>
          <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => go(-1)} aria-label="Previous picture"
            className={`${btn} absolute left-3 top-1/2 -translate-y-1/2`}><ChevronLeft size={22} /></button>
          <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => go(1)} aria-label="Next picture"
            className={`${btn} absolute right-3 top-1/2 -translate-y-1/2`}><ChevronRight size={22} /></button>
        </>
      )}
      {view.scale === 1 && (
        <p className="absolute bottom-0 left-0 right-0 text-center text-xs text-white/60 pb-4" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}>
          Pinch or double-tap to zoom{images.length > 1 ? " · swipe for the next" : ""}
        </p>
      )}
    </div>,
    document.body
  );
}

export default ImageLightbox;
