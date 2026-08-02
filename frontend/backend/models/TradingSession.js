const mongoose = require("mongoose");

const tradingSessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    mode: {
      type: String,
      enum: ["mt5", "quick_trade"],
      required: true,
    },

    profitTarget: {
      type: Number,
      required: true,
    },

    riskLimit: {
      type: Number,
      required: true,
    },

    maxTrades: {
      type: Number,
      required: true,
    },

    pairs: {
      type: [String],
      default: [],
    },

    // Quick Trade only — lets Won/Lost be a single tap instead of asking
    // for the exact amount every time.
    stake: {
      type: Number,
    },

    payoutPercent: {
      type: Number,
    },

    status: {
      type: String,
      enum: ["active", "stopped_profit", "stopped_risk", "stopped_trades", "stopped_manual"],
      default: "active",
    },

    startedAt: {
      type: Date,
      default: Date.now,
    },

    endedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("TradingSession", tradingSessionSchema);
