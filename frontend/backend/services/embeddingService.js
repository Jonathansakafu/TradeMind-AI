const path = require("path");

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
const EMBEDDING_DIMS = 384;

let extractorPromise = null;

const getExtractor = () => {
  if (!extractorPromise) {
    extractorPromise = import("@xenova/transformers").then(({ pipeline, env }) => {
      env.cacheDir = path.join(__dirname, "..", ".model-cache");
      return pipeline("feature-extraction", MODEL_NAME);
    });
  }
  return extractorPromise;
};

// Mean-pooled, L2-normalized embedding — ready for cosine similarity / dot-product search
const embed = async (text) => {
  const extractor = await getExtractor();
  const output = await extractor(String(text || "").slice(0, 8000), {
    pooling: "mean",
    normalize: true,
  });
  return Array.from(output.data);
};

// Node is single-threaded for JS execution -- back-to-back CPU-bound
// inference calls with nothing awaited in between can starve the event
// loop, leaving the whole server unable to handle any other request
// (including ones with nothing to do with this batch) until the batch
// finishes. Yielding via setImmediate after each embedding lets pending
// I/O/requests get a turn before the next one starts.
const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));

const embedBatch = async (texts) => {
  const results = [];
  for (const text of texts) {
    results.push(await embed(text));
    await yieldToEventLoop();
  }
  return results;
};

module.exports = { embed, embedBatch, EMBEDDING_DIMS, MODEL_NAME };
