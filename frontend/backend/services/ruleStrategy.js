// Rule-based signals, backtested (added 2026-10-16). Replaces the AI as the
// source of automatic signals: 2 days of live results before this were
// almost all stop-outs (Oct 14-15: every EURUSD/GBPUSD/XAUUSD SELL hit SL;
// Oct 16: every XAUUSD BUY hit SL), and the AI's direction flipped with no
// measurable edge. Every setup below was chosen on Yahoo 1h data
// 2024-05 -> 2026-02 and checked on 2026-02 -> 2026-10 (unseen), with
// spread costs, stop checked before target inside a candle. Entry at the
// next price after the setup candle closes; one open trade per setup.
//
// "Trend": 4H EMA50 above EMA200 and the last closed 4H close above EMA50
// = up (mirror for down).
//
// XAUUSD. 2026-10-17: the user found stops and targets too far (3.5 ATR
// stops = ~$58 on 1H / ~$107 on 4H, 4R targets up to ~$430), so every
// setup has a tighter stop and a fixed 2R target -- no trailing (the user
// risks a fixed amount, e.g. $8, for 2x it; lot size does the rest, see
// utils/lotSize.js). 2026-10-22: re-checked on Dukascopy spot gold (15m,
// 2024-05 -> 2026-10) as well as Yahoo futures; the user asked for more
// signals. Now, on spot data: ~7.8 signals/week, ~46% wins, PF 1.55 / 1.28,
// worst combined losing run ~35R (setups often lose together).
//   1. trend pullback (1H): in 07-17 UTC Mon-Fri, a 1H candle takes RSI(2)
//      under 10 (over 90 in a downtrend) on the trend side of the 1H EMA200.
//      Stop 2.5 x 1H ATR (~$42), target 2R. Up to 2 open. PF 1.80 / 1.30.
//   2. 4-day breakout (4H): a 4H close beyond the high (low) of the previous
//      24 4H candles, with the trend. Stop 1.5 x 4H ATR (~$46), target 2R.
//      Up to 2 open. PF 1.63 / 1.27.
//   3. pin bar (4H): a hammer (lower wick >= 2/3 of the range, body <= 1/3)
//      in an uptrend / shooting star in a downtrend. Stop 2.5 x 4H ATR
//      (~$77), target 2R. PF 1.66 / 1.45.
//   4. 1-day breakout (15m, added 2026-10-22): a 15m close beyond the high
//      (low) of the previous 96 15m candles (24 h), with the 4H trend. Stop
//      2.5 x 15m ATR (~$15), target 2R. PF 1.36 / 1.26. Only 15m version
//      that passed (pullback, pin bar, FVG and a 6 h breakout on 15m didn't).
// maxOpen: trades one setup may have running at once; a second open trade
// (pullback, 4H breakout) adds ~1.4 signals/week at the same PF but deepens
// the worst losing run (16R -> 35R with the 15m setup).
// Removed 2026-10-22: the 4H fair value gap (added 2026-10-20) -- PF 1.44 /
// 1.71 on Yahoo futures but 1.00 / 1.06 on spot gold: not a real edge.
// Tested and rejected (lost on the unseen period): order blocks, supply /
// demand zones, engulfing (1H / 4H, with and without the trend), and all
// setups on EURUSD, GBPUSD, AUDUSD, NZDUSD, BTC, ETH. Also the 4H inside bar
// breakout -- it only held up with a 3.5 ATR stop.
// All close after 48 h. Backtests run this file's setupAt, so the tested
// rules are the live rules.
// trailAtr (stop trailed after every closed candle) is supported but unused.
//
// EURUSD / GBPUSD: no rule tested (RSI pullback, Donchian breakout, EMA
// resumption, pin bar, engulfing, inside bar, 24h high/low break; 1H and
// 4H) was clearly positive on both periods, so they get no automatic
// signals. AI_AUTO_SIGNAL_PAIRS (env, e.g. "EURUSD,GBPUSD") brings back the
// old AI signals for named pairs.
const marketService = require("./marketService");

const HOUR = 3600e3;
const TF_MS = { "15m": HOUR / 4, "1h": HOUR, "4h": 4 * HOUR };

