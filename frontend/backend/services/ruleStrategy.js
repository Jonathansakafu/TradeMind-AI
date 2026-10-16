// Rule-based signals, backtested (added 2026-10-16). Replaces the AI as the
// source of automatic signals: 2 days of live results before this were
// almost all stop-outs (Oct 14-15: every EURUSD/GBPUSD/XAUUSD SELL hit SL;
// Oct 16: every XAUUSD BUY hit SL), and the AI's direction flipped with no
// measurable edge. Each strategy below was chosen on Yahoo 1h data
// 2024-05 -> 2026-02 and checked on 2026-02 -> 2026-10 (unseen), with
// spread costs, stop checked before target inside a candle.
//
// XAUUSD "trend pullback": 4H EMA50 above EMA200 and the last closed 4H
// close above EMA50 = uptrend (mirror for down). In London / New York hours
// (07-17 UTC, Mon-Fri), when a closed 1H candle takes RSI(2) under 10 (over
// 90 in a downtrend) while still on the trend side of the 1H EMA200, enter
// at the next price. Stop 3.5 x 1H ATR, trailed at 3.5 x ATR behind the
// best price after every closed 1H candle, target capped at 4R, closed
// after 48 h. Backtest: ~1.3 trades/week, ~43% wins, profit factor 1.71
// (chosen) / 1.72 (unseen), worst drawdown ~4R, every year positive, both
// directions positive, still PF 1.6 at 2.5x the spread.
//
// EURUSD / GBPUSD: no rule tested (RSI pullback, Donchian breakout, EMA
// resumption; 1H and 4H; many stop/target sizes) was positive on both the
// chosen and the unseen period, so they get no automatic signals.
// AI_AUTO_SIGNAL_PAIRS (env, e.g. "EURUSD,GBPUSD") brings back the old AI
// signals for named pairs.
const marketService = require("./marketService");

const HOUR = 3600e3;

exports.STRATEGIES = {
  XAUUSD: {
    key: "gold_trend_pullback",
    label: "Gold trend pullback",
    rsiExtreme: 10,
    stopAtr: 3.5,
    trailAtr: 3.5,
    capR: 4,
    maxHoldHours: 48,
    sessionUtc: [7, 17],
    backtest: { winRate: 43, profitFactor: 1.7, tradesPerWeek: 1.3, maxDrawdownR: 4 },
  },
};

exports.has = (pair) => !!exports.STRATEGIES[pair];

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
// fully closed before 1H candle i started.
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

// Pure: indicators over closed 1H candles ({t ms, open, high, low, close}).
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

