// "Check impact" for the Economic Calendar page (added 2026-10): this
// week's high-impact releases, and for one release (a group of same-minute
// events for one currency) the impact on EURUSD / GBPUSD / XAUUSD:
//   - before release: expected move size from each pair's 1H ATR (top-tier
//     ~1.5-3x, other high-impact ~0.8-1.5x), what a higher / lower than
//     forecast figure would mean for each pair, and the signal pause window
//   - after release: the measured reaction -- move after 15 min, after 1h
//     and up to now (max 6h), biggest swing up / down, which way the
//     currency went -- from 5-minute candles
//   - a short plain-language AI explanation (one user-triggered call,
//     cached per release and state for 30 min; facts-only fallback)
const economicCalendar = require("./economicCalendar");
const marketService = require("./marketService");
const marketContext = require("./marketContext");

const PAIRS_BY_CCY = { USD: ["EURUSD", "GBPUSD", "XAUUSD"], EUR: ["EURUSD"], GBP: ["GBPUSD"] };
// Releases where a HIGHER number is bad for the currency.
const INVERSE = /unemployment|jobless|claims/i;
const MIN = 60 * 1000;
const aiCache = new Map();

const pipOf = (pair) => (pair === "XAUUSD" ? 1 : 0.0001); // $ for gold, pips for forex
const unitOf = (pair) => (pair === "XAUUSD" ? "$" : "pips");
const fmtMove = (pair, move) => `${move >= 0 ? "+" : "-"}${pair === "XAUUSD" ? "$" : ""}${(Math.abs(move) / pipOf(pair)).toFixed(pair === "XAUUSD" ? 1 : 0)}${pair === "XAUUSD" ? "" : " pips"}`;
const idOf = (time, currency) => `${time.toISOString()}|${currency}`;

exports.listEvents = async (now = new Date()) => {
  const events = (await economicCalendar.getHighImpactEvents()) || [];
  const groups = new Map();
  for (const e of events) {
    const id = idOf(e.time, e.currency);
    if (!groups.has(id)) {
      groups.set(id, {
        id, time: e.time, currency: e.currency, events: [],
        pairs: PAIRS_BY_CCY[e.currency] || [],
        status: e.time <= now ? "released" : "upcoming",
      });
    }
    groups.get(id).events.push({ title: e.title, forecast: e.forecast || null, previous: e.previous || null });
  }
  return [...groups.values()]
    .map((g) => ({ ...g, topTier: g.events.some((e) => economicCalendar.isTopTier(e)) }))
    .sort((a, b) => a.time - b.time);
};

// Pure: reaction of 5m candles (oldest first) to a release at `time`.
function measure(candles, time, pair, currency, now) {
  const t = time.getTime();
  const before = [...candles].reverse().find((c) => new Date(c.datetime).getTime() < t);
  const after = candles.filter((c) => {
    const ct = new Date(c.datetime).getTime();
    return ct >= t && ct <= Math.min(now.getTime(), t + 6 * 60 * MIN);
  });
  if (!before || !after.length) return null;
  const start = before.close;
  const at = (mins) => {
    const c = [...after].reverse().find((x) => new Date(x.datetime).getTime() <= t + mins * MIN);
    return c ? c.close - start : null;
  };
  const last = after[after.length - 1].close - start;
  const maxUp = Math.max(...after.map((c) => c.high)) - start;
  const maxDown = Math.min(...after.map((c) => c.low)) - start;
  const base = pair === "XAUUSD" ? "XAU" : pair.slice(0, 3);
  const ccyStronger = currency === base ? last > 0 : last < 0;
  return { start, after15: at(15), after60: at(60), sinceRelease: last, maxUp, maxDown, ccyStronger, minutes: Math.round((Math.min(now.getTime(), t + 6 * 60 * MIN) - t) / MIN) };
}
exports.measure = measure;

// What a higher / lower than forecast figure means for a pair.
function scenarios(currency, pairs, titles) {
  const inverse = titles.some((t) => INVERSE.test(t));
  const dirFor = (pair, ccyUp) => {
    const base = pair === "XAUUSD" ? "XAU" : pair.slice(0, 3);
    const pairUp = currency === base ? ccyUp : !ccyUp;
    return pairUp ? "↑ up" : "↓ down";
  };
  const higherCcyUp = !inverse;
  return {
    higher: { currency: higherCcyUp ? "stronger" : "weaker", pairs: Object.fromEntries(pairs.map((p) => [p, dirFor(p, higherCcyUp)])) },
    lower: { currency: higherCcyUp ? "weaker" : "stronger", pairs: Object.fromEntries(pairs.map((p) => [p, dirFor(p, !higherCcyUp)])) },
    note: inverse ? "For this release a HIGHER number is bad for the currency (e.g. more unemployment)." : null,
  };
}
exports.scenarios = scenarios;

