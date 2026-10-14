import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import axios from "axios";
import { createChart, CandlestickSeries, LineSeries, createSeriesMarkers, LineStyle } from "lightweight-charts";
import { domToBlob } from "modern-screenshot";
import { Loader2 } from "lucide-react";
import { API_URL } from "../config/api";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../hooks/useTheme";

// TradingView-style signal chart (added 2026-10-14): real candles with the
// technical drawings behind a signal (GET /api/market/chart) -- position box
// (entry / SL / TP), order block, fair value gaps, premium / discount,
// support / resistance, previous day high / low, Asian range, BOS / CHoCH,
// swing labels, liquidity sweeps, news times, and numbered callouts saying
// why the signal was created. Drawn on an SVG layer kept in step with the
// chart's zoom and scroll; capture() returns a PNG of the whole thing.

const LAYERS = [
  ["steps", "Steps"], ["structure", "Structure"], ["zones", "Zones"], ["levels", "Levels"], ["ema", "EMA"],
];

const palette = (dark) => ({
  bg: dark ? "#0b1220" : "#ffffff",
  grid: dark ? "rgba(148,163,184,0.08)" : "rgba(100,116,139,0.10)",
  text: dark ? "#cbd5e1" : "#334155",
  up: "#26a69a", down: "#ef5350",
  callout: dark ? "#1f6f78" : "#2b8a93",
  level: dark ? "rgba(148,163,184,0.75)" : "rgba(71,85,105,0.7)",
});

function lowerBound(arr, t) {
  let lo = 0, hi = arr.length - 1, ans = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].time >= t) { ans = mid; hi = mid - 1; } else lo = mid + 1;
  }
  return ans;
}

