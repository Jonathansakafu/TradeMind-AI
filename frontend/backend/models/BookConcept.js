const mongoose = require("mongoose");

const bookConceptSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  bookName: { type: String, required: true },
  concepts: [String],
  strategies: [String],
  rules: [String],
  rawSummary: { type: String },
}, { timestamps: true });

module.exports = mongoose.model("BookConcept", bookConceptSchema);