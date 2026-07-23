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

const embedBatch = async (texts) => {
  const results = [];
  for (const text of texts) {
    results.push(await embed(text));
  }
  return results;
};

module.exports = { embed, embedBatch, EMBEDDING_DIMS, MODEL_NAME };
