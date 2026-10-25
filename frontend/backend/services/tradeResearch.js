// Why signals win or lose (added 2026-10-15). For every signal that hit
// its take profit or stop loss, a post-mortem from the candles (no AI):
//   at entry -- with / against the 4H and 1H trend, premium / discount side,
//     stop size vs the hourly range (ATR), RSI stretched, a level in the
//     way, top-tier news before / during the trade, stopped-out streak in
//     the same direction, a running signal betting the dollar the other way
//   after -- how far it went in favour before stopping out (MFE) or against
//     before winning (MAE), how fast, a break of structure against it
// Stored on the signal (Notification.research) and shown in the app. Then
// per pair + direction over 30 days, the factors that keep losing or
// winning become "lessons" given to the signal AI, and once a day the AI
// writes a short summary of them (Gemini background allowance).
const Notification = require("../models/Notification");
const AppConfig = require("../models/AppConfig");
const chartAnnotations = require("./chartAnnotations");
const economicCalendar = require("./economicCalendar");
const { usdExposure } = require("./signalGuards");

const H = 3600e3;
const LABELS = {
  withTrend: "with the 4H trend",
  againstTrend: "against the 4H trend",
  h1Against: "against the 1H trend",
  goodZone: "entered from the right side of the range (sell premium / buy discount)",
  badZone: "entered from the wrong side of the range",
  tightStop: "stop tighter than 0.8x the hourly range",
  wideStop: "stop wider than 2.5x the hourly range",
  stretched: "RSI already stretched in the signal's direction",
  levelInWay: "a strong level between entry and target",
  newsDuring: "top-tier news released while the trade was open",
  newsJustBefore: "within 3 h after a top-tier release",
  afterLosses: "after 2+ stop-losses in the same direction",
  usdClash: "while a signal bet the dollar the other way",
  fastStop: "stopped out within 1 hour",
  wentInFavourFirst: "went 0.5R+ in favour before stopping out",
  structureAgainst: "a break of structure against it after entry",
  asia: "Asian session (thin market)",
  overlap: "London / New York overlap",
};

