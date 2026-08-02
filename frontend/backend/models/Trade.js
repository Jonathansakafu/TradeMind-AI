const mongoose = require("mongoose");

const tradeSchema = new mongoose.Schema({
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User", 
    required: true 
  },
  pair: { 
    type: String, 
    required: true, 
    uppercase: true 
  },
  direction: {
    type: String,
    enum: ["buy", "sell"],
    required: true
  },
  type: {
    type: String,
    enum: ["forex", "quick_trade"],
    default: "forex",
  },
  tradingSessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "TradingSession",
  },
  entryPrice: { type: Number, required: true },
  exitPrice: { type: Number },
  stopLoss: { type: Number },
  takeProfit: { type: Number },
  lotSize: {
    type: Number,
    required: function () { return this.type !== "quick_trade"; },
    default: 0,
  },
  session: { 
    type: String, 
    enum: ["london", "new_york", "tokyo", "sydney", "overlap"] 
  },
  setup: { type: String },
  status: { 
    type: String, 
    enum: ["open", "closed"], 
    default: "open" 
  },
  outcome: { 
    type: String, 
    enum: ["win", "loss", "breakeven"] 
  },
  profitLoss: { type: Number, default: 0 },
  screenshot: {
    url: { type: String },
    publicId: { type: String },
  },
  notes: { type: String },
  openedAt: { type: Date, default: Date.now },
  closedAt: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model("Trade", tradeSchema);