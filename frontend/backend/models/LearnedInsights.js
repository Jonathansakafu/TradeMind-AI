const mongoose = require("mongoose");

// One document per user, refreshed weekly by learningService.js. Kept as
// a single upserted doc (not a growing history) since only the latest
// summary is ever read back into prompt context -- a trend view over
// past runs isn't needed yet and can be added later without changing
// this shape if it is.
const learnedInsightsSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    tradeCount: { type: Number, required: true },
    winRate: { type: Number, required: true },
    summary: { type: String, required: true },
    generatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("LearnedInsights", learnedInsightsSchema);
