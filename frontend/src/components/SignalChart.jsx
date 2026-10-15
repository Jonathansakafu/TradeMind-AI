import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import axios from "axios";
import { createChart, CandlestickSeries, LineSeries, createSeriesMarkers, LineStyle } from "lightweight-charts";
import { domToBlob } from "modern-screenshot";
import { Loader2, Minus, TrendingUp, Square, Type, Undo2, Trash2, MousePointer2 } from "lucide-react";
import { API_URL } from "../config/api";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../hooks/useTheme";

// TradingView-style signal chart (added 2026-10-14, reworked 2026-10-15):
// real candles with the technical drawings behind a signal (GET
// /api/market/chart). Every kind of drawing is its own switch, with Clean /
// Key / Full presets (Key by default -- the old all-on view was too busy),
// so the trader can clear the chart and draw their own analysis: horizontal
// line, trend line, box and text note (saved on this device per chart, and
// included in downloads). Text, lines and callouts scale with the chart's
// width, from phones to tablets, computers and TVs. capture() returns a
// PNG of exactly what is shown.

const LAYERS = [
  ["position", "Position"], ["steps", "Steps"], ["structure", "BOS / CHoCH"], ["swings", "Swings"],
  ["liquidity", "Liquidity"], ["zones", "OB / FVG"], ["premium", "Premium / Discount"], ["levels", "S / R"],
  ["sessions", "PDH / PDL · Asia"], ["news", "News"], ["ema", "EMA"],
];
const PRESETS = {
  clean: ["position"],
  key: ["position", "steps", "structure", "levels"],
  full: LAYERS.map(([k]) => k),
};
const LAYER_KEY = "tm.chartLayers";
const fromPreset = (name) => Object.fromEntries(LAYERS.map(([k]) => [k, PRESETS[name].includes(k)]));
function savedLayers() {
  try {
    const s = JSON.parse(localStorage.getItem(LAYER_KEY) || "null");
    if (s && typeof s === "object") return { ...fromPreset("key"), ...s };
  } catch { /* storage blocked */ }
  return fromPreset("key");
}
const presetOf = (layers) => Object.keys(PRESETS).find((p) => LAYERS.every(([k]) => !!layers[k] === PRESETS[p].includes(k))) || null;

const palette = (dark) => ({
  bg: dark ? "#0b1220" : "#ffffff",
  grid: dark ? "rgba(148,163,184,0.08)" : "rgba(100,116,139,0.10)",
  text: dark ? "#cbd5e1" : "#334155",
  up: "#26a69a", down: "#ef5350",
  callout: dark ? "#1f6f78" : "#2b8a93",
  level: dark ? "rgba(148,163,184,0.75)" : "rgba(71,85,105,0.7)",
  draw: "#f59e0b",
});

function lowerBound(arr, t) {
  let lo = 0, hi = arr.length - 1, ans = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].time >= t) { ans = mid; hi = mid - 1; } else lo = mid + 1;
  }
  return ans;
}

// The candle a moment falls in (last candle starting at or before it) --
// exits / fills happen inside a candle, not at its start.
function floorIdx(arr, t) {
  let lo = 0, hi = arr.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].time <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

// Numbered badges + a list under the chart instead of callout boxes when
// boxes would crowd (narrow chart, or many steps).
const badgesFor = (w, steps) => w < 980 || steps > 5;

// Scale for bigger screens: 1 up to a laptop (~1280 px), 1.5 on a 1920
// monitor, up to 3 on a 4K TV seen from the sofa.
const scaleFor = (w) => Math.max(1, Math.min(3, w / 1280));

