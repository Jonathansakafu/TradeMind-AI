// Suggested position size for a signal: risk a fixed amount (riskAmount,
// e.g. $8) -- or else `riskPercent` of `balance` -- between entry and stop
// loss. Contract sizes: standard forex lot = 100,000 units (USD-quoted
// pairs like EURUSD/GBPUSD: 1 lot moves $10 per pip), gold XAUUSD lot =
// 100 oz ($100 per $1 move). A cent account's lot is 1/100 of a standard
// one, so small accounts can size the tested stops. Rounded DOWN to 0.01
// so the real risk never exceeds the chosen amount. Returns null when it
// can't be sized. Same rule in the app: src/utils/lotSize.js.
const CONTRACT = { XAUUSD: 100 };

function suggestedLot({ pair, entry, stopLoss, takeProfit }, settings) {
  const fixed = Number(settings?.riskAmount);
  const riskAmount = fixed > 0 ? fixed : (Number(settings?.balance) * Number(settings?.riskPercent)) / 100;
  const dist = Math.abs(Number(entry) - Number(stopLoss));
  if (!riskAmount || !dist || !pair) return null;
  const quote = pair.slice(3, 6);
  if (pair !== "XAUUSD" && quote !== "USD") return null; // non-USD quote needs a conversion rate
  const cent = settings?.accountType === "cent";
  const perLot = (dist * (CONTRACT[pair] || 100000)) / (cent ? 100 : 1); // loss at SL for 1 account lot
  const raw = riskAmount / perLot;
  const lot = Math.floor(raw * 100 + 1e-9) / 100;
  const tpDist = Math.abs(Number(takeProfit) - Number(entry));
  return {
    lot, lotRaw: raw, riskAmount, cent,
    actualRisk: lot * perLot,
    reward: tpDist ? (lot * perLot * tpDist) / dist : null,
    minRisk: 0.01 * perLot,
    tooSmall: lot < 0.01,
  };
}
module.exports = { suggestedLot };
