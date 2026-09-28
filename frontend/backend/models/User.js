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

    // Identifies this user on incoming TradingView webhook alerts, which
    // carry no auth header of their own -- the user pastes this token
    // into their own alert's JSON message body, and the webhook looks
    // the user up by it instead of a JWT. select:false since it's a
    // standing credential (like a password), not exposed on normal user
    // reads. Generated lazily on first request rather than at signup, so
    // existing accounts don't need a migration.
    tradingViewToken: {
      type: String,
      select: false,
    },

    // Out-of-app delivery for new notifications (see
    // services/notifyDispatcher.js). Push is on by default but does
    // nothing until a device actually registers below; email is opt-in
    // since Resend's free tier caps at 100 emails/day across the whole
    // app (password resets included), and signal volume can exceed that.
    notificationPrefs: {
      push: { type: Boolean, default: true },
      email: { type: Boolean, default: false },
      // Only signals at or above this confidence go out by email --
      // push has no such floor since it has no daily quota.
      emailMinConfidence: { type: Number, default: 70 },
    },

    // Per-user daily email counter backing EMAIL_DAILY_CAP in
    // notifyDispatcher.js -- keeps one busy user from burning through
    // Resend's app-wide daily quota.
    emailSentDate: { type: String },
    emailSentCount: { type: Number, default: 0 },

    // Browser Web Push subscriptions (one per browser/device the user
    // enabled alerts on). select:false -- these are delivery credentials,
    // and protect() loads the full user on every request.
    pushSubscriptions: {
      type: [{
        endpoint: { type: String, required: true },
        keys: { p256dh: String, auth: String },
        createdAt: { type: Date, default: Date.now },
      }],
      select: false,
    },

    // Firebase Cloud Messaging registration tokens from the Android app.
    fcmTokens: {
      type: [String],
      select: false,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("User", userSchema);