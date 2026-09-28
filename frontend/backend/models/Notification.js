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
    enum: ["past_trades", "books", "ai_auto", "tradingview", "news_impact"],
    default: "ai_auto",
  },
  sourceLabel: { type: String },
  // Set by a second, independent LLM pass that checks the signal's own
  // reasoning against the same context it was generated from (see
  // claudeAI.js's verifySignal) -- null means verification wasn't run or
  // itself failed (e.g. a rate limit), which is deliberately distinct from
  // false (the check ran and found a real problem).
  verified: { type: Boolean, default: null },
  verificationNote: { type: String },
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
  // "win"/"loss" (not "won"/"lost") to match both the outcome value the
  // quick-trade-bot controller actually sets this to, and Trade.outcome's
  // own enum, for consistency.
  botStatus: {
    type: String,
    enum: ["pending", "claimed", "win", "loss", "failed"],
  },
  botClaimedAt: { type: Date },
  botError: { type: String },
}, { timestamps: true });

notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ pair: 1, type: 1, createdAt: -1 });
notificationSchema.index({ tradingSessionId: 1, botStatus: 1 });

// Push/email the trader for every newly created notification (not on
// later saves like marking read or a bot status update). Hooked here
// rather than at each Notification.create call site so a new creation
// path can't forget it. Fire-and-forget: delivery must never slow down
// or fail signal generation.
notificationSchema.pre("save", function () {
  this.$locals.wasNew = this.isNew;
});
notificationSchema.post("save", function (doc) {
  if (!doc.$locals.wasNew) return;
  // Required lazily -- notifyDispatcher pulls in User/AppConfig/Resend,
  // none of which this model should load just to be defined.
  require("../services/notifyDispatcher").dispatchNotification(doc)
    .catch((err) => console.error("Notification dispatch failed:", err.message));
});

module.exports = mongoose.model("Notification", notificationSchema);