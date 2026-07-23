const mongoose = require("mongoose");

const documentChunkSchema = new mongoose.Schema(
  {
    // Absent for shared/global content (e.g. the "guide" source), which
    // every user can retrieve regardless of who's asking.
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    source: {
      type: String,
      enum: ["book", "trade", "guide"],
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
