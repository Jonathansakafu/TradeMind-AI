// Heads-up before high-impact news for trades the user actually has on
// (added 2026-10): signals they marked as taken (cart) in the last 24h that
// aren't closed, and open trades in their journal. Sent once per user per
// release, 15-45 min before it (the cycle runs every 10 min), via the same
// push / email channels as signals. Runs after each generation cycle and
// never affects signal generation; no AI calls.
const AppConfig = require("../models/AppConfig");
const Notification = require("../models/Notification");
const Trade = require("../models/Trade");
const economicCalendar = require("./economicCalendar");
const { dispatchMessage } = require("./notifyDispatcher");

const FROM_MS = 15 * 60 * 1000;
const TO_MS = 45 * 60 * 1000;

// Pure: what each user has open, grouped by pair.
function positionsByPair(taken, trades) {
  const out = new Map();
  const add = (pair, text) => {
    if (!pair) return;
    if (!out.has(pair)) out.set(pair, []);
    if (!out.get(pair).includes(text)) out.get(pair).push(text);
  };
  for (const n of taken) {
    if (n.tradeId && n.tradeId.status === "closed") continue;
    add(n.pair, `${n.pair} ${String(n.signal).toUpperCase()} (entry ${n.entry})`);
  }
  for (const t of trades) add(String(t.pair).replace("/", "").toUpperCase(), `${t.pair} ${String(t.direction).toUpperCase()} (entry ${t.entryPrice})`);
  return out;
}

exports.positionsByPair = positionsByPair;

exports.sendPreNewsWarnings = async (now = new Date()) => {
  const events = await economicCalendar.getHighImpactEvents();
  const soon = (events || []).filter((e) => e.time - now > FROM_MS && e.time - now <= TO_MS);
  if (!soon.length) return { sent: 0 };

  const cfg = (await AppConfig.findOne({ key: "newsWarningsSent" }))?.value || { keys: [] };
  const sentKeys = new Set(cfg.keys);
  const since = new Date(now.getTime() - 24 * 3600 * 1000);
  const [taken, openTrades] = await Promise.all([
    Notification.find({ taken: true, signal: { $in: ["buy", "sell"] }, createdAt: { $gte: since } })
      .select("user pair signal entry tradeId").populate("tradeId", "status"),
    Trade.find({ status: "open" }).select("user pair direction entryPrice"),
  ]);

  const users = new Set([...taken.map((n) => String(n.user)), ...openTrades.map((t) => String(t.user))]);
  let sent = 0;
  for (const userId of users) {
    const positions = positionsByPair(
      taken.filter((n) => String(n.user) === userId),
      openTrades.filter((t) => String(t.user) === userId)
    );
    for (const e of soon) {
      const key = `${userId}|${e.time.toISOString()}|${e.title}`;
      if (sentKeys.has(key)) continue;
      const affected = [...positions.entries()]
        .filter(([pair]) => economicCalendar.currenciesFor(pair).includes(e.currency))
        .flatMap(([, list]) => list);
      if (!affected.length) continue;
      const mins = Math.round((e.time - now) / 60000);
      const top = economicCalendar.isTopTier(e);
      const title = `⚠️ ${e.currency} ${e.title} in ${mins} min`;
      const body = `You have open: ${affected.slice(0, 3).join(", ")}${affected.length > 3 ? "…" : ""}. ${top ? "Top-tier release — expect a big, fast move." : "High-impact release — expect volatility."} Consider moving your stop to breakeven, reducing size or closing before ${e.time.toISOString().slice(11, 16)} UTC.`;
      const text = `${body}${e.forecast ? `\nForecast: ${e.forecast}` : ""}${e.previous ? ` · Previous: ${e.previous}` : ""}`;
      await dispatchMessage(userId, { title, body, text, url: "/notifications", id: `news-${e.time.getTime()}` })
        .catch((err) => console.error("News warning delivery failed:", err.message));
      sentKeys.add(key);
      sent++;
    }
  }
  if (sent) {
    await AppConfig.updateOne({ key: "newsWarningsSent" }, { $set: { value: { keys: [...sentKeys].slice(-500) } } }, { upsert: true });
  }
  return { sent };
};
