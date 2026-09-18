const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
    },

    password: {
      type: String,
      required: true,
    },

    resetPasswordToken: {
      type: String,
      select: false,
    },

    resetPasswordExpires: {
      type: Date,
      select: false,
    },

    // Tracks when this user's own signal generation (forex/MT5 -- Quick
    // Trade has its own equivalent on TradingSession, tied to the
    // extension's poll) was last triggered from the app's own
    // getNotifications poll (see notificationController.js). Not tied to
    // any specific session, since generation should run for a user with
    // no active session too -- the external cron stays as a backup for
    // whenever nobody has the app open at all.
    lastAutoGenAt: {
      type: Date,
    },

    // Throttles the weekly self-learning pass (services/learningService.js)
    // the same way lastAutoGenAt throttles signal generation -- checked
    // opportunistically on every runAutoGenerateForAllUsers cycle rather
    // than relying on a dedicated cron, since that pattern already proved
    // more reliable than GitHub Actions scheduling on this app's free tier.
    lastLearningAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("User", userSchema);