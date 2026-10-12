// Countdown alerts before high-impact news (added 2026-10 at the user's
// request, so traders can stand by): for every high-impact USD / EUR / GBP
// release -- the currencies behind EURUSD, GBPUSD and gold -- an alert at
// 6h, 5h, 4h, 3h, 2h and 1h before, plus a final one ~15 min before.
// Releases at the same minute (e.g. CPI m/m + y/y + core) are one alert.
// Push to every user who hasn't switched it off (Settings); email only at
// 6h and 1h. Each mark is sent once (stored in AppConfig). Runs after the
// generation cycle (every 10 min); never affects signals; no AI calls.
const AppConfig = require("../models/AppConfig");
const User = require("../models/User");
const economicCalendar = require("./economicCalendar");
const { dispatchMessage } = require("./notifyDispatcher");

const CURRENCIES = ["USD", "EUR", "GBP"];
const PAIRS_BY_CCY = { USD: ["EURUSD", "GBPUSD", "XAUUSD"], EUR: ["EURUSD"], GBP: ["GBPUSD"] };
const HOUR = 3600 * 1000;
const EMAIL_MARKS = new Set(["6h", "1h"]);

// Pure: which countdown mark (if any) is due for a release `msLeft` away.
// Hour marks fire once the time left drops to k hours (k = 6..1); the last
// one fires inside the final 20 minutes.
function dueMark(msLeft) {
  if (msLeft <= 0 || msLeft > 6 * HOUR) return null;
  if (msLeft <= 20 * 60 * 1000) return "15m";
  const k = Math.ceil(msLeft / HOUR); // 6h..1h
  return msLeft <= k * HOUR && msLeft > (k - 1) * HOUR ? `${k}h` : null;
}

// Same-minute releases grouped together.
function groupByTime(events) {
  const groups = new Map();
  for (const e of events) {
    const key = e.time.toISOString();
    if (!groups.has(key)) groups.set(key, { time: e.time, events: [] });
    groups.get(key).events.push(e);
  }
  return [...groups.values()].sort((a, b) => a.time - b.time);
}

const hhmm = (d) => d.toISOString().slice(11, 16);
const eat = (d) => new Date(d.getTime() + 3 * HOUR).toISOString().slice(11, 16);

function buildMessage(group, mark, now) {
  const mins = Math.round((group.time - now) / 60000);
  const left = mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ""}` : `${mins} min`;
  const top = group.events.some(economicCalendar.isTopTier);
  const ccys = [...new Set(group.events.map((e) => e.currency))];
  const pairs = [...new Set(ccys.flatMap((c) => PAIRS_BY_CCY[c] || []))];
  const names = group.events.map((e) => e.title);
  const headline = names.length > 2 ? `${names[0]} +${names.length - 1} more` : names.join(" & ");
  const quietAfter = Math.max(...group.events.map((e) => economicCalendar.quietAfterMs(e))) / 60000;
  const quietFrom = new Date(group.time.getTime() - economicCalendar.QUIET_BEFORE_MS);
  const quietTo = new Date(group.time.getTime() + quietAfter * 60000);

  const title = `${mark === "15m" ? "🚨" : "⏰"} ${ccys.join("/")} ${headline} in ${left}`;
  const body = `${hhmm(group.time)} UTC (${eat(group.time)} EAT) · ${top ? "TOP-TIER — expect a big, fast move" : "high-impact"} · affects ${pairs.join(", ")}`;
  const details = group.events.map((e) => `• ${e.currency} ${e.title}${e.forecast ? ` — forecast ${e.forecast}` : ""}${e.previous ? `, previous ${e.previous}` : ""}`).join("\n");
  const text = `${body}\n\n${details}\n\nTradeMind won't send new signals for these pairs from ${hhmm(quietFrom)} to ${hhmm(quietTo)} UTC. ${mark === "15m" ? "Release is imminent — protect open trades (stop to breakeven, reduce size or close)." : "Plan ahead: decide now what you'll do with any open trades."}`;
  return { title, body, text };
}

exports.dueMark = dueMark;
exports.groupByTime = groupByTime;
exports.buildMessage = buildMessage;

exports.sendCountdowns = async (now = new Date()) => {
  const events = await economicCalendar.getHighImpactEvents();
  const relevant = (events || []).filter((e) => CURRENCIES.includes(e.currency) && e.time > now && e.time - now <= 6 * HOUR);
  if (!relevant.length) return { sent: 0 };

  const cfg = (await AppConfig.findOne({ key: "newsCountdownSent" }))?.value || { keys: [] };
  const sentKeys = new Set(cfg.keys);
  const due = [];
  for (const group of groupByTime(relevant)) {
    const mark = dueMark(group.time - now);
    const key = `${group.time.toISOString()}|${mark}`;
    if (mark && !sentKeys.has(key)) due.push({ group, mark, key });
  }
  if (!due.length) return { sent: 0 };

  const users = await User.find({}).select("_id");
  for (const { group, mark, key } of due) {
    const msg = buildMessage(group, mark, now);
    for (const u of users) {
      await dispatchMessage(u._id, {
        ...msg,
        url: "/calendar",
        id: `countdown-${group.time.getTime()}`, // replaces the previous countdown alert on the phone
        email: EMAIL_MARKS.has(mark),
        pref: "newsCountdown",
        ttlSeconds: 50 * 60,
      }).catch((err) => console.error("News countdown delivery failed:", err.message));
    }
    sentKeys.add(key);
  }
  await AppConfig.updateOne({ key: "newsCountdownSent" }, { $set: { value: { keys: [...sentKeys].slice(-500) } } }, { upsert: true });
  return { sent: due.length, marks: due.map((d) => `${hhmm(d.group.time)} ${d.mark}`) };
};
