// Fixed rules around the AI signal (added 2026-10, "rules" step of the AI
// trading workflow). Three jobs:
//   preGate     -- skip the AI call entirely when the market structure
//                  shows no setup (saves the limited free AI allowance)
//   placeLevels -- stop loss just beyond real structure, take profit at the
//                  next level, at least 1:1.5 risk:reward
//   checklist   -- every signal must pass the hard rules before it's sent;
//                  the result is shown on the signal
// Uses services/marketContext.js (structure, S/R, multi-timeframe) and
// services/economicCalendar.js (high-impact news).

const { currenciesFor } = require("./economicCalendar");

const MIN_RR = 1.5;
const NEWS_BEFORE_MS = 30 * 60 * 1000; // no new signal 30 min before...
const NEWS_AFTER_MS = 15 * 60 * 1000; // ...or 15 min after high-impact news

const isUp = (t) => t === "up" || t === "up-leaning";
const isDown = (t) => t === "down" || t === "down-leaning";

// Worth asking the AI? Only when at least one of 4H / 1H has a direction,
// or 1H just broke structure. Pure ranges on both get skipped.
exports.preGate = (ctx) => {
  if (!ctx || ctx.h1.trend === "unknown") return { analyze: true, reason: "no structure data -- analyze anyway" };
  const directional = [ctx.h4.trend, ctx.h1.trend].some((t) => isUp(t) || isDown(t));
  if (directional || ctx.h1.bos) return { analyze: true, reason: "trend or break of structure present" };
  return { analyze: false, reason: "4H and 1H both ranging, no break of structure" };
};

// Stop loss just beyond the nearest swing on the wrong side of entry (with a
// small buffer), when that lands within sane intraday limits; take profit
// at the nearest opposing level if it gives >= MIN_RR, else MIN_RR from the
// stop. Falls back to the AI's own levels when structure gives no answer.
// fitIntradayLevels (marketAnalysis.js) still clamps the result afterwards.
exports.placeLevels = ({ signal, entry, stopLoss, takeProfit }, ctx) => {
  const atr = ctx?.atrH1;
  if (!atr || !entry || (signal !== "buy" && signal !== "sell")) return { entry, stopLoss, takeProfit, note: null };
  const dir = signal === "buy" ? 1 : -1;
  const notes = [];
  let sl = stopLoss, tp = takeProfit;

  const swingsAgainst = (signal === "buy" ? ctx.h1.swingLows : ctx.h1.swingHighs)
    .filter((p) => (entry - p) * dir > 0)
    .sort((a, b) => Math.abs(entry - a) - Math.abs(entry - b));
  const structural = swingsAgainst.find((p) => {
    const d = Math.abs(entry - p) + 0.2 * atr;
    return d >= 0.8 * atr && d <= 2.5 * atr;
  });
  if (structural != null) {
    sl = structural - dir * 0.2 * atr;
    notes.push(`stop beyond the ${signal === "buy" ? "swing low" : "swing high"} at ${fmt(structural, entry)}`);
  }

  const risk = Math.abs(entry - sl);
  if (risk > 0) {
    const opposing = (signal === "buy" ? ctx.levels.resistances : ctx.levels.supports).map((l) => l.price);
    const target = opposing.find((p) => Math.abs(p - entry) >= MIN_RR * risk);
    if (target != null && Math.abs(target - entry) <= 4 * atr) {
      tp = target - dir * 0.1 * atr; // just before the level
      notes.push(`target just before the ${signal === "buy" ? "resistance" : "support"} at ${fmt(target, entry)}`);
    } else if (!tp || Math.abs(tp - entry) < MIN_RR * risk) {
      tp = entry + dir * MIN_RR * risk;
      notes.push(`target set to 1:${MIN_RR} risk:reward`);
    }
  }
  return { entry, stopLoss: sl, takeProfit: tp, note: notes.join("; ") || null };
};

function fmt(n, ref) {
  return Number(n).toFixed(ref >= 100 ? 2 : 5);
}

// Hard rules block the signal; soft rules are shown but don't block.
exports.checklist = ({ signal, entry, stopLoss, takeProfit }, ctx, events, now = new Date()) => {
  const rules = [];
  const add = (key, label, passed, detail, hard = true) => rules.push({ key, label, passed, detail, hard });

  // 1. With the higher-timeframe trend
  const h4 = ctx?.h4?.trend || "unknown";
  if (h4 === "unknown") add("trend", "4H trend", true, "4H trend unavailable");
  else {
    const against = (signal === "buy" && isDown(h4)) || (signal === "sell" && isUp(h4));
    add("trend", "4H trend", !against, against ? `${signal.toUpperCase()} against a 4H ${h4} trend` : `4H ${h4} — ${isUp(h4) || isDown(h4) ? "aligned" : "neutral"}`);
  }

  // 2. Risk:reward
  const risk = Math.abs(entry - stopLoss), reward = Math.abs(takeProfit - entry);
  const rr = risk > 0 ? reward / risk : 0;
  add("rr", "Risk:reward", rr >= MIN_RR - 1e-9, `1 : ${rr.toFixed(1)} (minimum 1 : ${MIN_RR})`);

  // 3. Room to move: no *strong* opposing level (touched 2+ times) closer
  // than the stop distance. Single-touch levels sit every few pips and
  // would block nearly everything, so they're a warning, not a block.
  const dir = signal === "buy" ? 1 : -1;
  const opposing = ((signal === "buy" ? ctx?.levels?.resistances : ctx?.levels?.supports) || [])
    .filter((l) => (l.price - entry) * dir > 0 && Math.abs(l.price - entry) < risk);
  const strong = opposing.find((l) => l.strength >= 2);
  const weak = opposing.find((l) => l.strength < 2);
  const side = signal === "buy" ? "resistance" : "support";
  if (strong) add("room", "Room to target", false, `strong ${side} at ${fmt(strong.price, entry)} is closer than the stop distance`);
  else if (weak) add("room", "Room to target", false, `minor ${side} at ${fmt(weak.price, entry)} on the way`, false);
  else add("room", "Room to target", true, "no level in the way within 1R");

  // 4. High-impact news
  if (!events) add("news", "News", true, "calendar unavailable", true);
  else {
    const ccys = currenciesFor(ctx?.pair || "");
    const near = events.find((e) => ccys.includes(e.currency)
      && e.time - now <= NEWS_BEFORE_MS && now - e.time <= NEWS_AFTER_MS);
    add("news", "News", !near, near ? `${near.currency} ${near.title} at ${near.time.toISOString().slice(11, 16)} UTC` : "no high-impact news within 30 min");
  }

  // 5. Session (soft): London + New York hours, Mon-Fri
  const h = now.getUTCHours(), d = now.getUTCDay();
  const inSession = d >= 1 && d <= 5 && h >= 7 && h < 21;
  add("session", "Session", inSession, inSession ? "London / New York hours" : "outside London / New York hours (thinner market)", false);

  const blocked = rules.filter((r) => r.hard && !r.passed);
  return { rules, passed: blocked.length === 0, blocked: blocked.map((r) => r.key), rr };
};

// Compact text for the signal's reasoning (shows in app, push and email).
exports.checklistText = (result) =>
  "\n\n📋 Rule check:\n" + result.rules.map((r) => `${r.passed ? "✅" : r.hard ? "❌" : "⚠️"} ${r.label}: ${r.detail}`).join("\n");
