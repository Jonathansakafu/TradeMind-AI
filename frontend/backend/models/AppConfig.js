const mongoose = require("mongoose");

// Small key/value store for server-generated settings that must survive
// restarts/redeploys but aren't worth a manual Render env var -- e.g. the
// Web Push VAPID key pair (see services/notifyDispatcher.js), which only
// needs to be generated once and then stay stable forever, since every
// existing browser subscription is bound to the public key it was made with.
const appConfigSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

module.exports = mongoose.model("AppConfig", appConfigSchema);
