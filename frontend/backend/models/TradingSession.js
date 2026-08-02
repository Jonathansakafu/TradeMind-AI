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

    accountType: {
      type: String,
      enum: ["demo", "real"],
      default: "demo",
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

    // Quick Trade + demo only — lets the browser extension auto-execute
    // signals instead of the trader tapping Won/Lost manually. botToken is
    // only ever set when mode/accountType/autoExecute all agree it's safe.
    autoExecute: {
      type: Boolean,
      default: false,
    },

    botToken: {
      type: String,
    },

    botTokenCreatedAt: {
      type: Date,
    },

    botLastPolledAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("TradingSession", tradingSessionSchema);