const SignalChart = forwardRef(function SignalChart({
  notificationId, tradeId, query, tf = "1h", height = 380, compact = false, onLoaded, onError, hideStepList = false, preset = null,
}, ref) {
  const { headers } = useAuth();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const wrapRef = useRef(null);
  const boxRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0); // redraw the overlay on zoom / scroll / resize
  const [width, setWidth] = useState(600);
  const [layers, setLayersState] = useState(() => (preset ? fromPreset(preset) : savedLayers()));
  const qs = useMemo(() => JSON.stringify(query || {}), [query]);
  const chartKey = `tm.drawings.${notificationId || tradeId || qs}`;
  const [drawings, setDrawings] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`tm.drawings.${notificationId || tradeId || JSON.stringify(query || {})}`) || "[]"); } catch { return []; }
  });
  const [tool, setTool] = useState(null); // null | hline | trend | rect | text
  const [draft, setDraft] = useState(null);

  const setLayers = (next) => {
    setLayersState(next);
    if (!preset) try { localStorage.setItem(LAYER_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const saveDrawings = (next) => {
    setDrawings(next);
    try { localStorage.setItem(chartKey, JSON.stringify(next)); } catch { /* ignore */ }
  };

  useImperativeHandle(ref, () => ({
    async capture() {
      if (!wrapRef.current) return null;
      return domToBlob(wrapRef.current, { backgroundColor: palette(dark).bg, scale: 2, type: "image/png" });
    },
  }), [dark]);

  useEffect(() => {
    let stop = false;
    const params = { tf, ...(notificationId ? { notificationId } : {}), ...(tradeId ? { tradeId } : {}), ...JSON.parse(qs) };
    axios.get(`${API_URL}/api/market/chart`, { headers, params, timeout: 30000 })
      .then((r) => { if (!stop) { setData(r.data); setError(null); } })
      .catch((e) => {
        if (stop) return;
        setError(e.response?.data?.message || "Couldn't load the chart.");
        onError?.();
      });
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headers, notificationId, tradeId, qs, tf]);

  // Build the chart.
  useEffect(() => {
    if (!data || !boxRef.current) return undefined;
    const c = palette(dark);
    const w0 = boxRef.current.clientWidth;
    const k = scaleFor(w0);
    const chart = createChart(boxRef.current, {
      height,
      width: w0,
      layout: { background: { color: c.bg }, textColor: c.text, fontSize: Math.round(11 * k), attributionLogo: false },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderVisible: false, timeVisible: true, rightOffset: 4, barSpacing: 6 * k },
      crosshair: { mode: 0 },
      localization: { timeFormatter: (t) => new Date(t * 1000).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) },
      handleScroll: !compact, handleScale: !compact,
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: c.up, downColor: c.down, borderVisible: false, wickUpColor: c.up, wickDownColor: c.down,
      priceFormat: { type: "price", precision: data.pair === "XAUUSD" ? 2 : /JPY$/.test(data.pair) ? 3 : 5, minMove: data.pair === "XAUUSD" ? 0.01 : /JPY$/.test(data.pair) ? 0.001 : 0.00001 },
    });
    candles.setData(data.candles);
    if (layers.ema) {
      chart.addSeries(LineSeries, { color: "#f59e0b", lineWidth: Math.round(k), priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }).setData(data.ema20);
      chart.addSeries(LineSeries, { color: "#3b82f6", lineWidth: Math.round(k), priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }).setData(data.ema50);
    }
    const p = data.position;
    if (p && layers.position) {
      candles.createPriceLine({ price: p.entry, color: c.text, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "Entry" });
      if (p.sl) candles.createPriceLine({ price: p.sl, color: "#ef4444", lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "SL" });
      if (p.tp) candles.createPriceLine({ price: p.tp, color: "#22c55e", lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "TP" });
    }
    const markers = [];
    if (layers.swings) for (const s of data.swings) markers.push({ time: s.time, position: s.kind === "H" ? "aboveBar" : "belowBar", shape: "circle", size: 0, color: c.text, text: s.label });
    if (layers.liquidity) for (const sw of data.sweeps) markers.push({ time: sw.time, position: sw.side === "highs" ? "aboveBar" : "belowBar", shape: sw.side === "highs" ? "arrowDown" : "arrowUp", color: "#a855f7", text: "Sweep" });
    markers.sort((a, b) => a.time - b.time);
    createSeriesMarkers(candles, markers);

    // Show the build-up and the signal, with a little after it.
    const sigIdx = lowerBound(data.candles, data.signalTime);
    const narrowView = w0 < 560;
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, sigIdx - (narrowView ? 32 : compact ? 55 : 70)), to: Math.min(data.candles.length + 3, sigIdx + (data.result ? Math.max(12, floorIdx(data.candles, data.result.time) - sigIdx + 6) : 20)) });

    chartRef.current = chart;
    seriesRef.current = candles;
    const redraw = () => setTick((t) => t + 1);
    chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);
    const ro = new ResizeObserver(() => {
      const w = boxRef.current?.clientWidth || 300;
      chart.applyOptions({ width: w, layout: { fontSize: Math.round(11 * scaleFor(w)) } });
      setWidth(w);
      redraw();
    });
    ro.observe(boxRef.current);
    const first = setTimeout(() => { setWidth(boxRef.current?.clientWidth || w0); redraw(); onLoaded?.(); }, 60);
    return () => {
      clearTimeout(first);
      ro.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(redraw);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, dark, height, compact, layers.ema, layers.swings, layers.liquidity, layers.position]);

  // ----- trader's own drawings (data coordinates: time + price) -----
  const toData = (e) => {
    const chart = chartRef.current, series = seriesRef.current;
    if (!chart || !series || !data) return null;
    const r = boxRef.current.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const logical = chart.timeScale().coordinateToLogical(x);
    const price = series.coordinateToPrice(y);
    if (logical == null || price == null) return null;
    // Candle position (not time): market gaps (weekends) don't shift it.
    return { t: logical, p: price };
  };
  const onDrawDown = (e) => {
    const pt = toData(e);
    if (!pt) return;
    if (tool === "hline") { saveDrawings([...drawings, { type: "hline", p1: pt.p }]); return; }
    if (tool === "text") {
      const text = window.prompt("Note on the chart:");
      if (text) saveDrawings([...drawings, { type: "text", t1: pt.t, p1: pt.p, text: text.slice(0, 80) }]);
      return;
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDraft({ type: tool, t1: pt.t, p1: pt.p, t2: pt.t, p2: pt.p });
  };
  const onDrawMove = (e) => {
    if (!draft) return;
    const pt = toData(e);
    if (pt) setDraft({ ...draft, t2: pt.t, p2: pt.p });
  };
  const onDrawUp = () => {
    if (draft && (draft.t1 !== draft.t2 || draft.p1 !== draft.p2)) saveDrawings([...drawings, draft]);
    setDraft(null);
  };

  const overlay = useOverlay(chartRef, seriesRef, boxRef, data, layers, dark, tick, [...drawings, ...(draft ? [draft] : [])]);
  const narrow = width < 560;
  const k = scaleFor(width);
  const stepList = data ? badgesFor(width, data.steps.length) : false;

  if (error) return <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-6 text-sm text-slate-500 text-center">{error}</div>;

  const chip = (on) => `px-2.5 py-1 rounded-lg text-xs font-semibold border transition ${on ? "bg-green-500/15 border-green-500/40 text-green-700 dark:text-green-400" : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"}`;
  const current = presetOf(layers);

  return (
    <div>
      <div ref={wrapRef} className="relative rounded-xl overflow-hidden" style={{ background: palette(dark).bg }}>
        <div ref={boxRef} style={{ height }} />
        {data && overlay}
        {/* Drawing surface: catches touches only while a drawing tool is on. */}
        {data && tool && (
          <div className="absolute left-0 top-0 right-0 cursor-crosshair touch-none" style={{ height, zIndex: 6 }}
            onPointerDown={onDrawDown} onPointerMove={onDrawMove} onPointerUp={onDrawUp} onPointerCancel={onDrawUp} />
        )}
        {data && (
          <div className="absolute left-2 top-1.5 pointer-events-none leading-tight" style={{ color: palette(dark).text, zIndex: 5, fontSize: 11 * k }}>
            <b>{data.pair}</b> · {data.tf.toUpperCase()} · TradeMind AI
            {data.direction && (
              <span className={`ml-1.5 font-bold ${data.direction === "buy" ? "text-green-500" : "text-red-500"}`}>
                {data.direction.toUpperCase()}{data.confidence ? ` ${data.confidence}%` : ""}
              </span>
            )}
            <span className="block opacity-80">4H {data.trend.h4} · 1H {data.trend.h1}{data.tf === "15m" ? ` · 15m ${data.trend.tf}` : ""}{data.position?.rr ? ` · R:R 1:${data.position.rr.toFixed(1)}` : ""}</span>
          </div>
        )}
        {!data && <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="animate-spin text-green-500" /></div>}
        {/* Phones: the steps as a numbered list under the chart (numbered badges on it). */}
        {data && stepList && !hideStepList && layers.steps && data.steps.length > 0 && (
          <ol className={`px-2.5 py-2 leading-snug ${narrow ? "space-y-1" : "grid gap-x-6 gap-y-1"}`}
            style={{ color: palette(dark).text, fontSize: 11 * k, gridTemplateColumns: narrow ? undefined : "repeat(auto-fill, minmax(min(100%, 22rem), 1fr))" }}>
            {data.steps.map((st, i) => (
              <li key={i} className="flex gap-1.5 items-start">
                <span className="flex-shrink-0 rounded-full font-bold text-white flex items-center justify-center" style={{ background: palette(dark).callout, width: 16 * k, height: 16 * k, fontSize: 9 * k }}>{i + 1}</span>
                <span>{st.text}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {!compact && data && (
        // TVs / 4K screens: controls scaled up with the chart (zoom keeps their layout).
        <div className="mt-2 space-y-2" style={width >= 2000 ? { zoom: Math.min(2.4, width / 1600) } : undefined}>
          {/* View presets + every drawing on its own switch. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-slate-500 dark:text-slate-400 mr-1">View</span>
            {[["clean", "Clean"], ["key", "Key"], ["full", "Full analysis"]].map(([p, label]) => (
              <button key={p} type="button" onClick={() => setLayers(fromPreset(p))} aria-pressed={current === p} className={chip(current === p)}>{label}</button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {LAYERS.map(([key, label]) => (
              <button key={key} type="button" onClick={() => setLayers({ ...layers, [key]: !layers[key] })} aria-pressed={!!layers[key]} className={chip(layers[key])}>{label}</button>
            ))}
          </div>
          {/* The trader's own analysis. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-slate-500 dark:text-slate-400 mr-1">Draw</span>
            {[[null, MousePointer2, "Move / zoom"], ["hline", Minus, "Horizontal line"], ["trend", TrendingUp, "Trend line"], ["rect", Square, "Box"], ["text", Type, "Text note"]].map(([t, Icon, label]) => (
              <button key={label} type="button" onClick={() => setTool(t)} aria-pressed={tool === t} title={label} aria-label={label}
                className={`p-1.5 rounded-lg border transition ${tool === t ? "bg-amber-500/20 border-amber-500/50 text-amber-600 dark:text-amber-400" : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"}`}>
                <Icon size={15} />
              </button>
            ))}
            <button type="button" onClick={() => saveDrawings(drawings.slice(0, -1))} disabled={!drawings.length} title="Undo" aria-label="Undo drawing" className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 disabled:opacity-40"><Undo2 size={15} /></button>
            <button type="button" onClick={() => saveDrawings([])} disabled={!drawings.length} title="Clear my drawings" aria-label="Clear my drawings" className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 disabled:opacity-40"><Trash2 size={15} /></button>
            {tool && <span className="text-[11px] text-amber-600 dark:text-amber-400">{tool === "hline" || tool === "text" ? "Tap the chart" : "Drag on the chart"}</span>}
          </div>
        </div>
      )}
    </div>
  );
});

// ---------- drawing layer ----------

function useOverlay(chartRef, seriesRef, boxRef, data, layers, dark, tick, mine) {
  const chart = chartRef.current, series = seriesRef.current;
  if (!data || !chart || !series || !boxRef.current) return null;
  void tick;
  const c = palette(dark);
  const W = boxRef.current.clientWidth - chart.priceScale("right").width();
  const H = boxRef.current.clientHeight - chart.timeScale().height();
  const k = scaleFor(boxRef.current.clientWidth);
  const fs = 10 * k;
  const step = data.candles.length > 1 ? data.candles[1].time - data.candles[0].time : 3600;
  const xOf = (t) => {
    if (t > data.candles.at(-1).time || t < data.candles[0].time) return chart.timeScale().logicalToCoordinate((t - data.candles[0].time) / step);
    return chart.timeScale().logicalToCoordinate(floorIdx(data.candles, t));
  };
  const yOf = (p) => (p == null ? null : series.priceToCoordinate(p));
  const xEnd = W;
  const narrow = W < 500;
  const els = [];
  let key = 0;
  const rect = (x1, y1, x2, y2, fill, stroke) => {
    if ([x1, y1, x2, y2].some((v) => v == null)) return;
    els.push(<rect key={key++} x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.max(1, Math.abs(x2 - x1))} height={Math.max(1, Math.abs(y2 - y1))} fill={fill} stroke={stroke || "none"} strokeWidth={k} />);
  };
  const hline = (x1, x2, p, stroke, dash, width = 1) => {
    const y = yOf(p);
    if (y == null || x1 == null) return;
    els.push(<line key={key++} x1={x1} x2={x2} y1={y} y2={y} stroke={stroke} strokeWidth={width * k} strokeDasharray={dash} />);
  };
  const label = (x, p, text, fill, anchor = "start", dy = -3) => {
    const y = yOf(p);
    if (y == null || x == null) return;
    els.push(<text key={key++} x={x} y={y + dy * k} fill={fill} fontSize={fs} fontWeight="600" textAnchor={anchor}>{text}</text>);
  };

  if (layers.levels) {
    for (const l of [...data.levels.supports.slice(0, 2), ...data.levels.resistances.slice(0, 2)]) hline(0, xEnd, l.price, c.level, null, Math.min(2.5, 0.8 + l.strength * 0.5));
  }
  if (layers.sessions) {
    if (data.prevDay) {
      hline(0, xEnd, data.prevDay.high, "#94a3b8", "6 4");
      if (!narrow) label(4, data.prevDay.high, "PDH", "#94a3b8");
      hline(0, xEnd, data.prevDay.low, "#94a3b8", "6 4");
      if (!narrow) label(4, data.prevDay.low, "PDL", "#94a3b8", "start", 11);
    }
    if (data.asian) {
      rect(xOf(data.asian.from), yOf(data.asian.high), xOf(data.asian.to), yOf(data.asian.low), "rgba(234,179,8,0.07)", "rgba(234,179,8,0.35)");
      if (!narrow) label(xOf(data.asian.from), data.asian.high, "Asia", "#ca8a04");
    }
  }
  if (layers.liquidity) {
    if (data.equalHighs) { hline(0, xEnd, data.equalHighs, "#a855f7", "2 3"); label(xEnd - 4, data.equalHighs, "EQH", "#a855f7", "end"); }
    if (data.equalLows) { hline(0, xEnd, data.equalLows, "#a855f7", "2 3"); label(xEnd - 4, data.equalLows, "EQL", "#a855f7", "end", 11); }
  }
  if (layers.premium && data.range) {
    const x = xOf(data.range.from);
    hline(x, xEnd, data.range.mid, "#64748b", "4 4");
    label(xEnd - 4, data.range.mid, "50% EQ", "#64748b", "end");
    if (!narrow) {
      label(xEnd - 4, (data.range.high + data.range.mid) / 2, "Premium", "rgba(239,68,68,0.7)", "end");
      label(xEnd - 4, (data.range.low + data.range.mid) / 2, "Discount", "rgba(34,197,94,0.8)", "end");
    }
  }
  if (layers.zones) {
    for (const g of data.fvgs) {
      rect(xOf(g.from), yOf(g.top), xEnd, yOf(g.bottom), g.dir === "bullish" ? "rgba(34,197,94,0.10)" : "rgba(239,68,68,0.10)");
      label(xOf(g.from) + 3, g.top, "FVG", g.dir === "bullish" ? "#16a34a" : "#dc2626", "start", 10);
    }
    if (data.orderBlock) {
      const ob = data.orderBlock;
      rect(xOf(ob.from), yOf(ob.top), xEnd, yOf(ob.bottom), ob.dir === "bullish" ? "rgba(59,130,246,0.14)" : "rgba(249,115,22,0.14)", ob.dir === "bullish" ? "rgba(59,130,246,0.5)" : "rgba(249,115,22,0.5)");
      label(xOf(ob.from) + 3, ob.top, `${ob.dir === "bullish" ? "Bull" : "Bear"} OB`, ob.dir === "bullish" ? "#2563eb" : "#ea580c", "start", 10);
    }
  }
  if (layers.position && data.position) {
    const p = data.position;
    const xs = xOf(p.sent);
    if (p.unfilled) {
      // Never entered: the planned levels only, no trade box.
      hline(xs, xEnd, p.entry, c.text, "5 4", 1.2);
      label(xEnd - 4, p.entry, "Entry never reached — no trade", c.text, "end");
    } else {
      // Signal sent before price reached the entry: dashed "waiting" line.
      if (data.fill?.waited) {
        hline(xs, xOf(data.fill.time), p.entry, c.text, "3 3", 1.2);
        if (xs != null) label(xs + 3, p.entry, "waiting for entry", c.text, "start", 11);
      }
      const x1 = xOf(p.from), xExit = data.result ? xOf(data.result.time) : null;
      const x2 = Math.min(xEnd, Math.max((x1 ?? 0) + 8 * k, xExit ?? xOf(p.to) ?? xEnd));
      if (p.sl) rect(x1, yOf(p.entry), x2, yOf(p.sl), "rgba(239,68,68,0.22)");
      if (p.tp) rect(x1, yOf(p.entry), x2, yOf(p.tp), "rgba(34,197,94,0.20)");
      if (p.risk) label(x2 - 3, p.sl, `Risk ${p.risk}`, "#ef4444", "end", p.sl > p.entry ? -3 : 11);
      if (p.reward) label(x2 - 3, p.tp, `Target ${p.reward}`, "#16a34a", "end", p.tp > p.entry ? -3 : 11);
      // Where the entry was filled: on that candle, at the entry price.
      if (data.fill) {
        const fx = xOf(data.fill.time), fy = yOf(data.fill.price), up = data.direction === "buy";
        if (fx != null && fy != null) {
          const d = 6 * k;
          els.push(<path key={key++} d={up ? `M${fx},${fy - d} L${fx - d},${fy + d} L${fx + d},${fy + d} Z` : `M${fx},${fy + d} L${fx - d},${fy - d} L${fx + d},${fy - d} Z`} fill={up ? "#22c55e" : "#ef4444"} stroke="#fff" strokeWidth={k} />);
          if (data.fill.waited) label(fx, data.fill.price, "Filled", c.text, "middle", up ? 22 : -12);
        }
      }
      // The exit: on the candle it happened in, at the exact TP / SL price.
      if (data.result) {
        const rx = xOf(data.result.time), ry = yOf(data.result.price);
        const col = data.result.outcome === "win" ? "#22c55e" : data.result.outcome === "loss" ? "#ef4444" : "#94a3b8";
        if (rx != null && ry != null) {
          els.push(<circle key={key++} cx={rx} cy={ry} r={6 * k} fill={col} stroke="#fff" strokeWidth={1.5 * k} />);
          els.push(<text key={key++} x={rx + 9 * k} y={ry + (data.result.price > data.position.entry ? -8 : 16) * k} fill={col} fontSize={11 * k} fontWeight="700">{data.result.label}</text>);
        }
      }
    }
  }
  if (layers.structure) {
    // Major breaks, plus the last two internal ones (not on phones).
    const internal = data.structure.filter((s) => s.scope === "internal").slice(-2);
    for (const s of data.structure.filter((x) => x.scope === "major" || (!narrow && internal.includes(x)))) {
      const x1 = xOf(s.from), x2 = xOf(s.to);
      const col = s.dir === "bullish" ? "#22c55e" : "#ef4444";
      hline(x1, x2, s.level, col, s.scope === "internal" ? "4 3" : null, s.scope === "major" ? 1.5 : 1);
      if (x1 != null && x2 != null) label((x1 + x2) / 2, s.level, s.type, col, "middle", s.dir === "bullish" ? -3 : 11);
    }
  }
  if (layers.news) {
    for (const n of data.news) {
      const x = xOf(n.time);
      if (x == null || x < 0 || x > W) continue;
      els.push(<line key={key++} x1={x} x2={x} y1={0} y2={H} stroke={n.topTier ? "rgba(239,68,68,0.55)" : "rgba(234,179,8,0.5)"} strokeDasharray="3 3" />);
      els.push(<text key={key++} x={x + 3} y={H - 4} fontSize={9 * k} fill={n.topTier ? "#ef4444" : "#ca8a04"}>📰 {n.title.slice(0, 22)}</text>);
    }
  }

  // The trader's own drawings (x stored as candle position).
  const xL = (l) => chart.timeScale().logicalToCoordinate(l);
  for (const d of mine) {
    if (d.type === "hline") hline(0, xEnd, d.p1, c.draw, null, 1.5);
    else if (d.type === "trend") {
      const x1 = xL(d.t1), x2 = xL(d.t2), y1 = yOf(d.p1), y2 = yOf(d.p2);
      if ([x1, x2, y1, y2].every((v) => v != null)) els.push(<line key={key++} x1={x1} y1={y1} x2={x2} y2={y2} stroke={c.draw} strokeWidth={1.8 * k} />);
    } else if (d.type === "rect") rect(xL(d.t1), yOf(d.p1), xL(d.t2), yOf(d.p2), "rgba(245,158,11,0.12)", c.draw);
    else if (d.type === "text") {
      const x = xL(d.t1), y = yOf(d.p1);
      if (x != null && y != null) els.push(<text key={key++} x={x} y={y} fill={c.draw} fontSize={12 * k} fontWeight="700">{d.text}</text>);
    }
  }

  // Numbered callouts with leader lines (alternating above / below, stacked).
  const callouts = [];
  if (layers.steps) {
    const boxW = Math.min(170 * k, W * 0.42), boxH = 30 * k;
    const placed = [];
    data.steps.forEach((s, i) => {
      const ax = xOf(s.time), ay = yOf(s.price);
      if (ax == null || ay == null || ax < 0 || ax > W) return;
      if (badgesFor(boxRef.current.clientWidth, data.steps.length)) { // numbered badge; the text is listed under the chart
        els.push(<g key={key++}><circle cx={ax} cy={ay} r={8 * k} fill={c.callout} stroke="#fff" strokeWidth={k} /><text x={ax} y={ay + 3.5 * k} fontSize={10 * k} fontWeight="700" fill="#fff" textAnchor="middle">{i + 1}</text></g>);
        return;
      }
      const above = i % 2 === 0;
      let bx = Math.max(4, Math.min(W - boxW - 4, ax - boxW / 2 + (i % 3 - 1) * 20 * k));
      let by = above ? Math.max(30 * k, ay - 70 * k) : Math.min(H - boxH - 18, ay + 40 * k);
      for (let tries = 0; tries < 8 && placed.some((r) => !(bx + boxW < r.x || bx > r.x + boxW || by + boxH < r.y || by > r.y + boxH)); tries++) {
        by = above ? by - boxH - 6 : by + boxH + 6;
        if (by < 26 * k || by > H - boxH - 4) { by = Math.max(26 * k, Math.min(H - boxH - 4, by)); bx = Math.max(4, Math.min(W - boxW - 4, bx + boxW * 0.6)); }
      }
      placed.push({ x: bx, y: by });
      els.push(<line key={key++} x1={ax} y1={ay} x2={bx + boxW / 2} y2={above ? by + boxH : by} stroke={c.callout} strokeWidth={2 * k} />);
      callouts.push(
        <div key={`c${i}`} className="absolute text-white leading-tight rounded-md shadow"
          style={{ left: bx, top: by, width: boxW, minHeight: boxH, background: c.callout, fontSize: 10.5 * k, padding: `${4 * k}px ${8 * k}px` }}>
          <b>{i + 1}.</b> {s.text}
        </div>
      );
    });
  }

  return (
    <>
      <svg className="absolute left-0 top-0 pointer-events-none" width={W} height={H} style={{ overflow: "hidden", zIndex: 3 }}>{els}</svg>
      <div className="absolute left-0 top-0 pointer-events-none" style={{ width: W, height: H, zIndex: 4 }}>{callouts}</div>
    </>
  );
}

export default SignalChart;
