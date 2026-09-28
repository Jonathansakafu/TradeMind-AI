// Performance statistics for the Performance page -- the metric set common
// to trading journals (TradeZella, Tradervue, Edgewonk): win rate with
// win/breakeven/loss counts, profit factor, average win vs loss,
// expectancy, max drawdown, streaks, a cumulative P/L (equity) curve and
// win rate broken down by pair, direction, session and weekday.
// Pure functions over the trade list so they're easy to test.

import { riskReward } from "./riskReward.js";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SESSION_LABELS = {
  london: "London", new_york: "New York", tokyo: "Tokyo", sydney: "Sydney", overlap: "Overlap",
};

const pl = (t) => Number(t.profitLoss) || 0;
const closedTime = (t) => new Date(t.closedAt || t.openedAt || t.createdAt).getTime();

export function filterTrades(trades, { period = "all", type = "all" } = {}) {
  const days = { "7d": 7, "30d": 30, "90d": 90 }[period];
  const since = days ? Date.now() - days * 24 * 60 * 60 * 1000 : null;
  return trades.filter((t) => {
    if (type !== "all" && (t.type || "forex") !== type) return false;
    if (since && closedTime(t) < since) return false;
    return true;
  });
}

function group(closed, keyOf) {
  const map = new Map();
  for (const t of closed) {
    const key = keyOf(t);
    const g = map.get(key) || { key, trades: 0, wins: 0, losses: 0, netPL: 0 };
    g.trades++;
    if (t.outcome === "win") g.wins++;
    if (t.outcome === "loss") g.losses++;
    g.netPL += pl(t);
    map.set(key, g);
  }
  return [...map.values()]
    .map((g) => ({ ...g, winRate: g.trades ? (g.wins / g.trades) * 100 : 0 }))
    .sort((a, b) => b.trades - a.trades || b.winRate - a.winRate);
}

export function computeStats(trades) {
  // Only trades with a recorded result count toward performance.
  const closed = trades
    .filter((t) => t.outcome)
    .sort((a, b) => closedTime(a) - closedTime(b));

  const wins = closed.filter((t) => t.outcome === "win");
  const losses = closed.filter((t) => t.outcome === "loss");
  const breakeven = closed.filter((t) => t.outcome === "breakeven");

  const grossProfit = wins.reduce((s, t) => s + Math.max(0, pl(t)), 0);
  const grossLoss = losses.reduce((s, t) => s + Math.abs(Math.min(0, pl(t))), 0);
  const netPL = closed.reduce((s, t) => s + pl(t), 0);
  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;

  // Cumulative P/L after each trade, running win rate, and max drawdown
  // (largest peak-to-trough fall of the cumulative P/L).
  let cum = 0, peak = 0, maxDrawdown = 0, winsSoFar = 0;
  const series = closed.map((t, i) => {
    cum += pl(t);
    if (t.outcome === "win") winsSoFar++;
    peak = Math.max(peak, cum);
    maxDrawdown = Math.max(maxDrawdown, peak - cum);
    return {
      n: i + 1,
      date: new Date(closedTime(t)),
      pair: t.pair,
      direction: t.direction,
      outcome: t.outcome,
      pl: pl(t),
      cumPL: cum,
      winRate: (winsSoFar / (i + 1)) * 100,
    };
  });

  // Streaks (breakeven breaks a streak).
  let longestWin = 0, longestLoss = 0, run = 0, runType = null;
  for (const t of closed) {
    if (t.outcome === runType) run++;
    else { runType = t.outcome; run = 1; }
    if (runType === "win") longestWin = Math.max(longestWin, run);
    if (runType === "loss") longestLoss = Math.max(longestLoss, run);
  }
  const currentStreak = closed.length ? { type: runType, count: run } : null;

  // Average planned risk:reward over closed trades that had both a stop
  // loss and a take profit set.
  const rrs = closed.map((t) => riskReward(t.entryPrice, t.stopLoss, t.takeProfit)).filter((v) => v != null);
  const avgRR = rrs.length ? rrs.reduce((a, b) => a + b, 0) / rrs.length : null;

  return {
    total: trades.length,
    open: trades.filter((t) => !t.outcome).length,
    closed: closed.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: breakeven.length,
    winRate: closed.length ? (wins.length / closed.length) * 100 : 0,
    netPL,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    avgWin,
    avgLoss,
    winLossRatio: avgLoss > 0 ? avgWin / avgLoss : null,
    expectancy: closed.length ? netPL / closed.length : 0,
    largestWin: wins.reduce((m, t) => Math.max(m, pl(t)), 0),
    largestLoss: losses.reduce((m, t) => Math.min(m, pl(t)), 0),
    maxDrawdown,
    longestWin,
    longestLoss,
    currentStreak,
    avgRR,
    rrCount: rrs.length,
    series,
    breakdowns: {
      pair: group(closed, (t) => t.pair || "—"),
      direction: group(closed, (t) => (t.direction === "buy" ? "Long (BUY)" : t.direction === "sell" ? "Short (SELL)" : "—")),
      session: group(closed, (t) => SESSION_LABELS[t.session] || "Not set"),
      weekday: group(closed, (t) => WEEKDAYS[new Date(t.openedAt || closedTime(t)).getDay()])
        .sort((a, b) => WEEKDAYS.indexOf(a.key) - WEEKDAYS.indexOf(b.key)),
    },
  };
}

export function formatMoney(n, { sign = true } = {}) {
  if (!Number.isFinite(n)) return "—";
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (!sign) return (n < 0 ? "-" : "") + s;
  return (n > 0 ? "+" : n < 0 ? "-" : "") + s;
}