function analyze(n, d, history) {
  const f = new Set();
  const dir = n.signal === "buy" ? 1 : -1;
  const want = n.signal === "buy" ? ["up", "up-leaning"] : ["down", "down-leaning"];
  const opp = n.signal === "buy" ? ["down", "down-leaning"] : ["up", "up-leaning"];
  if (want.includes(d.trend?.h4)) f.add("withTrend");
  if (opp.includes(d.trend?.h4)) f.add("againstTrend");
  if (opp.includes(d.trend?.h1)) f.add("h1Against");
  if (d.range && n.entry) {
    const premium = n.entry > d.range.mid;
    f.add((n.signal === "sell") === premium ? "goodZone" : "badZone");
  }
  const risk = Math.abs(n.entry - n.stopLoss);
  if (d.atr && risk) {
    if (risk < 0.8 * d.atr) f.add("tightStop");
    if (risk > 2.5 * d.atr) f.add("wideStop");
  }
  if (d.rsi != null && ((n.signal === "sell" && d.rsi < 30) || (n.signal === "buy" && d.rsi > 70))) f.add("stretched");
  const opposing = n.signal === "buy" ? d.levels?.resistances : d.levels?.supports;
  if ((opposing || []).some((l) => l.strength >= 2 && (l.price - n.entry) * dir > 0 && Math.abs(l.price - n.entry) < Math.abs(n.takeProfit - n.entry))) f.add("levelInWay");
  const t0 = new Date(n.createdAt).getTime(), t1 = new Date(n.simResolvedAt).getTime();
  for (const e of history.news) {
    const et = new Date(e.time).getTime();
    if (!economicCalendar.isTopTier(e) || !economicCalendar.currenciesFor(n.pair).includes(e.currency)) continue;
    if (et >= t0 && et <= t1) f.add("newsDuring");
    if (et < t0 && t0 - et <= 3 * H) f.add("newsJustBefore");
  }
  if (history.priorLosses >= 2) f.add("afterLosses");
  if (history.usdClash) f.add("usdClash");
  const h = new Date(t0 + 3 * H).getUTCHours();
  if (h >= 1 && h < 10) f.add("asia");
  if (h >= 16 && h < 19) f.add("overlap");

  // After entry: excursions from the candles between entry and result.
  const after = d.candles.filter((c) => c.time * 1000 >= t0 && c.time * 1000 <= t1 + 3600e3);
  let mfe = 0, mae = 0;
  for (const c of after) {
    mfe = Math.max(mfe, ((n.signal === "buy" ? c.high : n.entry * 2 - c.low) - n.entry) / risk);
    mae = Math.max(mae, ((n.signal === "buy" ? n.entry * 2 - c.low : c.high) - n.entry) / risk);
  }
  const minutes = Math.round((t1 - t0) / 60000);
  if (n.simOutcome === "loss" && minutes <= 60) f.add("fastStop");
  if (n.simOutcome === "loss" && mfe >= 0.5) f.add("wentInFavourFirst");
  if ((d.structure || []).some((s) => s.to * 1000 > t0 && s.to * 1000 <= t1 && s.dir !== (n.signal === "buy" ? "bullish" : "bearish"))) f.add("structureAgainst");

  const factors = [...f];
  const bad = ["againstTrend", "h1Against", "badZone", "tightStop", "stretched", "levelInWay", "newsDuring", "newsJustBefore", "afterLosses", "usdClash", "asia"];
  const good = ["withTrend", "goodZone", "overlap"];
  const reasons = n.simOutcome === "loss" ? factors.filter((k) => bad.includes(k) || k === "wentInFavourFirst" || k === "structureAgainst") : factors.filter((k) => good.includes(k));
  const verdict = `${n.simOutcome === "win" ? "Won" : "Lost"} in ${minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes} min`}`
    + (reasons.length ? ` — ${reasons.map((k) => LABELS[k]).join("; ")}` : "")
    + (n.simOutcome === "win" ? ` (went ${mae.toFixed(1)}R against first)` : mfe >= 0.2 ? ` (was ${mfe.toFixed(1)}R in favour first)` : "");
  return { factors, verdict, mfeR: +mfe.toFixed(2), maeR: +mae.toFixed(2), minutes, at: new Date() };
}

// Post-mortems for freshly resolved signals (a few per cycle; cheap -- the
// candles are cached per pair).
exports.researchResolved = async (limit = 60) => {
  const list = await Notification.find({
    simOutcome: { $in: ["win", "loss"] }, "research.at": { $exists: false }, type: { $ne: "quick_trade" },
    signal: { $in: ["buy", "sell"] }, entry: { $gt: 0 }, simResolvedAt: { $gte: new Date(Date.now() - 10 * 24 * H) },
  }).sort({ simResolvedAt: -1 }).limit(limit).lean();
  let events = [];
  try { events = (await economicCalendar.getHighImpactEvents()) || []; } catch { /* no news factor */ }
  let done = 0;
  for (const n of list) {
    try {
      const exit = n.simOutcome === "win" ? n.takeProfit : n.stopLoss;
      const d = await chartAnnotations.build(n.user, { tf: "1h", query: { pair: n.pair, dir: n.signal, entry: n.entry, sl: n.stopLoss, tp: n.takeProfit, at: n.createdAt, exit, exitAt: n.simResolvedAt, outcome: n.simOutcome } });
      if (d.error) { await Notification.updateOne({ _id: n._id }, { research: { verdict: "no price data", factors: [], at: new Date() } }); continue; }
      const prior = await Notification.countDocuments({ user: n.user, pair: n.pair, signal: n.signal, simOutcome: "loss", simResolvedAt: { $gte: new Date(new Date(n.createdAt) - 12 * H), $lt: n.createdAt } });
      const running = await Notification.find({ user: n.user, pair: { $ne: n.pair }, signal: { $in: ["buy", "sell"] }, createdAt: { $gte: new Date(new Date(n.createdAt) - 8 * H), $lt: n.createdAt }, $or: [{ simResolvedAt: { $gt: n.createdAt } }, { simOutcome: { $exists: false } }] }).select("pair signal").lean();
      const usdClash = usdExposure(n.pair, n.signal) !== 0 && running.some((r) => usdExposure(r.pair, r.signal) === -usdExposure(n.pair, n.signal));
      const research = analyze(n, d, { news: events, priorLosses: prior, usdClash });
      await Notification.updateOne({ _id: n._id }, { research });
      done++;
    } catch (err) {
      console.error("Trade research failed:", err.message);
    }
  }
  return done;
};

// Lessons per pair + direction (last 30 days of the signals in scope -- a
// Notification filter, e.g. { user } or { primary: true }): factors whose
// win rate is far from the usual one.
exports.lessonsFor = async (scope, pair) => {
  const rows = await Notification.find({ ...scope, pair, "research.at": { $exists: true }, simResolvedAt: { $gte: new Date(Date.now() - 30 * 24 * H) } })
    .select("signal simOutcome research.factors").lean();
  const out = [];
  for (const side of ["buy", "sell"]) {
    const list = rows.filter((r) => r.signal === side);
    if (list.length < 6) continue;
    const base = list.filter((r) => r.simOutcome === "win").length / list.length;
    const stats = {};
    for (const r of list) for (const k of r.research.factors) {
      stats[k] = stats[k] || { n: 0, w: 0 };
      stats[k].n++;
      if (r.simOutcome === "win") stats[k].w++;
    }
    for (const [k, s] of Object.entries(stats)) {
      if (s.n < 4 || !LABELS[k] || ["fastStop", "wentInFavourFirst", "structureAgainst"].includes(k)) continue;
      const wr = s.w / s.n;
      if (wr <= Math.min(0.3, base - 0.2)) out.push(`AVOID ${pair} ${side.toUpperCase()} ${LABELS[k]}: won ${s.w}/${s.n}`);
      else if (wr >= Math.max(0.7, base + 0.2)) out.push(`FAVOUR ${pair} ${side.toUpperCase()} ${LABELS[k]}: won ${s.w}/${s.n}`);
    }
  }
  return out.slice(0, 6);
};

// Once a day: the AI turns the numbers into a few plain lessons.
exports.dailySummary = async () => {
  const cfg = await AppConfig.findOne({ key: "researchSummary" }).lean();
  if (cfg?.value?.at && Date.now() - new Date(cfg.value.at) < 20 * H) return null;
  const since = new Date(Date.now() - 7 * 24 * H);
  const recent = await Notification.find({ "research.verdict": { $exists: true }, simResolvedAt: { $gte: since } })
    .select("pair signal simOutcome research.verdict").sort({ simResolvedAt: -1 }).limit(300).lean();
  if (recent.length < 10) return null;
  const seen = new Set();
  const lines = [];
  for (const r of recent) {
    const k = `${r.pair}|${r.signal}|${r.research.verdict}`;
    if (seen.has(k)) continue; // the same signal for several users
    seen.add(k);
    lines.push(`${r.pair} ${r.signal.toUpperCase()}: ${r.research.verdict}`);
    if (lines.length >= 60) break;
  }
  const prompt = `You are TradeMind AI's research desk. Below are post-mortems of the last week's forex / gold signals (each: result and the conditions it was taken in). Find the patterns: which conditions keep losing and which keep winning, per pair and direction. Reply with at most 6 short, concrete lessons for future signals (e.g. "Don't sell XAUUSD in the discount half after a top-tier USD release"). Plain text, one lesson per line, no numbering.\n\n${lines.join("\n")}`;
  let text = null;
  try {
    text = await require("./geminiText").generate(prompt, { background: true });
  } catch (err) {
    console.error("Research summary AI failed:", err.message);
  }
  const lessons = String(text || "").split("\n").map((l) => l.replace(/^[-*•\d.\s]+/, "").trim()).filter((l) => l.length > 10).slice(0, 6);
  if (!lessons.length) return null;
  await AppConfig.updateOne({ key: "researchSummary" }, { $set: { value: { at: new Date(), lessons } } }, { upsert: true });
  return lessons;
};

exports.summaryLessons = async () => (await AppConfig.findOne({ key: "researchSummary" }).lean())?.value?.lessons || [];
exports.LABELS = LABELS;
exports._analyze = analyze;
