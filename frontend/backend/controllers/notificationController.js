const crypto = require("crypto");
const Notification = require("../models/Notification");
const Trade = require("../models/Trade");
const TradingSession = require("../models/TradingSession");
const MT5Signal = require("../models/MT5Signal");
const marketService = require("../services/marketService");
const newsService = require("../services/newsService");
const claudeAI = require("../services/claudeAI");
const ragService = require("../services/ragService");
const { computeMomentum } = require("../services/marketAnalysis");

// Crypto pairs zinapatikana 24/7 — zitumike kwanza kwa notifications
const CRYPTO_PAIRS = ["BTCUSD", "ETHUSD", "XRPUSD"];
// Forex zitatumika kama zinapatikana tu
const FOREX_PAIRS = ["EURUSD", "GBPUSD", "XAUUSD"];
// Stocks — same real-data pipeline as gold (marketService's Yahoo Finance
// path), analyzed alongside forex/crypto rather than as a separate mode.
const STOCK_PAIRS = marketService.STOCK_SYMBOLS;
const LIMIT_STOPPED_STATUSES = ["stopped_profit", "stopped_risk", "stopped_trades"];

// Pocket Option/Expert Option OTC instruments (e.g. "EUR/USD OTC") are
// broker-generated synthetic prices with no independent public data feed —
// there's no third-party API for them. We look up quotes using the
// underlying real pair as the closest honest proxy, while keeping the OTC
// label for display so it matches what the trader sees in their broker app.
const toMarketSymbol = marketService.normalizeSymbol;

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

  // Fetched once for the whole cycle, not per pair -- it's the same
  // regardless of which pair is being analyzed, and it's a Mongo query
  // (cheap), but no reason to repeat it up to ~10x per cycle.
  const bookSummary = await ragService.getBookConceptSummary(userId);

  // No per-cycle cap — availablePairs is already naturally bounded (session
  // pairs or the ~10 default pairs), and with indexed dedup lookups and
  // cached news/prices (see marketService/newsService), analyzing all of
  // them per cycle is cheap enough now that this isn't a single-tester app.
  let created = 0;
  // A per-pair AI call failing (e.g. the model's daily quota exhausted)
  // was being swallowed into a console.error only — the cycle would then
  // report the exact same "no signal" reason as a legitimate "the AI saw
  // nothing worth trading," making a real outage indistinguishable from
  // ordinary quiet market conditions. Tracking the last error lets the
  // caller surface it instead of masking it.
  let lastError = null;
  for (const pair of availablePairs) {
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

      const momentum = computeMomentum(historical);
      const analysis = await claudeAI.analyzeQuickSignal(
        formattedPair, currentPrice, historical, [], { bookSummary, momentum }
      );

      // Every non-"wait" signal was auto-executed regardless of how
      // confident the AI actually was in it. Live results (mostly losses
      // out of the trades the system itself placed) are the real
      // evidence this needed tightening -- a plain confidence floor is
      // the simplest, cheapest lever to try first.
      const MIN_QUICK_TRADE_CONFIDENCE = 65;
      if (
        analysis.direction && analysis.direction !== "wait" &&
        (analysis.confidence || 0) >= MIN_QUICK_TRADE_CONFIDENCE
      ) {
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
      lastError = err.message;
    }
  }
  return { created, lastError };
}
// Exported so quickTradeBotController.getPending can trigger generation
// directly, tied to the extension's own poll -- see that file's comment
// for why (GitHub Actions' scheduled cron doesn't fire reliably enough
// at a 10-minute cadence for this repo, confirmed live: real gaps were
// 1.5-3+ hours, not 10 minutes).
exports.generateQuickTradeSignals = generateQuickTradeSignals;

