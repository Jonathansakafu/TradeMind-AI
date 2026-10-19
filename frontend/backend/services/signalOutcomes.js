// Automatic result tracking for forex/gold signals ("rules + backtest" step
// of the AI trading workflow, added 2026-10). After a signal is sent, the
// real price path (Yahoo 5-minute candles) decides which came first:
// take-profit (win) or stop-loss (loss). Unresolved after 24h = expired,
// scored at the last price. Runs once per generation cycle, no AI calls.
// The results feed back into the AI prompt (statsTextByPair) and the
// Performance page (GET /api/notifications/signal-stats).
const Notification = require("../models/Notification");
const marketService = require("./marketService");
const pipelineStats = require("./pipelineStats");

const MIN_AGE_MS = 5 * 60 * 1000;
const EXPIRE_MS = 24 * 60 * 60 * 1000;
// 72 h so a strategy signal held for 48 h (services/ruleStrategy.js) is
// still picked up when it closes.
const LOOKBACK_MS = 72 * 60 * 60 * 1000;

// Pure: the result of a signal from 5-minute candles (oldest first).
// Fixed 2026-10-15: the entry must be reached first. A signal whose entry is
// a level away from the price (a pullback / limit entry, e.g. BUY 1.32380
// with GBPUSD at 1.3265) used to be scored from the moment it was sent --
// its TP was already behind the price, so it showed "TP hit" while the
// trade never started (price later fell through the entry and the SL).
//   - in at once when the price when sent is at the entry (within 0.15R,
//     or inside the first candle) or already better than it (BUY below /
//     SELL above the entry -- a trader just takes the market price)
//   - waits when the price is worse than the entry (BUY above / SELL below
//     it): a pullback / limit order
//   - otherwise: filled by the first candle that touches the entry
//   - after the fill: TP or SL, whichever price reaches first; a candle
//     touching both counts as SL (order inside it unknown -- conservative);
//     on a later fill candle only the SL can count (TP may have come first)
//   - entry not reached within 24 h: "unfilled" (no trade -- neither a win
//     nor a loss); filled but neither level within 24 h: "expired"
const inAtOnce = (signal, entry, risk, first) => Math.abs(first.open - entry) <= 0.15 * risk
  || (first.low <= entry && entry <= first.high)
  || (signal === "buy" ? first.open < entry : first.open > entry);

// Strategy signals (services/ruleStrategy.js) trail their stop: each
// candle is checked against the stop in force when it started
// (stopHistory), R is measured from the first stop, a stop hit beyond the
// entry is a win, and the trade closes at market after maxHoldHours.
function resolveManaged(n, candles, now) {
  const { signal, entry, takeProfit, createdAt, initialStopLoss } = n;
  const risk = Math.abs(entry - initialStopLoss);
  if (!risk) return null;
  const start = new Date(createdAt).getTime();
  const holdMs = (n.maxHoldHours || 48) * 3600e3;
  const after = candles.filter((c) => { const t = new Date(c.datetime).getTime(); return t > start - 5 * 60 * 1000 && t < start + holdMs; });
  if (!after.length) return null;
  const isBuy = signal === "buy";
  const fill = inAtOnce(signal, entry, risk, after[0]) ? 0 : after.findIndex((c) => c.low <= entry && entry <= c.high);
  if (fill < 0) return now - start > holdMs ? { simOutcome: "unfilled", simR: 0, at: after[after.length - 1].datetime, filledAt: null } : null;
  const filledAt = after[fill].datetime;
  const history = (n.stopHistory || []).map((h) => ({ t: new Date(h.at).getTime(), price: h.price })).sort((a, b) => a.t - b.t);
  const rOf = (px) => Math.round((((px - entry) * (isBuy ? 1 : -1)) / risk) * 100) / 100;
  for (let i = fill; i < after.length; i++) {
    const c = after[i], t = new Date(c.datetime).getTime();
    let stop = initialStopLoss;
    for (const h of history) if (h.t <= t) stop = h.price;
    if (isBuy ? c.low <= stop : c.high >= stop) {
      const r = rOf(stop);
      return { simOutcome: r > 0 ? "win" : "loss", simR: r, at: c.datetime, filledAt, exit: stop };
    }
    if ((isBuy ? c.high >= takeProfit : c.low <= takeProfit) && !(i === fill && fill > 0)) {
      return { simOutcome: "win", simR: rOf(takeProfit), at: c.datetime, filledAt, exit: takeProfit };
    }
  }
  if (now - start > holdMs) {
    const last = after[after.length - 1].close;
    return { simOutcome: "expired", simR: rOf(last), at: after[after.length - 1].datetime, filledAt, exit: last };
  }
  return null;
}

