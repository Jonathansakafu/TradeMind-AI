// Economic-news context for one pair, given to the AI and shown in the
// signal's notes (added 2026-10):
//   - upcoming: high-impact releases for the pair's currencies in the next
//     6 hours, with forecast / previous (from the calendar feed)
//   - reactions: for releases in the last 3 hours whose quiet window has
//     passed, how price actually reacted -- net move from the last candle
//     before the release to now, in % and in 1H-ATR units, and which side
//     of the release's currency it favoured. The free calendar has no
//     "actual" figure, so the market's own reaction stands in for it.
// No AI calls. Any failure returns an empty context -- signals carry on.
const economicCalendar = require("./economicCalendar");
const marketService = require("./marketService");

const AHEAD_MS = 6 * 3600 * 1000;
// How the AI should use the calendar. TradeMind itself blocks new signals
// from 30 min before to 60 min after top-tier releases (signalRules), so a
// release hours away is not a reason to WAIT -- the old wording ("an
// imminent top-tier release makes a new position risky") had the AI answer
// WAIT on every USD pair for ~6 hours before US CPI (2026-10-14).
const GUIDANCE = "How to use this: TradeMind already blocks new signals from 30 min before to 60 min after top-tier releases, so do NOT answer WAIT just because a release is coming later today -- judge the chart. Only if a top-tier release is less than 90 min away, prefer a nearer take profit that can be reached before it, or WAIT if the setup needs longer. A strong post-release reaction shows which way the news pushed the market.";
const BACK_MS = 3 * 3600 * 1000;
const CANDLE_CACHE_MS = 5 * 60 * 1000;
const candleCache = new Map();

async function fiveMinute(pair) {
  const hit = candleCache.get(pair);
  if (hit && Date.now() - hit.at < CANDLE_CACHE_MS) return hit.candles;
  const candles = await marketService.getYahooCandles(pair, { interval: "5m", range: "1d" });
  candleCache.set(pair, { at: Date.now(), candles });
  return candles;
}

const hhmm = (d) => d.toISOString().slice(11, 16);
const fmtFor = (ref) => (n) => Number(n).toFixed(ref >= 100 ? 2 : 5);

// Pure: reaction of `candles` (oldest first) to a release at `time`.
function reaction(candles, time, pair, currency, atrH1) {
  const t = time.getTime();
  const before = [...candles].reverse().find((c) => new Date(c.datetime).getTime() < t);
  const after = candles.filter((c) => new Date(c.datetime).getTime() >= t);
  if (!before || !after.length) return null;
  const start = before.close, now = after[after.length - 1].close;
  const move = now - start;
  const pct = (move / start) * 100;
  const atrs = atrH1 ? move / atrH1 : null;
  // Which way did the release's currency go? For XXX/USD pairs a rise means
  // USD weaker; for the base currency (EUR in EURUSD) a rise means stronger.
  // Gold (XAUUSD) up = USD weaker.
  const base = pair === "XAUUSD" ? "XAU" : pair.slice(0, 3);
  const up = move > 0;
  const ccyStronger = currency === base ? up : !up;
  const size = atrs == null ? "" : Math.abs(atrs) >= 1.5 ? "strong" : Math.abs(atrs) >= 0.7 ? "clear" : "small";
  return { start, now, move, pct, atrs, ccyStronger, size };
}

exports.reaction = reaction;

exports.getNewsContext = async (pair, { atrH1 } = {}, now = new Date()) => {
  try {
    const events = await economicCalendar.getHighImpactEvents();
    if (!events) return { upcoming: [], reactions: [], text: "" };
    const upcoming = economicCalendar.eventsFor(events, pair, now, new Date(now.getTime() + AHEAD_MS));
    const recent = economicCalendar.eventsFor(events, pair, new Date(now.getTime() - BACK_MS), now)
      .filter((e) => now - e.time >= economicCalendar.quietAfterMs(e));

    const reactions = [];
    if (recent.length) {
      const candles = await fiveMinute(pair);
      const fmt = fmtFor(candles[candles.length - 1]?.close || 1);
      for (const e of recent) {
        const r = reaction(candles, e.time, pair, e.currency, atrH1);
        if (!r) continue;
        reactions.push({ event: e, ...r,
          line: `${e.currency} ${e.title} (${hhmm(e.time)} UTC): ${pair} ${r.move >= 0 ? "+" : ""}${r.pct.toFixed(2)}% (${fmt(r.start)} → ${fmt(r.now)}${r.atrs != null ? `, ${r.atrs >= 0 ? "+" : ""}${r.atrs.toFixed(1)}x 1H ATR` : ""}) — ${r.size ? `${r.size} ` : ""}${e.currency} ${r.ccyStronger ? "buying" : "selling"}` });
      }
    }

    const lines = [];
    for (const e of upcoming) {
      const mins = Math.round((e.time - now) / 60000);
      lines.push(`Upcoming: ${e.currency} ${e.title} at ${hhmm(e.time)} UTC (in ${mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`})${e.forecast ? `, forecast ${e.forecast}` : ""}${e.previous ? `, previous ${e.previous}` : ""}${economicCalendar.isTopTier(e) ? " — top-tier, expect a big move" : ""}`);
    }
    for (const r of reactions) lines.push(`Post-release reaction: ${r.line}`);
    const text = lines.length
      ? `Economic calendar for ${pair}:\n- ${lines.join("\n- ")}\n${GUIDANCE}`
      : "";
    return { upcoming, reactions, text };
  } catch (err) {
    return { upcoming: [], reactions: [], text: "", error: err.message };
  }
};
