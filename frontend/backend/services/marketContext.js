// Deterministic market context for the signal pipeline: market structure,
// support/resistance, moving averages and multi-timeframe trend (4H / 1H /
// 15m). Pure calculation, no AI -- it runs before any AI call so that:
//   1. the AI gets a structured read of the market instead of 10 raw
//      candles, and
//   2. signalRules.js can skip the AI entirely when there's no setup and
//      check every signal against fixed rules.
// Added 2026-10 ("AI trading workflow": structure, S/R + indicators,
// multi-timeframe). Data: Yahoo via marketService.getYahooCandles.

const marketService = require("./marketService");

const CACHE_MS = 10 * 60 * 1000; // per pair; shared by every user in a cycle
const cache = new Map();

// ---------- primitives ----------

function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function rsi(closes, period = 14) {
  if (closes.length <= period) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgG = gain / period, avgL = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgL === 0) return 100;
  return 100 - 100 / (1 + avgG / avgL);
}

function atr(candles, period = 14) {
  if (candles.length < 2) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const last = trs.slice(-period);
  return last.reduce((a, b) => a + b, 0) / last.length;
}

// Fractal swing points: a high (low) higher (lower) than the `k` candles on
// each side. The last k candles can't be confirmed yet and are excluded.
function swings(candles, k = 2) {
  const highs = [], lows = [];
  for (let i = k; i < candles.length - k; i++) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= k; j++) {
      if (!(candles[i].high > candles[i - j].high && candles[i].high >= candles[i + j].high)) isHigh = false;
      if (!(candles[i].low < candles[i - j].low && candles[i].low <= candles[i + j].low)) isLow = false;
    }
    if (isHigh) highs.push({ i, price: candles[i].high, time: candles[i].datetime });
    if (isLow) lows.push({ i, price: candles[i].low, time: candles[i].datetime });
  }
  return { highs, lows };
}

// Group 1H candles into 4H candles on UTC 4-hour boundaries.
function toFourHour(h1) {
  const out = [];
  for (const c of h1) {
    const t = new Date(c.datetime);
    const bucket = Math.floor(t.getTime() / (4 * 3600 * 1000));
    const last = out[out.length - 1];
    if (last && last.bucket === bucket) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
    } else {
      out.push({ bucket, datetime: c.datetime, open: c.open, high: c.high, low: c.low, close: c.close });
    }
  }
  return out;
}

// ---------- per-timeframe read ----------

// Trend from the last two confirmed swing highs and lows:
// HH + HL = up, LH + LL = down, anything mixed = range. The 50 EMA breaks
// a tie when structure is mixed but price is clearly on one side.
function analyzeTimeframe(candles, label) {
  if (!candles || candles.length < 30) return { label, trend: "unknown", note: "not enough data" };
  const closes = candles.map((c) => c.close);
  const last = closes[closes.length - 1];
  const { highs, lows } = swings(candles);
  const e20 = ema(closes, 20), e50 = ema(closes, 50);

  let structure = "range";
  if (highs.length >= 2 && lows.length >= 2) {
    const [h1, h2] = highs.slice(-2), [l1, l2] = lows.slice(-2);
    if (h2.price > h1.price && l2.price > l1.price) structure = "up";
    else if (h2.price < h1.price && l2.price < l1.price) structure = "down";
  }
  let trend = structure;
  // Swings say one thing but both moving-average reads say the opposite
  // (e.g. old higher-highs while price has already fallen below a falling
  // 50 EMA): don't trust either -- call it a range.
  if (e50 && e20) {
    const emaBull = last > e50 && e20 > e50, emaBear = last < e50 && e20 < e50;
    if ((structure === "up" && emaBear) || (structure === "down" && emaBull)) trend = "range";
  }
  if (structure === "range" && e50) {
    if (last > e50 && e20 > e50) trend = "up-leaning";
    else if (last < e50 && e20 < e50) trend = "down-leaning";
  }

  // Break of structure: the latest close beyond the most recent confirmed
  // swing high (bullish) or swing low (bearish) within the last few candles.
  let bos = null;
  const lastHigh = highs[highs.length - 1], lastLow = lows[lows.length - 1];
  const recent = candles.slice(-6);
  if (lastHigh && recent.some((c) => c.close > lastHigh.price) && last > lastHigh.price) bos = { dir: "bullish", level: lastHigh.price };
  if (lastLow && recent.some((c) => c.close < lastLow.price) && last < lastLow.price) bos = { dir: "bearish", level: lastLow.price };

  return {
    label,
    trend, // up | down | up-leaning | down-leaning | range | unknown
    structure,
    bos,
    close: last,
    ema20: e20,
    ema50: e50,
    rsi: rsi(closes),
    atr: atr(candles),
    swingHighs: highs.slice(-6).map((s) => s.price),
    swingLows: lows.slice(-6).map((s) => s.price),
  };
}

