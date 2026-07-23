const axios = require("axios");

const TWELVE_DATA_KEY = process.env.TWELVE_DATA_KEY;

const FOREX_PAIRS = [
  "EUR/USD", "GBP/USD", "USD/JPY", "XAU/USD",
  "AUD/USD", "USD/CAD", "NZD/USD", "GBP/JPY",
  "EUR/JPY", "USD/CHF",
];

const CRYPTO_IDS = {
  "BTC/USD": "bitcoin",
  "ETH/USD": "ethereum",
  "XRP/USD": "ripple",
  "BNB/USD": "binancecoin",
  "SOL/USD": "solana",
  "ADA/USD": "cardano",
  "DOGE/USD": "dogecoin",
  "LTC/USD": "litecoin",
};

// Cache — dakika 3
const priceCache = {
  forex: { data: {}, timestamp: 0 },
  crypto: { data: {}, timestamp: 0 },
};
const CACHE_TTL = 3 * 60 * 1000;

const isCacheValid = (entry) =>
  Date.now() - entry.timestamp < CACHE_TTL &&
  Object.keys(entry.data).length > 0;

// Fallback prices — approximate values kwa wakati ambapo APIs zinashindwa
const FALLBACK_PRICES = {
  EURUSD: 1.0850, GBPUSD: 1.2700, USDJPY: 149.50,
  AUDUSD: 0.6500, USDCAD: 1.3600, NZDUSD: 0.6000,
  USDCHF: 0.9100, GBPJPY: 189.00, EURJPY: 162.00,
  XAUUSD: 2330.00,
};

// Pata Gold price kutoka alternative API
const getGoldPrice = async () => {
  try {
    const res = await axios.get(
      "https://api.metals.live/v1/spot/gold",
      { timeout: 8000 }
    );
    if (res.data && res.data[0]?.price) {
      return parseFloat(res.data[0].price);
    }
    return null;
  } catch {
    try {
      // Backup — goldapi alternative
      const res2 = await axios.get(
        "https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD",
        { timeout: 8000 }
      );
      if (res2.data && res2.data[0]?.spreadProfilePrices?.[0]?.ask) {
        return parseFloat(res2.data[0].spreadProfilePrices[0].ask);
      }
    } catch {
      return null;
    }
    return null;
  }
};

// Pata forex prices kutoka Twelve Data
exports.getForexPrices = async () => {
  if (isCacheValid(priceCache.forex)) return priceCache.forex.data;

  const prices = { ...priceCache.forex.data };

  try {
    // Jaribu Twelve Data kwanza
    const forexSymbols = FOREX_PAIRS.filter(p => p !== "XAU/USD").join(",");
    const res = await axios.get(
      `https://api.twelvedata.com/price?symbol=${forexSymbols}&apikey=${TWELVE_DATA_KEY}`,
      { timeout: 12000 }
    );

    if (res.data && typeof res.data === "object") {
      Object.entries(res.data).forEach(([key, val]) => {
        if (val?.price && !isNaN(parseFloat(val.price))) {
          prices[key.replace("/", "")] = parseFloat(val.price);
        }
      });
    }
  } catch (err) {
    console.error("Twelve Data error:", err.message);
  }

  // Pata Gold price separately
  try {
    const goldPrice = await getGoldPrice();
    if (goldPrice) {
      prices["XAUUSD"] = goldPrice;
    } else if (!prices["XAUUSD"]) {
      prices["XAUUSD"] = FALLBACK_PRICES["XAUUSD"];
    }
  } catch {
    if (!prices["XAUUSD"]) prices["XAUUSD"] = FALLBACK_PRICES["XAUUSD"];
  }

  // Weka fallback kwa pairs ambazo hazikupatikana
  Object.entries(FALLBACK_PRICES).forEach(([pair, fallback]) => {
    if (!prices[pair]) {
      prices[pair] = fallback;
      console.log(`Using fallback price for ${pair}: ${fallback}`);
    }
  });

  if (Object.keys(prices).length > 0) {
    priceCache.forex.data = prices;
    priceCache.forex.timestamp = Date.now();
  }

  return prices;
};

