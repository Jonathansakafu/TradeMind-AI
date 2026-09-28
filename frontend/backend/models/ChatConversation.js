const mongoose = require("mongoose");

// Saved Ask AI conversations. Before this, chat lived only in React state:
// leaving the page (or the app being killed) lost it, and the AI never saw
// earlier messages, so follow-up questions had no context.
const chatMessageSchema = new mongoose.Schema({
  role: { type: String, enum: ["user", "assistant"], required: true },
  content: { type: String, default: "" },
  sources: { type: [mongoose.Schema.Types.Mixed], default: undefined },
  // Set when the answer stream ended early (connection dropped) -- the
  // partial text is kept rather than lost.
  incomplete: { type: Boolean },
}, { _id: false, timestamps: { createdAt: true, updatedAt: false } });

const chatConversationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  title: { type: String, default: "New chat" },
  messages: { type: [chatMessageSchema], default: [] },
}, { timestamps: true });

chatConversationSchema.index({ user: 1, updatedAt: -1 });

module.exports = mongoose.model("ChatConversation", chatConversationSchema);
