// Profit / loss of a forex trade from entry, exit and lot size -- the same
// tables as the app's src/utils/tradePL.js (keep them in step).
const PIP_VALUES = {
  EURUSD: 10, GBPUSD: 10, AUDUSD: 10, NZDUSD: 10,
  USDCAD: 10, USDCHF: 10, EURGBP: 10, AUDCAD: 10,
  AUDCHF: 10, USDJPY: 9.1, GBPJPY: 9.1, EURJPY: 9.1,
  AUDJPY: 9.1, CADJPY: 9.1,
  XAUUSD: 1, // 1 lot = 100 oz: $100 per $1 move
  BTCUSD: 1, ETHUSD: 1, XRPUSD: 1, BNBUSD: 1, SOLUSD: 1,
};
const PIP_DECIMALS = {
  USDJPY: 100, GBPJPY: 100, EURJPY: 100,
  AUDJPY: 100, CADJPY: 100, XAUUSD: 100,
  BTCUSD: 1, ETHUSD: 1, XRPUSD: 1, BNBUSD: 1, SOLUSD: 1,
};

exports.calculatePL = (pair, direction, entryPrice, exitPrice, lotSize) => {
  const entry = Number(entryPrice), exit = Number(exitPrice), lots = Number(lotSize);
  if (!pair || !entry || !exit || !lots) return null;
  const pips = (direction === "buy" ? exit - entry : entry - exit) * (PIP_DECIMALS[pair] || 10000);
  const pl = Math.round(pips * (PIP_VALUES[pair] || 10) * lots * 100) / 100;
  return { pips, pl, outcome: pl > 0 ? "win" : pl < 0 ? "loss" : "breakeven" };
};
