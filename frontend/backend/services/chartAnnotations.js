// Signal chart (added 2026-10-14): candles around a signal plus the
// technical drawings behind it, for a TradingView-style chart in the app
// and as the trade's screenshot. Everything is computed from candles up to
// the signal's time (no hindsight); the candles after it show how it
// played out. Drawings:
//   - swing points (HH / HL / LH / LL) and BOS / CHoCH lines, major and
//     internal structure (same rules as services/marketContext.js)
//   - liquidity sweeps, equal highs / lows
//   - support / resistance (4H + 1H swing clusters)
//   - fair value gaps (3-candle imbalance >= 0.3 ATR, not yet filled)
//   - order block (last opposite candle before the move that broke structure)
//   - premium / discount of the current swing range (50% line)
//   - previous day high / low, the Asian session range
//   - EMA 20 / 50, high-impact news times
//   - the position (entry, SL, TP, R:R), its result, and numbered steps
//     explaining why the signal was created
const Notification = require("../models/Notification");
const Trade = require("../models/Trade");
const marketService = require("./marketService");
const economicCalendar = require("./economicCalendar");
const { _internals: mc } = require("./marketContext");
const { fairValueGaps, orderBlock } = require("./smcZones");

const CANDLE_TTL = 60 * 1000;
const cache = new Map();
async function candles(pair, interval, range) {
  const key = `${pair}|${interval}|${range}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CANDLE_TTL) return hit.c;
  const c = (await marketService.getYahooCandles(pair, { interval, range }))
    .filter((x) => x.close != null && x.high != null)
    .map((x) => ({ ...x, t: Math.floor(new Date(x.datetime).getTime() / 1000) }));
  cache.set(key, { at: Date.now(), c });
  return c;
}

const sec = (d) => Math.floor(new Date(d).getTime() / 1000);
const fmtFor = (p) => (n) => (n == null ? "?" : Number(n).toFixed(p >= 100 ? 2 : 5));

// Swing labels relative to the previous swing of the same kind.
function labelSwings(pts, kind) {
  return pts.map((p, i) => {
    const prev = pts[i - 1];
    const label = !prev ? (kind === "H" ? "H" : "L") : kind === "H" ? (p.price > prev.price ? "HH" : "LH") : (p.price > prev.price ? "HL" : "LL");
    return { ...p, label };
  });
}

async function loadSignal(user, { notificationId, tradeId, query }) {
  if (tradeId) {
    const t = await Trade.findOne({ _id: tradeId, user }).lean();
    if (t) {
      const n = t.notificationId ? await Notification.findOne({ _id: t.notificationId, user }).lean() : null;
      return {
        pair: t.pair, direction: t.direction, entry: t.entryPrice, sl: t.stopLoss, tp: t.takeProfit,
        at: n?.createdAt || t.openedAt || t.createdAt, exitPrice: t.exitPrice, exitAt: t.closedAt,
        fillAt: n?.simFilledAt || null, unfilled: n?.simOutcome === "unfilled",
        outcome: t.outcome, confidence: n?.confidence, reasoning: n?.reasoning, lot: t.lotSize,
      };
    }
  }
  if (notificationId) {
    const n = await Notification.findOne({ _id: notificationId, user }).lean();
    if (n) {
      const exit = n.simOutcome === "win" ? n.takeProfit : n.simOutcome === "loss" ? n.stopLoss : null;
      return {
        pair: n.pair, direction: n.signal, entry: n.entry, sl: n.stopLoss, tp: n.takeProfit, at: n.createdAt,
        exitPrice: exit, exitAt: exit ? n.simResolvedAt : null, outcome: n.simOutcome, confidence: n.confidence, reasoning: n.reasoning,
        fillAt: n.simFilledAt || null, unfilled: n.simOutcome === "unfilled",
      };
    }
  }
  const q = query || {};
  if (!q.pair) return null;
  const num = (v) => (v == null || v === "" ? null : Number(v));
  return {
    pair: String(q.pair).toUpperCase(), direction: q.dir, entry: num(q.entry), sl: num(q.sl), tp: num(q.tp),
    at: q.at ? new Date(q.at) : new Date(), exitPrice: num(q.exit), exitAt: q.exitAt ? new Date(q.exitAt) : null, outcome: q.outcome || null,
    fillAt: q.fillAt ? new Date(q.fillAt) : null,
  };
}

exports.build = async (user, opts) => {
  const s = await loadSignal(user, opts);
  if (!s) return { error: "Signal not found" };
  const tf = opts.tf === "15m" ? "15m" : "1h";
  const [c1h, cTf] = await Promise.all([
    candles(s.pair, "60m", "60d"),
    tf === "15m" ? candles(s.pair, "15m", "30d") : null,
  ]);
  const c = tf === "15m" ? cTf : c1h;
  if (!c?.length) return { error: "No price data for this pair right now." };

  const at = sec(s.at || Date.now());
  let upto = c.findLastIndex((x) => x.t <= at);
  if (upto < 30) upto = Math.min(c.length - 1, Math.max(upto, 30)); // very old signal: best effort
  const hist = c.slice(0, upto + 1);
  const fmt = fmtFor(s.entry || hist.at(-1).close);
  const atrV = mc.atr(hist);

  // Structure as it was when the signal was sent.
  const { highs, lows } = mc.swings(hist);
  const maj = mc.majorSwings(hist, 0.5 * (atrV || 0));
  const majorEv = mc.structureEvents(hist, maj.highs, maj.lows);
  const internalEv = mc.structureEvents(hist, highs, lows);
  const tfRead = mc.analyzeTimeframe(hist.slice(-200), tf === "15m" ? "15m" : "1H");
  const h1Hist = c1h.filter((x) => x.t <= at);
  const h4Read = mc.analyzeTimeframe(mc.toFourHour(h1Hist).slice(-120), "4H");
  const h1Read = tf === "15m" ? mc.analyzeTimeframe(h1Hist.slice(-200), "1H") : tfRead;
  const levels = mc.supportResistance(s.entry || hist.at(-1).close, [h4Read, h1Read], h1Read.atr);
  const liq = mc.liquidity(hist, highs, lows, atrV);

  // Window shown: ~90 candles before the signal, up to 40 after (or to now).
  const start = Math.max(0, upto - 90);
  const exitIdx = s.exitAt ? c.findLastIndex((x) => x.t <= sec(s.exitAt)) : -1;
  const endIdx = Math.min(c.length - 1, exitIdx >= 0 ? Math.max(upto + 8, exitIdx + 6) : upto + 40);
  const view = c.slice(start, endIdx + 1);
  const inView = (i) => i >= start;
  const T = (i) => c[i]?.t;

  const swingsOut = [
    ...labelSwings(maj.highs, "H").map((p) => ({ ...p, kind: "H" })),
    ...labelSwings(maj.lows, "L").map((p) => ({ ...p, kind: "L" })),
  ].filter((p) => inView(p.i)).map((p) => ({ time: T(p.i), price: p.price, label: p.label, kind: p.kind }));

  const breakLines = (ev, scope) => ev.events.filter((e) => inView(e.i)).slice(-5).map((e) => {
    const pool = e.dir === "bullish" ? (scope === "major" ? maj.highs : highs) : (scope === "major" ? maj.lows : lows);
    const origin = [...pool].reverse().find((p) => p.i < e.i && Math.abs(p.price - e.level) < 1e-9);
    return { type: e.type, dir: e.dir, scope, level: e.level, from: T(origin ? origin.i : Math.max(start, e.i - 10)), to: T(e.i) };
  });
  const structure = [...breakLines(majorEv, "major"), ...breakLines(internalEv, "internal").filter((b) => b.to >= T(Math.max(start, upto - 30)))];

  const lastMajor = majorEv.events.at(-1);
  const ob = orderBlock(hist, lastMajor, lastMajor?.dir === "bullish" ? maj.lows : maj.highs);
  const fvgs = fairValueGaps(hist, atrV, hist.length - 1).filter((g) => inView(g.i));
  const lastH = maj.highs.at(-1), lastL = maj.lows.at(-1);
  const range = lastH && lastL ? { high: lastH.price, low: lastL.price, mid: (lastH.price + lastL.price) / 2, from: T(Math.min(lastH.i, lastL.i)) } : null;

  // Previous (UTC) day high / low and the Asian session (00:00-07:00 UTC) of the signal day.
  const day = (t) => Math.floor(t / 86400);
  const sigDay = day(at);
  const prevDayC = c1h.filter((x) => day(x.t) === sigDay - 1 || (new Date(x.t * 1000).getUTCDay() === 1 && day(x.t) === sigDay - 3));
  const pd = prevDayC.length ? { high: Math.max(...prevDayC.map((x) => x.high)), low: Math.min(...prevDayC.map((x) => x.low)) } : null;
  const asia = c1h.filter((x) => day(x.t) === sigDay && new Date(x.t * 1000).getUTCHours() < 7 && x.t <= at);
  const asian = asia.length >= 3 ? { high: Math.max(...asia.map((x) => x.high)), low: Math.min(...asia.map((x) => x.low)), from: asia[0].t, to: asia.at(-1).t + 3600 } : null;

  let news = [];
  try {
    const events = (await economicCalendar.getHighImpactEvents()) || [];
    const ccys = economicCalendar.currenciesFor(s.pair);
    news = events.filter((e) => ccys.includes(e.currency) && sec(e.time) >= view[0].t && sec(e.time) <= view.at(-1).t + 3600)
      .map((e) => ({ time: sec(e.time), title: `${e.currency} ${e.title}`, topTier: economicCalendar.isTopTier(e) }));
  } catch { /* chart without news marks */ }

  // ---------- the position and the story ----------
  const dir = s.direction === "buy" || s.direction === "sell" ? s.direction : null;
  const risk = s.entry && s.sl ? Math.abs(s.entry - s.sl) : null;
  const rr = risk && s.tp ? Math.abs(s.tp - s.entry) / risk : null;
  const unit = (d) => (s.pair === "XAUUSD" ? `$${d.toFixed(2)}` : `${(d / (/JPY$/.test(s.pair) ? 0.01 : 0.0001)).toFixed(1)} pips`);
  const sigT = T(upto);
  const steps = [];
  const trendWord = (r) => ({ up: "bullish", down: "bearish", "up-leaning": "leaning bullish", "down-leaning": "leaning bearish", range: "ranging" }[r.trend] || r.trend);
  const anchorSwing = dir === "sell" ? maj.highs.at(-2) || maj.highs.at(-1) : maj.lows.at(-2) || maj.lows.at(-1);
  steps.push({
    text: `4H ${trendWord(h4Read)} · 1H ${trendWord(h1Read)}${tf === "15m" ? ` · 15m ${trendWord(tfRead)}` : ""}`,
    time: anchorSwing ? T(anchorSwing.i) : T(Math.max(start, upto - 40)), price: anchorSwing?.price ?? hist.at(-40)?.close,
  });
  const keyBreak = [...majorEv.events, ...internalEv.events].filter((e) => !dir || e.dir === (dir === "buy" ? "bullish" : "bearish"))
    .sort((a, b) => a.i - b.i).filter((e) => upto - e.i <= 40).at(-1);
  if (keyBreak) {
    steps.push({ text: `${keyBreak.type}: price closed ${keyBreak.dir === "bullish" ? "above" : "below"} ${fmt(keyBreak.level)}`, time: T(keyBreak.i), price: keyBreak.level });
  }
  // Only a sweep that supports the trade: highs swept before a SELL, lows before a BUY.
  const sweep = liq.sweeps.filter((sw) => !dir || sw.dir === (dir === "buy" ? "bullish" : "bearish")).at(-1);
  if (sweep) {
    steps.push({ text: `Liquidity sweep of ${sweep.side} at ${fmt(sweep.level)}`, time: T(upto - sweep.ago), price: sweep.level });
  }
  const zone = ob && ((dir === "buy" && ob.dir === "bullish") || (dir === "sell" && ob.dir === "bearish")) ? `${ob.dir} order block` : null;
  const gap = fvgs.filter((g) => (dir === "buy" ? g.dir === "bullish" : g.dir === "bearish")).at(-1);
  const nearLevel = dir === "sell" ? levels.resistances[0] : levels.supports[0];
  const pullback = zone || (gap ? "fair value gap" : null) || (nearLevel ? `${dir === "sell" ? "resistance" : "support"} ${fmt(nearLevel.price)}` : null);
  if (pullback && dir) {
    steps.push({ text: `Pullback into ${pullback}`, time: T(Math.max(start, upto - 2)), price: zone ? (dir === "sell" ? ob.bottom : ob.top) : gap ? (gap.top + gap.bottom) / 2 : nearLevel.price });
  }
  if (range && dir && s.entry) {
    const inPremium = s.entry > range.mid;
    steps.push({
      text: `${inPremium ? "Premium" : "Discount"} zone ${(dir === "sell") === inPremium ? "✓" : "(against the ideal side)"}`,
      time: T(Math.max(start, upto - 6)), price: range.mid,
    });
  }
  const hhmm = (t) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" });
  const fillT = s.fillAt ? sec(s.fillAt) : null;
  const waited = fillT && fillT - at > 10 * 60; // entry reached well after the signal was sent
  if (dir && s.entry) {
    steps.push({
      text: `${dir.toUpperCase()} ${waited || s.unfilled ? "limit " : ""}at ${fmt(s.entry)} · SL ${fmt(s.sl)} · TP ${fmt(s.tp)}${rr ? ` · R:R 1:${rr.toFixed(1)}` : ""}${waited || s.unfilled ? ` (sent ${hhmm(s.at)} EAT, waiting for the price)` : ""}`,
      time: sigT, price: s.entry,
    });
  }
  if (waited) steps.push({ text: `Entry filled at ${fmt(s.entry)} — ${hhmm(s.fillAt)} EAT`, time: fillT, price: s.entry });
  if (s.unfilled) steps.push({ text: "Entry never reached in 24 h — no trade", time: c.at(-1).t, price: s.entry });
  if (s.exitPrice && s.exitAt) {
    const when = `${hhmm(s.exitAt)} EAT`;
    steps.push({ text: s.outcome === "win" ? `Hit take profit ${fmt(s.exitPrice)} — ${when}` : s.outcome === "loss" ? `Hit stop loss ${fmt(s.exitPrice)} — ${when}` : `Closed at ${fmt(s.exitPrice)} — ${when}`, time: sec(s.exitAt), price: s.exitPrice });
  }

  // AI's own reasons from the signal notes (📌 Signal basis), if any.
  const basisText = String(s.reasoning || "").split("📌 Signal basis")[1]?.split("📰")[0]?.trim() || "";

  return {
    pair: s.pair, tf, signalTime: sigT, direction: dir, confidence: s.confidence ?? null,
    candles: view.map((x) => ({ time: x.t, open: x.open, high: x.high, low: x.low, close: x.close })),
    ema20: emaSeries(c, 20, start, endIdx), ema50: emaSeries(c, 50, start, endIdx),
    swings: swingsOut, structure,
    sweeps: liq.sweeps.map((sw) => ({ time: T(upto - sw.ago), price: sw.level, side: sw.side, dir: sw.dir })),
    equalHighs: liq.equalHighs, equalLows: liq.equalLows,
    levels: { supports: levels.supports.map((l) => ({ price: l.price, strength: l.strength })), resistances: levels.resistances.map((l) => ({ price: l.price, strength: l.strength })) },
    fvgs: fvgs.map((g) => ({ dir: g.dir, top: g.top, bottom: g.bottom, from: T(g.i) })),
    orderBlock: ob ? { dir: ob.dir, top: ob.top, bottom: ob.bottom, from: T(ob.i) } : null,
    range, prevDay: pd, asian, news,
    // The box starts when the entry was actually reached (or at the signal
    // for a market entry) and ends at the exact exit time.
    position: dir && s.entry ? { entry: s.entry, sl: s.sl, tp: s.tp, from: fillT || sigT, sent: sigT, to: s.exitAt ? sec(s.exitAt) : view.at(-1).t, rr, risk: risk ? unit(risk) : null, reward: s.tp ? unit(Math.abs(s.tp - s.entry)) : null, unfilled: !!s.unfilled } : null,
    fill: fillT ? { time: fillT, price: s.entry, waited: !!waited } : null,
    result: s.exitPrice && s.exitAt ? { price: s.exitPrice, time: sec(s.exitAt), outcome: s.outcome, label: `${s.outcome === "win" ? "TP hit" : s.outcome === "loss" ? "SL hit" : "Closed"} ${fmt(s.exitPrice)} · ${hhmm(s.exitAt)}` } : null,
    trend: { h4: h4Read.trend, h1: h1Read.trend, tf: tfRead.trend },
    atr: atrV, rsi: mc.rsi(hist.map((x) => x.close)), steps, basis: basisText,
  };
};

function emaSeries(c, period, start, end) {
  const k = 2 / (period + 1);
  let e = null;
  const out = [];
  for (let i = 0; i <= end; i++) {
    e = e == null ? c[i].close : c[i].close * k + e * (1 - k);
    if (i >= start && i >= period) out.push({ time: c[i].t, value: e });
  }
  return out;
}
