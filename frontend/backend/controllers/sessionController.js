const TradingSession = require("../models/TradingSession");
const { getSessionProgress } = require("../utils/sessionLimits");

// START SESSION
const startSession = async (req, res) => {
  try {
    const { mode, profitTarget, riskLimit, maxTrades, pairs, stake, payoutPercent } = req.body;

    if (!mode || !profitTarget || !riskLimit || !maxTrades) {
      return res.status(400).json({
        message: "mode, profitTarget, riskLimit, and maxTrades are required",
      });
    }

    if (mode === "quick_trade" && (!stake || !payoutPercent)) {
      return res.status(400).json({
        message: "stake and payoutPercent are required for Quick Trade sessions",
      });
    }

    const existing = await TradingSession.findOne({ user: req.user._id, status: "active" });
    if (existing) {
      return res.status(400).json({
        message: "You already have an active session — stop it before starting a new one",
      });
    }

    const session = await TradingSession.create({
      user: req.user._id,
      mode,
      profitTarget,
      riskLimit,
      maxTrades,
      pairs: pairs || [],
      stake: mode === "quick_trade" ? stake : undefined,
      payoutPercent: mode === "quick_trade" ? payoutPercent : undefined,
    });

    res.status(201).json(session);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};


// GET ACTIVE SESSION (+ live progress)
const getActiveSession = async (req, res) => {
  try {
    const session = await TradingSession.findOne({ user: req.user._id, status: "active" });
    if (!session) {
      return res.status(200).json({ session: null });
    }

    const progress = await getSessionProgress(session._id);

    res.status(200).json({ session, progress });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};


// GET SESSION HISTORY
const getSessions = async (req, res) => {
  try {
    const sessions = await TradingSession.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50);

    res.status(200).json(sessions);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};


// STOP SESSION (manual)
const stopSession = async (req, res) => {
  try {
    const session = await TradingSession.findOne({ _id: req.params.id, user: req.user._id });

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    if (session.status !== "active") {
      return res.status(400).json({ message: "Session is already stopped" });
    }

    session.status = "stopped_manual";
    session.endedAt = new Date();
    await session.save();

    res.status(200).json(session);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

module.exports = {
  startSession,
  getActiveSession,
  getSessions,
  stopSession,
};
