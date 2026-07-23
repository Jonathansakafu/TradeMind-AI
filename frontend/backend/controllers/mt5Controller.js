const MT5Signal = require("../models/MT5Signal");
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
    const signals = await MT5Signal.find({ user: req.user._id });
    const executed = signals.filter((s) => s.status === "executed").length;
    const pending = signals.filter((s) => s.status === "pending" || s.status === "sent").length;
    const failed = signals.filter((s) => s.status === "failed").length;
    res.json({ total: signals.length, executed, pending, failed });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};