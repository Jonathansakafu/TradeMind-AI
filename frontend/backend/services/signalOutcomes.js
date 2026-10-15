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
const LOOKBACK_MS = 48 * 60 * 60 * 1000;

// Pure: which level did price reach first after `startTime`? A candle that
// touches both counts as a loss (can't know the order inside it -- the
// conservative assumption).
function resolve({ signal, entry, stopLoss, takeProfit, createdAt }, candles, now = Date.now()) {
  const risk = Math.abs(entry - stopLoss);
  if (!risk) return null;
  const start = new Date(createdAt).getTime();
  const after = candles.filter((c) => new Date(c.datetime).getTime() >= start - 60 * 1000);
  for (const c of after) {
    const hitSL = signal === "buy" ? c.low <= stopLoss : c.high >= stopLoss;
    const hitTP = signal === "buy" ? c.high >= takeProfit : c.low <= takeProfit;
    if (hitSL) return { simOutcome: "loss", simR: -1, at: c.datetime };
    if (hitTP) return { simOutcome: "win", simR: Math.round((Math.abs(takeProfit - entry) / risk) * 100) / 100, at: c.datetime };
  }
  if (now - start > EXPIRE_MS && after.length) {
    const last = after[after.length - 1].close;
    const r = ((last - entry) * (signal === "buy" ? 1 : -1)) / risk;
    return { simOutcome: "expired", simR: Math.round(r * 100) / 100, at: after[after.length - 1].datetime };
  }
  return null;
}

exports.resolve = resolve;

exports.evaluateOpenSignals = async () => {
  const now = Date.now();
  const open = await Notification.find({
    type: { $ne: "quick_trade" },
    simOutcome: { $exists: false },
    signal: { $in: ["buy", "sell"] },
    entry: { $gt: 0 }, stopLoss: { $gt: 0 }, takeProfit: { $gt: 0 },
    createdAt: { $gte: new Date(now - LOOKBACK_MS), $lte: new Date(now - MIN_AGE_MS) },
  }).select("user pair signal entry stopLoss takeProfit createdAt confidence type").limit(2000);
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
      if (!r) continue;
      await Notification.updateOne({ _id: n._id }, { simOutcome: r.simOutcome, simR: r.simR, simResolvedAt: new Date(r.at) });
      resolved++;
      if (r.simOutcome !== "expired") justResolved.push({ n, r });
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
    const exit = win ? n.takeProfit : n.stopLoss;
    const rr = r.simR != null ? ` (${r.simR >= 0 ? "+" : ""}${r.simR}R)` : "";
    await dispatchMessage(n.user, {
      title: `${win ? "✅" : "🛑"} ${n.pair} ${String(n.signal).toUpperCase()} hit ${win ? "TP" : "SL"}${rr}`,
      body: `Entry ${n.entry} → ${win ? "take profit" : "stop loss"} ${exit}. Tap to see how price got there.`,
      url: "/notifications",
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
