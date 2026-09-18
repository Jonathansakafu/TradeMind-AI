const Trade = require("../models/Trade");
const LearnedInsights = require("../models/LearnedInsights");
const claudeAI = require("./claudeAI");

// Below this, "patterns" would just be noise dressed up as insight --
// skip rather than let the AI confidently summarize 3 trades as a trend.
const MIN_TRADES_FOR_LEARNING = 10;

// Refreshed weekly (see cronJobs.js's throttle on User.lastLearningAt),
// but looks back further than just the last 7 days -- most users don't
// close 10+ trades in a single week, so a strict 7-day window would
// starve this of data almost every run. 60 days gives each weekly
// refresh a real, slowly-rolling sample instead.
const LOOKBACK_MS = 60 * 24 * 60 * 60 * 1000;

// A summary older than this is more likely to reflect a market regime or
// habit that's already shifted -- getLearnedSummary drops it rather than
// ground new signals in outdated self-analysis. 2x the refresh interval
// gives one missed weekly cycle of slack before that happens.
const STALE_MS = 14 * 24 * 60 * 60 * 1000;

function buildSummaryText({ patterns, winRate, tradeCount }) {
  const parts = [`Over this trader's last ${tradeCount} closed trades (${winRate}% win rate):`];

  if (patterns.bestSession) parts.push(`Best session: ${patterns.bestSession}.`);
  if (patterns.worstSession) parts.push(`Weakest session: ${patterns.worstSession}.`);

  if (patterns.strongestPairs?.length) {
    const top = patterns.strongestPairs.slice(0, 3).map((p) => `${p.pair} (${p.winRate}% win rate)`);
    parts.push(`Strongest pairs: ${top.join(", ")}.`);
  }
  if (patterns.weakestPairs?.length) {
    const bottom = patterns.weakestPairs.slice(0, 3).map((p) => `${p.pair} (${p.winRate}% win rate)`);
    parts.push(`Weakest pairs: ${bottom.join(", ")}.`);
  }

  const topPatternNames = (patterns.patterns || []).slice(0, 3).map((p) => p.name).filter(Boolean);
  if (topPatternNames.length) parts.push(`Recurring setups: ${topPatternNames.join(", ")}.`);

  const highRiskBehaviors = (patterns.riskBehaviors || [])
    .filter((r) => r.severity !== "low")
    .slice(0, 2)
    .map((r) => r.description)
    .filter(Boolean);
  if (highRiskBehaviors.length) parts.push(`Risk behaviors to avoid repeating: ${highRiskBehaviors.join(" ")}`);

  return parts.join(" ");
}

// Runs the self-learning pass for one user: pulls their recent closed
// trades, reuses the existing detectPatterns analysis (same one shown on
// the Patterns page) to find what's actually been working, and caches a
// compact prompt-ready summary of it. Fire-and-forget from cronJobs.js --
// callers don't await the result beyond logging.
exports.runWeeklyLearningForUser = async (userId) => {
  const periodStart = new Date(Date.now() - LOOKBACK_MS);
  const periodEnd = new Date();

  const trades = await Trade.find({
    user: userId,
    status: "closed",
    closedAt: { $gte: periodStart, $lte: periodEnd },
  }).lean();

  if (trades.length < MIN_TRADES_FOR_LEARNING) {
    console.log(`Learning pass skipped for user ${userId}: only ${trades.length} closed trades in the last 60 days (need ${MIN_TRADES_FOR_LEARNING}+).`);
    return null;
  }

  const patterns = await claudeAI.detectPatterns(trades);
  const wins = trades.filter((t) => t.outcome === "win").length;
  const winRate = Math.round((wins / trades.length) * 100);
  const summary = buildSummaryText({ patterns, winRate, tradeCount: trades.length });

  await LearnedInsights.findOneAndUpdate(
    { user: userId },
    { user: userId, periodStart, periodEnd, tradeCount: trades.length, winRate, summary, generatedAt: new Date() },
    { upsert: true }
  );

  console.log(`Learning pass complete for user ${userId}: ${trades.length} trades, ${winRate}% win rate.`);
  return summary;
};

// Cheap read of the latest cached summary -- called once per generation
// cycle (not per pair), same usage pattern as ragService.getBookConceptSummary.
exports.getLearnedSummary = async (userId) => {
  if (!userId) return "";
  const insights = await LearnedInsights.findOne({ user: userId }).lean();
  if (!insights) return "";
  if (Date.now() - insights.generatedAt.getTime() > STALE_MS) return "";
  return `\nWhat's actually been working for this trader recently (apply these patterns where relevant to the current setup):\n${insights.summary}`;
};