exports.STRATEGIES = {
  XAUUSD: [
    {
      key: "gold_trend_pullback", label: "Gold trend pullback", tf: "1h", setup: "pullback",
      rsiExtreme: 10, sessionUtc: [7, 17], stopAtr: 2.5, targetR: 2, trailAtr: null, maxHoldHours: 48, maxOpen: 2,
      backtest: { winRate: 49, profitFactor: 1.5, tradesPerWeek: 2.2, maxDrawdownR: 17 },
    },
    {
      key: "gold_4h_breakout", label: "Gold 4-day breakout", tf: "4h", setup: "breakout",
      lookback: 24, stopAtr: 1.5, targetR: 2, trailAtr: null, maxHoldHours: 48, maxOpen: 2,
      backtest: { winRate: 48, profitFactor: 1.45, tradesPerWeek: 1.6, maxDrawdownR: 12 },
    },
    {
      key: "gold_4h_pin_bar", label: "Gold 4H pin bar", tf: "4h", setup: "pin",
      stopAtr: 2.5, targetR: 2, trailAtr: null, maxHoldHours: 48, maxOpen: 1,
      backtest: { winRate: 56, profitFactor: 1.55, tradesPerWeek: 0.75, maxDrawdownR: 5 },
    },
    {
      key: "gold_15m_day_breakout", label: "Gold 15m 1-day breakout", tf: "15m", setup: "breakout",
      lookback: 96, stopAtr: 2.5, targetR: 2, trailAtr: null, maxHoldHours: 48, maxOpen: 1,
      backtest: { winRate: 41, profitFactor: 1.3, tradesPerWeek: 3.2, maxDrawdownR: 11 },
    },
  ],
};

exports.has = (pair) => !!exports.STRATEGIES[pair]?.length;
const byKey = (key) => Object.values(exports.STRATEGIES).flat().find((s) => s.key === key);

// ---- indicators (same formulas as the backtest: Wilder ATR / RSI) ----
function ema(xs, n) {
  const k = 2 / (n + 1), out = [];
  let e = null;
  for (const x of xs) { e = e == null ? x : e + k * (x - e); out.push(e); }
  return out;
}
function atr(bars, n = 14) {
  const out = [];
  let a = null, pc = null;
  for (const b of bars) {
    const tr = pc == null ? b.high - b.low : Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
    a = a == null ? tr : a + (tr - a) / n;
    out.push(a);
    pc = b.close;
  }
  return out;
}
function rsi(closes, n) {
  const out = [null];
  let ag = null, al = null;
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1], g = Math.max(d, 0), l = Math.max(-d, 0);
    if (ag == null) { ag = g; al = l; } else { ag += (g - ag) / n; al += (l - al) / n; }
    out.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  }
  return out;
}
// UTC 4-hour buckets; closedIdx[i] = index of the last 4H candle that had
// fully closed before candle i started (on 4H input: i - 1).
function fourHour(bars) {
  const h4 = [], closedIdx = [];
  let cur = null;
  for (const b of bars) {
    const bucket = Math.floor(b.t / (4 * HOUR));
    if (!cur || cur.bucket !== bucket) {
      if (cur) h4.push(cur);
      cur = { bucket, t: bucket * 4 * HOUR, open: b.open, high: b.high, low: b.low, close: b.close };
    } else {
      cur.high = Math.max(cur.high, b.high); cur.low = Math.min(cur.low, b.low); cur.close = b.close;
    }
    closedIdx.push(h4.length - 1);
  }
  return { h4, closedIdx };
}

// Pure: indicators over closed candles ({t ms, open, high, low, close}).
function indicators(bars) {
  const c = bars.map((b) => b.close);
  const { h4, closedIdx } = fourHour(bars);
  const c4 = h4.map((b) => b.close);
  return { c, A: atr(bars), e200: ema(c, 200), r2: rsi(c, 2), h4, closedIdx, e4_50: ema(c4, 50), e4_200: ema(c4, 200) };
}

// Trend from 4H candle k (closed), given its closes and EMA50 / EMA200.
function trendFrom(c4, e50, e200, k) {
  if (k < 200) return 0;
  if (e50[k] > e200[k] && c4[k] > e50[k]) return 1;
  if (e50[k] < e200[k] && c4[k] < e50[k]) return -1;
  return 0;
}
const trendOf4h = (X, k) => trendFrom(X.h4.map((b) => b.close), X.e4_50, X.e4_200, k);
// The trend candle i trades in: from the last 4H candle closed before it.
// X.trendFn (15m setups, live) takes the trend from the long 1H-built 4H
// history instead of the short 15m history -- same buckets, same rule.
const trendAt = (X, i) => (X.trendFn ? X.trendFn(i) : trendFrom(X.c4 ??= X.h4.map((b) => b.close), X.e4_50, X.e4_200, X.closedIdx[i]));

