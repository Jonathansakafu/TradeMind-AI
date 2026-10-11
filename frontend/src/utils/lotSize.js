// Suggested position size for a signal: risk `riskPercent` of `balance`
// between entry and stop loss. Contract sizes: standard forex lot = 100,000
// units (USD-quoted pairs like EURUSD/GBPUSD: 1 lot moves $10 per pip),
// gold XAUUSD lot = 100 oz ($100 per $1 move). Rounded DOWN to 0.01 so the
// real risk never exceeds the chosen %. Returns null when it can't be sized.
const CONTRACT = { XAUUSD: 100 };

export function suggestedLot({ pair, entry, stopLoss }, settings) {
  const balance = Number(settings?.balance), pct = Number(settings?.riskPercent);
  const dist = Math.abs(Number(entry) - Number(stopLoss));
  if (!balance || !pct || !dist || !pair) return null;
  const quote = pair.slice(3, 6);
  if (pair !== "XAUUSD" && quote !== "USD") return null; // non-USD quote needs a conversion rate
  const contract = CONTRACT[pair] || 100000;
  const riskAmount = (balance * pct) / 100;
  const raw = riskAmount / (dist * contract);
  const lot = Math.floor(raw * 100) / 100;
  return { lot, lotRaw: raw, riskAmount, actualRisk: lot * dist * contract, tooSmall: lot < 0.01 };
}
