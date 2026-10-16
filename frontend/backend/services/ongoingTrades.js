// Trades that follow a signal close themselves when TradeMind's price check
// scores the signal (signalOutcomes) -- at exactly its take profit or stop
// loss, at that time -- and get a result chart as their closing screenshot.
// (Group-recorded only until 2026-10-14; now every open trade linked to a
// signal, unless the trader moved its SL / TP away from the signal's -- then
// they manage it themselves.) Signals marked 🛒 Taken but never recorded are
// recorded and closed the same way when they hit TP / SL (lot 0.01, locked).
// Ongoing trades count nowhere until closed. An expired signal (neither hit)
// gets one reminder to close by hand. Runs after the scoring step of each
// cycle; never touches signal generation.
const Trade = require("../models/Trade");
const Notification = require("../models/Notification");
const { calculatePL } = require("../utils/tradePL");
const { dispatchMessage } = require("./notifyDispatcher");

const money = (v) => `${v >= 0 ? "+" : "-"}$${Math.abs(v).toFixed(2)}`;
const same = (a, b) => a == null || b == null || Math.abs(Number(a) - Number(b)) <= Math.abs(Number(b)) * 0.00002 + 1e-9;

function sessionAt(date) {
  const h = new Date(date).getUTCHours();
  if (h >= 22 || h < 7) return "sydney";
  if (h < 9) return "tokyo";
  if (h < 13) return "london";
  if (h < 17) return "overlap";
  return "new_york";
}

// Result chart as the closing screenshot: replaces an app-made picture,
// otherwise (the trader's own upload) is kept alongside it.
async function attachResultChart(tradeId) {
  try {
    const t = await Trade.findById(tradeId).lean();
    const pic = await require("./signalImage").forTrade(t);
    if (!pic) return;
    const ownUpload = t.screenshot?.url && (t.screenshotIsUpload || !String(t.screenshot.publicId || "").endsWith(`chart-${t._id}`)) && !t.locked;
    await Trade.updateOne({ _id: t._id }, ownUpload ? { resultScreenshot: pic } : { screenshot: pic, resultScreenshot: pic });
  } catch (err) {
    console.error("Result chart failed:", err.message);
  }
}

// Where a signal's scored trade closed: the recorded exit (a trailed stop
// or the time limit on strategy signals), else its TP / SL.
const exitOf = (n) => n.simExitPrice ?? (n.simOutcome === "win" ? n.takeProfit : n.stopLoss);
// Strategy signals trail their stop, so the trade still carries the first one.
const signalStop = (n) => n.initialStopLoss ?? n.stopLoss;
// Settled automatically: TP / SL, plus a strategy signal's time limit.
const settles = (n) => n.simOutcome === "win" || n.simOutcome === "loss" || (n.strategy && n.simOutcome === "expired");

async function alertClosed(userId, t, n, exit, pl, recorded) {
  const how = require("./signalOutcomes").exitLabel(n, { simOutcome: n.simOutcome, exit });
  const good = pl >= 0;
  await dispatchMessage(userId, {
    title: `${good ? "✅" : "🛑"} ${t.pair} ${String(t.direction).toUpperCase()} closed at ${how.short} ${money(pl)}`,
    body: `${recorded ? "Recorded from the signal you took and closed" : "Closed automatically"}: ${how.long} (${exit}). It now counts in your performance.`,
    url: "/history",
    id: `trade-closed-${t._id}`,
    email: false,
  }).catch((err) => console.error("Trade-closed alert failed:", err.message));
}

exports.attachResultChart = (id) => attachResultChart(id);

