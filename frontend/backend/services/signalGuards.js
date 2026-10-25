// Loss safeguards around AI signals (added 2026-10-15, after 13-15 Oct:
// ~10 hours of SELLs into a post-CPI dollar sell-off, every one stopped out,
// and EURUSD SELL alongside GBPUSD BUY). Hard rules, checked after the
// fixed checklist (signalRules.checklist); all are per user, from that
// user's own signals (each user gets the same signals).
//   A. Loss brake: 2 stop-losses on the same pair + direction within 12 h
//      pause that direction for 12 h -- released early by a fresh break of
//      structure in the signal's direction after the last stop (so signals
//      resume as soon as the chart confirms, not after a fixed freeze);
//      a pair that lost 3R or more today pauses until tomorrow (EAT).
//   B. No conflicting dollar bets: while a signal that is long USD is still
//      running (e.g. EURUSD SELL), no signal that is short USD (GBPUSD BUY),
//      and vice versa.
//   C. News reaction: for 3 h after a top-tier release (CPI, NFP, rates...)
//      that moved the pair at least 1x its hourly range, only signals in
//      the direction it moved.
const Notification = require("../models/Notification");
const { isTopTier } = require("./economicCalendar");

const H = 3600 * 1000;
const EAT = 3 * H;

// +1 = the signal profits if USD rises, -1 = if USD falls, 0 = no USD.
function usdExposure(pair, signal) {
  const dir = signal === "buy" ? 1 : -1;
  if (pair.slice(3, 6) === "USD") return -dir; // EURUSD BUY = short USD
  if (pair.slice(0, 3) === "USD") return dir; // USDJPY BUY = long USD
  return 0;
}
exports.usdExposure = usdExposure;

const freshBreakFor = (ctx, signal, sinceMs, now) => {
  const want = signal === "buy" ? "bullish" : "bearish";
  // ctx reads count candles ago; 1H = 1 h per candle, 15m = 0.25 h.
  for (const [read, hours] of [[ctx?.h1, 1], [ctx?.m15, 0.25]]) {
    for (const e of [read?.internal?.lastEvent, read?.major?.lastEvent]) {
      if (e && e.dir === want && now - e.ago * hours * H > sinceMs) return `${e.type} ${want} on ${read.label} after the last stop`;
    }
  }
  return null;
};

// scope: which signals count -- the shared record ({ primary: true }) for
// generation, or one user's ({ user }).
exports.evaluate = async ({ scope, pair, signal, ctx, newsCtx, now = new Date() }) => {
  const rules = [];
  const add = (key, label, passed, detail) => rules.push({ key, label, passed, detail, hard: true });
  const t = now.getTime();

  // A. Loss brake
  const recent = await Notification.find({
    ...scope, pair, signal: { $in: ["buy", "sell"] }, type: { $ne: "quick_trade" },
    simOutcome: { $in: ["win", "loss"] }, simResolvedAt: { $gte: new Date(t - 24 * H) },
  }).select("signal simOutcome simR simResolvedAt").lean();
  const sameLosses = recent.filter((n) => n.signal === signal && n.simOutcome === "loss" && t - new Date(n.simResolvedAt) <= 12 * H)
    .sort((a, b) => new Date(b.simResolvedAt) - new Date(a.simResolvedAt));
  const dayStart = (() => { const l = new Date(t + EAT); return Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate()) - EAT; })();
  const todayR = recent.filter((n) => new Date(n.simResolvedAt).getTime() >= dayStart).reduce((s, n) => s + (Number(n.simR) || 0), 0);
  if (todayR <= -3) {
    add("lossBrake", "Loss brake", false, `${pair} has lost ${todayR.toFixed(1)}R today — paused until tomorrow`);
  } else if (sameLosses.length >= 2) {
    const last = new Date(sameLosses[0].simResolvedAt).getTime();
    const release = freshBreakFor(ctx, signal, last, t);
    add("lossBrake", "Loss brake", !!release, release
      ? `${sameLosses.length} recent stop-losses on ${pair} ${signal.toUpperCase()}, but ${release} — resumed`
      : `${sameLosses.length} ${pair} ${signal.toUpperCase()} signals hit their stop in the last 12 h — paused until the chart confirms ${signal === "buy" ? "up" : "down"} again`);
  } else {
    add("lossBrake", "Loss brake", true, sameLosses.length ? `1 recent stop on ${pair} ${signal.toUpperCase()} (pauses after 2)` : `no recent stop-losses on ${pair} ${signal.toUpperCase()}`);
  }

  // B. Conflicting dollar bets
  const mine = usdExposure(pair, signal);
  if (mine !== 0) {
    const running = await Notification.find({
      ...scope, pair: { $ne: pair }, signal: { $in: ["buy", "sell"] }, type: { $ne: "quick_trade" },
      simOutcome: { $exists: false }, createdAt: { $gte: new Date(t - 8 * H) },
    }).select("pair signal").lean();
    const clash = running.find((n) => usdExposure(n.pair, n.signal) === -mine);
    add("usdConflict", "Dollar direction", !clash, clash
      ? `${clash.pair} ${clash.signal.toUpperCase()} (still running) bets the dollar the other way`
      : `no running signal bets the dollar the other way`);
  }

  // C. Respect a strong post-news move
  const strong = (newsCtx?.reactions || []).find((r) => isTopTier(r.event) && r.atrs != null && Math.abs(r.atrs) >= 1);
  if (strong) {
    const moved = strong.move > 0 ? "buy" : "sell";
    add("newsReaction", "News reaction", moved === signal, moved === signal
      ? `with the ${strong.event.currency} ${strong.event.title} move (${strong.atrs.toFixed(1)}x hourly range)`
      : `against the ${strong.event.currency} ${strong.event.title} move — ${pair} went ${moved === "buy" ? "up" : "down"} ${Math.abs(strong.atrs).toFixed(1)}x its hourly range`);
  }

  const blocked = rules.filter((r) => !r.passed);
  return { rules, passed: blocked.length === 0, blocked: blocked.map((r) => r.key) };
};
