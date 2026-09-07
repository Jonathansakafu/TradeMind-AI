const Trade = require("../models/Trade");
const ragService = require("./ragService");
const { computeMomentum } = require("./marketAnalysis");

// One place that gathers every fused context source (uploaded-book
// concepts, RAG-retrieved chunks — including the trader's own past chart
// screenshots — price-action momentum, and this specific pair's own
// recent trade history) so every signal/analysis/answer path builds its
// context the same way instead of each hand-rolling its own subset.
exports.buildContext = async (userId, {
  pair,
  historicalCandles,
  ragQuery,
  ragSources = ["book", "trade", "screenshot"],
  ragTopK = 6,
  pairTradeLimit = 5,
  includeRag = true,
} = {}) => {
  const [bookSummary, retrievedChunks, pairTrades] = await Promise.all([
    ragService.getBookConceptSummary(userId),
    includeRag && ragQuery
      ? ragService.retrieve(userId, ragQuery, { topK: ragTopK, sources: ragSources })
      : Promise.resolve([]),
    pair
      ? Trade.find({ user: userId, pair }).sort({ openedAt: -1 }).limit(pairTradeLimit)
      : Promise.resolve([]),
  ]);

  const momentum = historicalCandles ? computeMomentum(historicalCandles) : null;

  return { bookSummary, retrievedChunks, momentum, pairTrades };
};
