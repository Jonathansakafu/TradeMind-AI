const Trade = require("../models/Trade");
const ragService = require("../services/ragService");

// GET all trades
exports.getTrades = async (req, res) => {
  try {
    const { status, outcome, pair, limit = 20, page = 1 } = req.query;
    const filter = { user: req.user._id };
    if (status) filter.status = status;
    if (outcome) filter.outcome = outcome;
    if (pair) filter.pair = pair.toUpperCase();

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
    res.status(201).json(trade);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// UPDATE trade
exports.updateTrade = async (req, res) => {
  try {
    const trade = await Trade.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      req.body,
      { new: true, runValidators: true }
    );
    if (!trade) return res.status(404).json({ message: "Trade not found" });
    ragService.indexTrade(req.user._id, trade).catch((err) =>
      console.error("RAG index trade failed:", err.message)
    );
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
    const trades = await Trade.find({ 
      user: req.user._id, 
      status: "closed" 
    });

    const wins = trades.filter((t) => t.outcome === "win").length;
    const losses = trades.filter((t) => t.outcome === "loss").length;
    const totalPL = trades.reduce((sum, t) => sum + (t.profitLoss || 0), 0);
    const winRate = trades.length 
      ? ((wins / trades.length) * 100).toFixed(1) 
      : 0;

    // Best pair
    const pairMap = {};
    trades.forEach((t) => {
      if (!pairMap[t.pair]) pairMap[t.pair] = { wins: 0, total: 0, pl: 0 };
      pairMap[t.pair].total++;
      pairMap[t.pair].pl += t.profitLoss || 0;
      if (t.outcome === "win") pairMap[t.pair].wins++;
    });

    const bestPair = Object.entries(pairMap)
      .sort((a, b) => b[1].pl - a[1].pl)[0]?.[0] || null;

    res.json({ total: trades.length, wins, losses, winRate, totalPL, bestPair, pairMap });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};