const Trade = require("../models/Trade");
const ragService = require("../services/ragService");
const { checkAndUpdateSession } = require("../utils/sessionLimits");

// GET all trades
exports.getTrades = async (req, res) => {
  try {
    const { status, outcome, pair, tradingSessionId, limit = 20, page = 1 } = req.query;
    const filter = { user: req.user._id };
    if (status) filter.status = status;
    if (outcome) filter.outcome = outcome;
    if (pair) filter.pair = pair.toUpperCase();
    if (tradingSessionId) filter.tradingSessionId = tradingSessionId;

    const trades = await Trade.find(filter)
      .sort({ openedAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await Trade.countDocuments(filter);

    res.json({ trades, total, page: Number(page) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET single trade
exports.getTrade = async (req, res) => {
  try {
    const trade = await Trade.findOne({ 
      _id: req.params.id, 
      user: req.user._id 
    });
    if (!trade) return res.status(404).json({ message: "Trade not found" });
    res.json(trade);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// CREATE trade
exports.createTrade = async (req, res) => {
  try {
    const tradeData = { ...req.body, user: req.user._id };

    // Handle screenshot if uploaded
    if (req.file) {
      tradeData.screenshot = {
        url: req.file.path,
        publicId: req.file.filename,
      };
    }

    const trade = await Trade.create(tradeData);
    ragService.indexTrade(req.user._id, trade).catch((err) =>
      console.error("RAG index trade failed:", err.message)
    );
    // Quick Trade results are created already-closed (win/loss reported in
    // one tap), so a session's progress can move on create, not just update.
    if (trade.tradingSessionId) {
      checkAndUpdateSession(trade.tradingSessionId).catch((err) =>
        console.error("Session limit check failed:", err.message)
      );
    }
    res.status(201).json(trade);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// UPDATE trade
exports.updateTrade = async (req, res) => {
  try {
    const updateData = { ...req.body };

    // Handle screenshot if uploaded (e.g. close-trade snapshot)
    if (req.file) {
      updateData.screenshot = {
        url: req.file.path,
        publicId: req.file.filename,
      };
    }

    const trade = await Trade.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      updateData,
      { new: true, runValidators: true }
    );
    if (!trade) return res.status(404).json({ message: "Trade not found" });
    ragService.indexTrade(req.user._id, trade).catch((err) =>
      console.error("RAG index trade failed:", err.message)
    );
    if (trade.tradingSessionId) {
      checkAndUpdateSession(trade.tradingSessionId).catch((err) =>
        console.error("Session limit check failed:", err.message)
      );
    }
    res.json(trade);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// DELETE trade
exports.deleteTrade = async (req, res) => {
  try {
    const trade = await Trade.findOneAndDelete({ 
      _id: req.params.id, 
      user: req.user._id 
    });
    if (!trade) return res.status(404).json({ message: "Trade not found" });
    ragService.removeTrade(trade._id).catch((err) =>
      console.error("RAG remove trade failed:", err.message)
    );
    res.json({ message: "Trade deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET stats
exports.getStats = async (req, res) => {
  try {
    // Grouped by pair server-side instead of pulling every closed trade
    // into Node and reducing in JS — this scales with distinct pairs, not
    // with trade count.
    const byPair = await Trade.aggregate([
      { $match: { user: req.user._id, status: "closed" } },
      {
        $group: {
          _id: "$pair",
          total: { $sum: 1 },
          wins: { $sum: { $cond: [{ $eq: ["$outcome", "win"] }, 1, 0] } },
          losses: { $sum: { $cond: [{ $eq: ["$outcome", "loss"] }, 1, 0] } },
          pl: { $sum: { $ifNull: ["$profitLoss", 0] } },
        },
      },
    ]);

    const total = byPair.reduce((sum, p) => sum + p.total, 0);
    const wins = byPair.reduce((sum, p) => sum + p.wins, 0);
    const losses = byPair.reduce((sum, p) => sum + p.losses, 0);
    const totalPL = byPair.reduce((sum, p) => sum + p.pl, 0);
    const winRate = total ? ((wins / total) * 100).toFixed(1) : 0;

    const bestPair = byPair.slice().sort((a, b) => b.pl - a.pl)[0]?._id || null;
    const pairMap = Object.fromEntries(
      byPair.map((p) => [p._id, { wins: p.wins, total: p.total, pl: p.pl }])
    );

    res.json({ total, wins, losses, winRate, totalPL, bestPair, pairMap });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};