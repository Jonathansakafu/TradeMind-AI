const TradingSession = require("../models/TradingSession");
const Notification = require("../models/Notification");
const Trade = require("../models/Trade");
const { checkAndUpdateSession } = require("../utils/sessionLimits");

// The browser extension can't hold a JWT (no safe place to keep a 7-day
// full-access credential in extension storage on a page automating a
// ToS-sensitive site), so it authenticates with a per-session bot token
// instead — same pattern as the MT5 EA's public /pending + /executed routes.
async function loadValidSession(sessionId, token) {
  if (!sessionId || !token) return null;
  const session = await TradingSession.findById(sessionId);
  if (!session || session.botToken !== token) return null;
  return session;
}

// GET /api/quick-trade-bot/pending?sessionId=&token=
// Polled by the extension's content script. Returns { active: false } for
// any reason auto-execution should stop — that's the explicit "stop
// trading" signal, not a 4xx, so the extension can tell it apart from a
// transient network error.
exports.getPending = async (req, res) => {
  try {
    const { sessionId, token } = req.query;
    const session = await loadValidSession(sessionId, token);

    if (
      !session ||
      session.status !== "active" ||
      !session.autoExecute ||
      session.accountType !== "demo"
    ) {
      return res.json({ active: false });
    }

    session.botLastPolledAt = new Date();
    await session.save();

    const now = Date.now();
    const candidates = await Notification.find({
      tradingSessionId: session._id,
      type: "quick_trade",
      $or: [{ botStatus: { $exists: false } }, { botStatus: "pending" }],
    }).sort({ createdAt: 1 });

    const unexpired = candidates.filter((n) => {
      if (!n.expiresInMinutes) return true;
      return now - new Date(n.createdAt).getTime() < n.expiresInMinutes * 60 * 1000;
    });

    const claimed = [];
    for (const n of unexpired) {
      n.botStatus = "claimed";
      n.botClaimedAt = new Date();
      await n.save();
      claimed.push(n);
    }

    res.json({
      active: true,
      notifications: claimed.map((n) => ({
        id: n._id,
        pair: n.pair,
        signal: n.signal,
        expiresInMinutes: n.expiresInMinutes,
        stake: session.stake,
      })),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/quick-trade-bot/executed
// Body: { sessionId, token, notificationId, outcome: "win"|"loss"|"failed"|"unknown" }
exports.reportExecuted = async (req, res) => {
  try {
    const { sessionId, token, notificationId, outcome } = req.body;
    const session = await loadValidSession(sessionId, token);
    if (!session) return res.status(401).json({ message: "Invalid session or token" });

    const notification = await Notification.findOne({
      _id: notificationId,
      tradingSessionId: session._id,
    });
    if (!notification) return res.status(404).json({ message: "Notification not found" });
    if (notification.botStatus !== "claimed") {
      return res.status(400).json({ message: "Notification already resolved" });
    }

    if (outcome !== "win" && outcome !== "loss") {
      // Extension couldn't confidently place the trade or read the result —
      // never guess. Leave it unread so the existing manual Won/Lost UI in
      // Notifications.jsx picks it up as a normal fallback.
      notification.botStatus = "failed";
      notification.botError = outcome === "unknown" ? "Could not read trade result" : "Execution failed";
      await notification.save();
      return res.json({ success: true, sessionActive: session.status === "active" });
    }

    // Computed server-side from the session, never trusted from the
    // extension — a compromised/buggy client shouldn't be able to hand us
    // an arbitrary profitLoss number.
    const profitLoss = outcome === "win"
      ? session.stake * (session.payoutPercent / 100)
      : -session.stake;

    const trade = await Trade.create({
      user: session.user,
      pair: notification.pair,
      direction: notification.signal,
      type: "quick_trade",
      tradingSessionId: session._id,
      entryPrice: notification.entry || 0,
      outcome,
      profitLoss,
      status: "closed",
      closedAt: new Date(),
    });

    notification.botStatus = outcome;
    notification.read = true;
    await notification.save();

    const updatedSession = await checkAndUpdateSession(session._id);

    res.json({
      success: true,
      tradeId: trade._id,
      sessionActive: updatedSession?.status === "active",
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
