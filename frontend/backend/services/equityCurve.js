// Equity curve of a period (today in East Africa Time, or the last 7 days),
// rebuilt from market prices (added 2026-10-14): for every minute (5
// minutes over 7 days), the P/L of trades closed so far in the period plus
// the floating P/L of trades open at that moment, measured from the start
// of the period (floating carried in from before counts from its value at
// the start, like MT5's equity change for the day). Each candle's high /
// low gives the best and worst moment inside it. Works even for times the
// app was closed; the app adds the live 3-second price on top.
const Trade = require("../models/Trade");
const marketService = require("./marketService");
const { calculatePL } = require("../utils/tradePL");

const TZ_MS = 3 * 3600 * 1000; // EAT
const DAY = 24 * 3600 * 1000;
const CANDLE_TTL_MS = 60 * 1000;
const candleCache = new Map();

async function candlesFor(pair, interval, range) {
  const key = `${pair}|${interval}|${range}`;
  const hit = candleCache.get(key);
  if (hit && Date.now() - hit.at < CANDLE_TTL_MS) return hit.candles;
  const candles = (await marketService.getYahooCandles(pair, { interval, range }))
    .map((c) => ({ t: new Date(c.datetime).getTime(), high: c.high, low: c.low, close: c.close }))
    .filter((c) => c.t && c.close)
    .sort((a, b) => a.t - b.t);
  candleCache.set(key, { at: Date.now(), candles });
  return candles;
}

function periodStart(period, now) {
  if (period === "7d") return new Date(now.getTime() - 7 * DAY);
  const l = new Date(now.getTime() + TZ_MS);
  return new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate()) - TZ_MS);
}

const pl = (t, price) => calculatePL(t.pair, t.direction, t.entryPrice, price, t.lotSize || 0.01)?.pl ?? 0;
const opened = (t) => new Date(t.openedAt || t.createdAt).getTime();
const closed = (t) => (t.outcome ? new Date(t.closedAt || t.updatedAt || t.openedAt).getTime() : Infinity);

exports.build = async (userId, period = "today", now = new Date()) => {
  const from = periodStart(period, now).getTime();
  const end = now.getTime();
  const step = period === "7d" ? 5 * 60 * 1000 : 60 * 1000;
  const interval = period === "7d" ? "5m" : "1m";
  const range = period === "7d" ? "7d" : "1d";

  const trades = (await Trade.find({
    user: userId,
    entryPrice: { $gt: 0 },
    $or: [{ outcome: { $exists: false } }, { outcome: null }, { closedAt: { $gte: new Date(from) } }],
  }).select("pair direction entryPrice exitPrice lotSize profitLoss outcome openedAt closedAt createdAt updatedAt").lean())
    .filter((t) => opened(t) <= end && closed(t) >= from);

  const pairs = [...new Set(trades.map((t) => t.pair))];
  const series = {};
  await Promise.all(pairs.map(async (p) => {
    try {
      series[p] = await candlesFor(p, interval, range);
    } catch {
      series[p] = [];
    }
  }));

  // Floating P/L carried in from before the period: counted from its value
  // at the start, so the curve starts at 0.
  const priceAt = (pair, t) => {
    const c = series[pair];
    if (!c?.length) return null;
    let lo = 0, hi = c.length - 1, best = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (c[mid].t <= t) { best = c[mid]; lo = mid + 1; } else hi = mid - 1;
    }
    return best;
  };
  const baseline = {};
  for (const t of trades) {
    if (opened(t) < from) {
      const c = priceAt(t.pair, from);
      baseline[t._id] = c ? pl(t, c.close) : 0;
    } else baseline[t._id] = 0;
  }

  const realizedTrades = trades.filter((t) => t.outcome && closed(t) >= from).sort((a, b) => closed(a) - closed(b));
  const points = [];
  let peak = { value: 0, at: from }, low = { value: 0, at: from };
  for (let t = from - (from % step) + step; t <= end; t += step) {
    let realized = 0, close = 0, best = 0, worst = 0;
    for (const r of realizedTrades) if (closed(r) <= t) realized += (Number(r.profitLoss) || 0) - baseline[r._id];
    for (const tr of trades) {
      if (opened(tr) > t || closed(tr) <= t) continue; // not open at this minute
      const c = priceAt(tr.pair, t);
      if (!c || t - c.t > 3 * step) continue; // no fresh candle (market closed)
      const base = baseline[tr._id];
      const a = pl(tr, c.high) - base, b = pl(tr, c.low) - base;
      close += pl(tr, c.close) - base;
      best += Math.max(a, b);
      worst += Math.min(a, b);
    }
    const v = realized + close;
    points.push({ t, v: Math.round(v * 100) / 100 });
    if (realized + best > peak.value) peak = { value: Math.round((realized + best) * 100) / 100, at: t };
    if (realized + worst < low.value) low = { value: Math.round((realized + worst) * 100) / 100, at: t };
  }

  // What the app needs to add the live price itself: realized so far and
  // each open trade's baseline.
  const realizedNow = realizedTrades.reduce((s, r) => s + (Number(r.profitLoss) || 0) - baseline[r._id], 0);
  const open = trades.filter((t) => !t.outcome).map((t) => ({
    _id: t._id, pair: t.pair, direction: t.direction, entryPrice: t.entryPrice, lotSize: t.lotSize || 0.01, baseline: baseline[t._id],
  }));
  const every = Math.max(1, Math.ceil(points.length / 150));
  return {
    period, from: new Date(from), to: now,
    peak, low,
    realized: Math.round(realizedNow * 100) / 100,
    open,
    current: points.at(-1)?.v ?? Math.round(realizedNow * 100) / 100,
    points: points.filter((_, i) => i % every === 0 || i === points.length - 1),
  };
};