// Mirrors mt5Controller.sendSignal's MT5Signal shape exactly -- this is the
// same record the trader's EA polls for via /api/mt5/pending, just created
// automatically instead of from a manual "Send to MT5" click. A failure
// here is logged and swallowed rather than thrown: it must never cost the
// trader the Notification itself, which already exists by the time this
// runs.
async function autoForwardToMT5(userId, session, notification) {
  try {
    await MT5Signal.create({
      user: userId,
      pair: notification.pair.replace("/", ""),
      action: notification.signal,
      accountType: session.accountType === "real" ? "real" : "demo",
      entry: notification.entry,
      stopLoss: notification.stopLoss || null,
      takeProfit: notification.takeProfit || null,
      lotSize: session.mt5LotSize || 0.01,
      confidence: notification.confidence,
      source: notification.source,
      sourceLabel: `${notification.sourceLabel || "AI Auto"} (auto-sent)`,
      reasoning: notification.reasoning,
      status: "sent",
      token: crypto.randomBytes(32).toString("hex"),
    });
    console.log(`🤖 Auto-forwarded AI-verified signal to MT5: ${notification.signal} ${notification.pair}`);
  } catch (err) {
    console.error(`Auto-forward to MT5 failed for ${notification.pair}:`, err.message);
  }
}