function resolve(n, candles, now = Date.now()) {
  if (n.strategy && n.initialStopLoss) return resolveManaged(n, candles, now);
  const { signal, entry, stopLoss, takeProfit, createdAt } = n;
  const risk = Math.abs(entry - stopLoss);
  if (!risk) return null;
  const start = new Date(createdAt).getTime();
  // The candle the signal was sent in, and everything after it up to 24 h
  // (a re-score sees weeks of candles; a hit after the 24 h doesn't count).
  const after = candles.filter((c) => { const t = new Date(c.datetime).getTime(); return t > start - 5 * 60 * 1000 && t <= start + EXPIRE_MS; });
  if (!after.length) return null;
  const isBuy = signal === "buy";
  const first = after[0];
  const fill = inAtOnce(signal, entry, risk, first)
    ? 0 : after.findIndex((c) => c.low <= entry && entry <= c.high);
  if (fill < 0) {
    return now - start > EXPIRE_MS ? { simOutcome: "unfilled", simR: 0, at: after[after.length - 1].datetime, filledAt: null } : null;
  }
  const filledAt = after[fill].datetime;
  for (let i = fill; i < after.length; i++) {
    const c = after[i];
    const hitSL = isBuy ? c.low <= stopLoss : c.high >= stopLoss;
    const hitTP = isBuy ? c.high >= takeProfit : c.low <= takeProfit;
    if (hitSL) return { simOutcome: "loss", simR: -1, at: c.datetime, filledAt };
    if (hitTP && !(i === fill && fill > 0)) {
      return { simOutcome: "win", simR: Math.round((Math.abs(takeProfit - entry) / risk) * 100) / 100, at: c.datetime, filledAt };
    }
  }
  if (now - start > EXPIRE_MS) {
    const last = after[after.length - 1].close;
    const r = ((last - entry) * (isBuy ? 1 : -1)) / risk;
    return { simOutcome: "expired", simR: Math.round(r * 100) / 100, at: after[after.length - 1].datetime, filledAt };
  }
  return null;
}

exports.resolve = resolve;

// When price reached the entry (same rule as resolve), or null.
function fillTime({ signal, entry, stopLoss, createdAt }, candles) {
  const risk = Math.abs(entry - stopLoss);
  const start = new Date(createdAt).getTime();
  const after = candles.filter((c) => new Date(c.datetime).getTime() > start - 5 * 60 * 1000);
  if (!after.length || !risk) return null;
  const first = after[0];
  if (inAtOnce(signal, entry, risk, first)) return first.datetime;
  return after.find((c) => c.low <= entry && entry <= c.high)?.datetime || null;
}
exports.fillTime = fillTime;

exports.evaluateOpenSignals = async () => {
  const now = Date.now();
  const open = await Notification.find({
    type: { $ne: "quick_trade" },
    simOutcome: { $exists: false },
    signal: { $in: ["buy", "sell"] },
    entry: { $gt: 0 }, stopLoss: { $gt: 0 }, takeProfit: { $gt: 0 },
    createdAt: { $gte: new Date(now - LOOKBACK_MS), $lte: new Date(now - MIN_AGE_MS) },
  }).select("user pair signal entry stopLoss takeProfit createdAt confidence type simFilledAt strategy initialStopLoss stopHistory maxHoldHours").limit(2000);
  if (!open.length) return { checked: 0, resolved: 0 };

  const byPair = new Map();
  for (const n of open) {
    if (!byPair.has(n.pair)) byPair.set(n.pair, []);
    byPair.get(n.pair).push(n);
  }
  let resolved = 0;
  const justResolved = [];
  for (const [pair, list] of byPair) {
    let candles;
    try {
      candles = await marketService.getYahooCandles(pair, { interval: "5m", range: "5d" });
    } catch (err) {
      pipelineStats.recordError("signalOutcomes", `${pair}: ${err.message}`);
      continue;
    }
    if (!candles.length) continue;
    for (const n of list) {
      const r = resolve(n, candles, now);
      if (!r) {
        // Still running: note when the entry was reached (shown as "Entered").
        if (!n.simFilledAt) {
          const f = fillTime(n, candles);
          if (f) await Notification.updateOne({ _id: n._id }, { simFilledAt: new Date(f) });
        }
        continue;
      }
      await Notification.updateOne({ _id: n._id }, {
        simOutcome: r.simOutcome, simR: r.simR, simResolvedAt: new Date(r.at), simFilledAt: r.filledAt ? new Date(r.filledAt) : null,
        ...(r.exit != null ? { simExitPrice: r.exit } : {}),
      });
      resolved++;
      if (r.simOutcome === "win" || r.simOutcome === "loss" || (n.strategy && r.simOutcome === "expired")) justResolved.push({ n, r });
    }
  }
  pipelineStats.inc("outcomes.resolved", resolved);
  await exports.sendResultAlerts(justResolved, now).catch((err) => console.error("Signal result alerts failed:", err.message));
  return { checked: open.length, resolved };
};

