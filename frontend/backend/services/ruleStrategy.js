// Rule-based signals, backtested (added 2026-10-16). Replaces the AI as the
// source of automatic signals: 2 days of live results before this were
// almost all stop-outs (Oct 14-15: every EURUSD/GBPUSD/XAUUSD SELL hit SL;
// Oct 16: every XAUUSD BUY hit SL), and the AI's direction flipped with no
// measurable edge. Every setup below was chosen on Yahoo 1h data
// 2024-05 -> 2026-02 and checked on 2026-02 -> 2026-10 (unseen), with
// spread costs, stop checked before target inside a candle. Entry at the
// next price after the setup candle closes; one open trade per setup.
//
// "Trend" (all but the inside bar): 4H EMA50 above EMA200 and the last
// closed 4H close above EMA50 = up (mirror for down).
//
// XAUUSD, 4 setups (2026-10-17: 4H price action setups added at the user's
// request; together ~3.8 signals/week, ~50% wins, PF 1.64 / 1.61, every
// year positive, worst combined drawdown ~9R -- they often lose together):
//   1. trend pullback (1H): in 07-17 UTC Mon-Fri, a 1H candle takes RSI(2)
//      under 10 (over 90 in a downtrend) on the trend side of the 1H EMA200.
//      Stop 3.5 ATR trailed 3.5 ATR, 4R cap. PF 1.71 / 1.72.
//   2. 4-day breakout (4H): a 4H close beyond the high (low) of the previous
//      24 4H candles, with the trend. Stop beyond the breakout candle
//      (+0.2 ATR, at least 1 ATR), target 2R, no trailing. PF 1.63 / 1.70.
//   3. pin bar (4H): a hammer (lower wick >= 2/3 of the range, body <= 1/3)
//      in an uptrend / shooting star in a downtrend. Stop 3.5 ATR trailed,
//      4R cap. PF 1.54 / 1.49.
//   4. inside bar breakout (4H): a candle inside the one before it, then a
//      close beyond that mother candle's high / low (no trend filter). Stop
//      3.5 ATR trailed, 4R cap. PF 1.60 / 1.43.
// All close after 48 h. The JS setups match the Python backtest's exactly.
//
// EURUSD / GBPUSD: no rule tested (RSI pullback, Donchian breakout, EMA
// resumption, pin bar, engulfing, inside bar, 24h high/low break; 1H and
// 4H) was clearly positive on both periods, so they get no automatic
// signals. AI_AUTO_SIGNAL_PAIRS (env, e.g. "EURUSD,GBPUSD") brings back the
// old AI signals for named pairs.
const marketService = require("./marketService");

const HOUR = 3600e3;
const TF_MS = { "1h": HOUR, "4h": 4 * HOUR };

