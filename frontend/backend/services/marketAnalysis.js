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

// Average true range in price units (not %), over chronologically sorted
// candles -- the basis for sizing intraday stop/target distances.
exports.computeAtr = (candles) => {
  if (!Array.isArray(candles) || candles.length < 3) return null;
  const pct = computeVolatilityPct(chronological(candles));
  const last = Number(chronological(candles).at(-1)?.close);
  return pct != null && last ? (pct / 100) * last : null;
};

// Intraday limits, in multiples of the 1h ATR, for a trade meant to close
// within ~3-4 hours. The model was often ignoring the prompt's "intraday"
// wording and returning swing-sized levels (e.g. GBPUSD targets that
// would take weeks to reach, reported by the user 2026-09-28).
const INTRADAY = { maxEntryGapAtr: 1, minStopAtr: 0.8, defaultStopAtr: 1.5, maxStopAtr: 2.5, maxTargetAtr: 4, maxRR: 2.5 };
exports.INTRADAY_LIMITS = INTRADAY;

// Pulls an AI signal's entry/stopLoss/takeProfit into those limits.
// Returns the adjusted levels plus a note when anything was changed.
exports.fitIntradayLevels = ({ signal, entry, stopLoss, takeProfit }, currentPrice, atr) => {
  if (!atr || !currentPrice || (signal !== "buy" && signal !== "sell")) {
    return { entry, stopLoss, takeProfit, adjusted: false };
  }
  const dir = signal === "buy" ? 1 : -1;
  const changes = [];

  let e = Number(entry);
  if (!e || Math.abs(e - currentPrice) > INTRADAY.maxEntryGapAtr * atr) {
    e = currentPrice;
    changes.push("entry moved to the current price");
  }

  let slDist = (e - Number(stopLoss)) * dir; // positive when on the correct side
  if (!stopLoss || !(slDist > 0)) {
    slDist = INTRADAY.defaultStopAtr * atr;
    changes.push("stop loss set from volatility");
  } else if (slDist > INTRADAY.maxStopAtr * atr) {
    slDist = INTRADAY.maxStopAtr * atr;
    changes.push("stop loss tightened for intraday");
  } else if (slDist < INTRADAY.minStopAtr * atr) {
    slDist = INTRADAY.minStopAtr * atr;
    changes.push("stop loss widened past normal noise");
  }

  const maxTp = Math.min(INTRADAY.maxTargetAtr * atr, INTRADAY.maxRR * slDist);
  let tpDist = (Number(takeProfit) - e) * dir;
  if (!takeProfit || !(tpDist > 0)) {
    tpDist = Math.min(1.5 * slDist, maxTp);
    changes.push("take profit set from volatility");
  } else if (tpDist > maxTp) {
    tpDist = maxTp;
    changes.push("take profit brought within intraday reach");
  } else if (tpDist < slDist) {
    tpDist = Math.min(slDist, maxTp);
    changes.push("take profit raised to at least 1:1");
  }

  const decimals = currentPrice >= 100 ? 2 : currentPrice >= 10 ? 3 : 5;
  const round = (n) => Number(n.toFixed(decimals));
  return {
    entry: round(e),
    stopLoss: round(e - dir * slDist),
    takeProfit: round(e + dir * tpDist),
    adjusted: changes.length > 0,
    note: changes.join(", "),
  };
};
