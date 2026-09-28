const User = require("../models/User");
const { autoGenerate } = require("../controllers/notificationController");
const { runWeeklyLearningForUser } = require("./learningService");
const { extractSkillKnowledgeFromNews } = require("./newsKnowledgeService");
const pipelineStats = require("./pipelineStats");

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
// A full cycle takes minutes (~3.5 min for 8 users, observed live), and it
// can be started by the in-process interval, the external cron endpoint,
// or both at once -- overlapping runs would just double the Groq calls
// and dedup-race each other. Later callers skip while one is in flight.
let running = false;

async function runAutoGenerateForAllUsers() {
  if (running) {
    console.log("⏭ Auto-generate already running — skipping this trigger");
    return { skipped: true, reason: "already_running" };
  }
  running = true;
  try {
    return await runCycle();
  } finally {
    running = false;
  }
}

function isAutoGenerateRunning() {
  return running;
}

async function runCycle() {
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

  const startedAt = new Date();
  const reasons = {};
  let created = 0;
  for (const user of users) {
    const { count, reason } = await autoGenerate(user._id);
    created += count || 0;
    // Error text is truncated so the health report groups identical
    // failures together instead of listing one line per user.
    const key = count > 0 ? "created" : (reason || "unknown").slice(0, 120);
    reasons[key] = (reasons[key] || 0) + 1;

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
  pipelineStats.inc("cycles.completed");
  pipelineStats.setLastCycle({ startedAt, finishedAt: new Date(), userCount: users.length, created, reasons });
  console.log("✅ Auto-generate complete");
  return { userCount: users.length };
}

module.exports = { runAutoGenerateForAllUsers, isAutoGenerateRunning };