exports.settle = async () => {
  let closed = 0, recorded = 0, reminded = 0, skippedManaged = 0;

  // 1. Open trades that follow a signal.
  const open = await Trade.find({ status: "open", notificationId: { $exists: true, $ne: null } })
    .populate("notificationId", "simOutcome simResolvedAt stopLoss takeProfit initialStopLoss simExitPrice strategy maxHoldHours")
    .limit(500);
  for (const t of open) {
    const n = t.notificationId;
    if (!n || !n.simOutcome) continue;
    const label = `${t.pair} ${String(t.direction).toUpperCase()}`;
    if (settles(n)) {
      // The trader moved SL / TP away from the signal: they manage it.
      const moved = !(same(t.stopLoss, signalStop(n)) || same(t.stopLoss, n.stopLoss)) || !same(t.takeProfit, n.takeProfit);
      if (!t.locked && moved) { skippedManaged++; continue; }
      const exit = exitOf(n);
      const r = calculatePL(t.pair, t.direction, t.entryPrice, exit, t.lotSize || 0.01);
      if (!r) continue;
      const res = await Trade.updateOne(
        { _id: t._id, status: "open" },
        { exitPrice: exit, profitLoss: r.pl, outcome: r.outcome, status: "closed", closedAt: n.simResolvedAt || new Date(), closedBy: "signal" }
      );
      if (!res.modifiedCount) continue;
      closed++;
      await attachResultChart(t._id);
      await alertClosed(t.user, t, n, exit, r.pl, false);
    } else if ((n.simOutcome === "expired" || n.simOutcome === "unfilled") && !t.expiryReminded) {
      await Trade.updateOne({ _id: t._id }, { expiryReminded: true });
      reminded++;
      const unfilled = n.simOutcome === "unfilled";
      await dispatchMessage(t.user, {
        title: unfilled ? `⏸ ${label}: entry never reached` : `⏳ ${label}: close it with your real exit`,
        body: unfilled
          ? "Price never came to this signal's entry in 24 hours, so the trade may never have opened. If your order wasn't filled, delete it in Trade History; otherwise close it with your real exit."
          : "The signal expired without hitting its take profit or stop loss, so TradeMind can't close this trade for you. Close it in Trade History with the price you exited at.",
        url: "/history",
        id: `trade-expired-${t._id}`,
        email: false,
      }).catch((err) => console.error("Trade-expiry reminder failed:", err.message));
    }
  }

  // 2. Signals marked 🛒 Taken that hit TP / SL but were never recorded.
  const taken = await Notification.find({
    taken: true,
    $or: [{ tradeId: { $exists: false } }, { tradeId: null }],
    $and: [{ $or: [{ simOutcome: { $in: ["win", "loss"] } }, { strategy: { $exists: true, $ne: null }, simOutcome: "expired" }] }],
    signal: { $in: ["buy", "sell"] },
    type: { $ne: "quick_trade" },
    entry: { $gt: 0 },
    createdAt: { $gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) },
  }).limit(200);
  for (const n of taken) {
    if (await Trade.exists({ user: n.user, notificationId: n._id })) continue;
    const exit = exitOf(n);
    const r = calculatePL(n.pair, n.signal, n.entry, exit, 0.01);
    if (!r) continue;
    const t = await Trade.create({
      user: n.user, pair: n.pair, direction: n.signal, type: "forex",
      entryPrice: n.entry, stopLoss: signalStop(n), takeProfit: n.takeProfit, lotSize: 0.01,
      exitPrice: exit, profitLoss: r.pl, outcome: r.outcome, status: "closed", closedBy: "signal",
      openedAt: n.takenAt && n.takenAt < (n.simResolvedAt || Date.now()) ? n.createdAt : n.createdAt,
      closedAt: n.simResolvedAt || new Date(), session: sessionAt(n.createdAt),
      notificationId: n._id, locked: true, batchId: "auto-taken",
      notes: `AI Signal — ${n.sourceLabel || "AI Auto"} (recorded automatically: you marked it taken)`,
    });
    await Notification.updateOne({ _id: n._id }, { tradeId: t._id });
    recorded++;
    await attachResultChart(t._id);
    await alertClosed(n.user, t, n, exit, r.pl, true);
  }
  return { closed, recorded, reminded, skippedManaged };
};
