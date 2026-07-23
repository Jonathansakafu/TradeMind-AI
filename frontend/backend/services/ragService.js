const mongoose = require("mongoose");
const DocumentChunk = require("../models/DocumentChunk");
const { chunkText } = require("../utils/chunkText");
const embeddingService = require("./embeddingService");

const VECTOR_INDEX_NAME = "vector_index";
const MAX_CHUNKS_PER_BOOK = 400;

// Cached after the first attempt so we don't retry a doomed $vectorSearch
// call on every single retrieval once we know the cluster/index can't do it.
let vectorSearchAvailable = null;

const cosineSimilarity = (a, b) => {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

const tradeToText = (trade) => {
  const parts = [
    `${trade.pair} ${trade.direction ? trade.direction.toUpperCase() : ""} trade`.trim(),
    trade.session ? `session: ${trade.session}` : null,
    trade.setup ? `setup: ${trade.setup}` : null,
    `entry ${trade.entryPrice}`,
    trade.exitPrice != null ? `exit ${trade.exitPrice}` : null,
    trade.stopLoss != null ? `stop loss ${trade.stopLoss}` : null,
    trade.takeProfit != null ? `take profit ${trade.takeProfit}` : null,
    trade.outcome ? `outcome: ${trade.outcome}` : null,
    trade.profitLoss != null ? `P&L ${trade.profitLoss}` : null,
    trade.notes ? `notes: ${trade.notes}` : null,
  ].filter(Boolean);
  return parts.join(", ");
};

// ---- Indexing ----

exports.indexBookChunks = async (userId, bookConceptId, bookName, rawText) => {
  await DocumentChunk.deleteMany({ sourceId: bookConceptId, source: "book" });

  const pieces = chunkText(rawText, { chunkSize: 900, overlap: 150 }).slice(0, MAX_CHUNKS_PER_BOOK);
  if (pieces.length === 0) return 0;

  const embeddings = await embeddingService.embedBatch(pieces);
  const docs = pieces.map((text, i) => ({
    user: userId,
    source: "book",
    sourceId: bookConceptId,
    label: bookName,
    text,
    embedding: embeddings[i],
    chunkIndex: i,
  }));

  await DocumentChunk.insertMany(docs);
  return docs.length;
};

exports.removeBookChunks = async (bookConceptId) => {
  await DocumentChunk.deleteMany({ sourceId: bookConceptId, source: "book" });
};

exports.indexTrade = async (userId, trade) => {
  const text = tradeToText(trade);
  const embedding = await embeddingService.embed(text);
  await DocumentChunk.findOneAndUpdate(
    { sourceId: trade._id, source: "trade" },
    {
      user: userId,
      source: "trade",
      sourceId: trade._id,
      label: `${trade.pair} ${trade.direction} (${trade.status})`,
      text,
      embedding,
      chunkIndex: 0,
    },
    { upsert: true }
  );
};

exports.removeTrade = async (tradeId) => {
  await DocumentChunk.deleteMany({ sourceId: tradeId, source: "trade" });
};

// ---- Retrieval ----

const bruteForceSearch = async (userId, queryEmbedding, { topK, sources }) => {
  const chunks = await DocumentChunk.find({
    user: userId,
    source: { $in: sources },
  }).lean();

  return chunks
    .map((c) => ({ ...c, score: cosineSimilarity(c.embedding, queryEmbedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
};

exports.retrieve = async (userId, queryText, { topK = 6, sources = ["book", "trade"] } = {}) => {
  if (!queryText || !queryText.trim()) return [];
  const queryEmbedding = await embeddingService.embed(queryText);

  if (vectorSearchAvailable !== false) {
    try {
      const results = await DocumentChunk.aggregate([
        {
          $vectorSearch: {
            index: VECTOR_INDEX_NAME,
            path: "embedding",
            queryVector: queryEmbedding,
            numCandidates: Math.max(100, topK * 20),
            limit: topK * 3,
            filter: { user: new mongoose.Types.ObjectId(userId) },
          },
        },
        { $match: { source: { $in: sources } } },
        { $limit: topK },
        {
          $project: {
            text: 1,
            label: 1,
            source: 1,
            sourceId: 1,
            score: { $meta: "vectorSearchScore" },
          },
        },
      ]);
      vectorSearchAvailable = true;
      return results;
    } catch (err) {
      vectorSearchAvailable = false;
      console.warn("Atlas vector search unavailable, using in-app cosine similarity fallback:", err.message);
    }
  }

  return bruteForceSearch(userId, queryEmbedding, { topK, sources });
};

exports.formatContext = (chunks) => {
  if (!chunks || chunks.length === 0) return "";
  return `\nRetrieved context — ground your answer in this and cite sources by label:\n${chunks
    .map((c) => `[Source: ${c.label || c.source}]\n${c.text}`)
    .join("\n\n")}`;
};

exports.VECTOR_INDEX_NAME = VECTOR_INDEX_NAME;
