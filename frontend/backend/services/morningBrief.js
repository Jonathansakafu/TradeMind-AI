// Daily pre-London brief ("daily AI routine" step of the AI trading
// workflow, added 2026-10): on weekdays from 04:00 UTC (07:00 Tanzania),
// once per day, the first generation cycle builds a short plan for
// EURUSD / GBPUSD / XAUUSD -- trend + key levels (computed, no AI) and
// today's high-impact news, worded by one AI call -- saves it (shown on the
// Dashboard) and sends it to every user via push / email.
const AppConfig = require("../models/AppConfig");
const User = require("../models/User");
const marketService = require("./marketService");
const marketContext = require("./marketContext");
const economicCalendar = require("./economicCalendar");
const claudeAI = require("./claudeAI");
const { dispatchMessage } = require("./notifyDispatcher");

const PAIRS = ["EURUSD", "GBPUSD", "XAUUSD"];
const START_HOUR_UTC = 4;
const END_HOUR_UTC = 10; // don't send a "morning" brief after this

async function buildBrief(now = new Date()) {
  const prices = await marketService.getAllPrices();
  const lines = [];
  for (const pair of PAIRS) {
    const px = prices[pair];
    if (!px) continue;
    try {
      const ctx = await marketContext.getMarketContext(pair, px);
      const f = (n) => Number(n).toFixed(px >= 100 ? 2 : 5);
      lines.push(`${pair} ${f(px)}: 4H ${ctx.h4.trend}, 1H ${ctx.h1.trend}; support ${ctx.levels.supports.slice(0, 2).map((l) => f(l.price)).join(" / ") || "-"}; resistance ${ctx.levels.resistances.slice(0, 2).map((l) => f(l.price)).join(" / ") || "-"}`);
    } catch (err) {
      lines.push(`${pair} ${px}: structure unavailable (${err.message})`);
    }
  }
  const events = (await economicCalendar.getHighImpactEvents()) || [];
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
  const today = events
    .filter((e) => e.time >= dayStart && e.time < dayEnd && ["USD", "EUR", "GBP"].includes(e.currency))
    .map((e) => `${e.time.toISOString().slice(11, 16)} UTC ${e.currency} ${e.title}`);
  const facts = [...lines, `High-impact news today: ${today.length ? today.join("; ") : "none"}`].join("\n");

  let plan = null;
  try {
    plan = await claudeAI.writeMorningBrief(facts);
  } catch (err) {
    console.error("Morning brief AI wording failed:", err.message);
  }
  // Without the AI the computed facts are still useful on their own.
  return { facts, text: plan || facts, today };
}

exports.maybeSendMorningBrief = async (now = new Date()) => {
  const day = now.getUTCDay(), hour = now.getUTCHours();
  if (day === 0 || day === 6 || hour < START_HOUR_UTC || hour >= END_HOUR_UTC) return null;
  const date = now.toISOString().slice(0, 10);
  // Claim today's slot first so overlapping cycles can't send it twice.
  const claimed = await AppConfig.findOneAndUpdate(
    { key: "morningBrief", "value.date": { $ne: date } },
    { $set: { "value.date": date, "value.status": "building" } },
    { upsert: false, returnDocument: "after" }
  ).catch(() => null) || await AppConfig.create({ key: "morningBrief", value: { date, status: "building" } }).catch(() => null);
  if (!claimed) return null;

  const brief = await buildBrief(now);
  await AppConfig.updateOne({ key: "morningBrief" }, {
    $set: { value: { date, status: "sent", text: brief.text, facts: brief.facts, createdAt: now } },
  });
  const users = await User.find({}).select("_id");
  const title = `📅 TradeMind plan for ${date}`;
  const body = brief.text.split("\n").slice(0, 3).join("\n");
  for (const u of users) {
    await dispatchMessage(u._id, { title, body, text: brief.text, url: "/dashboard", id: `brief-${date}` })
      .catch((err) => console.error("Brief delivery failed:", err.message));
  }
  console.log(`📅 Morning brief sent to ${users.length} user(s)`);
  return brief;
};

exports.getLatestBrief = async () => (await AppConfig.findOne({ key: "morningBrief" }))?.value || null;
exports.buildBrief = buildBrief;
