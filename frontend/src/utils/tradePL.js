// Profit / loss of a forex trade from entry, exit and lot size -- shared by
// Add Trade, its confirmation window and the trade-history editor.

export const PIP_VALUES = {
  EURUSD: 10, GBPUSD: 10, AUDUSD: 10, NZDUSD: 10,
  USDCAD: 10, USDCHF: 10, EURGBP: 10, AUDCAD: 10,
  AUDCHF: 10, USDJPY: 9.1, GBPJPY: 9.1, EURJPY: 9.1,
  AUDJPY: 9.1, CADJPY: 9.1,
  // Gold: 1 lot = 100 oz, so $1 per 0.01 "pip" per lot ($100 per $1 move,
  // same as utils/lotSize.js). Was 10 -- gold P/L came out 10x too big.
  XAUUSD: 1,
  BTCUSD: 1, ETHUSD: 1, XRPUSD: 1, BNBUSD: 1, SOLUSD: 1,
};

export const PIP_DECIMALS = {
  USDJPY: 100, GBPJPY: 100, EURJPY: 100,
  AUDJPY: 100, CADJPY: 100, XAUUSD: 100,
  BTCUSD: 1, ETHUSD: 1, XRPUSD: 1, BNBUSD: 1, SOLUSD: 1,
};

export const calculatePL = (pair, direction, entryPrice, exitPrice, lotSize) => {
  if (!pair || !entryPrice || !exitPrice || !lotSize) return null;
  const entry = parseFloat(entryPrice);
  const exit = parseFloat(exitPrice);
  const lots = parseFloat(lotSize);
  if (isNaN(entry) || isNaN(exit) || isNaN(lots)) return null;
  const pipDecimal = PIP_DECIMALS[pair] || 10000;
  const pipValue = PIP_VALUES[pair] || 10;
  const priceDiff = direction === "buy" ? exit - entry : entry - exit;
  const pips = priceDiff * pipDecimal;
  const pl = pips * pipValue * lots;
  return {
    pips: pips.toFixed(1),
    pl: pl.toFixed(2),
    outcome: pl > 0 ? "win" : pl < 0 ? "loss" : "breakeven",
  };
};
