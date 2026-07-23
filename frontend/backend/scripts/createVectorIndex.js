const { MongoClient } = require("mongodb");
const { VECTOR_INDEX_NAME } = require("../services/ragService");
const { EMBEDDING_DIMS } = require("../services/embeddingService");

const ensureVectorIndex = async () => {
  const client = new MongoClient(process.env.MONGO_URI);
  try {
    await client.connect();
    const collection = client.db().collection("documentchunks");

    const existing = await collection.listSearchIndexes().toArray().catch(() => []);
    if (existing.some((idx) => idx.name === VECTOR_INDEX_NAME)) {
      console.log("Atlas vector search index already exists");
      return;
    }

    await collection.createSearchIndex({
      name: VECTOR_INDEX_NAME,
      type: "vectorSearch",
      definition: {
        fields: [
          { type: "vector", path: "embedding", numDimensions: EMBEDDING_DIMS, similarity: "cosine" },
          { type: "filter", path: "user" },
        ],
      },
    });
    console.log("Atlas vector search index creation requested (can take a minute to finish building)");
  } catch (err) {
    console.warn("Could not create Atlas vector search index — RAG will use the in-app fallback search instead:", err.message);
  } finally {
    await client.close();
  }
};

module.exports = { ensureVectorIndex };

if (require.main === module) {
  require("dotenv").config();
  ensureVectorIndex().then(() => process.exit(0));
}
