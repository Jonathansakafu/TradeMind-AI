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
  // Set only when the auto-execute browser extension claims/reports this
  // notification — a "failed"/"unknown" result leaves it unread with
  // botStatus set so it still shows up in the normal manual Won/Lost UI.
  botStatus: {
    type: String,
    enum: ["pending", "claimed", "won", "lost", "failed"],
  },
  botClaimedAt: { type: Date },
  botError: { type: String },
}, { timestamps: true });

module.exports = mongoose.model("Notification", notificationSchema);