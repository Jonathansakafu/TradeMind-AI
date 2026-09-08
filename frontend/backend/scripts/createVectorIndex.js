const { MongoClient } = require("mongodb");
const { VECTOR_INDEX_NAME } = require("../services/ragService");
const { EMBEDDING_DIMS } = require("../services/embeddingService");

// `source` is a filter field (not just `user`) so ragService can filter by
// source *inside* the $vectorSearch pre-filter stage instead of narrowing
// results with a $match afterward — a document scoped by user but ranked
// against candidates from every source could otherwise have its "book"
// chunks crowded out of the top-N by a user's much more numerous "trade"
// chunks before the source filter ever got a chance to apply.
const INDEX_DEFINITION = {
  fields: [
    { type: "vector", path: "embedding", numDimensions: EMBEDDING_DIMS, similarity: "cosine" },
    { type: "filter", path: "user" },
    { type: "filter", path: "source" },
  ],
};

const ensureVectorIndex = async () => {
  const client = new MongoClient(process.env.MONGO_URI);
  try {
    await client.connect();
    const collection = client.db().collection("documentchunks");

    const existing = await collection.listSearchIndexes().toArray().catch(() => []);
    const current = existing.find((idx) => idx.name === VECTOR_INDEX_NAME);
    if (current) {
      // Update in place if an older deploy created this index before the
      // `source` filter field existed — recreating a whole search index
      // just to add a field would drop query availability while it rebuilds.
      const hasSourceFilter = current.latestDefinition?.fields?.some(
        (f) => f.type === "filter" && f.path === "source"
      );
      if (!hasSourceFilter) {
        await collection.updateSearchIndex(VECTOR_INDEX_NAME, INDEX_DEFINITION);
        console.log("Atlas vector search index definition updated (added `source` filter field)");
      } else {
        console.log("Atlas vector search index already exists and is up to date");
      }
      return;
    }

    await collection.createSearchIndex({
      name: VECTOR_INDEX_NAME,
      type: "vectorSearch",
      definition: INDEX_DEFINITION,
    });
    console.log("Atlas vector search index creation requested (can take a minute to finish building)");
  } catch (err) {
    console.warn("Could not create/update Atlas vector search index — RAG will use the in-app fallback search instead:", err.message);
  } finally {
    await client.close();
  }
};

module.exports = { ensureVectorIndex };

if (require.main === module) {
  require("dotenv").config();
  ensureVectorIndex().then(() => process.exit(0));
}