// Pure: trend for candles of any timeframe from closed 4H candles h4 (the
// last one that closed before the candle started), as trendAt does.
function trendFnFrom4h(bars, h4) {
  const c4 = h4.map((b) => b.close), e50 = ema(c4, 50), e200 = ema(c4, 200);
  return (i) => {
    const start = Math.floor(bars[i].t / (4 * HOUR)) * 4 * HOUR;
    let lo = 0, hi = h4.length - 1, k = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (h4[m].t < start) { k = m; lo = m + 1; } else hi = m - 1; }
    return trendFrom(c4, e50, e200, k);
  };
}

// Pure: is closed candle i a setup for strategy s? Returns
// { dir, atr, risk, detail } (risk = stop distance in price) or null.
function setupAt(bars, X, i, s) {
  const b = bars[i], p = bars[i - 1], A = X.A[i];
  const trend = trendAt(X, i);
  const atrStop = () => s.stopAtr * A;
  if (!trend) return null;
  if (s.setup === "pullback") {
    const d = new Date(b.t), h = d.getUTCHours(), wd = d.getUTCDay();
    if (wd === 0 || wd === 6 || h < s.sessionUtc[0] || h >= s.sessionUtc[1]) return null;
    const r = X.r2[i], c = X.c[i];
    const ok = trend === 1 ? r < s.rsiExtreme && c > X.e200[i] : r > 100 - s.rsiExtreme && c < X.e200[i];
    return ok ? { dir: trend, atr: A, risk: atrStop(), detail: `RSI(2) ${r.toFixed(0)}` } : null;
  }
  if (s.setup === "breakout") {
    if (i < s.lookback) return null;
    const prev = bars.slice(i - s.lookback, i);
    const hi = Math.max(...prev.map((x) => x.high)), lo = Math.min(...prev.map((x) => x.low));
    const dir = b.close > hi && p.close <= hi ? 1 : b.close < lo && p.close >= lo ? -1 : 0;
    if (!dir || dir !== trend) return null;
    return { dir, atr: A, risk: atrStop(), detail: `closed ${dir === 1 ? "above" : "below"} the ${spanOf(s)} ${dir === 1 ? "high" : "low"} ${round(dir === 1 ? hi : lo, b.close)}` };
  }
  if (s.setup === "pin") {
    const range = b.high - b.low;
    if (range <= 0) return null;
    const body = Math.abs(b.close - b.open);
    const dir = Math.min(b.open, b.close) - b.low >= (2 / 3) * range && body <= range / 3 ? 1
      : b.high - Math.max(b.open, b.close) >= (2 / 3) * range && body <= range / 3 ? -1 : 0;
    if (!dir || dir !== trend) return null;
    return { dir, atr: A, risk: atrStop(), detail: dir === 1 ? `hammer rejecting ${round(b.low, b.close)}` : `shooting star rejecting ${round(b.high, b.close)}` };
  }
  return null;
}

// Pure: the stop after the closed candles since entry. Only ever tightens.
function trailedStop({ dir, stop }, barsSinceEntry, atrs, trailAtr, entry) {
  let best = entry, sl = stop;
  barsSinceEntry.forEach((b, j) => {
    best = dir === 1 ? Math.max(best, b.high) : Math.min(best, b.low);
    const next = best - dir * trailAtr * atrs[j];
    if ((next - sl) * dir > 0) sl = next;
  });
  return sl;
}

// "15-minute" / "1H" / "4H" for messages.
const tfName = (tf) => (tf === "15m" ? "15-minute" : tf.toUpperCase());
// "4-day" / "24-hour": how far back a breakout setup looks.
const spanOf = (s) => (s.tf === "15m" ? "24-hour" : "4-day");
const decimalsFor = (p) => (p >= 100 ? 2 : p >= 10 ? 3 : 5);
function round(n, ref) { return Number(Number(n).toFixed(decimalsFor(ref))); }