exports.STRATEGIES = {
  XAUUSD: [
    {
      key: "gold_trend_pullback", label: "Gold trend pullback", tf: "1h", setup: "pullback",
      rsiExtreme: 10, sessionUtc: [7, 17], stop: "atr", stopAtr: 3.5, trailAtr: 3.5, capR: 4, maxHoldHours: 48,
      backtest: { winRate: 43, profitFactor: 1.7, tradesPerWeek: 1.2, maxDrawdownR: 4 },
    },
    {
      key: "gold_4h_breakout", label: "Gold 4-day breakout", tf: "4h", setup: "breakout",
      lookback: 24, stop: "structure", capR: 2, trailAtr: null, maxHoldHours: 48,
      backtest: { winRate: 50, profitFactor: 1.65, tradesPerWeek: 0.8, maxDrawdownR: 6 },
    },
    {
      key: "gold_4h_pin_bar", label: "Gold 4H pin bar", tf: "4h", setup: "pin",
      stop: "atr", stopAtr: 3.5, trailAtr: 3.5, capR: 4, maxHoldHours: 48,
      backtest: { winRate: 54, profitFactor: 1.5, tradesPerWeek: 0.85, maxDrawdownR: 3 },
    },
    {
      key: "gold_4h_inside_bar", label: "Gold 4H inside bar breakout", tf: "4h", setup: "inside",
      stop: "atr", stopAtr: 3.5, trailAtr: 3.5, capR: 4, maxHoldHours: 48,
      backtest: { winRate: 53, profitFactor: 1.55, tradesPerWeek: 0.9, maxDrawdownR: 3.5 },
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

function trendAt(X, i) {
  const k = X.closedIdx[i];
  if (k < 200) return 0;
  if (X.e4_50[k] > X.e4_200[k] && X.h4[k].close > X.e4_50[k]) return 1;
  if (X.e4_50[k] < X.e4_200[k] && X.h4[k].close < X.e4_50[k]) return -1;
  return 0;
}

// Pure: is closed candle i a setup for strategy s? Returns
// { dir, atr, risk, detail } (risk = stop distance in price) or null.
function setupAt(bars, X, i, s) {
  const b = bars[i], p = bars[i - 1], A = X.A[i];
  const trend = trendAt(X, i);
  const atrStop = () => s.stopAtr * A;
  if (s.setup === "pullback") {
    const d = new Date(b.t), h = d.getUTCHours(), wd = d.getUTCDay();
    if (wd === 0 || wd === 6 || h < s.sessionUtc[0] || h >= s.sessionUtc[1] || !trend) return null;
    const r = X.r2[i], c = X.c[i];
    const ok = trend === 1 ? r < s.rsiExtreme && c > X.e200[i] : r > 100 - s.rsiExtreme && c < X.e200[i];
    return ok ? { dir: trend, atr: A, risk: atrStop(), detail: `RSI(2) ${r.toFixed(0)}` } : null;
  }
  if (s.setup === "breakout") {
    if (!trend || i < s.lookback) return null;
    const prev = bars.slice(i - s.lookback, i);
    const hi = Math.max(...prev.map((x) => x.high)), lo = Math.min(...prev.map((x) => x.low));
    const dir = b.close > hi && p.close <= hi ? 1 : b.close < lo && p.close >= lo ? -1 : 0;
    if (!dir || dir !== trend) return null;
    const ext = dir === 1 ? b.low : b.high;
    return { dir, atr: A, risk: Math.max(Math.abs(b.close - ext) + 0.2 * A, A), detail: `closed ${dir === 1 ? "above the 4-day high" : "below the 4-day low"} ${round(dir === 1 ? hi : lo, b.close)}` };
  }
  if (s.setup === "pin") {
    const range = b.high - b.low;
    if (!trend || range <= 0) return null;
    const body = Math.abs(b.close - b.open);
    const dir = Math.min(b.open, b.close) - b.low >= (2 / 3) * range && body <= range / 3 ? 1
      : b.high - Math.max(b.open, b.close) >= (2 / 3) * range && body <= range / 3 ? -1 : 0;
    if (!dir || dir !== trend) return null;
    return { dir, atr: A, risk: atrStop(), detail: dir === 1 ? `hammer rejecting ${round(b.low, b.close)}` : `shooting star rejecting ${round(b.high, b.close)}` };
  }
  if (s.setup === "inside") {
    if (i < 2) return null;
    const m = bars[i - 2], ib = p;
    if (!(ib.high < m.high && ib.low > m.low)) return null;
    const dir = b.close > m.high ? 1 : b.close < m.low ? -1 : 0;
    if (!dir) return null;
    return { dir, atr: A, risk: atrStop(), detail: `closed ${dir === 1 ? "above" : "below"} the mother candle's ${dir === 1 ? "high" : "low"} ${round(dir === 1 ? m.high : m.low, b.close)}` };
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

const decimalsFor = (p) => (p >= 100 ? 2 : p >= 10 ? 3 : 5);
function round(n, ref) { return Number(Number(n).toFixed(decimalsFor(ref))); }

exports._internals = { ema, atr, rsi, fourHour, indicators, trendAt, setupAt, trailedStop };

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
  if (tf === "1h") return all.filter((b) => b.t + HOUR <= now);
  const { h4 } = fourHour(all.filter((b) => b.t + HOUR <= now));
  return h4.filter((b) => b.t + 4 * HOUR <= now).map(({ t, open, high, low, close }) => ({ t, open, high, low, close }));
}
exports.closedBars = closedBars;

// One strategy's setup on its last closed candle, priced at the live price
// -- or { signal: null, reason }. Same for every user.
async function evaluate(pair, s, livePrice, now) {
  const bars = await closedBars(pair, s.tf, now);
  const need = s.tf === "1h" ? 1200 : 300;
  if (bars.length < need) return { strategy: s, signal: null, reason: `not enough ${s.tf} history (${bars.length})` };
  const i = bars.length - 1;
  // A candle that closed long ago is stale (server asleep, market closed):
  // the backtest entered on the very next price.
  if (now - (bars[i].t + TF_MS[s.tf]) > 50 * 60e3) return { strategy: s, signal: null, reason: "no fresh candle" };
  const X = indicators(bars);
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
    takeProfit: round(entry + dir * s.capR * setup.risk, entry),
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
  breakout: (buy) => `broke out ${buy ? "above" : "below"} the last 4 days' range with a 4H close, in the trend's direction`,
  pin: (buy) => `printed a ${buy ? "hammer (long lower wick: sellers rejected)" : "shooting star (long upper wick: buyers rejected)"} on the 4H chart, in the trend's direction`,
  inside: (buy) => `broke ${buy ? "up" : "down"} out of a 4H inside bar (a quiet candle inside the one before it)`,
};

exports.reasoningFor = (sig, pair) => {
  const s = sig.strategy, buy = sig.signal === "buy", bt = s.backtest;
  const trend = s.setup === "inside" ? "" : ` ${pair} is in a 4H ${buy ? "up" : "down"}trend (EMA50 ${buy ? "above" : "below"} EMA200) and`;
  const manage = s.trailAtr
    ? `Stop ${s.stopAtr}× the ${s.tf.toUpperCase()} range (ATR ${round(sig.atr, sig.entry)}) away. TradeMind trails the stop ${s.trailAtr}× ATR behind the best price after every ${s.tf.toUpperCase()} candle and sends "move stop" alerts — follow them. Target ${s.capR}R`
    : `Stop just beyond the breakout candle, target ${s.capR}R — no trailing, leave it`;
  return `${s.label}:${trend} price ${WHAT[s.setup](buy)} (${sig.detail}).`
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
