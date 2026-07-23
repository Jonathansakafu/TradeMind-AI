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

// Pata forex news
exports.getForexNews = async () => {
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
    return res.data.articles || [];
  } catch (err) {
    console.error("News fetch error:", err.message);
    return [];
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