// Support/resistance: swing points from 4H and 1H clustered within 0.5 ATR
// of each other; levels touched more often rank higher.
function supportResistance(price, tfs, atrH1) {
  const points = [];
  for (const tf of tfs) {
    if (!tf || tf.trend === "unknown") continue;
    const weight = tf.label === "4H" ? 2 : 1;
    for (const p of [...tf.swingHighs, ...tf.swingLows]) points.push({ price: p, weight });
  }
  const tol = (atrH1 || price * 0.001) * 0.5;
  const clusters = [];
  for (const pt of points.sort((a, b) => a.price - b.price)) {
    const c = clusters[clusters.length - 1];
    if (c && pt.price - c.max <= tol) {
      c.sum += pt.price * pt.weight; c.w += pt.weight; c.max = pt.price; c.touches++;
    } else {
      clusters.push({ sum: pt.price * pt.weight, w: pt.weight, max: pt.price, touches: 1 });
    }
  }
  const levels = clusters.map((c) => ({ price: c.sum / c.w, strength: c.touches }));
  const supports = levels.filter((l) => l.price < price).sort((a, b) => b.price - a.price).slice(0, 3);
  const resistances = levels.filter((l) => l.price > price).sort((a, b) => a.price - b.price).slice(0, 3);
  return { supports, resistances };
}

// ---------- public ----------

const fmtFor = (price) => (n) => (n == null ? "?" : Number(n).toFixed(price >= 100 ? 2 : 5));

function describe(tf, fmt) {
  if (tf.trend === "unknown") return `${tf.label}: not enough data`;
  const parts = [`${tf.label}: ${tf.trend} (structure ${tf.structure})`];
  if (tf.ema20 && tf.ema50) parts.push(`price ${tf.close > tf.ema50 ? "above" : "below"} 50 EMA, 20 EMA ${tf.ema20 > tf.ema50 ? "above" : "below"} 50 EMA`);
  if (tf.rsi != null) parts.push(`RSI ${Math.round(tf.rsi)}`);
  if (tf.bos) parts.push(`recent ${tf.bos.dir} break of structure at ${fmt(tf.bos.level)}`);
  return parts.join(", ");
}

// Full context for one pair at the given live price (cached 10 min).
exports.getMarketContext = async (pair, price) => {
  const key = pair;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.ctx;

  const [h1raw, m15raw] = await Promise.all([
    marketService.getYahooCandles(pair, { interval: "60m", range: "30d" }),
    marketService.getYahooCandles(pair, { interval: "15m", range: "5d" }),
  ]);
  const h1c = h1raw.slice(-200);
  const h4c = toFourHour(h1raw).slice(-120);
  const m15c = m15raw.slice(-150);

  const h4 = analyzeTimeframe(h4c, "4H");
  const h1 = analyzeTimeframe(h1c, "1H");
  const m15 = analyzeTimeframe(m15c, "15m");
  const atrH1 = h1.atr;
  const px = price || h1.close;
  const levels = px ? supportResistance(px, [h4, h1], atrH1) : { supports: [], resistances: [] };
  const fmt = fmtFor(px || 1);

  const summary = [
    "Multi-timeframe structure (computed from price data):",
    `- ${describe(h4, fmt)}`,
    `- ${describe(h1, fmt)}`,
    `- ${describe(m15, fmt)}`,
    `- Nearest support: ${levels.supports.map((l) => fmt(l.price)).join(", ") || "none found"}`,
    `- Nearest resistance: ${levels.resistances.map((l) => fmt(l.price)).join(", ") || "none found"}`,
    atrH1 ? `- 1H average range (ATR): ${fmt(atrH1)}` : "",
  ].filter(Boolean).join("\n");

  const ctx = { pair, price: px, h4, h1, m15, atrH1, levels, summary, candlesH1: h1c.slice(-10) };
  if (h1c.length) cache.set(key, { at: Date.now(), ctx });
  return ctx;
};

// Exported for tests.
exports._internals = { ema, rsi, atr, swings, toFourHour, analyzeTimeframe, supportResistance };