exports._internals = { ema, atr, rsi, fourHour, fourHourBuckets, indicators, trendAt, trendOf4h, trendFnFrom4h, setupAt, trailedStop };

// What each of the pair's setups is waiting for, from the latest closed
// candles -- the daily "still watching" message (services/dailyStatus.js).
exports.watchText = async (pair, price, now = Date.now()) => {
  const list = exports.STRATEGIES[pair] || [];
  if (!list.length) return null;
  const b4 = await closedBars(pair, "4h", now);
  if (b4.length < 300) return null;
  const X4 = indicators(b4), k = b4.length - 1;
  // The trend the next 4H candle will trade in: from candle k itself (X4's
  // own 4H series ends one candle earlier, at the last fully closed bucket
  // before candle k), same rule as trendOf4h.
  const e50 = ema(X4.c, 50), e200 = ema(X4.c, 200);
  const trend = k < 200 ? 0 : e50[k] > e200[k] && X4.c[k] > e50[k] ? 1 : e50[k] < e200[k] && X4.c[k] < e50[k] ? -1 : 0;
  const px = price || b4[k].close;
  const f = (n) => round(n, px);
  const head = `${pair} ${f(px)} · 4H trend ${trend === 1 ? "up" : trend === -1 ? "down" : "unclear"}`;
  if (!trend) return `${head}. Price is between its 4H averages, and every setup waits for a clear trend — no trade is better than a coin flip.`;
  const up = trend === 1, wants = [];
  for (const s of list) {
    if (s.setup === "pullback") wants.push(`a sharp 1H ${up ? "dip (RSI(2) under 10)" : "spike (RSI(2) over 90)"} between 07:00 and 17:00 UTC`);
    if (s.setup === "breakout") {
      const bars = s.tf === "4h" ? b4 : await closedBars(pair, s.tf, now).catch(() => []);
      if (bars.length < s.lookback) continue;
      const prev = bars.slice(-s.lookback);
      wants.push(`a ${tfName(s.tf)} close ${up ? `above ${f(Math.max(...prev.map((b) => b.high)))}` : `below ${f(Math.min(...prev.map((b) => b.low)))}`} (${spanOf(s)} ${up ? "high" : "low"})`);
    }
    if (s.setup === "pin") wants.push(`a 4H ${up ? "hammer" : "shooting star"}`);
  }
  return `${head}. Waiting for ${wants.slice(0, -1).join(", ")}${wants.length > 1 ? " or " : ""}${wants.at(-1)}.`;
};

// ---- live ----
const toBars = (candles) => candles
  .map((c) => ({ t: new Date(c.datetime).getTime(), open: +c.open, high: +c.high, low: +c.low, close: +c.close }))
  .filter((b) => b.high >= b.low && b.close > 0);

// Closed candles of the timeframe (the one still forming is dropped);
// Yahoo 1H fetched once per 5 min, 4H built from it in UTC buckets.
// The pending fetch is cached too, so strategies evaluated together share
// one Yahoo request.
const cache = new Map();
async function closedBars(pair, tf = "1h", now = Date.now()) {
  if (tf === "15m") return closed15m(pair, now);
  let hit = cache.get(pair);
  if (!hit || now - hit.at >= 5 * 60e3) {
    hit = {
      at: now,
      bars: marketService.getYahooCandles(pair, { interval: "60m", range: "180d" }).then(toBars),
    };
    cache.set(pair, hit);
    hit.bars.then((b) => { if (!b.length) cache.delete(pair); }, () => cache.delete(pair));
  }
  const all = await hit.bars;
  const hours = all.filter((b) => b.t + HOUR <= now);
  if (tf === "1h") return hours;
  // Every 4H bucket whose 4 hours are over -- including the newest one.
  // (Fixed 2026-10-22: built with fourHour(), which leaves out its last
  // bucket, the just-closed 4H candle only appeared an hour later, by
  // which time it was "not fresh" -- so no 4H setup could ever fire; a
  // fair value gap SELL on Oct 20 16:00 UTC was missed.) A bucket whose
  // last hour hasn't arrived from Yahoo yet waits up to 15 min for it.
  return fourHourBuckets(hours).filter((b) => b.t + 4 * HOUR <= now
    && (b.lastHour >= b.t + 3 * HOUR || now - (b.t + 4 * HOUR) > 15 * 60e3))
    .map(({ t, open, high, low, close }) => ({ t, open, high, low, close }));
}

