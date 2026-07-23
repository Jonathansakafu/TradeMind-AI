const mongoose = require("mongoose");

const documentChunkSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    source: {
      type: String,
      enum: ["book", "trade"],
      required: true,
    },
    sourceId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    label: { type: String },
    text: { type: String, required: true },
    embedding: { type: [Number], required: true },
    chunkIndex: { type: Number, default: 0 },
  },
  { timestamps: true }
);

documentChunkSchema.index({ user: 1, source: 1 });
documentChunkSchema.index({ sourceId: 1 });

module.exports = mongoose.model("DocumentChunk", documentChunkSchema);
