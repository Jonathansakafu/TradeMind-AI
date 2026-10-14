// The trader's own numbers for Ask AI (added 2026-10-14): retrieval only
// finds text snippets, so "How was my performance last month?" got "open
// the Performance page" instead of an answer. Every question now carries a
// compact summary straight from the database -- results per period (today
// ... all time), month by month, open trades and TradeMind's auto-scored
// signal results -- so the AI can answer in any language without guessing
// which period was meant. Periods use East Africa Time (UTC+3), the
// trader's time zone. Same win-rate rules as the Performance page: only
// trades with a recorded outcome count.
const Trade = require("../models/Trade");
const Notification = require("../models/Notification");
const User = require("../models/User");

const TZ_MS = 3 * 3600 * 1000; // EAT
const DAY = 24 * 3600 * 1000;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Local (EAT) calendar helpers, returned as UTC Dates.
const local = (d) => new Date(d.getTime() + TZ_MS); // read with getUTC*
const fromLocal = (y, m, day = 1) => new Date(Date.UTC(y, m, day) - TZ_MS);
const fmtDay = (d) => { const l = local(d); return `${l.getUTCDate()} ${MONTHS[l.getUTCMonth()].slice(0, 3)}`; };

function periods(now) {
  const l = local(now);
  const y = l.getUTCFullYear(), m = l.getUTCMonth(), d = l.getUTCDate();
  const today = fromLocal(y, m, d);
  const dow = (l.getUTCDay() + 6) % 7; // Monday = 0
  const weekStart = new Date(today.getTime() - dow * DAY);
  return [
    { label: `Today (${fmtDay(today)})`, from: today, to: now },
    { label: `Yesterday (${fmtDay(new Date(today - DAY))})`, from: new Date(today - DAY), to: today },
    { label: `This week (since Mon ${fmtDay(weekStart)})`, from: weekStart, to: now },
    { label: `Last week (${fmtDay(new Date(weekStart - 7 * DAY))}–${fmtDay(new Date(weekStart - DAY))})`, from: new Date(weekStart - 7 * DAY), to: weekStart },
    { label: `This month (${MONTHS[m]} ${y}, so far)`, from: fromLocal(y, m), to: now },
    { label: `Last month (${MONTHS[(m + 11) % 12]} ${m ? y : y - 1})`, from: fromLocal(m ? y : y - 1, (m + 11) % 12), to: fromLocal(y, m) },
    { label: "Last 30 days", from: new Date(now - 30 * DAY), to: now },
    { label: `This year (${y})`, from: fromLocal(y, 0), to: now },
    { label: "All time", from: new Date(0), to: now },
  ];
}

const doneAt = (t) => new Date(t.closedAt || t.openedAt || t.createdAt);

function summarize(trades, money) {
  const closed = trades.filter((t) => t.outcome);
  if (!closed.length) return "no closed trades";
  const wins = closed.filter((t) => t.outcome === "win").length;
  const losses = closed.filter((t) => t.outcome === "loss").length;
  const be = closed.length - wins - losses;
  const net = closed.reduce((s, t) => s + (Number(t.profitLoss) || 0), 0);
  const byPair = new Map();
  for (const t of closed) byPair.set(t.pair, (byPair.get(t.pair) || 0) + (Number(t.profitLoss) || 0));
  const pairs = [...byPair.entries()].sort((a, b) => b[1] - a[1]);
  const parts = [
    `${closed.length} trades: ${wins} wins, ${losses} losses${be ? `, ${be} breakeven` : ""}`,
    `win rate ${Math.round((wins / closed.length) * 100)}%`,
    `net P/L ${money(net)}`,
  ];
  if (pairs.length > 1) parts.push(`best pair ${pairs[0][0]} (${money(pairs[0][1])}), worst ${pairs.at(-1)[0]} (${money(pairs.at(-1)[1])})`);
  else parts.push(`pair ${pairs[0][0]}`);
  return parts.join(", ");
}

function signalLine(sigs) {
  const won = sigs.filter((s) => s.simOutcome === "win").length;
  const lost = sigs.filter((s) => s.simOutcome === "loss").length;
  const expired = sigs.filter((s) => s.simOutcome === "expired").length;
  if (!won && !lost && !expired) return "none scored";
  const r = sigs.reduce((s, x) => s + (Number(x.simR) || 0), 0);
  return `${won} hit take profit, ${lost} hit stop loss, ${expired} expired${won + lost ? ` (accuracy ${Math.round((won / (won + lost)) * 100)}%)` : ""}, total ${r >= 0 ? "+" : ""}${r.toFixed(1)}R`;
}

exports.build = async (userId, now = new Date()) => {
  const [trades, user, signals] = await Promise.all([
    Trade.find({ user: userId }).select("pair direction outcome profitLoss status openedAt closedAt createdAt type").lean(),
    User.findById(userId).select("riskSettings").lean(),
    Notification.find({ user: userId, simOutcome: { $exists: true }, createdAt: { $gte: new Date(now - 62 * DAY) } })
      .select("simOutcome simR createdAt").lean(),
  ]);
  const ccy = user?.riskSettings?.currency || "USD";
  const sym = { USD: "$", EUR: "€", GBP: "£" }[ccy];
  const money = (n) => `${n < 0 ? "-" : "+"}${sym || ""}${Math.abs(n).toFixed(2)}${sym ? "" : ` ${ccy}`}`;
  const asOf = local(now).toISOString().slice(0, 16).replace("T", " ");

  const lines = [`Your trading data — from the trader's TradeMind trade journal (database), as of ${asOf} East Africa Time:`];
  if (!trades.length) {
    lines.push("- The journal has no trades yet.");
  } else {
    lines.push("Results by period (closed trades with a recorded result):");
    for (const p of periods(now)) {
      lines.push(`- ${p.label}: ${summarize(trades.filter((t) => doneAt(t) >= p.from && doneAt(t) < p.to), money)}`);
    }
    const l = local(now);
    const monthly = [];
    for (let i = 1; i <= 12; i++) {
      const y = l.getUTCFullYear(), m = l.getUTCMonth() - i;
      const from = fromLocal(y, m), to = fromLocal(y, m + 1);
      const list = trades.filter((t) => doneAt(t) >= from && doneAt(t) < to);
      if (list.some((t) => t.outcome)) monthly.push(`${MONTHS[local(from).getUTCMonth()].slice(0, 3)} ${local(from).getUTCFullYear()}: ${summarize(list, money)}`);
    }
    if (monthly.length) lines.push("Month by month:", ...monthly.map((x) => `- ${x}`));
    const open = trades.filter((t) => t.status === "open");
    lines.push(`- Open trades now: ${open.length ? open.map((t) => `${t.pair} ${String(t.direction).toUpperCase()}`).join(", ") : "none"}`);
  }
  if (signals.length) {
    const l = local(now);
    const thisMonth = fromLocal(l.getUTCFullYear(), l.getUTCMonth());
    const lastMonth = fromLocal(l.getUTCFullYear(), l.getUTCMonth() - 1);
    lines.push("TradeMind AI signal results (auto-scored against real prices, whether or not the trader took them):");
    lines.push(`- This month: ${signalLine(signals.filter((s) => s.createdAt >= thisMonth))}`);
    lines.push(`- Last month: ${signalLine(signals.filter((s) => s.createdAt >= lastMonth && s.createdAt < thisMonth))}`);
  }
  return lines.join("\n");
};

exports.periods = periods;