// Pata crypto prices — CoinGecko
exports.getCryptoPrices = async () => {
  if (isCacheValid(priceCache.crypto)) return priceCache.crypto.data;

  try {
    const ids = Object.values(CRYPTO_IDS).join(",");
    const res = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
      { timeout: 10000 }
    );
    const prices = {};
    Object.entries(CRYPTO_IDS).forEach(([symbol, id]) => {
      const key = symbol.replace("/", "");
      if (res.data[id]?.usd) prices[key] = res.data[id].usd;
    });
    if (Object.keys(prices).length > 0) {
      priceCache.crypto.data = prices;
      priceCache.crypto.timestamp = Date.now();
    }
    return prices;
  } catch (err) {
    console.error("Crypto prices error:", err.message);
    return priceCache.crypto.data || {};
  }
};

// Pata ALL prices
exports.getAllPrices = async () => {
  try {
    const [forexResult, cryptoResult] = await Promise.allSettled([
      exports.getForexPrices(),
      exports.getCryptoPrices(),
    ]);
    return {
      ...(forexResult.status === "fulfilled" ? forexResult.value : priceCache.forex.data),
      ...(cryptoResult.status === "fulfilled" ? cryptoResult.value : priceCache.crypto.data),
    };
  } catch (err) {
    console.error("All prices error:", err.message);
    return { ...priceCache.forex.data, ...priceCache.crypto.data };
  }
};

// Pata live price ya pair moja
exports.getLivePrice = async (pair) => {
  try {
    const symbol = pair.replace("/", "");
    const cryptoId = CRYPTO_IDS[pair];

    if (cryptoId) {
      const prices = await exports.getCryptoPrices();
      const price = prices[symbol];
      if (price) return { pair: symbol, price, timestamp: new Date() };
      return null;
    } else {
      // Angalia cache kwanza
      const cached = priceCache.forex.data[symbol];
      if (cached && isCacheValid(priceCache.forex)) {
        return { pair: symbol, price: cached, timestamp: new Date() };
      }

      // Kama ni Gold — tumia gold API
      if (symbol === "XAUUSD") {
        const goldPrice = await getGoldPrice();
        if (goldPrice) {
          priceCache.forex.data["XAUUSD"] = goldPrice;
          return { pair: symbol, price: goldPrice, timestamp: new Date() };
        }
        return { pair: symbol, price: FALLBACK_PRICES["XAUUSD"], timestamp: new Date() };
      }

      // Jaribu Twelve Data
      const res = await axios.get(
        `https://api.twelvedata.com/price?symbol=${pair}&apikey=${TWELVE_DATA_KEY}`,
        { timeout: 12000 }
      );
      if (res.data?.price && !isNaN(parseFloat(res.data.price))) {
        const price = parseFloat(res.data.price);
        priceCache.forex.data[symbol] = price;
        return { pair: symbol, price, timestamp: new Date() };
      }

      // Fallback
      const fallback = FALLBACK_PRICES[symbol];
      if (fallback) return { pair: symbol, price: fallback, timestamp: new Date() };
      return null;
    }
  } catch (err) {
    console.error(`Price fetch error ${pair}:`, err.message);
    const symbol = pair.replace("/", "");
    const cached = priceCache.forex.data[symbol] ||
                   priceCache.crypto.data[symbol] ||
                   FALLBACK_PRICES[symbol];
    if (cached) return { pair: symbol, price: cached, timestamp: new Date() };
    return null;
  }
};

// Pata historical data
exports.getHistoricalData = async (pair, interval = "1h", outputsize = 20) => {
  try {
    const cryptoId = CRYPTO_IDS[pair];
    if (cryptoId) {
      const days = interval === "1h" ? 2 : interval === "4h" ? 7 : 30;
      const res = await axios.get(
        `https://api.coingecko.com/api/v3/coins/${cryptoId}/market_chart?vs_currency=usd&days=${days}`,
        { timeout: 10000 }
      );
      const prices = res.data.prices || [];
      return prices.slice(-outputsize).map(([timestamp, price]) => ({
        datetime: new Date(timestamp).toISOString(),
        open: price, high: price * 1.001,
        low: price * 0.999, close: price,
      }));
    } else {
      const res = await axios.get(
        `https://api.twelvedata.com/time_series?symbol=${pair}&interval=${interval}&outputsize=${outputsize}&apikey=${TWELVE_DATA_KEY}`,
        { timeout: 12000 }
      );
      if (res.data?.status === "error") return [];
      return res.data?.values || [];
    }
  } catch (err) {
    console.error("Historical data error:", err.message);
    return [];
  }
};