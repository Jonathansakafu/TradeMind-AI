const crypto = require("crypto");
const TradingSession = require("../models/TradingSession");
const MT5Signal = require("../models/MT5Signal");
const { getSessionProgress } = require("../utils/sessionLimits");

// START SESSION
const startSession = async (req, res) => {
  try {
    const {
      mode, profitTarget, riskLimit, maxTrades, pairs,
      stake, payoutPercent, accountType, accountReady, autoExecute,
      autoSendToMT5, mt5LotSize,
    } = req.body;

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

    // Gate: this can't be a real broker-account connection (Pocket
    // Option/Expert Option have no third-party trade-execution API), so
    // Quick Trade requires the trader to confirm they're actually ready.
    if (mode === "quick_trade" && !accountReady) {
      return res.status(400).json({
        message: "Please confirm you have a Pocket Option or Expert Option account open and ready to trade",
      });
    }

    // Gate: for MT5, we CAN check something real — has this user's EA ever
    // successfully reached the backend at all. If not, sending signals
    // would just go nowhere, so send them to finish the MT5 setup guide first.
    if (mode === "mt5") {
      const everConnected = await MT5Signal.findOne({ user: req.user._id });
      if (!everConnected) {
        return res.status(400).json({
          message: "Your MT5 EA hasn't connected yet — finish the setup guide first",
          code: "mt5_not_connected",
        });
      }
    }

    // Scoped by mode, not global -- Quick Trade and MT5 are independent
    // trading contexts (separate pair universes, separate risk budgets,
    // notificationController's autoGenerate already treats them as such),
    // so a trader should be able to run one of each at the same time. Only
    // guards against two sessions of the *same* mode running at once.
    const existing = await TradingSession.findOne({ user: req.user._id, mode, status: "active" });
    if (existing) {
      return res.status(400).json({
        message: "You already have an active session in this mode — stop it before starting a new one",
      });
    }

    const resolvedAccountType = accountType === "real" ? "real" : "demo";

    // Auto-execute (the browser extension clicking real trades) is only
    // ever allowed for demo Quick Trade sessions — this is the primary
    // safety gate, enforced here regardless of what the client sends.
    const canAutoExecute = mode === "quick_trade" && resolvedAccountType === "demo" && !!autoExecute;

    const session = await TradingSession.create({
      user: req.user._id,
      mode,
      profitTarget,
      riskLimit,
      maxTrades,
      pairs: pairs || [],
      accountType: resolvedAccountType,
      stake: mode === "quick_trade" ? stake : undefined,
      payoutPercent: mode === "quick_trade" ? payoutPercent : undefined,
      autoExecute: canAutoExecute,
      botToken: canAutoExecute ? crypto.randomBytes(32).toString("hex") : undefined,
      botTokenCreatedAt: canAutoExecute ? new Date() : undefined,
      autoSendToMT5: mode === "mt5" && !!autoSendToMT5,
      mt5LotSize: mode === "mt5" && mt5LotSize ? Number(mt5LotSize) : 0.01,
    });

    res.status(201).json(session);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};


// GET ACTIVE SESSION (+ live progress)
// Optional ?mode=mt5|quick_trade -- now that both can be active at once
// (see startSession), callers that care about one specific mode (the
// Quick Trade Won/Lost flow, the Trading Robot page's per-mode tab) pass
// it explicitly; omitted, this falls back to "whichever is active" for
// callers that only ever expect at most one (e.g. a user who's never
// touched the other mode).
const getActiveSession = async (req, res) => {
  try {
    const query = { user: req.user._id, status: "active" };
    if (req.query.mode) query.mode = req.query.mode;
    const session = await TradingSession.findOne(query);
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
    session.autoExecute = false;
    session.botToken = undefined;
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
