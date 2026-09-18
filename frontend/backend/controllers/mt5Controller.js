const MT5Signal = require("../models/MT5Signal");
const TradingSession = require("../models/TradingSession");
const Trade = require("../models/Trade");
const ragService = require("../services/ragService");
const { sessionForTime } = require("../utils/tradingSession");
const crypto = require("crypto");

// Send signal to MT5
exports.sendSignal = async (req, res) => {
  try {
    const {
      pair, action, entry, stopLoss,
      takeProfit, lotSize, confidence,
      source, sourceLabel, reasoning, accountType,
    } = req.body;

    if (!pair || !action || !entry) {
      return res.status(400).json({ message: "pair, action, entry are required" });
    }

    // If this user's most recent MT5 session hit a profit/risk/trade-count
    // limit, block further signals until they start a new session. A manual
    // stop or "never used sessions" doesn't restrict ad-hoc signal sending.
    const latestMt5Session = await TradingSession.findOne({
      user: req.user._id,
      mode: "mt5",
    }).sort({ createdAt: -1 });
    const limitStoppedStatuses = ["stopped_profit", "stopped_risk", "stopped_trades"];
    if (latestMt5Session && limitStoppedStatuses.includes(latestMt5Session.status)) {
      return res.status(403).json({
        message: "Your trading session limit was reached — start a new session to keep sending signals",
      });
    }

    // Generate unique token for MT5 verification
    const token = crypto.randomBytes(32).toString("hex");

    const signal = await MT5Signal.create({
      user: req.user._id,
      pair: pair.replace("/", ""),
      action,
      accountType: accountType === "real" ? "real" : "demo",
      entry: parseFloat(entry),
      stopLoss: stopLoss ? parseFloat(stopLoss) : null,
      takeProfit: takeProfit ? parseFloat(takeProfit) : null,
      lotSize: lotSize ? parseFloat(lotSize) : 0.01,
      confidence,
      source,
      sourceLabel,
      reasoning,
      status: "sent",
      token,
    });

    res.json({
      success: true,
      signal,
      message: "Signal sent — MT5 EA will execute when connected",
      mt5Instructions: {
        endpoint: `${process.env.SERVER_URL || "http://localhost:5000"}/api/mt5/pending`,
        token,
        signalId: signal._id,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get all signals for user
exports.getSignals = async (req, res) => {
  try {
    const signals = await MT5Signal.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(signals);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Update signal status (called by MT5 EA)
exports.updateSignalStatus = async (req, res) => {
  try {
    const { status, mt5Response } = req.body;
    const signal = await MT5Signal.findByIdAndUpdate(
      req.params.id,
      {
        status,
        mt5Response,
        executedAt: status === "executed" ? new Date() : null,
      },
      { new: true }
    );
    res.json(signal);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get stats
exports.getStats = async (req, res) => {
  try {
    const counts = await MT5Signal.aggregate([
      { $match: { user: req.user._id } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);
    const byStatus = Object.fromEntries(counts.map((c) => [c._id, c.count]));
    const total = counts.reduce((sum, c) => sum + c.count, 0);
    const executed = byStatus.executed || 0;
    const pending = (byStatus.pending || 0) + (byStatus.sent || 0);
    const failed = byStatus.failed || 0;
    res.json({ total, executed, pending, failed });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Called by the EA whenever a position closes in the trader's MT5
// account -- not just ones TradeMind itself signaled. Deliberately
// unscoped to TradeMind-originated trades: this is what actually makes
// copy-traded positions (from an MQL5 Signal Provider subscription
// running in the same terminal) or any other manually-placed MT5 trade
// count toward the trade journal and the weekly self-learning summary,
// the same way an app-logged trade does. Public route (see
// mt5PublicRoutes.js), same trust model as /pending and /executed --
// identified by userId only, no JWT, matching this file's existing
// EA-facing endpoints.
exports.reportClosedTrade = async (req, res) => {
  try {
    const {
      userId, ticket, symbol, direction,
      entryPrice, exitPrice, lotSize, profitLoss,
      openedAt, closedAt,
    } = req.body;

    if (!userId || !ticket || !symbol || !direction) {
      return res.status(400).json({ message: "userId, ticket, symbol, direction are required" });
    }
    if (!["buy", "sell"].includes(direction)) {
      return res.status(400).json({ message: "direction must be buy or sell" });
    }

    const pnl = Number(profitLoss) || 0;
    const outcome = pnl > 0 ? "win" : pnl < 0 ? "loss" : "breakeven";
    const closedDate = closedAt ? new Date(closedAt * 1000) : new Date();

    const trade = await Trade.findOneAndUpdate(
      { mt5Ticket: ticket },
      {
        user: userId,
        mt5Ticket: ticket,
        pair: symbol,
        direction,
        type: "forex",
        entryPrice: Number(entryPrice) || Number(exitPrice) || 0,
        exitPrice: Number(exitPrice) || undefined,
        lotSize: Number(lotSize) || 0.01,
        session: sessionForTime(closedDate),
        status: "closed",
        outcome,
        profitLoss: pnl,
        openedAt: openedAt ? new Date(openedAt * 1000) : closedDate,
        closedAt: closedDate,
        notes: "Imported automatically from MT5 — a closed position reported by the EA (may be a TradeMind signal, a copy-traded position, or a trade placed directly in the terminal).",
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    ragService.indexTrade(userId, trade).catch((err) =>
      console.error("RAG index MT5 trade failed:", err.message)
    );

    res.json({ success: true, tradeId: trade._id });
  } catch (err) {
    // A duplicate ticket (the EA re-reporting the same close after a
    // retry) hits Trade's unique mt5Ticket index -- not a real error,
    // just confirmation the trade is already recorded.
    if (err.code === 11000) {
      return res.json({ success: true, message: "Already recorded" });
    }
    res.status(500).json({ message: err.message });
  }
};