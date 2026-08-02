const Notification = require("../models/Notification");
const Trade = require("../models/Trade");
const TradingSession = require("../models/TradingSession");
const marketService = require("../services/marketService");
const newsService = require("../services/newsService");
const claudeAI = require("../services/claudeAI");
const ragService = require("../services/ragService");

// Crypto pairs zinapatikana 24/7 — zitumike kwanza kwa notifications
const CRYPTO_PAIRS = ["BTCUSD", "ETHUSD", "XRPUSD"];
// Forex zitatumika kama zinapatikana tu
const FOREX_PAIRS = ["EURUSD", "GBPUSD", "XAUUSD"];
const LIMIT_STOPPED_STATUSES = ["stopped_profit", "stopped_risk", "stopped_trades"];

// Pocket Option/Expert Option OTC instruments (e.g. "EUR/USD OTC") are
// broker-generated synthetic prices with no independent public data feed —
// there's no third-party API for them. We look up quotes using the
// underlying real pair as the closest honest proxy, while keeping the OTC
// label for display so it matches what the trader sees in their broker app.
function toMarketSymbol(pair) {
  const base = pair.replace(/\s*OTC$/i, "").trim();
  if (/^gold$/i.test(base)) return "XAUUSD";
  return base.replace(/\//g, "").toUpperCase();
}

// Default Quick Trade pairs when a session didn't specify any. Must match
// the exact OTC display text Pocket Option's own UI shows (same list as
// QUICK_TRADE_OTC_PAIRS in frontend/src/pages/TradingSession.jsx) — the
// auto-execute browser extension matches a signal's pair against that
// exact on-page text, so a raw MT5-style symbol like "BTCUSD" (used
// elsewhere in this file for the forex/MT5 path) would never be found in
// Pocket Option's pair picker and every Quick Trade signal would fail.
const QUICK_TRADE_DEFAULT_PAIRS = [
  "EUR/USD OTC", "GBP/USD OTC", "USD/JPY OTC", "AUD/USD OTC", "USD/CAD OTC",
  "USD/CHF OTC", "NZD/USD OTC", "EUR/JPY OTC", "GBP/JPY OTC", "Gold OTC",
];

// Quick Trade signals — direction + confidence only, no entry/SL/TP, since
// the trader executes on Pocket Option/Expert Option themselves. Mirrors
// the forex loop below but calls analyzeQuickSignal instead.
async function generateQuickTradeSignals(userId, session) {
  const prices = await marketService.getAllPrices();
  const candidatePairs = session.pairs?.length ? session.pairs : QUICK_TRADE_DEFAULT_PAIRS;
  const availablePairs = candidatePairs.filter((p) => prices[toMarketSymbol(p)]);

  let created = 0;
  for (const pair of availablePairs) {
    if (created >= 2) break; // cap per cycle, but only counting pairs we actually generated for
    try {
      // Checked before doing any AI work, and against every candidate pair
      // (not just the first 2) — otherwise repeatedly generating within
      // the same window always re-tries the same leading pairs, finds
      // them already deduped, and silently produces nothing new. Window
      // shortened from 10min to 2min while there's a single user actively
      // testing (repeatedly clicking Generate can otherwise exhaust all
      // ~10 default pairs' cooldowns within a few minutes) — widen this
      // back once there are real users, so it's not spamming them.
      const DEDUP_WINDOW_MS = 2 * 60 * 1000;
      const existingRecent = await Notification.findOne({
        user: userId,
        pair,
        type: "quick_trade",
        createdAt: { $gte: new Date(Date.now() - DEDUP_WINDOW_MS) },
      });
      if (existingRecent) continue;

      const marketSymbol = toMarketSymbol(pair);
      const currentPrice = prices[marketSymbol];
      const formattedPair = pair.includes("/")
        ? pair.replace(/\s*OTC$/i, "").trim()
        : marketSymbol.slice(0, 3) + "/" + marketSymbol.slice(3);

      let historical = [];
      try {
        historical = await marketService.getHistoricalData(formattedPair, "1h", 10);
      } catch (err) {
        console.error(`Historical data failed for ${pair}:`, err.message);
      }

      const analysis = await claudeAI.analyzeQuickSignal(formattedPair, currentPrice, historical);

      if (analysis.direction && analysis.direction !== "wait") {
        await Notification.create({
          user: userId,
          pair,
          signal: analysis.direction,
          reasoning: analysis.reasoning || "AI generated quick trade signal",
          confidence: analysis.confidence || 60,
          source: "ai_auto",
          sourceLabel: "Quick Trade Signal",
          type: "quick_trade",
          expiresInMinutes: analysis.expiresInMinutes || 5,
          tradingSessionId: session._id,
          read: false,
        });
        created++;
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (err) {
      console.error(`Error analyzing quick trade ${pair}:`, err.message);
    }
  }
  return created;
}

exports.autoGenerate = async (userId) => {
  try {
    // A session (either mode) manages this user's signal budget once
    // they've opted into one. If their most recent session hit a limit,
    // stop suggesting new trades until they start a fresh session — users
    // who've never used sessions are completely unaffected.
    const latestSession = await TradingSession.findOne({ user: userId }).sort({ createdAt: -1 });
    if (latestSession && LIMIT_STOPPED_STATUSES.includes(latestSession.status)) {
      console.log(`⏸ Skipping signal generation for ${userId} — session limit reached`);
      return 0;
    }

    const activeSession = latestSession?.status === "active" ? latestSession : null;
    if (activeSession?.mode === "quick_trade") {
      const created = await generateQuickTradeSignals(userId, activeSession);
      console.log(`✅ Generated ${created} quick trade notifications for user ${userId}`);
      return created;
    }

    const [pastTrades, prices] = await Promise.all([
      Trade.find({ user: userId }).sort({ openedAt: -1 }).limit(50),
      marketService.getAllPrices(),
    ]);

    // Angalia ni pairs zipi zina prices — crypto kwanza
    const availablePairs = [];

    for (const pair of CRYPTO_PAIRS) {
      if (prices[pair]) availablePairs.push(pair);
    }
    for (const pair of FOREX_PAIRS) {
      if (prices[pair]) availablePairs.push(pair);
    }

    // Kama hakuna prices — tumia crypto tu bila price (AI auto mode)
    if (availablePairs.length === 0) {
      console.log("No live prices available — using AI auto mode for crypto");
      availablePairs.push(...CRYPTO_PAIRS);
    }

    // Analyze pairs 2 tu ili kuepuka rate limits
    const pairsToAnalyze = availablePairs.slice(0, 2);
    const notifications = [];

    // Pata news mara moja tu
    let newsArticles = [];
    try {
      newsArticles = await newsService.getForexNews();
    } catch (err) {
      console.error("News fetch failed:", err.message);
    }

    for (const pair of pairsToAnalyze) {
      try {
        const currentPrice = prices[pair] || null;
        const formattedPair = pair.slice(0, 3) + "/" + pair.slice(3);

        // Historical data — optional, usisimamishe kama imeshindwa
        let historical = [];
        try {
          historical = await marketService.getHistoricalData(formattedPair, "1h", 10);
        } catch (err) {
          console.error(`Historical data failed for ${pair}:`, err.message);
        }

        const relevantNews = newsService.getNewsSentiment(newsArticles, pair);
        const retrievedChunks = await ragService.retrieve(
          userId, `${formattedPair} trading strategy signal`, { topK: 6 }
        );

        const analysis = await claudeAI.analyzeMarketSmart(
          formattedPair,
          currentPrice || 0,
          historical,
          pastTrades,
          retrievedChunks,
          relevantNews
        );

        if (analysis.signal && analysis.signal !== "wait") {
          // Angalia kama notification kama hii haijatumwa leo
          const existingToday = await Notification.findOne({
            user: userId,
            pair,
            signal: analysis.signal,
            createdAt: { $gte: new Date(Date.now() - 6 * 60 * 60 * 1000) },
          });

          if (!existingToday) {
            const notification = await Notification.create({
              user: userId,
              pair,
              signal: analysis.signal,
              entry: analysis.entry || currentPrice || 0,
              stopLoss: analysis.stopLoss || 0,
              takeProfit: analysis.takeProfit || 0,
              reasoning: analysis.reasoning || "AI generated signal",
              confidence: analysis.confidence || 60,
              source: analysis.source || "ai_auto",
              sourceLabel: analysis.sourceLabel || "AI Auto",
              read: false,
            });
            notifications.push(notification);
            console.log(`✅ Notification created: ${analysis.signal} ${pair}`);
          } else {
            console.log(`⏭ Skipped duplicate: ${pair} ${analysis.signal}`);
          }
        }

        // Pumzika sekunde 2 kati ya pairs — epuka rate limit
        await new Promise((resolve) => setTimeout(resolve, 2000));

      } catch (err) {
        console.error(`Error analyzing ${pair}:`, err.message);
      }
    }

    // News notifications
    if (newsArticles.length > 0) {
      try {
        const topNews = newsArticles.slice(0, 1);
        for (const article of topNews) {
          const impact = await claudeAI.analyzeNewsImpact(
            article, [...CRYPTO_PAIRS, ...FOREX_PAIRS].slice(0, 3)
          );
          if (impact.impactLevel === "high" && impact.affectedPairs?.length > 0) {
            const affectedPair = impact.affectedPairs[0];
            const signalType = affectedPair.impact === "bullish" ? "buy"
              : affectedPair.impact === "bearish" ? "sell" : null;

            if (signalType) {
              await Notification.create({
                user: userId,
                pair: affectedPair.pair || "BTCUSD",
                signal: signalType,
                entry: affectedPair.entry || 0,
                stopLoss: affectedPair.stopLoss || 0,
                takeProfit: affectedPair.takeProfit || 0,
                reasoning: `📰 ${article.title}\n\n${impact.tradingAdvice}`,
                confidence: 65,
                source: "ai_auto",
                sourceLabel: "News Impact Alert",
                read: false,
              });
            }
          }
        }
      } catch (err) {
        console.error("News notification error:", err.message);
      }
    }

    console.log(`✅ Generated ${notifications.length} notifications for user ${userId}`);
    return notifications.length;
  } catch (err) {
    console.error("Auto generate error:", err.message);
    return 0;
  }
};

// Manual generate — from button click
exports.generateNotifications = async (req, res) => {
  try {
    console.log(`Manual generate triggered for user ${req.user._id}`);
    const count = await exports.autoGenerate(req.user._id);
    const notifications = await Notification.find({ user: req.user._id })
      .sort({ createdAt: -1 }).limit(20);
    const unreadCount = await Notification.countDocuments({
      user: req.user._id, read: false,
    });
    res.json({
      notifications,
      unreadCount,
      generated: count,
      message: count > 0
        ? `${count} new signal(s) generated`
        : "No new signals — market conditions suggest waiting",
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get notifications
exports.getNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({ user: req.user._id })
      .sort({ createdAt: -1 }).limit(20);
    const unreadCount = await Notification.countDocuments({
      user: req.user._id, read: false,
    });
    res.json({ notifications, unreadCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Mark as read
exports.markAsRead = async (req, res) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { read: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Mark all as read
exports.markAllAsRead = async (req, res) => {
  try {
    await Notification.updateMany({ user: req.user._id }, { read: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Delete notification
exports.deleteNotification = async (req, res) => {
  try {
    await Notification.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};