const mongoose = require("mongoose");

const analysisSchema = new mongoose.Schema({
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User", 
    required: true 
  },
  trade: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Trade" 
  },
  type: { 
    type: String, 
    enum: ["trade", "pattern", "suggestion", "document"], 
    required: true 
  },
  response: { type: String, required: true },
  patterns: [{ name: String, description: String, confidence: Number }],
  riskFlags: [{ type: String, severity: String, message: String }],
  suggestions: [String],
  bestSession: String,
  strongestPairs: [{ pair: String, winRate: Number, avgPnl: Number }],
}, { timestamps: true });

module.exports = mongoose.model("Analysis", analysisSchema);