// Pure: 1H candles grouped into UTC 4-hour candles, all buckets kept (the
// same grouping as fourHour); lastHour = start of the bucket's last 1H candle.
function fourHourBuckets(bars) {
  const out = [];
  for (const b of bars) {
    const t = Math.floor(b.t / (4 * HOUR)) * 4 * HOUR;
    const cur = out[out.length - 1];
    if (!cur || cur.t !== t) out.push({ t, open: b.open, high: b.high, low: b.low, close: b.close, lastHour: b.t });
    else {
      cur.high = Math.max(cur.high, b.high); cur.low = Math.min(cur.low, b.low); cur.close = b.close; cur.lastHour = b.t;
    }
  }
  return out;
}
exports.closedBars = closedBars;

// Closed 15m candles (Yahoo keeps 60 days; one month is plenty for a 96-
// candle lookback -- the trend comes from the 1H-built 4H history).
async function closed15m(pair, now) {
  const key = `${pair}:15m`;
  let hit = cache.get(key);
  if (!hit || now - hit.at >= 2 * 60e3) {
    hit = { at: now, bars: marketService.getYahooCandles(pair, { interval: "15m", range: "1mo" }).then(toBars) };
    cache.set(key, hit);
    hit.bars.then((b) => { if (!b.length) cache.delete(key); }, () => cache.delete(key));
  }
  return (await hit.bars).filter((b) => b.t + TF_MS["15m"] <= now);
}

// One strategy's setup on its last closed candle, priced at the live price
// -- or { signal: null, reason }. Same for every user.
async function evaluate(pair, s, livePrice, now) {
  const bars = await closedBars(pair, s.tf, now);
  const need = s.tf === "1h" ? 1200 : 300;
  if (bars.length < need) return { strategy: s, signal: null, reason: `not enough ${s.tf} history (${bars.length})` };
  const i = bars.length - 1;
  // A candle that closed long ago is stale (server asleep, market closed):
  // the backtest entered on the very next price.
  if (now - (bars[i].t + TF_MS[s.tf]) > Math.min(50 * 60e3, TF_MS[s.tf])) {
    return { strategy: s, signal: null, reason: `no fresh candle (last ${s.tf.toUpperCase()} closed ${new Date(bars[i].t + TF_MS[s.tf]).toISOString().slice(5, 16).replace("T", " ")} UTC)` };
  }
  const X = indicators(bars);
  if (s.tf === "15m") X.trendFn = trendFnFrom4h(bars, await closedBars(pair, "4h", now));
  const setup = setupAt(bars, X, i, s);
  if (!setup) return { strategy: s, signal: null, reason: "no setup" };
  const entry = livePrice || bars[i].close;
  if (Math.abs(entry - bars[i].close) > 0.5 * setup.atr) return { strategy: s, signal: null, reason: "price moved more than 0.5 ATR since the setup" };
  const dir = setup.dir;
  return {
    strategy: s,
    signal: dir === 1 ? "buy" : "sell",
    barTime: new Date(bars[i].t),
    entry: round(entry, entry),
    stopLoss: round(entry - dir * setup.risk, entry),
    takeProfit: round(entry + dir * s.targetR * setup.risk, entry),
    atr: setup.atr,
    detail: setup.detail,
  };
}

// Every strategy of the pair, evaluated on its last closed candle.
exports.getSignals = async (pair, livePrice, now = Date.now()) => {
  const list = exports.STRATEGIES[pair] || [];
  return Promise.all(list.map((s) => evaluate(pair, s, livePrice, now).catch((err) => ({ strategy: s, signal: null, reason: err.message }))));
};

const WHAT = {
  pullback: (buy) => `${buy ? "dipped" : "spiked"} hard against the trend on the 1H chart — a pullback inside the trend`,
  breakout: (buy, s) => `broke out ${buy ? "above" : "below"} the last ${s.tf === "15m" ? "24 hours'" : "4 days'"} range with a ${tfName(s.tf)} close, in the 4H trend's direction`,
  pin: (buy) => `printed a ${buy ? "hammer (long lower wick: sellers rejected)" : "shooting star (long upper wick: buyers rejected)"} on the 4H chart, in the trend's direction`,
};

