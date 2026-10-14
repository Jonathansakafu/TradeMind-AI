// Server-drawn signal chart picture (added 2026-10-14) for push alerts,
// emails and trade screenshots: the same data as the in-app chart
// (services/chartAnnotations.js) drawn with @napi-rs/canvas -- candles,
// position box (risk / target), order block, fair value gaps, 50% line,
// support / resistance, previous day high / low, major BOS / CHoCH, swing
// labels, sweeps, the exit, and the numbered steps listed underneath.
// Bundled DejaVu fonts, so text works on servers without fonts. PNG buffer.
const path = require("path");
const { createCanvas, GlobalFonts } = require("@napi-rs/canvas");

const FONT_DIR = path.join(__dirname, "..", "assets", "fonts");
let fontsReady = false;
function fonts() {
  if (fontsReady) return;
  GlobalFonts.registerFromPath(path.join(FONT_DIR, "DejaVuSans.ttf"), "TMSans");
  GlobalFonts.registerFromPath(path.join(FONT_DIR, "DejaVuSans-Bold.ttf"), "TMSansBold");
  fontsReady = true;
}

const C = {
  bg: "#0b1220", grid: "rgba(148,163,184,0.09)", text: "#cbd5e1", muted: "#94a3b8",
  up: "#26a69a", down: "#ef5350", level: "rgba(148,163,184,0.55)", callout: "#1f6f78",
  green: "#22c55e", red: "#ef4444", purple: "#a855f7",
};