exports.checkImpact = async (id, now = new Date()) => {
  const all = await exports.listEvents(now);
  const group = all.find((g) => g.id === id);
  if (!group) return { error: "Release not found in this week's calendar." };
  const { time, currency, pairs, topTier, events } = group;
  const released = time <= now;
  const quietAfterMin = Math.max(...events.map((e) => economicCalendar.quietAfterMs(e))) / MIN;
  const prices = await marketService.getAllPrices();

  const perPair = [];
  for (const pair of pairs) {
    const row = { pair, unit: unitOf(pair), price: prices[pair] ?? null };
    try {
      const ctx = row.price ? await marketContext.getMarketContext(pair, row.price) : null;
      row.atr = ctx?.atrH1 ?? null;
      if (row.atr) {
        const [lo, hi] = topTier ? [1.5, 3] : [0.8, 1.5];
        row.expected = { low: (lo * row.atr) / pipOf(pair), high: (hi * row.atr) / pipOf(pair) };
      }
      if (released) {
        const candles = await marketService.getYahooCandles(pair, { interval: "5m", range: "5d" });
        const m = measure(candles, time, pair, currency, now);
        if (m) {
          row.reaction = {
            after15: m.after15 != null ? fmtMove(pair, m.after15) : null,
            after60: m.after60 != null ? fmtMove(pair, m.after60) : null,
            sinceRelease: fmtMove(pair, m.sinceRelease),
            biggestUp: fmtMove(pair, m.maxUp),
            biggestDown: fmtMove(pair, m.maxDown),
            minutes: m.minutes,
            atrMultiple: row.atr ? Math.abs(m.sinceRelease) / row.atr : null,
            currencyWent: m.ccyStronger ? "stronger" : "weaker",
          };
        }
      }
    } catch (err) {
      row.error = err.message;
    }
    perPair.push(row);
  }

  const result = {
    id, time, currency, topTier, released, events, pairs,
    quietWindow: {
      from: new Date(time.getTime() - economicCalendar.QUIET_BEFORE_MS),
      to: new Date(time.getTime() + quietAfterMin * MIN),
    },
    perPair,
    scenarios: pairs.length ? scenarios(currency, pairs, events.map((e) => e.title)) : null,
  };
  result.summary = await explain(result);
  return result;
};

// One short AI explanation per release and state (before / after),
// cached 30 min. User-triggered, so not on the background AI budget.
async function explain(r) {
  const key = `${r.id}|${r.released ? "after" : "before"}`;
  const hit = aiCache.get(key);
  if (hit && Date.now() - hit.at < 30 * MIN) return hit.text;
  const facts = [
    `${r.currency} ${r.events.map((e) => `${e.title}${e.forecast ? ` (forecast ${e.forecast}, previous ${e.previous || "-"})` : ""}`).join("; ")} at ${r.time.toISOString().slice(0, 16)} UTC, ${r.topTier ? "top-tier" : "high-impact"}.`,
    ...r.perPair.map((p) => r.released && p.reaction
      ? `${p.pair}: ${p.reaction.sinceRelease} since release (${p.reaction.minutes} min), after 15 min ${p.reaction.after15}, biggest up ${p.reaction.biggestUp}, biggest down ${p.reaction.biggestDown}; ${r.currency} went ${p.reaction.currencyWent}.`
      : `${p.pair}: typical reaction ${p.expected ? `${Math.round(p.expected.low)}-${Math.round(p.expected.high)} ${p.unit}` : "unknown"}.`),
    r.scenarios ? `If higher than forecast: ${r.currency} ${r.scenarios.higher.currency} (${Object.entries(r.scenarios.higher.pairs).map(([k, v]) => `${k} ${v}`).join(", ")}). If lower: the opposite.${r.scenarios.note ? ` ${r.scenarios.note}` : ""}` : "",
  ].filter(Boolean).join("\n");
  let text = null;
  try {
    text = await require("./claudeAI").explainNewsImpact(facts, r.released);
  } catch { /* fall back to the facts */ }
  const out = text || null;
  if (out) aiCache.set(key, { at: Date.now(), text: out });
  return out;
}