exports.reasoningFor = (sig, pair) => {
  const s = sig.strategy, buy = sig.signal === "buy", bt = s.backtest;
  const trend = ` ${pair} is in a 4H ${buy ? "up" : "down"}trend (EMA50 ${buy ? "above" : "below"} EMA200) and`;
  const tf = tfName(s.tf);
  const manage = s.trailAtr
    ? `Stop ${s.stopAtr}× the ${tf} range (ATR ${round(sig.atr, sig.entry)}) away. TradeMind trails the stop ${s.trailAtr}× ATR behind the best price after every ${tf} candle and sends "move stop" alerts — follow them. Target ${s.targetR}R`
    : `Stop ${s.stopAtr}× the ${tf} range (ATR ${round(sig.atr, sig.entry)}) = ${round(Math.abs(sig.entry - sig.stopLoss), sig.entry)} away, target ${s.targetR === 1 ? "the same distance" : `${s.targetR}× that`} (${round(Math.abs(sig.takeProfit - sig.entry), sig.entry)}). Set both and leave them`;
  return `${s.label}:${trend} price ${WHAT[s.setup](buy, s)} (${sig.detail}).`
    + `\n\n🛡 Managing it: ${manage}; close the trade after ${s.maxHoldHours} h if neither is hit.`
    + `\n\n📊 Tested on 2+ years of real prices: about ${bt.tradesPerWeek} trades a week, ~${bt.winRate}% winners, `
    + `profit factor ${bt.profitFactor} (more won than lost), deepest losing run ~${bt.maxDrawdownR}R. `
    + `Losing trades are normal — the edge comes from following every signal with the same risk.`;
};

// Trailing stops for open strategy signals: after every closed candle of
// the strategy's timeframe the stop follows the best price. Every move is
// saved (so the result is scored exactly as managed); an alert goes out
// when the stop has moved at least 0.5R since the last one. Returns the
// number of signals updated.
exports.updateTrailingStops = async (now = Date.now()) => {
  const Notification = require("../models/Notification");
  const { dispatchMessage } = require("./notifyDispatcher");
  const open = await Notification.find({
    strategy: { $exists: true, $ne: null },
    simOutcome: { $exists: false },
    signal: { $in: ["buy", "sell"] },
    createdAt: { $gte: new Date(now - 50 * HOUR) },
  }).limit(500);
  let updated = 0;
  for (const n of open) {
    const s = byKey(n.strategy);
    if (!s || !s.trailAtr || !n.initialStopLoss) continue;
    let bars;
    try { bars = await closedBars(n.pair, s.tf, now); } catch { continue; }
    if (!bars.length) continue;
    const A = atr(bars);
    const unit = TF_MS[s.tf];
    // Candles that started at or after the entry candle (as in the
    // backtest: the entry candle counts once it has closed).
    const from = bars.findIndex((b) => b.t >= Math.floor(new Date(n.createdAt).getTime() / unit) * unit);
    if (from < 0) continue;
    const dir = n.signal === "buy" ? 1 : -1;
    const sl = round(trailedStop({ dir, stop: n.initialStopLoss }, bars.slice(from), A.slice(from), s.trailAtr, n.entry), n.entry);
    if ((sl - n.stopLoss) * dir <= 0) continue;
    const risk = Math.abs(n.entry - n.initialStopLoss);
    const lastAlerted = n.trailAlertedStop ?? n.initialStopLoss;
    const alert = (sl - lastAlerted) * dir >= 0.5 * risk;
    await Notification.updateOne({ _id: n._id }, {
      stopLoss: sl,
      $push: { stopHistory: { at: new Date(now), price: sl } },
      ...(alert ? { trailAlertedStop: sl } : {}),
    });
    updated++;
    if (alert) {
      const locked = ((sl - n.entry) * dir) / risk;
      await dispatchMessage(n.user, {
        title: `🔒 ${n.pair} ${n.signal.toUpperCase()}: move stop to ${sl}`,
        body: locked >= 0
          ? `${s.label}: price moved your way. New stop ${sl} locks in ${locked >= 0.05 ? `+${locked.toFixed(1)}R` : "break-even"}.`
          : `${s.label}: price moved your way. New stop ${sl} cuts the risk to ${(-locked).toFixed(1)}R.`,
        url: "/notifications",
        id: `trail-${n._id}-${sl}`,
        email: false,
        pref: "signalResults",
      }).catch(() => {});
    }
  }
  return updated;
};