exports.autoGenerate = async (userId) => {
  try {
    // Each mode manages its own signal budget once the trader opts into a
    // session for it — scoped per mode (not "whichever session was most
    // recently created, of either mode") because quick_trade and mt5 are
    // independent trading contexts. A Quick Trade session hitting its
    // limit (including just hitting its *profit target* — a win, not a
    // failure) has nothing to do with the ordinary forex/MT5 signal loop,
    // which doesn't require a session to run in the first place; blocking
    // it too silently starved a user of all signals until they happened to
    // know to start an unrelated new session. Users who've never used
    // sessions at all are unaffected either way.
    const [latestQuickTrade, latestMt5] = await Promise.all([
      TradingSession.findOne({ user: userId, mode: "quick_trade" }).sort({ createdAt: -1 }),
      TradingSession.findOne({ user: userId, mode: "mt5" }).sort({ createdAt: -1 }),
    ]);

    if (latestQuickTrade?.status === "active") {
      const { created, lastError } = await generateQuickTradeSignals(userId, latestQuickTrade);
      console.log(`✅ Generated ${created} quick trade notifications for user ${userId}`);
      const reason = created > 0 ? null : lastError ? `error: ${lastError}` : "quick_trade_no_signal";
      return { count: created, reason };
    }
    if (latestQuickTrade && LIMIT_STOPPED_STATUSES.includes(latestQuickTrade.status)) {
      console.log(`⏸ Skipping Quick Trade signal generation for ${userId} — session limit reached`);
      return { count: 0, reason: "session_limit_reached" };
    }

    if (latestMt5 && LIMIT_STOPPED_STATUSES.includes(latestMt5.status)) {
      console.log(`⏸ Skipping forex/MT5 signal generation for ${userId} — session limit reached`);
      return { count: 0, reason: "session_limit_reached" };
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
    for (const pair of STOCK_PAIRS) {
      if (prices[pair]) availablePairs.push(pair);
    }

    // Kama hakuna prices — tumia crypto tu bila price (AI auto mode)
    if (availablePairs.length === 0) {
      console.log("No live prices available — using AI auto mode for crypto");
      availablePairs.push(...CRYPTO_PAIRS);
    }

    // Analyze every available pair (naturally capped at ~14 by
    // CRYPTO_PAIRS+FOREX_PAIRS+STOCK_PAIRS) — previously capped at 2 to
    // dodge rate limits while solo-testing; no longer needed with cached
    // news/prices.
    const pairsToAnalyze = availablePairs;
    const notifications = [];
    // Same reasoning as generateQuickTradeSignals' lastError: a per-pair AI
    // failure was previously indistinguishable from the AI legitimately
    // finding nothing worth trading -- both silently produced 0
    // notifications and the same "no clear setup" message.
    let lastError = null;

    // Pata news mara moja tu
    let newsArticles = [];
    try {
      newsArticles = await newsService.getForexNews();
    } catch (err) {
      console.error("News fetch failed:", err.message);
    }

    // Fetched once per cycle, not per pair -- same reasoning as the Quick
    // Trade path above.
    const bookSummary = await ragService.getBookConceptSummary(userId);

    for (const pair of pairsToAnalyze) {
      try {
        const currentPrice = prices[pair] || null;
        // Stock tickers aren't currency pairs -- the 3+3 slash split below
        // is meaningless for them (and actively wrong: "AAPL" -> "AAP/L").
        const formattedPair = STOCK_PAIRS.includes(pair) ? pair : pair.slice(0, 3) + "/" + pair.slice(3);

        // Historical data — optional, usisimamishe kama imeshindwa
        let historical = [];
        try {
          historical = await marketService.getHistoricalData(formattedPair, "1h", 10);
        } catch (err) {
          console.error(`Historical data failed for ${pair}:`, err.message);
        }

        const relevantNews = newsService.getNewsSentiment(newsArticles, pair);
        // "screenshot" added to sources so the trader's own uploaded chart
        // screenshots (if any, for this pair) can actually surface here --
        // previously this only ever retrieved book/trade chunks, so an
        // uploaded screenshot never influenced auto-generated signals.
        const retrievedChunks = await ragService.retrieve(
          userId, `${formattedPair} trading strategy signal`,
          { topK: 6, sources: ["book", "trade", "screenshot"] }
        );
        const momentum = computeMomentum(historical);

        const analysis = await claudeAI.analyzeMarketSmart(
          formattedPair,
          currentPrice || 0,
          historical,
          pastTrades,
          retrievedChunks,
          relevantNews,
          { bookSummary, momentum }
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
              verified: analysis.verified ?? null,
              verificationNote: analysis.verificationNote,
              read: false,
            });
            notifications.push(notification);
            console.log(`✅ Notification created: ${analysis.signal} ${pair}`);

            // Hands-off automation, opt-in per session: only forward a
            // signal that passed the AI's own self-verification pass
            // (claudeAI.js's verifySignal) -- an unverified or
            // verification-unavailable (null) signal still waits for
            // manual review via the "Send to MT5" button, same as today.
            if (analysis.verified === true && latestMt5?.status === "active" && latestMt5.autoSendToMT5) {
              await autoForwardToMT5(userId, latestMt5, notification);
            }
          } else {
            console.log(`⏭ Skipped duplicate: ${pair} ${analysis.signal}`);
          }
        }

        // Pumzika sekunde 2 kati ya pairs — epuka rate limit
        await new Promise((resolve) => setTimeout(resolve, 2000));

      } catch (err) {
        console.error(`Error analyzing ${pair}:`, err.message);
        lastError = err.message;
      }
    }

    // News notifications
    if (newsArticles.length > 0) {
      try {
        const topNews = newsArticles.slice(0, 1);
        for (const article of topNews) {
          const impact = await claudeAI.analyzeNewsImpact(
            article, [...CRYPTO_PAIRS, ...FOREX_PAIRS].slice(0, 3), prices
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
    const reason = notifications.length > 0
      ? null
      : lastError ? `error: ${lastError}` : "forex_no_signal";
    return { count: notifications.length, reason };
  } catch (err) {
    console.error("Auto generate error:", err.message);
    return { count: 0, reason: `error: ${err.message}` };
  }
};

// Human-readable explanation for each "generated 0" reason — surfaced to
// the user instead of one generic message, so a stopped session or an
// exhausted cooldown doesn't look identical to "the AI saw nothing to do."
const ZERO_RESULT_MESSAGES = {
  session_limit_reached: "Your active session already hit its profit/risk/trade limit — start a new session to keep generating signals.",
  quick_trade_no_signal: "No new Quick Trade signal — either every pair was generated recently (2-min cooldown) or the AI sees no clear setup right now.",
  forex_no_signal: "No new signal — the AI sees no clear setup right now, or today's signal for these pairs already exists.",
};

// Manual generate — from button click
exports.generateNotifications = async (req, res) => {
  try {
    console.log(`Manual generate triggered for user ${req.user._id}`);
    const { count, reason } = await exports.autoGenerate(req.user._id);
    const notifications = await Notification.find({ user: req.user._id })
      .sort({ createdAt: -1 }).limit(20);
    const unreadCount = await Notification.countDocuments({
      user: req.user._id, read: false,
    });
    res.json({
      notifications,
      unreadCount,
      generated: count,
      reason,
      message: count > 0
        ? `${count} new signal(s) generated`
        : ZERO_RESULT_MESSAGES[reason] || (reason ? `No new signals (${reason})` : "No new signals right now"),
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