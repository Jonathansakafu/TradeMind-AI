const marketService = require("../services/marketService");
const newsService = require("../services/newsService");
const claudeAI = require("../services/claudeAI");
const ragService = require("../services/ragService");
const Trade = require("../models/Trade");

const PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "AUDUSD", "GBPJPY"];

exports.getLivePrices = async (req, res) => {
  try {
    const prices = await marketService.getAllPrices();
    res.json({ prices, timestamp: new Date() });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.analyzePair = async (req, res) => {
  try {
    const { pair } = req.params;
    const formattedPair = pair.slice(0, 3) + "/" + pair.slice(3);

    const [priceData, pastTrades, newsArticles] = await Promise.all([
      marketService.getLivePrice(formattedPair),
      Trade.find({ user: req.user._id }).sort({ openedAt: -1 }).limit(50),
      newsService.getForexNews(),
    ]);

    if (!priceData) {
      return res.status(400).json({ message: "Currently no suggested trades for " + pair });
    }

    const historical = await marketService.getHistoricalData(formattedPair, "1h", 20);
    const relevantNews = newsService.getNewsSentiment(newsArticles, pair);
    const retrievedChunks = await ragService.retrieve(req.user._id, `${formattedPair} trading strategy signal`, { topK: 6 });

    const analysis = await claudeAI.analyzeMarketSmart(
      formattedPair, priceData.price, historical,
      pastTrades, retrievedChunks, relevantNews
    );

    res.json({
      pair, currentPrice: priceData.price,
      timestamp: priceData.timestamp, analysis,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getNews = async (req, res) => {
  try {
    const { q } = req.query;
    let articles;
    if (q) {
      // Custom search
      const axios = require("axios");
      const res2 = await axios.get("https://newsapi.org/v2/everything", {
        params: {
          q: `${q} forex OR currency OR trading`,
          language: "en",
          sortBy: "publishedAt",
          pageSize: 20,
          apiKey: process.env.NEWS_API_KEY,
        },
      });
      articles = res2.data.articles || [];
    } else {
      articles = await newsService.getForexNews();
    }
    res.json({ articles });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
exports.analyzeNews = async (req, res) => {
  try {
    const { article } = req.body;
    if (!article) return res.status(400).json({ message: "Article inahitajika" });
    const analysis = await claudeAI.analyzeNewsImpact(article, PAIRS);
    res.json(analysis);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};