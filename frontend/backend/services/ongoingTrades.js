// Ongoing group-recorded trades (Notifications > Record trades, locked):
// they count nowhere (win rate, P/L, performance) until closed. When
// TradeMind's price check scores their signal (signalOutcomes), they close
// themselves at exactly the take profit or stop loss, at that time, and the
// trader is told. A signal that expired without hitting either gets one
// reminder to close the trade by hand with the real exit. Runs after the
// scoring step of each cycle; never touches signal generation.
const Trade = require("../models/Trade");
const { calculatePL } = require("../utils/tradePL");
const { dispatchMessage } = require("./notifyDispatcher");

const money = (v) => `${v >= 0 ? "+" : "-"}$${Math.abs(v).toFixed(2)}`;

exports.settle = async () => {
  const open = await Trade.find({ locked: true, status: "open", notificationId: { $exists: true } })
    .populate("notificationId", "simOutcome simResolvedAt stopLoss takeProfit")
    .limit(500);
  let closed = 0, reminded = 0;
  for (const t of open) {
    const n = t.notificationId;
    if (!n || !n.simOutcome) continue;
    const label = `${t.pair} ${String(t.direction).toUpperCase()}`;
    if (n.simOutcome === "win" || n.simOutcome === "loss") {
      const exit = n.simOutcome === "win" ? n.takeProfit : n.stopLoss;
      const r = calculatePL(t.pair, t.direction, t.entryPrice, exit, t.lotSize);
      if (!r) continue;
      // Only if still open (the trader may have closed it meanwhile).
      const res = await Trade.updateOne(
        { _id: t._id, status: "open" },
        { exitPrice: exit, profitLoss: r.pl, outcome: r.outcome, status: "closed", closedAt: n.simResolvedAt || new Date(), closedBy: "signal" }
      );
      if (!res.modifiedCount) continue;
      closed++;
      const hit = n.simOutcome === "win" ? "take profit" : "stop loss";
      await dispatchMessage(t.user, {
        title: `${n.simOutcome === "win" ? "✅" : "🛑"} ${label} closed at ${n.simOutcome === "win" ? "TP" : "SL"} ${money(r.pl)}`,
        body: `Price hit the ${hit} (${exit}). Your recorded trade was closed automatically and now counts in your performance.`,
        url: "/history",
        id: `trade-closed-${t._id}`,
        email: false,
      }).catch((err) => console.error("Trade-closed alert failed:", err.message));
    } else if (n.simOutcome === "expired" && !t.expiryReminded) {
      await Trade.updateOne({ _id: t._id }, { expiryReminded: true });
      reminded++;
      await dispatchMessage(t.user, {
        title: `⏳ ${label}: close it with your real exit`,
        body: "The signal expired without hitting its take profit or stop loss, so TradeMind can't close this trade for you. Close it in Trade History with the price you exited at.",
        url: "/history",
        id: `trade-expired-${t._id}`,
        email: false,
      }).catch((err) => console.error("Trade-expiry reminder failed:", err.message));
    }
  }
  return { closed, reminded };
};
