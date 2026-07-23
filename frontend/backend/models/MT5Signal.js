const mongoose = require("mongoose");

const mt5SignalSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  pair: { type: String, required: true },
  action: { type: String, enum: ["buy", "sell"], required: true },
  accountType: { type: String, enum: ["demo", "real"], default: "demo" },
  entry: { type: Number, required: true },
  stopLoss: { type: Number },
  takeProfit: { type: Number },
  lotSize: { type: Number, default: 0.01 },
  confidence: { type: Number },
  source: { type: String },
  sourceLabel: { type: String },
  reasoning: { type: String },
  status: {
    type: String,
    enum: ["pending", "sent", "executed", "failed", "cancelled"],
    default: "pending",
  },
  mt5Response: { type: String },
  executedAt: { type: Date },
  token: { type: String }, // unique token for MT5 to verify
}, { timestamps: true });

module.exports = mongoose.model("MT5Signal", mt5SignalSchema);