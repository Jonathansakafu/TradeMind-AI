const axios = require("axios");

const NEWS_API_KEY = process.env.NEWS_API_KEY;

const PAIR_KEYWORDS = {
  EURUSD: ["EUR", "euro", "ECB", "eurozone", "European"],
  GBPUSD: ["GBP", "pound", "sterling", "Bank of England", "Brexit", "UK"],
  USDJPY: ["JPY", "yen", "Bank of Japan", "BOJ", "Japan"],
  XAUUSD: ["gold", "XAU", "safe haven", "inflation"],
  AUDUSD: ["AUD", "aussie", "Australia", "RBA"],
  USDCAD: ["CAD", "loonie", "Canada", "oil", "Bank of Canada"],
  GBPJPY: ["GBP", "JPY", "pound", "yen"],
  NZDUSD: ["NZD", "kiwi", "New Zealand", "RBNZ"],
  USDCHF: ["CHF", "franc", "Switzerland", "SNB"],
  EURJPY: ["EUR", "JPY", "euro", "yen"],
};

// Cache — dakika 20. Global news is identical for every user, so without
// this every user's auto-generate cycle re-hits NewsAPI's free 100 req/day
// quota for the exact same articles.
const newsCache = { data: [], timestamp: 0 };
const NEWS_CACHE_TTL = 20 * 60 * 1000;

// Pata forex news
exports.getForexNews = async () => {
  if (Date.now() - newsCache.timestamp < NEWS_CACHE_TTL && newsCache.data.length > 0) {
    return newsCache.data;
  }

  try {
    const query = "forex OR currency OR \"Federal Reserve\" OR \"interest rate\" OR gold OR dollar";
    const res = await axios.get("https://newsapi.org/v2/everything", {
      params: {
        q: query,
        language: "en",
        sortBy: "publishedAt",
        pageSize: 20,
        apiKey: NEWS_API_KEY,
      },
    });
    const articles = res.data.articles || [];
    if (articles.length > 0) {
      newsCache.data = articles;
      newsCache.timestamp = Date.now();
    }
    return articles;
  } catch (err) {
    console.error("News fetch error:", err.message);
    return newsCache.data;
  }
};

// Pata impact ya news kwenye pair
exports.getPairImpact = (article, pair) => {
  const keywords = PAIR_KEYWORDS[pair] || [];
  const text = `${article.title} ${article.description || ""}`.toLowerCase();
  const matches = keywords.filter((k) => text.toLowerCase().includes(k.toLowerCase()));
  return matches.length > 0 ? matches.length : 0;
};

// Analyze sentiment ya news
exports.getNewsSentiment = (articles, pair) => {
  const relevant = articles.filter((a) => {
    const impact = exports.getPairImpact(a, pair);
    return impact > 0;
  });
  return relevant.slice(0, 5);
};