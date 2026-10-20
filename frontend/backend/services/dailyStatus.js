// Daily "still watching" message (added 2026-10-20): the backtested gold
// setups (services/ruleStrategy.js) can go days without a signal, which
// looked like the system had stopped. On weekdays from 17:00 UTC (20:00
// Tanzania, after the London / New York overlap), once per day, every user
// who got no strategy signal that day gets one push: price, 4H trend and
// what each setup is waiting for. Settings switch "dailyStatus" (on
// unless turned off). Computed, no AI.
const AppConfig = require("../models/AppConfig");
const User = require("../models/User");
const Notification = require("../models/Notification");
const marketService = require("./marketService");
const ruleStrategy = require("./ruleStrategy");
const { dispatchMessage, hasChannels } = require("./notifyDispatcher");

const PAIR = "XAUUSD";
const START_HOUR_UTC = 17;
const END_HOUR_UTC = 21;

exports.maybeSendDailyStatus = async (now = new Date()) => {
  const day = now.getUTCDay(), hour = now.getUTCHours();
  if (day === 0 || day === 6 || hour < START_HOUR_UTC || hour >= END_HOUR_UTC) return null;
  const date = now.toISOString().slice(0, 10);
  // Claim today's slot first so overlapping cycles can't send it twice.
  const claimed = await AppConfig.findOneAndUpdate(
    { key: "dailyStatus", "value.date": { $ne: date } },
    { $set: { "value.date": date } },
    { upsert: false, returnDocument: "after" }
  ).catch(() => null) || await AppConfig.create({ key: "dailyStatus", value: { date } }).catch(() => null);
  if (!claimed) return null;

  const price = (await marketService.getAllPrices().catch(() => ({})))[PAIR];
  const text = await ruleStrategy.watchText(PAIR, price, now.getTime()).catch((err) => {
    console.error("Daily status text failed:", err.message);
    return null;
  });
  if (!text) return null;
  const dayStart = new Date(`${date}T00:00:00Z`);
  let sent = 0;
  for (const u of await User.find({}).select("_id")) {
    if (await Notification.exists({ user: u._id, strategy: { $exists: true, $ne: null }, createdAt: { $gte: dayStart } })) continue;
    if (!(await hasChannels(u._id))) continue;
    await dispatchMessage(u._id, {
      title: "👀 No gold setup today — still watching",
      body: text,
      url: "/notifications",
      id: `status-${date}`,
      email: false,
      pref: "dailyStatus",
    }).catch((err) => console.error("Daily status delivery failed:", err.message));
    sent++;
  }
  await AppConfig.updateOne({ key: "dailyStatus" }, { $set: { value: { date, text, sent } } });
  return { text, sent };
};
