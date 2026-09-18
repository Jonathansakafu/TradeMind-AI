const mongoose = require("mongoose");

const bookConceptSchema = new mongoose.Schema({
  // Optional: entries the app extracts automatically from trading-strategy
  // news (see services/newsKnowledgeService.js) are global/shared across
  // every user -- unset here, the same way the RAG "guide" source is
  // unscoped -- rather than tied to one owner. Only user-uploaded books
  // have a real user.
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  bookName: { type: String, required: true },
  concepts: [String],
  strategies: [String],
  rules: [String],
  rawSummary: { type: String },
}, { timestamps: true });

module.exports = mongoose.model("BookConcept", bookConceptSchema);