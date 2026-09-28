// Planned risk:reward of a trade/signal: distance to take-profit divided
// by distance to stop-loss (e.g. 2 means "1 : 2" -- risking 1 to make 2).
// null when a level is missing or zero (e.g. Quick Trade signals, which
// have no stop/target).
export function riskReward(entry, stopLoss, takeProfit) {
  const e = Number(entry), sl = Number(stopLoss), tp = Number(takeProfit);
  if (!e || !sl || !tp) return null;
  const risk = Math.abs(e - sl);
  const reward = Math.abs(tp - e);
  if (!risk || !reward) return null;
  return reward / risk;
}

export function formatRR(rr) {
  return rr == null ? "—" : `1 : ${rr >= 10 ? rr.toFixed(0) : rr.toFixed(1)}`;
}

// Win rate needed just to break even at this R:R: 1 / (1 + R:R).
export function breakevenWinRate(rr) {
  return rr == null ? null : (1 / (1 + rr)) * 100;
}
