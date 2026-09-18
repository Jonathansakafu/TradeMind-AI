const User = require("../models/User");
const { autoGenerate } = require("../controllers/notificationController");
const { runWeeklyLearningForUser } = require("./learningService");
const { extractSkillKnowledgeFromNews } = require("./newsKnowledgeService");

// Checked on every cycle (see below) but only actually fires about once a
// week per user -- same self-throttling pattern as autoGenerate's own
// lastAutoGenAt, chosen over a dedicated weekly cron for the same reason:
// piggybacking on this already-frequent, already-reliable cycle proved
// more dependable than GitHub Actions scheduling on this app's free tier.
const LEARNING_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

// Runs autoGenerate for every user, with a pause between each so the
// AI/market-data API calls don't all fire in the same instant. Shared by
// server.js's own in-process setInterval (works fine whenever the server
// happens to already be awake) and the external cron endpoint (routes/
// cronRoutes.js) that exists specifically because Render's free tier
// suspends the whole process -- including in-process timers -- after
// ~15 minutes with no incoming request, so that setInterval alone can't
// be relied on to fire on schedule while nothing else is hitting the app.
async function runAutoGenerateForAllUsers() {
  const users = await User.find({}).select("_id lastLearningAt");
  if (users.length === 0) {
    console.log("No users found — skipping auto-generate");
    return { userCount: 0 };
  }
  console.log(`🔔 Auto-generating for ${users.length} user(s)...`);

  // Global, not per-user -- runs once a cycle regardless of user count.
  // No separate throttle needed here: getTradingSkillNews's own 1h cache
  // bounds the real external cost, so calling this every cycle is safe.
  extractSkillKnowledgeFromNews().catch((err) =>
    console.error("News skill-knowledge extraction failed:", err.message)
  );

  for (const user of users) {
    await autoGenerate(user._id);

    const dueForLearning = !user.lastLearningAt
      || Date.now() - user.lastLearningAt.getTime() > LEARNING_INTERVAL_MS;
    if (dueForLearning) {
      // Saved before the (unawaited) run so an overlapping cycle within
      // the same window doesn't also see this user as due and double-fire.
      user.lastLearningAt = new Date();
      await user.save();
      runWeeklyLearningForUser(user._id).catch((err) =>
        console.error(`Weekly learning failed for user ${user._id}:`, err.message)
      );
    }

    // Pumzika sekunde 5 kati ya users
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  console.log("✅ Auto-generate complete");
  return { userCount: users.length };
}

module.exports = { runAutoGenerateForAllUsers };
