const User = require("../models/User");
const { autoGenerate } = require("../controllers/notificationController");

// Runs autoGenerate for every user, with a pause between each so the
// AI/market-data API calls don't all fire in the same instant. Shared by
// server.js's own in-process setInterval (works fine whenever the server
// happens to already be awake) and the external cron endpoint (routes/
// cronRoutes.js) that exists specifically because Render's free tier
// suspends the whole process -- including in-process timers -- after
// ~15 minutes with no incoming request, so that setInterval alone can't
// be relied on to fire on schedule while nothing else is hitting the app.
async function runAutoGenerateForAllUsers() {
  const users = await User.find({}).select("_id");
  if (users.length === 0) {
    console.log("No users found — skipping auto-generate");
    return { userCount: 0 };
  }
  console.log(`🔔 Auto-generating for ${users.length} user(s)...`);
  for (const user of users) {
    await autoGenerate(user._id);
    // Pumzika sekunde 5 kati ya users
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  console.log("✅ Auto-generate complete");
  return { userCount: users.length };
}

module.exports = { runAutoGenerateForAllUsers };