const SignalChart = forwardRef(function SignalChart({ notificationId, tradeId, query, tf = "1h", height = 380, compact = false, onLoaded, onError }, ref) {
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
  const [layers, setLayers] = useState(() => Object.fromEntries(LAYERS.map(([k]) => [k, k !== "ema" || (typeof window !== "undefined" && window.innerWidth >= 640)])));
  const qs = useMemo(() => JSON.stringify(query || {}), [query]);

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
    const chart = createChart(boxRef.current, {
      height,
      width: boxRef.current.clientWidth,
      layout: { background: { color: c.bg }, textColor: c.text, fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderVisible: false, timeVisible: true, rightOffset: 4 },
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
      chart.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }).setData(data.ema20);
      chart.addSeries(LineSeries, { color: "#3b82f6", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }).setData(data.ema50);
    }
    const p = data.position;
    if (p) {
      candles.createPriceLine({ price: p.entry, color: c.text, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "Entry" });
      if (p.sl) candles.createPriceLine({ price: p.sl, color: "#ef4444", lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "SL" });
      if (p.tp) candles.createPriceLine({ price: p.tp, color: "#22c55e", lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "TP" });
    }
    const markers = [];
    if (layers.structure) {
      for (const s of data.swings) markers.push({ time: s.time, position: s.kind === "H" ? "aboveBar" : "belowBar", shape: "circle", size: 0, color: c.text, text: s.label });
      for (const sw of data.sweeps) markers.push({ time: sw.time, position: sw.side === "highs" ? "aboveBar" : "belowBar", shape: sw.side === "highs" ? "arrowDown" : "arrowUp", color: "#a855f7", text: "Sweep" });
    }
    if (data.result) markers.push({ time: data.candles[lowerBound(data.candles, data.result.time)].time, position: "inBar", shape: "circle", color: data.result.outcome === "win" ? "#22c55e" : "#ef4444", text: data.result.outcome === "win" ? "TP hit" : data.result.outcome === "loss" ? "SL hit" : "Closed" });
    markers.sort((a, b) => a.time - b.time);
    createSeriesMarkers(candles, markers);

    // Show the build-up and the signal, with a little after it.
    const sigIdx = lowerBound(data.candles, data.signalTime);
    const narrowView = (boxRef.current?.clientWidth || 600) < 560;
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, sigIdx - (narrowView ? 32 : compact ? 55 : 70)), to: Math.min(data.candles.length + 3, sigIdx + (data.result ? Math.max(12, lowerBound(data.candles, data.result.time) - sigIdx + 6) : 20)) });

    chartRef.current = chart;
    seriesRef.current = candles;
    const redraw = () => setTick((t) => t + 1);
    chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);
    const ro = new ResizeObserver(() => {
      const w = boxRef.current?.clientWidth || 300;
      chart.applyOptions({ width: w });
      setWidth(w);
      redraw();
    });
    ro.observe(boxRef.current);
    const first = setTimeout(() => { redraw(); onLoaded?.(); }, 60);
    return () => {
      clearTimeout(first);
      ro.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(redraw);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, dark, height, compact, layers.ema, layers.structure]);

  const overlay = useOverlay(chartRef, seriesRef, boxRef, data, layers, dark, tick);
  const narrow = width < 560;

  if (error) return <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-6 text-sm text-slate-500 text-center">{error}</div>;

  return (
    <div>
      <div ref={wrapRef} className="relative rounded-xl overflow-hidden" style={{ background: palette(dark).bg }}>
        <div ref={boxRef} style={{ height }} />
        {data && overlay}
        {data && (
          <div className="absolute left-2 top-1.5 pointer-events-none text-[11px] leading-tight" style={{ color: palette(dark).text, zIndex: 5 }}>
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
        {data && narrow && layers.steps && data.steps.length > 0 && (
          <ol className="px-2.5 py-2 space-y-1 text-[11px] leading-snug" style={{ color: palette(dark).text }}>
            {data.steps.map((st, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="flex-shrink-0 w-4 h-4 rounded-full text-[9px] font-bold text-white flex items-center justify-center" style={{ background: palette(dark).callout }}>{i + 1}</span>
                <span>{st.text}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
      {!compact && data && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {LAYERS.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setLayers((l) => ({ ...l, [k]: !l[k] }))} aria-pressed={layers[k]}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition ${layers[k] ? "bg-green-500/15 border-green-500/40 text-green-700 dark:text-green-400" : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"}`}>
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

// ---------- drawing layer ----------

function useOverlay(chartRef, seriesRef, boxRef, data, layers, dark, tick) {
  const chart = chartRef.current, series = seriesRef.current;
  if (!data || !chart || !series || !boxRef.current) return null;
  void tick;
  const c = palette(dark);
  const W = boxRef.current.clientWidth - chart.priceScale("right").width();
  const H = boxRef.current.clientHeight - chart.timeScale().height();
  const xOf = (t) => {
    const i = lowerBound(data.candles, t);
    const x = chart.timeScale().logicalToCoordinate(i);
    return x == null ? null : x;
  };
  const yOf = (p) => (p == null ? null : series.priceToCoordinate(p));
  const xEnd = W;
  const narrow = W < 500;
  const els = [];
  let key = 0;
  const rect = (x1, y1, x2, y2, fill, stroke) => {
    if ([x1, y1, x2, y2].some((v) => v == null)) return;
    els.push(<rect key={key++} x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.max(1, Math.abs(x2 - x1))} height={Math.max(1, Math.abs(y2 - y1))} fill={fill} stroke={stroke || "none"} strokeWidth="1" />);
  };
  const hline = (x1, x2, p, stroke, dash, width = 1) => {
    const y = yOf(p);
    if (y == null || x1 == null) return;
    els.push(<line key={key++} x1={x1} x2={x2} y1={y} y2={y} stroke={stroke} strokeWidth={width} strokeDasharray={dash} />);
  };
  const label = (x, p, text, fill, anchor = "start", dy = -3) => {
    const y = yOf(p);
    if (y == null || x == null) return;
    els.push(<text key={key++} x={x} y={y + dy} fill={fill} fontSize="10" fontWeight="600" textAnchor={anchor}>{text}</text>);
  };

  if (layers.levels) {
    for (const l of [...data.levels.supports.slice(0, 2), ...data.levels.resistances.slice(0, 2)]) hline(0, xEnd, l.price, c.level, null, Math.min(2.5, 0.8 + l.strength * 0.5));
    if (data.prevDay) {
      hline(0, xEnd, data.prevDay.high, "#94a3b8", "6 4");
      if (!narrow) label(4, data.prevDay.high, "PDH", "#94a3b8");
      hline(0, xEnd, data.prevDay.low, "#94a3b8", "6 4");
      if (!narrow) label(4, data.prevDay.low, "PDL", "#94a3b8", "start", 11);
    }
    if (data.equalHighs) { hline(0, xEnd, data.equalHighs, "#a855f7", "2 3"); label(xEnd - 4, data.equalHighs, "EQH", "#a855f7", "end"); }
    if (data.equalLows) { hline(0, xEnd, data.equalLows, "#a855f7", "2 3"); label(xEnd - 4, data.equalLows, "EQL", "#a855f7", "end", 11); }
    if (data.asian) {
      rect(xOf(data.asian.from), yOf(data.asian.high), xOf(data.asian.to), yOf(data.asian.low), "rgba(234,179,8,0.07)", "rgba(234,179,8,0.35)");
      if (!narrow) label(xOf(data.asian.from), data.asian.high, "Asia", "#ca8a04");
    }
  }
  if (layers.zones) {
    if (data.range) {
      const x = xOf(data.range.from);
      hline(x, xEnd, data.range.mid, "#64748b", "4 4");
      label(xEnd - 4, data.range.mid, "50% EQ", "#64748b", "end");
      if (!narrow) {
        label(xEnd - 4, (data.range.high + data.range.mid) / 2, "Premium", "rgba(239,68,68,0.7)", "end");
        label(xEnd - 4, (data.range.low + data.range.mid) / 2, "Discount", "rgba(34,197,94,0.8)", "end");
      }
    }
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
  if (data.position) {
    const p = data.position;
    const x1 = xOf(p.from), x2 = Math.min(xEnd, Math.max((x1 ?? 0) + 40, xOf(p.to) ?? xEnd));
    if (p.sl) rect(x1, yOf(p.entry), x2, yOf(p.sl), "rgba(239,68,68,0.22)");
    if (p.tp) rect(x1, yOf(p.entry), x2, yOf(p.tp), "rgba(34,197,94,0.20)");
    if (p.risk) label(x2 - 3, p.sl, `Risk ${p.risk}`, "#ef4444", "end", p.sl > p.entry ? -3 : 11);
    if (p.reward) label(x2 - 3, p.tp, `Target ${p.reward}`, "#16a34a", "end", p.tp > p.entry ? -3 : 11);
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
  for (const n of data.news) {
    const x = xOf(n.time);
    if (x == null || x < 0 || x > W) continue;
    els.push(<line key={key++} x1={x} x2={x} y1={0} y2={H} stroke={n.topTier ? "rgba(239,68,68,0.55)" : "rgba(234,179,8,0.5)"} strokeDasharray="3 3" />);
    els.push(<text key={key++} x={x + 3} y={H - 4} fontSize="9" fill={n.topTier ? "#ef4444" : "#ca8a04"}>📰 {n.title.slice(0, 22)}</text>);
  }

  // Numbered callouts with leader lines (alternating above / below, stacked).
  const callouts = [];
  if (layers.steps) {
    const boxW = Math.min(170, W * 0.42), boxH = 30;
    const placed = [];
    data.steps.forEach((s, i) => {
      const ax = xOf(s.time), ay = yOf(s.price);
      if (ax == null || ay == null || ax < 0 || ax > W) return;
      if (narrow) { // numbered badge; the text is listed under the chart
        els.push(<g key={key++}><circle cx={ax} cy={ay} r="8" fill={c.callout} stroke="#fff" strokeWidth="1" /><text x={ax} y={ay + 3.5} fontSize="10" fontWeight="700" fill="#fff" textAnchor="middle">{i + 1}</text></g>);
        return;
      }
      const above = i % 2 === 0;
      let bx = Math.max(4, Math.min(W - boxW - 4, ax - boxW / 2 + (i % 3 - 1) * 20));
      let by = above ? Math.max(30, ay - 70) : Math.min(H - boxH - 18, ay + 40);
      for (let tries = 0; tries < 8 && placed.some((r) => !(bx + boxW < r.x || bx > r.x + boxW || by + boxH < r.y || by > r.y + boxH)); tries++) {
        by = above ? by - boxH - 6 : by + boxH + 6;
        if (by < 26 || by > H - boxH - 4) { by = Math.max(26, Math.min(H - boxH - 4, by)); bx = Math.max(4, Math.min(W - boxW - 4, bx + boxW * 0.6)); }
      }
      placed.push({ x: bx, y: by });
      els.push(<line key={key++} x1={ax} y1={ay} x2={bx + boxW / 2} y2={above ? by + boxH : by} stroke={c.callout} strokeWidth="2" />);
      callouts.push(
        <div key={`c${i}`} className="absolute text-white text-[10.5px] leading-tight rounded-md px-2 py-1 shadow"
          style={{ left: bx, top: by, width: boxW, minHeight: boxH, background: c.callout }}>
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
