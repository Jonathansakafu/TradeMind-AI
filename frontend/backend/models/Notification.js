const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  pair: { type: String },
  signal: { type: String, enum: ["buy", "sell", "wait"] },
  entry: { type: Number },
  stopLoss: { type: Number },
  takeProfit: { type: Number },
  reasoning: { type: String },
  confidence: { type: Number },
  source: {
    type: String,
    enum: ["past_trades", "books", "ai_auto"],
    default: "ai_auto",
  },
  sourceLabel: { type: String },
  read: { type: Boolean, default: false },
  type: {
    type: String,
    enum: ["forex", "quick_trade"],
    default: "forex",
  },
  expiresInMinutes: { type: Number },
  tradingSessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "TradingSession",
  },
}, { timestamps: true });

module.exports = mongoose.model("Notification", notificationSchema);