// Pure: is closed candle i a setup? Returns { dir, atr, ... } or null.
function setupAt(bars, X, i, s) {
  const d = new Date(bars[i].t), h = d.getUTCHours(), wd = d.getUTCDay();
  if (wd === 0 || wd === 6 || h < s.sessionUtc[0] || h >= s.sessionUtc[1]) return null;
  const dir = trendAt(X, i);
  if (!dir) return null;
  const r = X.r2[i], c = X.c[i];
  if (dir === 1 && r < s.rsiExtreme && c > X.e200[i]) return { dir, atr: X.A[i], rsi2: r };
  if (dir === -1 && r > 100 - s.rsiExtreme && c < X.e200[i]) return { dir, atr: X.A[i], rsi2: r };
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

exports._internals = { ema, atr, rsi, fourHour, indicators, trendAt, setupAt, trailedStop };

// ---- live ----
const toBars = (candles) => candles
  .map((c) => ({ t: new Date(c.datetime).getTime(), open: +c.open, high: +c.high, low: +c.low, close: +c.close }))
  .filter((b) => b.high >= b.low && b.close > 0);

// Closed 1H candles (the one still forming is dropped), cached 5 min.
const cache = new Map();
async function closedHourBars(pair, now = Date.now()) {
  const hit = cache.get(pair);
  if (hit && now - hit.at < 5 * 60e3) return hit.bars;
  const candles = await marketService.getYahooCandles(pair, { interval: "60m", range: "180d" });
  const bars = toBars(candles).filter((b) => b.t + HOUR <= now);
  if (bars.length) cache.set(pair, { at: now, bars });
  return bars;
}
exports.closedHourBars = closedHourBars;

const decimalsFor = (p) => (p >= 100 ? 2 : p >= 10 ? 3 : 5);
const round = (n, ref) => Number(Number(n).toFixed(decimalsFor(ref)));

// The setup on the last closed 1H candle, priced at the live price -- or
// { signal: null, reason }. Same for every user, so computed once a cycle.
exports.getSignal = async (pair, livePrice, now = Date.now()) => {
  const s = exports.STRATEGIES[pair];
  if (!s) return { signal: null, reason: "no tested strategy for this pair" };
  const bars = await closedHourBars(pair, now);
  if (bars.length < 1200) return { signal: null, reason: `not enough 1H history (${bars.length})` };
  const i = bars.length - 1;
  // A candle that closed over an hour ago is stale (server asleep, market
  // closed): the backtest entered on the very next price.
  if (now - (bars[i].t + HOUR) > 50 * 60e3) return { signal: null, reason: "last 1H candle is not fresh" };
  const X = indicators(bars);
  const setup = setupAt(bars, X, i, s);
  if (!setup) {
    const tr = trendAt(X, i);
    return { signal: null, reason: `no setup (4H trend ${tr === 1 ? "up" : tr === -1 ? "down" : "none"}, RSI(2) ${X.r2[i].toFixed(0)})` };
  }
  const entry = livePrice || bars[i].close;
  // Price already ran away from the signal candle's close.
  if (Math.abs(entry - bars[i].close) > 0.5 * setup.atr) return { signal: null, reason: "price moved more than 0.5 ATR since the setup" };
  const risk = s.stopAtr * setup.atr;
  const dir = setup.dir;
  return {
    signal: dir === 1 ? "buy" : "sell",
    barTime: new Date(bars[i].t),
    entry: round(entry, entry),
    stopLoss: round(entry - dir * risk, entry),
    takeProfit: round(entry + dir * s.capR * risk, entry),
    atr: setup.atr,
    rsi2: setup.rsi2,
    strategy: s,
  };
};

exports.reasoningFor = (sig, pair) => {
  const s = sig.strategy, buy = sig.signal === "buy";
  const bt = s.backtest;
  return `${s.label}: ${pair} is in a 4H ${buy ? "up" : "down"}trend (EMA50 ${buy ? "above" : "below"} EMA200) and the last 1H candle `
    + `${buy ? "dipped" : "spiked"} hard against it (RSI(2) ${sig.rsi2.toFixed(0)}) — a pullback inside the trend.`
    + `\n\n🛡 Managing it: stop ${s.stopAtr}× the 1H range (ATR ${round(sig.atr, sig.entry)}) away. TradeMind trails the stop `
    + `${s.trailAtr}× ATR behind the best price after every hour and sends "move stop" alerts — follow them. `
    + `Target ${s.capR}R; close the trade after ${s.maxHoldHours} h if neither is hit.`
    + `\n\n📊 Tested on 2+ years of real prices: about ${bt.tradesPerWeek} trades a week, ~${bt.winRate}% winners, `
    + `profit factor ${bt.profitFactor} (wins are larger than losses), deepest losing run ~${bt.maxDrawdownR}R. `
    + `Losing trades are normal — the edge comes from following every signal with the same risk.`;
};

// Trailing stops for open strategy signals: after every closed 1H candle
// the stop follows the best price. Every move is saved (so the result is
// scored exactly as managed); an alert goes out when the stop has moved at
// least 0.5R since the last one. Returns the number of signals updated.
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
    const s = Object.values(exports.STRATEGIES).find((x) => x.key === n.strategy);
    if (!s || !n.initialStopLoss) continue;
    let bars;
    try { bars = await closedHourBars(n.pair, now); } catch { continue; }
    if (!bars.length) continue;
    const A = atr(bars);
    const created = new Date(n.createdAt).getTime();
    // Candles that started at or after the entry hour (as in the backtest:
    // the entry candle itself counts once it has closed).
    const from = bars.findIndex((b) => b.t >= Math.floor(created / HOUR) * HOUR);
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
          ? `Price moved your way. New stop ${sl} locks in ${locked >= 0.05 ? `+${locked.toFixed(1)}R` : "break-even"}.`
          : `Price moved your way. New stop ${sl} cuts the risk to ${(-locked).toFixed(1)}R.`,
        url: "/notifications",
        id: `trail-${n._id}-${sl}`,
        email: false,
        pref: "signalResults",
      }).catch(() => {});
    }
  }
  return updated;
};
