// Price-action-derived "market pressure" — computed directly from the OHLC
// candles already fetched for signal generation, so this adds no extra
// API calls or latency. This is NOT real order flow / Level 2 depth (no
// data source for that exists in this app) — it's a momentum/volatility
// read off recent price action, and is labeled as such everywhere it
// surfaces so it's never mistaken for genuine order-book pressure.

// marketService.getHistoricalData's two upstream providers disagree on
// order: CoinGecko candles arrive oldest-first, Twelve Data's forex
// candles arrive newest-first (its default, no `order` param is passed).
// Every calc below assumes chronological (oldest-first) order, so
// normalize by datetime rather than trusting whatever order was handed in.
function chronological(candles) {
  return [...candles].sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
}

function toCloses(candles) {
  return candles
    .map((c) => Number(c.close))
    .filter((n) => !isNaN(n));
}

// Wilder's RSI, adapted to whatever candle count is actually available
// (the historical-data fetch typically returns ~10 candles, well short of
// the traditional 14-period window) — period is capped at closes.length-1
// so it still produces a meaningful read on a short series instead of NaN.
function computeRSI(closes) {
  const period = Math.max(2, Math.min(14, closes.length - 1));
  if (closes.length <= period) return null;

  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return Math.round(100 - 100 / (1 + rs));
}

// Average True Range as a % of price — a volatility read independent of
// the pair's absolute price scale (so it means the same thing for EURUSD
// as it does for XAUUSD or BTCUSD).
function computeVolatilityPct(candles) {
  if (candles.length < 2) return null;
  let sumRange = 0, count = 0;
  for (let i = 1; i < candles.length; i++) {
    const high = Number(candles[i].high), low = Number(candles[i].low);
    const prevClose = Number(candles[i - 1].close);
    if ([high, low, prevClose].some((n) => isNaN(n))) continue;
    const trueRange = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    sumRange += trueRange;
    count++;
  }
  if (count === 0) return null;
  const atr = sumRange / count;
  const lastClose = Number(candles[candles.length - 1].close);
  return lastClose ? (atr / lastClose) * 100 : null;
}

function volatilityLabel(pct) {
  if (pct == null) return "unknown";
  if (pct < 0.15) return "low";
  if (pct < 0.4) return "moderate";
  return "high";
}

exports.computeMomentum = (candles) => {
  if (!Array.isArray(candles) || candles.length < 3) {
    return {
      direction: "neutral",
      strength: 0,
      volatility: "unknown",
      rsi: null,
      summary: "Not enough recent candles to read momentum.",
    };
  }

  candles = chronological(candles);
  const closes = toCloses(candles);
  const rsi = computeRSI(closes);
  const volatilityPct = computeVolatilityPct(candles);
  const volatility = volatilityLabel(volatilityPct);

  const first = closes[0], last = closes[closes.length - 1];
  const changePct = first ? ((last - first) / first) * 100 : 0;
  const direction = changePct > 0.05 ? "bullish" : changePct < -0.05 ? "bearish" : "neutral";
  const strength = Math.min(100, Math.round(Math.abs(changePct) * 20));

  const rsiNote = rsi != null
    ? `RSI ~${rsi}${rsi >= 70 ? " (overbought territory)" : rsi <= 30 ? " (oversold territory)" : ""}`
    : "RSI unavailable (too few candles)";

  const summary = `Price-action read (not order flow): ${direction} momentum over the recent candles `
    + `(${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}% net move, strength ${strength}/100), `
    + `${rsiNote}, ${volatility} volatility`
    + (volatilityPct != null ? ` (~${volatilityPct.toFixed(2)}% ATR)` : "") + ".";

  return { direction, strength, volatility, volatilityPct, rsi, summary };
};