exports.render = (d, { width = 1080, height = 640 } = {}) => {
  fonts();
  const steps = d.steps || [];
  const stepsH = Math.min(7, steps.length) * 22 + (steps.length ? 14 : 0);
  const canvas = createCanvas(width, height);
  const g = canvas.getContext("2d");
  g.fillStyle = C.bg;
  g.fillRect(0, 0, width, height);

  const L = 14, R = width - 86, T = 56, B = height - stepsH - 34;
  const font = (px, bold) => `${px}px ${bold ? "TMSansBold" : "TMSans"}`;

  // Candles in view: the build-up, the signal and what followed.
  const all = d.candles || [];
  const sigIdx = Math.max(0, all.findIndex((c) => c.time >= d.signalTime));
  const endIdx = d.result ? Math.min(all.length - 1, Math.max(sigIdx + 8, all.findIndex((c) => c.time >= d.result.time) + 5)) : Math.min(all.length - 1, sigIdx + 25);
  const startIdx = Math.max(0, endIdx - 85);
  const view = all.slice(startIdx, endIdx + 1);
  if (!view.length) return canvas.toBuffer("image/png");
  const p = d.position;
  const prices = view.flatMap((c) => [c.high, c.low]).concat(p ? [p.entry, p.sl, p.tp].filter(Boolean) : []).concat(d.result ? [d.result.price] : []);
  let lo = Math.min(...prices), hi = Math.max(...prices);
  const pad = (hi - lo) * 0.06 || 1;
  lo -= pad; hi += pad;
  const step = (R - L) / (view.length + 2);
  const X = (t) => {
    let i = view.findIndex((c) => c.time >= t);
    if (i < 0) i = t > view.at(-1).time ? view.length - 1 : 0;
    return L + step * (i + 0.5);
  };
  const Y = (v) => T + ((hi - v) / (hi - lo)) * (B - T);
  const dec = d.pair === "XAUUSD" ? 2 : /JPY$/.test(d.pair) ? 3 : 5;
  const fx = (v) => Number(v).toFixed(dec);

  // grid + price axis
  g.font = font(12);
  for (let k = 0; k <= 5; k++) {
    const v = lo + ((hi - lo) * k) / 5, y = Y(v);
    g.strokeStyle = C.grid; g.lineWidth = 1;
    g.beginPath(); g.moveTo(L, y); g.lineTo(R, y); g.stroke();
    g.fillStyle = C.muted; g.fillText(fx(v), R + 8, y + 4);
  }
  // time axis
  for (let k = 0; k < view.length; k += Math.max(1, Math.round(view.length / 6))) {
    const t = new Date(view[k].time * 1000);
    g.fillStyle = C.muted;
    g.fillText(`${t.getUTCDate()}/${t.getUTCMonth() + 1} ${String(t.getUTCHours()).padStart(2, "0")}:00`, Math.max(L, Math.min(R - 70, L + step * (k + 0.5) - 26)), B + 18);
  }

  const box = (x1, y1, x2, y2, fill, stroke) => {
    g.fillStyle = fill; g.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)); }
  };
  const hline = (x1, x2, v, color, dash = [], w = 1) => {
    if (v == null || v < lo || v > hi) return;
    g.save(); g.setLineDash(dash); g.strokeStyle = color; g.lineWidth = w;
    g.beginPath(); g.moveTo(x1, Y(v)); g.lineTo(x2, Y(v)); g.stroke(); g.restore();
  };
  const text = (s, x, y, color, px = 11, bold = true, align = "left") => {
    g.font = font(px, bold); g.fillStyle = color; g.textAlign = align; g.fillText(s, x, y); g.textAlign = "left";
  };

  // levels and zones
  for (const l of [...(d.levels?.supports || []).slice(0, 2), ...(d.levels?.resistances || []).slice(0, 2)]) hline(L, R, l.price, C.level, [], 1.5);
  if (d.prevDay) { hline(L, R, d.prevDay.high, C.muted, [6, 4]); text("PDH", L + 2, Y(d.prevDay.high) - 3, C.muted, 10); hline(L, R, d.prevDay.low, C.muted, [6, 4]); text("PDL", L + 2, Y(d.prevDay.low) + 11, C.muted, 10); }
  if (d.range) { hline(X(d.range.from), R, d.range.mid, "#64748b", [4, 4]); text("50% EQ", R - 4, Y(d.range.mid) - 3, "#64748b", 10, true, "right"); }
  for (const f of d.fvgs || []) {
    if (f.top < lo || f.bottom > hi) continue;
    box(X(f.from), Y(f.top), R, Y(f.bottom), f.dir === "bullish" ? "rgba(34,197,94,0.10)" : "rgba(239,68,68,0.10)");
    text("FVG", X(f.from) + 3, Y(f.top) + 11, f.dir === "bullish" ? "#16a34a" : "#dc2626", 10);
  }
  if (d.orderBlock && d.orderBlock.bottom < hi && d.orderBlock.top > lo) {
    const ob = d.orderBlock, bull = ob.dir === "bullish";
    box(X(ob.from), Y(ob.top), R, Y(ob.bottom), bull ? "rgba(59,130,246,0.15)" : "rgba(249,115,22,0.15)", bull ? "rgba(59,130,246,0.5)" : "rgba(249,115,22,0.5)");
    text(`${bull ? "Bull" : "Bear"} OB`, X(ob.from) + 3, Y(ob.top) + 11, bull ? "#3b82f6" : "#f97316", 10);
  }
  if (p) {
    const x1 = X(p.from), x2 = Math.max(x1 + 30, d.result ? X(d.result.time) : R - 4);
    if (p.sl) box(x1, Y(p.entry), x2, Y(p.sl), "rgba(239,68,68,0.24)");
    if (p.tp) box(x1, Y(p.entry), x2, Y(p.tp), "rgba(34,197,94,0.22)");
  }
  for (const s of (d.structure || []).filter((x) => x.scope === "major")) {
    const col = s.dir === "bullish" ? C.green : C.red;
    hline(X(s.from), X(s.to), s.level, col, [], 1.5);
    text(s.type, (X(s.from) + X(s.to)) / 2, Y(s.level) + (s.dir === "bullish" ? -4 : 12), col, 10, true, "center");
  }

  // candles
  const bw = Math.max(1, step * 0.62);
  view.forEach((c, i) => {
    const x = L + step * (i + 0.5);
    const col = c.close >= c.open ? C.up : C.down;
    g.strokeStyle = col; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, Y(c.high)); g.lineTo(x, Y(c.low)); g.stroke();
    g.fillStyle = col;
    const yo = Y(c.open), yc = Y(c.close);
    g.fillRect(x - bw / 2, Math.min(yo, yc), bw, Math.max(1, Math.abs(yc - yo)));
  });

  // swing labels, sweeps, news
  for (const s of d.swings || []) {
    if (s.time < view[0].time) continue;
    text(s.label, X(s.time), s.kind === "H" ? Y(s.price) - 6 : Y(s.price) + 14, C.text, 9, true, "center");
  }
  for (const sw of d.sweeps || []) {
    if (sw.time < view[0].time) continue;
    text(sw.side === "highs" ? "▼ sweep" : "▲ sweep", X(sw.time), sw.side === "highs" ? Y(sw.price) - 16 : Y(sw.price) + 26, C.purple, 9, true, "center");
  }
  // News: one line and label per release time (several events often share one).
  const byTime = new Map();
  for (const n of d.news || []) if (!byTime.has(n.time)) byTime.set(n.time, n);
  for (const n of byTime.values()) {
    const x = X(n.time);
    g.save(); g.setLineDash([3, 3]); g.strokeStyle = n.topTier ? "rgba(239,68,68,0.5)" : "rgba(234,179,8,0.45)";
    g.beginPath(); g.moveTo(x, T); g.lineTo(x, B); g.stroke(); g.restore();
    text(n.title.slice(0, 20), x + 3, B - 5, n.topTier ? C.red : "#ca8a04", 9);
  }

  // entry / SL / TP lines with axis tags
  const tag = (v, label, color) => {
    if (v == null) return;
    hline(L, R, v, color, label === "Entry" ? [5, 4] : [], 1);
    g.fillStyle = color; g.fillRect(R + 2, Y(v) - 9, 82, 18);
    text(`${label} ${fx(v)}`, R + 6, Y(v) + 4, label === "Entry" ? "#0b1220" : "#ffffff", 10);
  };
  if (p) { tag(p.sl, "SL", C.red); tag(p.tp, "TP", "#16a34a"); tag(p.entry, "Entry", "#e2e8f0"); }
  if (d.result) {
    const x = X(d.result.time), y = Y(d.result.price);
    const col = d.result.outcome === "win" ? C.green : d.result.outcome === "loss" ? C.red : C.muted;
    g.fillStyle = col; g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill();
    text(d.result.outcome === "win" ? "TP hit" : d.result.outcome === "loss" ? "SL hit" : "Closed", x + 9, y - 7, col, 11);
  }

  // numbered badges on the chart, the steps underneath
  steps.forEach((s, i) => {
    if (s.time < view[0].time || s.price < lo || s.price > hi) return;
    const x = X(s.time), y = Y(s.price);
    g.fillStyle = C.callout; g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#fff"; g.lineWidth = 1; g.stroke();
    text(String(i + 1), x, y + 4, "#ffffff", 11, true, "center");
  });
  steps.slice(0, 7).forEach((s, i) => {
    const y = B + 40 + i * 22;
    g.fillStyle = C.callout; g.beginPath(); g.arc(L + 9, y - 4, 9, 0, Math.PI * 2); g.fill();
    text(String(i + 1), L + 9, y, "#ffffff", 11, true, "center");
    text(s.text.length > 110 ? `${s.text.slice(0, 107)}…` : s.text, L + 26, y, C.text, 13, false);
  });

  // header
  text(`${d.pair} · ${String(d.tf).toUpperCase()} · TradeMind AI`, L, 22, "#ffffff", 16);
  if (d.direction) text(`${d.direction.toUpperCase()}${d.confidence ? ` ${d.confidence}%` : ""}`, L + g.measureText(`${d.pair} · ${String(d.tf).toUpperCase()} · TradeMind AI`).width + 12, 22, d.direction === "buy" ? C.green : C.red, 16);
  text(`4H ${d.trend?.h4} · 1H ${d.trend?.h1}${p?.rr ? ` · R:R 1:${p.rr.toFixed(1)}` : ""}${p?.risk ? ` · risk ${p.risk} · target ${p.reward}` : ""}`, L, 42, C.muted, 12, false);
  return canvas.toBuffer("image/png");
};
