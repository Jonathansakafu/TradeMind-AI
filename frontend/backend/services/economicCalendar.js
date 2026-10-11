// High-impact economic events (CPI, NFP, rate decisions...) from the free
// ForexFactory weekly calendar feed, used by signalRules.js to avoid new
// signals right around big news (spreads widen, price spikes both ways)
// and by the morning brief. Cached 1h; if the feed fails the news rule is
// reported as "unknown" rather than blocking every signal.
const axios = require("axios");

const FEED = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const CACHE_MS = 60 * 60 * 1000;
let cache = { at: 0, events: null, error: null };

// The feed rate-limits (HTTP 429 when fetched more than a couple of times
// in a few minutes), so the last good copy is also kept in Mongo: it
// survives server restarts and covers the feed being unavailable.
exports.getHighImpactEvents = async () => {
  if (cache.events && Date.now() - cache.at < CACHE_MS) return cache.events;
  const AppConfig = require("../models/AppConfig");
  try {
    const res = await axios.get(FEED, { timeout: 10000, headers: { "User-Agent": "Mozilla/5.0" } });
    const events = (Array.isArray(res.data) ? res.data : [])
      .filter((e) => e.impact === "High" && e.date)
      .map((e) => ({ time: new Date(e.date), currency: e.country, title: e.title }))
      .filter((e) => !Number.isNaN(e.time.getTime()));
    cache = { at: Date.now(), events, error: null };
    AppConfig.updateOne({ key: "economicCalendar" }, { $set: { value: { savedAt: new Date(), events } } }, { upsert: true })
      .catch(() => {});
    return events;
  } catch (err) {
    cache.error = err.message;
    if (cache.events) return cache.events;
    try {
      const saved = (await AppConfig.findOne({ key: "economicCalendar" }))?.value;
      if (saved?.events && Date.now() - new Date(saved.savedAt).getTime() < 7 * 24 * 3600 * 1000) {
        const events = saved.events.map((e) => ({ ...e, time: new Date(e.time) }));
        cache = { at: Date.now() - CACHE_MS + 10 * 60 * 1000, events, error: err.message }; // retry the feed in 10 min
        return events;
      }
    } catch { /* no saved copy */ }
    return null;
  }
};

// Currencies whose news moves a pair. Gold is priced in USD.
exports.currenciesFor = (pair) =>
  pair === "XAUUSD" ? ["USD"] : [pair.slice(0, 3), pair.slice(3, 6)];