// Per-user stats over the last `days`, by pair and direction.
exports.getStats = async (userId, days = 30) => {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await Notification.aggregate([
    { $match: { user: userId, simOutcome: { $exists: true }, createdAt: { $gte: since } } },
    { $group: {
      _id: { pair: "$pair", signal: "$signal" },
      wins: { $sum: { $cond: [{ $eq: ["$simOutcome", "win"] }, 1, 0] } },
      losses: { $sum: { $cond: [{ $eq: ["$simOutcome", "loss"] }, 1, 0] } },
      expired: { $sum: { $cond: [{ $eq: ["$simOutcome", "expired"] }, 1, 0] } },
      totalR: { $sum: "$simR" },
    } },
  ]);
  const pending = await Notification.countDocuments({
    user: userId, type: { $ne: "quick_trade" }, simOutcome: { $exists: false },
    signal: { $in: ["buy", "sell"] }, stopLoss: { $gt: 0 }, createdAt: { $gte: since },
  });
  return { days, pending, rows: rows.map((r) => ({ pair: r._id.pair, signal: r._id.signal, wins: r.wins, losses: r.losses, expired: r.expired, totalR: Math.round(r.totalR * 100) / 100 })) };
};

// One short line per pair for the AI prompt, e.g.
// "Your recent XAUUSD signals (14 days): BUY 4/6 hit target, SELL 1/5 ..."
exports.statsTextByPair = async (userId) => {
  const { rows } = await exports.getStats(userId, 14);
  const out = {};
  for (const pair of new Set(rows.map((r) => r.pair))) {
    const parts = rows.filter((r) => r.pair === pair).map((r) => {
      const decided = r.wins + r.losses;
      return `${r.signal.toUpperCase()} ${r.wins}/${decided} hit target (net ${r.totalR >= 0 ? "+" : ""}${r.totalR}R)`;
    });
    out[pair] = `Track record of your own recent ${pair} signals (last 14 days, checked against real prices): ${parts.join("; ")}. Weigh this: be more selective in a direction that has been losing.`;
  }
  // What the post-mortems found (services/tradeResearch.js).
  const research = require("./tradeResearch");
  const summary = await research.summaryLessons().catch(() => []);
  for (const pair of ["XAUUSD", "EURUSD", "GBPUSD"]) {
    const lessons = await research.lessonsFor(userId, pair).catch(() => []);
    // The AI's lessons that name this pair, or no pair at all.
    const general = summary.filter((l) => { const u = l.toUpperCase(); return u.includes(pair) || !["XAUUSD", "EURUSD", "GBPUSD", "GOLD"].some((p) => u.includes(p)); });
    const all = [...lessons, ...general.slice(0, 3)];
    if (all.length) out[pair] = `${out[pair] ? `${out[pair]}\n` : ""}Lessons from post-mortems of past signals (why they won or lost): ${all.join("; ")}. Apply these: do not repeat a losing pattern.`;
  }
  return out;
};

// "✅ XAUUSD SELL hit TP" with the result chart, when a fresh signal hits
// its take profit or stop loss (added 2026-10-14). Only signals from the
// last 24 h that resolved in the last 3 h (no flood after a pause); push
// only; Settings switch "signalResults" (on unless turned off).
// "TP" / "SL" / "trailing stop" / "48 h time limit" for a resolved signal.
function exitLabel(n, r) {
  if (r.simOutcome === "expired") return { short: "time limit", long: `${n.maxHoldHours || 24} h time limit, market price` };
  if (r.exit != null && r.exit !== n.takeProfit && r.simOutcome === "win") return { short: "trailing stop", long: "trailing stop" };
  return r.simOutcome === "win" ? { short: "TP", long: "take profit" } : { short: "SL", long: "stop loss" };
}
exports.exitLabel = exitLabel;

exports.sendResultAlerts = async (list, now = Date.now()) => {
  const { dispatchMessage, hasChannels } = require("./notifyDispatcher");
  const signalImage = require("./signalImage");
  let sent = 0;
  for (const { n, r } of list) {
    if (now - new Date(n.createdAt).getTime() > 24 * 3600e3 || now - new Date(r.at).getTime() > 3 * 3600e3) continue;
    if (!(await hasChannels(n.user))) continue;
    const win = r.simOutcome === "win";
    const fresh = await Notification.findById(n._id).lean();
    const image = await signalImage.withTimeout(signalImage.forNotification(fresh, { result: true }).catch(() => null), 10000);
    const exit = r.exit ?? (win ? n.takeProfit : n.stopLoss);
    const rr = r.simR != null ? ` (${r.simR >= 0 ? "+" : ""}${r.simR}R)` : "";
    const how = exitLabel(n, r);
    await dispatchMessage(n.user, {
      title: `${win ? "✅" : r.simOutcome === "expired" ? "⏱" : "🛑"} ${n.pair} ${String(n.signal).toUpperCase()} ${r.simOutcome === "expired" ? "time limit — close it" : `hit ${how.short}`}${rr}`,
      body: `Entry ${n.entry} → ${how.long} ${exit}. Tap to see how price got there.`,
      url: `/notifications?id=${n._id}`,
      id: `result-${n._id}`,
      email: false,
      pref: "signalResults",
      image,
    }).catch(() => {});
    sent++;
  }
  if (sent) pipelineStats.inc("outcomes.alerts", sent);
  return sent;
};
