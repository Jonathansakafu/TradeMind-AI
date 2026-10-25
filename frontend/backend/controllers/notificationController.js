const crypto = require("crypto");
const signalGuards = require("../services/signalGuards");
const Notification = require("../models/Notification");
const User = require("../models/User");
const Trade = require("../models/Trade");
const TradingSession = require("../models/TradingSession");
const MT5Signal = require("../models/MT5Signal");
const marketService = require("../services/marketService");
const newsService = require("../services/newsService");
const claudeAI = require("../services/claudeAI");
const ragService = require("../services/ragService");
const learningService = require("../services/learningService");
const { computeMomentum, computeAtr, fitIntradayLevels } = require("../services/marketAnalysis");
const AppConfig = require("../models/AppConfig");
const marketContext = require("../services/marketContext");
const signalRules = require("../services/signalRules");
const economicCalendar = require("../services/economicCalendar");
const signalOutcomes = require("../services/signalOutcomes");
const signalNotes = require("../services/signalNotes");
const newsContext = require("../services/newsContext");
const pipelineStats = require("../services/pipelineStats");
const ruleStrategy = require("../services/ruleStrategy");

// Automatic signals come from backtested rules (services/ruleStrategy.js);
// pairs without one get none. The old AI-picked signals lost on almost
// every trade in live results (2026-10-14/16) and can be brought back per
// pair with AI_AUTO_SIGNAL_PAIRS="EURUSD,GBPUSD"; AI news-impact signals
// (untested too) with AI_NEWS_SIGNALS=1.
const AI_AUTO_SIGNAL_PAIRS = (process.env.AI_AUTO_SIGNAL_PAIRS || "").split(",").map((p) => p.trim().toUpperCase()).filter(Boolean);
const AI_NEWS_SIGNALS = process.env.AI_NEWS_SIGNALS === "1";

// Forex zitatumika kama zinapatikana tu
const FOREX_PAIRS = ["EURUSD", "GBPUSD", "XAUUSD"];
// Stocks — same real-data pipeline as gold (marketService's Yahoo Finance
// path), analyzed alongside forex/crypto rather than as a separate mode.
const STOCK_PAIRS = marketService.STOCK_SYMBOLS;
// True once today's closed trades have lost at least the user's daily
// loss limit (Settings -> Risk). Only gates MT5 auto-sending; signals and
// alerts still arrive so the trader stays informed.
async function dailyLossLimitHit(userId) {
  const u = await User.findById(userId).select("riskSettings");
  const rs = u?.riskSettings;
  if (!rs?.balance || !rs?.dailyLossLimitPercent) return false;
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const agg = await Trade.aggregate([
    { $match: { user: u._id, outcome: { $exists: true }, closedAt: { $gte: start } } },
    { $group: { _id: null, pl: { $sum: "$profitLoss" } } },
  ]);
  return (agg[0]?.pl || 0) <= -(rs.balance * rs.dailyLossLimitPercent) / 100;
}

// Gold only: says which price the signal was built on and when, so an
// out-of-date price is visible on the signal itself.
function goldPriceNote(pair) {
  if (pair !== "XAUUSD") return "";
  const g = marketService.getGoldStatus();
  if (!g.at) return "";
  const time = g.at.toISOString().slice(11, 16);
  return `\n\n💰 Gold price used: ${g.price.toFixed(2)} (${g.source}, ${time} UTC)`;
}

// Every signal goes to every user (2026-10-25): one copy each, so read /
// taken / delete and history stay per user, all sharing a broadcastId. The
// first copy is marked primary, and the generation checks below (dedup,
// open setups, loss brake, track record) read primary copies only -- each
// signal counts once however many users there are.
const SHARED = { primary: true };

async function broadcast(fields) {
  const users = await User.find({}).select("_id").sort({ _id: 1 }).lean();
  const broadcastId = crypto.randomUUID();
  const copies = [];
  for (const [i, u] of users.entries()) {
    copies.push(await Notification.create({ ...fields, user: u._id, broadcastId, primary: i === 0 }));
  }
  return copies;
}

// Signals from before shared generation have no primary copy. The busiest
// user's are taken as the shared record, so dedup, open setups and the
// track record carry over instead of restarting empty.
let primaryChecked = false;
async function ensureSharedRecord() {
  if (primaryChecked) return;
  if (!(await Notification.exists(SHARED))) {
    const [top] = await Notification.aggregate([
      { $match: { createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
      { $group: { _id: "$user", n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 1 },
    ]);
    if (top) await Notification.updateMany({ user: top._id }, { primary: true });
  }
  primaryChecked = true;
}

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

// Symbols to check news impact against — analyzeNewsImpact wants standard
// symbols (e.g. "EURUSD", "AAPL"), not Quick Trade's OTC display strings
// ("EUR/USD OTC"), so both generation paths below share this same
// candidate set regardless of which pairs they're otherwise trading. Was
// slice(0,3) on just [...CRYPTO_PAIRS, ...FOREX_PAIRS] -- CRYPTO_PAIRS
// alone is exactly 3 items, so that silently never checked a single forex
// pair despite the comment above claiming both, and never covered stocks
// at all. Now includes every crypto/forex/stock pair this app tracks
// (2026-09-23, at the user's request -- News Impact was only ever
// evaluating BTC/ETH/XRP in practice).
// Narrowed to forex + gold only 2026-09-28 at the user's request, together
// with the automatic signal loop below -- Groq's free 200K tokens/day was
// being exhausted within hours, leaving most of each day with no signals.
const NEWS_IMPACT_CANDIDATE_PAIRS = [...FOREX_PAIRS];

// Previously only checked the single most-recent article and only ever
// ran from the forex/MT5 path -- both were why these alerts were rare and
// Quick Trade never got any. Shared by both generateQuickTradeSignals and
// autoGenerate below so the two modes have real parity instead of one
// having news context and the other having none at all. Raised from 3/24h
// to 10/3h 2026-09-23 at the user's explicit request for much higher
// notification volume -- more candidate articles per cycle and a much
// shorter re-alert window, accepting the higher Groq call volume and
// noisier/more-repetitive alerts that come with it.
// 10 -> 3 (2026-09-28): in practice nearly every checked article came back
// "not high impact" (90 of 90 in one live cycle), so 10 per cycle mostly
// burned the daily AI allowance without producing alerts.
const NEWS_IMPACT_CANDIDATES = 3;
const NEWS_IMPACT_DEDUP_WINDOW_MS = 3 * 60 * 60 * 1000;

async function createNewsImpactNotifications(newsArticles, prices, type) {
  if (!newsArticles.length) return 0;

  let created = 0;
  const topNews = newsArticles.slice(0, NEWS_IMPACT_CANDIDATES);
  for (const article of topNews) {
    try {
      const impact = await claudeAI.analyzeNewsImpact(article, NEWS_IMPACT_CANDIDATE_PAIRS, prices, { background: true });
      pipelineStats.inc("news.analyzed");
      if (impact.impactLevel !== "high" || !impact.affectedPairs?.length) {
        pipelineStats.inc("news.notHighImpact");
        continue;
      }

      const affectedPair = impact.affectedPairs[0];
      const signalType = affectedPair.impact === "bullish" ? "buy"
        : affectedPair.impact === "bearish" ? "sell" : null;
      if (!signalType) continue;

      const pair = affectedPair.pair || NEWS_IMPACT_CANDIDATE_PAIRS[0];
      // Same dedup shape as the regular per-pair signal check elsewhere in
      // this file -- a fast-moving news cycle shouldn't re-alert the same
      // pair/direction call on every generation cycle while it's still current.
      const existing = await Notification.findOne({
        ...SHARED,
        source: "news_impact",
        pair,
        signal: signalType,
        createdAt: { $gte: new Date(Date.now() - NEWS_IMPACT_DEDUP_WINDOW_MS) },
      });
      if (existing) {
        pipelineStats.inc("news.dedupSkipped");
        continue;
      }

      // Same intraday limits as regular signals (see fitIntradayLevels) --
      // news alerts were the original source of 8%-stop suggestions.
      let levels = { entry: affectedPair.entry || 0, stopLoss: affectedPair.stopLoss || 0, takeProfit: affectedPair.takeProfit || 0 };
      const livePrice = prices[pair];
      let newsAtr = null;
      if (livePrice) {
        try {
          const candles = await marketService.getHistoricalData(pair.slice(0, 3) + "/" + pair.slice(3), "1h", 10);
          newsAtr = computeAtr(candles);
          levels = fitIntradayLevels({ signal: signalType, ...levels }, livePrice, newsAtr);
        } catch (err) {
          console.error(`News impact level sizing failed for ${pair}:`, err.message);
        }
      }

      await broadcast({
        pair,
        signal: signalType,
        entry: levels.entry,
        stopLoss: levels.stopLoss,
        takeProfit: levels.takeProfit,
        reasoning: `📰 ${article.title}\n\n${impact.tradingAdvice}` + signalNotes.forNewsImpact()
          + signalNotes.newsAlertImpact({ level: impact.impactLevel, bias: affectedPair.impact, atr: newsAtr, price: livePrice }),
        confidence: 65,
        source: "news_impact",
        sourceLabel: "News Impact Alert",
        type,
        read: false,
      });
      created++;
      pipelineStats.inc("news.created");
    } catch (err) {
      // Hourly AI budget used up by the pair signals first -- expected, and
      // the remaining articles would hit the same wall.
      if (err.code === "AI_BUDGET") break;
      pipelineStats.inc("news.error");
      console.error(`News impact analysis failed for "${article.title}":`, err.message);
    }
  }
  return created;
}

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
  const [bookSummary, learnedSummary] = await Promise.all([
    ragService.getBookConceptSummary(userId, { allUsers: true }),
    learningService.getSharedLearnedSummary(),
  ]);

  // Previously hardcoded to [] below -- Quick Trade signals had no news
  // context at all while the forex/MT5 path did. Shares getForexNews's
  // own 20min cache with that path, so calling it here too costs nothing
  // extra when both run in the same cycle.
  let newsArticles = [];
  try {
    newsArticles = await newsService.getForexNews();
  } catch (err) {
    console.error("News fetch failed:", err.message);
  }

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
      if (existingRecent) {
        pipelineStats.inc("quick.dedupSkipped");
        continue;
      }

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

      const relevantNews = newsService.getNewsSentiment(newsArticles, marketSymbol);
      const momentum = computeMomentum(historical);
      const analysis = await claudeAI.analyzeQuickSignal(
        formattedPair, currentPrice, historical, relevantNews, { bookSummary, momentum, learnedSummary }
      );
      pipelineStats.inc("quick.analyzed");
      if (!analysis.direction || analysis.direction === "wait") pipelineStats.inc("quick.wait");
      else if ((analysis.confidence || 0) < 50) pipelineStats.inc("quick.belowConfidenceFloor");

      // Every non-"wait" signal was auto-executed regardless of how
      // confident the AI actually was in it. Live results (mostly losses
      // out of the trades the system itself placed) are the real
      // evidence this needed tightening -- a plain confidence floor is
      // the simplest, cheapest lever to try first. Lowered from 65 to 50
      // 2026-09-23 at the user's explicit request for much higher
      // notification volume -- this directly trades away some of that
      // loss-rate protection for more signals, since Quick Trade has no
      // second-pass verification (unlike the forex/MT5 path's
      // verifySignal) gating what gets auto-executed by the browser
      // extension. Worth revisiting if losses climb again.
      const MIN_QUICK_TRADE_CONFIDENCE = 50;
      if (
        analysis.direction && analysis.direction !== "wait" &&
        (analysis.confidence || 0) >= MIN_QUICK_TRADE_CONFIDENCE
      ) {
        await Notification.create({
          user: userId,
          pair,
          signal: analysis.direction,
          reasoning: (analysis.reasoning || "AI generated quick trade signal")
            + signalNotes.forQuickTrade({ news: relevantNews.length > 0, books: !!bookSummary, learned: !!learnedSummary }),
          confidence: analysis.confidence || 60,
          source: "ai_auto",
          sourceLabel: "Quick Trade Signal",
          type: "quick_trade",
          expiresInMinutes: analysis.expiresInMinutes || 5,
          tradingSessionId: session._id,
          read: false,
        });
        created++;
        pipelineStats.inc("quick.created");
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (err) {
      console.error(`Error analyzing quick trade ${pair}:`, err.message);
      pipelineStats.inc("quick.error");
      lastError = err.message;
    }
  }

  try {
    await createNewsImpactNotifications(newsArticles, prices, "quick_trade");
  } catch (err) {
    console.error("Quick Trade news impact notification error:", err.message);
  }

  return { created, lastError };
}
// Exported so quickTradeBotController.getPending can trigger generation
// directly, tied to the extension's own poll -- see that file's comment
// for why (GitHub Actions' scheduled cron doesn't fire reliably enough
// at a 10-minute cadence for this repo, confirmed live: real gaps were
// 1.5-3+ hours, not 10 minutes).
exports.generateQuickTradeSignals = generateQuickTradeSignals;

// Quick Trade signals for every running Quick Trade session (they're tied
// to the session's own pairs and auto-execute extension).
exports.generateActiveQuickTrade = async () => {
  const sessions = await TradingSession.find({ mode: "quick_trade", status: "active" });
  let created = 0;
  for (const session of sessions) {
    try {
      created += (await generateQuickTradeSignals(session.user, session)).created;
    } catch (err) {
      console.error(`Quick trade generation failed for session ${session._id}:`, err.message);
    }
  }
  return created;
};

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

// One user's copy of an AI-verified signal goes to their MT5 EA when their
// latest MT5 session is running with auto-send on.
async function maybeAutoForwardToMT5(notification) {
  const session = await TradingSession.findOne({ user: notification.user, mode: "mt5" }).sort({ createdAt: -1 });
  if (session?.status !== "active" || !session.autoSendToMT5) return;
  if (await dailyLossLimitHit(notification.user)) {
    console.log(`🛑 Daily loss limit reached for ${notification.user} -- MT5 auto-send paused`);
    pipelineStats.inc("risk.autoSendPaused");
    return;
  }
  await autoForwardToMT5(notification.user, session, notification);
}

// Shared generation: one run for everyone (see broadcast). Triggers that
// overlap (cron, in-process interval, app polls) join the run in flight
// instead of racing its dedup checks.
let generating = null;
exports.autoGenerate = () => {
  generating ||= generateShared().finally(() => { generating = null; });
  return generating;
};

async function generateShared() {
  try {
    await ensureSharedRecord();

    const [pastTrades, prices] = await Promise.all([
      // Every user's trades -- the AI learns from all of them together.
      Trade.find({}).sort({ openedAt: -1 }).limit(50),
      marketService.getAllPrices(),
    ]);

    // Forex + gold only (2026-09-28, at the user's request). Crypto and
    // stocks were dropped from automatic signals to fit Groq's free daily
    // token cap: 14 pairs refreshed every 15 min needed roughly 10x the
    // allowance, so it ran out within hours and then nothing was generated
    // for the rest of the day. Re-add them here (e.g. after upgrading the
    // Groq plan) to bring them back.
    const availablePairs = FOREX_PAIRS.filter((pair) => prices[pair]);
    if (availablePairs.length === 0) {
      console.log("No live forex/gold prices available — skipping this cycle");
      return { count: 0, reason: "no_prices" };
    }

    // Oldest-analyzed pair first. The hourly AI budget (claudeAI.js) only
    // covers ~2 fresh analyses an hour, and a fixed order meant EURUSD and
    // GBPUSD always used it up before XAUUSD got a turn -- gold got no new
    // signals at all after the budget was introduced. Stored in Mongo so
    // the rotation survives Render's frequent restarts.
    const lastAnalyzed = (await AppConfig.findOne({ key: "pairLastAnalyzed" }))?.value || {};
    const pairsToAnalyze = [...availablePairs].sort((a, b) => (lastAnalyzed[a] || 0) - (lastAnalyzed[b] || 0));
    const notifications = [];
    // Same reasoning as generateQuickTradeSignals' lastError: a per-pair AI
    // failure was previously indistinguishable from the AI legitimately
    // finding nothing worth trading -- both silently produced 0
    // notifications and the same "no clear setup" message.
    let lastError = null;

    // The AI inputs below are only needed when some pair still uses the AI.
    const usesAi = AI_NEWS_SIGNALS || pairsToAnalyze.some((p) => !ruleStrategy.has(p) && AI_AUTO_SIGNAL_PAIRS.includes(p));

    // Pata news mara moja tu
    let newsArticles = [];
    try {
      if (usesAi) newsArticles = await newsService.getForexNews();
    } catch (err) {
      console.error("News fetch failed:", err.message);
    }

    // Fetched once per cycle, not per pair -- same reasoning as the Quick
    // Trade path above.
    const [bookSummary, learnedSummary, signalStatsByPair] = !usesAi ? [null, null, {}] : await Promise.all([
      ragService.getBookConceptSummary(null, { allUsers: true }),
      learningService.getSharedLearnedSummary(),
      // How past signals actually played out, per pair -- fed back into
      // the AI prompt (services/signalOutcomes.js).
      signalOutcomes.statsTextByPair(SHARED).catch(() => ({})),
    ]);

    for (const pair of pairsToAnalyze) {
      try {
        const currentPrice = prices[pair] || null;
        if (ruleStrategy.has(pair)) {
          notifications.push(...await createStrategySignals(pair, currentPrice));
          continue;
        }
        if (!AI_AUTO_SIGNAL_PAIRS.includes(pair)) continue;
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
          null, `${formattedPair} trading strategy signal`,
          { topK: 6, sources: ["book", "trade", "screenshot"], allUsers: true }
        );
        const momentum = computeMomentum(historical);

        // Market structure, S/R and 4H/1H/15m trend, computed (no AI) and
        // cached per pair for 10 min. Skip the AI call when there's no
        // setup at all -- saves the limited free AI allowance for pairs
        // that are actually moving (services/signalRules.js preGate).
        let ctx = null;
        try {
          ctx = await marketContext.getMarketContext(pair, currentPrice);
        } catch (err) {
          console.error(`Market context failed for ${pair}:`, err.message);
        }
        // Upcoming high-impact releases (with forecast / previous) and how
        // price reacted to recent ones. Never throws; empty when unavailable.
        const newsCtx = await newsContext.getNewsContext(pair, { atrH1: ctx?.atrH1 });
        const gate = signalRules.preGate(ctx);
        if (!gate.analyze) {
          pipelineStats.inc("rules.gateSkipped");
          console.log(`⏭ ${pair}: ${gate.reason} -- no AI call`);
          continue;
        }

        const analysis = await claudeAI.analyzeMarketSmart(
          formattedPair,
          currentPrice || 0,
          historical,
          pastTrades,
          retrievedChunks,
          relevantNews,
          {
            bookSummary, momentum, learnedSummary,
            marketContext: ctx?.summary || "",
            signalStats: signalStatsByPair[pair] || "",
            newsCalendar: newsCtx.text,
          }
        );
        pipelineStats.inc("forex.analyzed");
        if (analysis.analyzedAt && analysis.analyzedAt > (lastAnalyzed[pair] || 0)) {
          lastAnalyzed[pair] = analysis.analyzedAt;
          await AppConfig.updateOne(
            { key: "pairLastAnalyzed" },
            { $set: { [`value.${pair}`]: analysis.analyzedAt } },
            { upsert: true }
          );
        }
        if (!analysis.signal || analysis.signal === "wait") {
          pipelineStats.noteDecision(pair, `WAIT (${analysis.confidence ?? "?"}%): ${analysis.reasoning || ""}`);
          pipelineStats.inc("forex.wait");
          // WAIT while a release is ahead -- shows if news still holds signals back.
          if (newsCtx.upcoming?.length) pipelineStats.inc("forex.wait.newsAhead");
        }

        if (analysis.signal && analysis.signal !== "wait") {
          // Angalia kama notification kama hii haijatumwa leo
          // Shortened from 6h to 15min 2026-09-23 at the user's explicit
          // request for much higher notification volume. Matched to
          // analyzeMarketSmart's own result-cache bucket (also cut from
          // 30min to 15min in claudeAI.js in the same change) -- a
          // shorter dedup window alone would have been silently
          // meaningless, since that cache would keep returning the exact
          // same cached signal for pairs already deduped anyway.
          // Matches analyzeMarketSmart's cache bucket (30 min) -- pairs
          // refresh every 30 min with Gemini as the backup model.
          const FOREX_DEDUP_WINDOW_MS = 30 * 60 * 1000;
          const existingToday = await Notification.findOne({
            ...SHARED,
            pair,
            signal: analysis.signal,
            createdAt: { $gte: new Date(Date.now() - FOREX_DEDUP_WINDOW_MS) },
          });

          if (!existingToday) {
            // Levels: entry from the AI (kept within 1 ATR of price), stop
            // beyond real structure and target at the next level
            // (placeLevels), then the intraday safety clamp as before.
            const atrNow = ctx?.atrH1 || computeAtr(historical);
            const first = fitIntradayLevels(analysis, currentPrice, atrNow);
            const structured = ctx ? signalRules.placeLevels({ signal: analysis.signal, ...first }, ctx) : first;
            const levels = fitIntradayLevels({ signal: analysis.signal, ...structured }, currentPrice, atrNow);
            if (levels.adjusted) pipelineStats.inc("forex.levelsAdjusted");

            // Fixed rule checklist: a signal failing a hard rule (against
            // the 4H trend, R:R under 1:1.5, strong level in the way,
            // high-impact news within 30 min) is not sent.
            const events = await economicCalendar.getHighImpactEvents();
            const check = ctx ? signalRules.checklist({ signal: analysis.signal, ...levels }, ctx, events) : null;
            if (check && !check.passed) {
              pipelineStats.inc("rules.blocked");
              check.blocked.forEach((k) => pipelineStats.inc(`rules.blocked.${k}`));
              console.log(`🚫 ${pair} ${analysis.signal} blocked by rules: ${check.blocked.join(", ")}`);
              pipelineStats.noteDecision(pair, `${analysis.signal.toUpperCase()} ${analysis.confidence ?? "?"}% blocked: ${check.rules.filter((r) => !r.passed && r.hard !== false).map((r) => `${r.label} — ${r.detail}`).join("; ")} | entry ${levels.entry} SL ${levels.stopLoss} TP ${levels.takeProfit}`);
              continue;
            }

            // Loss safeguards (services/signalGuards.js): loss brake, no
            // conflicting dollar bets, respect a strong post-news move.
            const guards = await signalGuards.evaluate({ scope: SHARED, pair, signal: analysis.signal, ctx, newsCtx }).catch((err) => {
              console.error("Signal guards failed:", err.message);
              return null;
            });
            if (guards && !guards.passed) {
              pipelineStats.inc("rules.blocked");
              guards.blocked.forEach((k) => pipelineStats.inc(`rules.blocked.${k}`));
              console.log(`🛡 ${pair} ${analysis.signal} held back: ${guards.blocked.join(", ")}`);
              pipelineStats.noteDecision(pair, `${analysis.signal.toUpperCase()} held back: ${guards.rules.filter((r) => !r.passed).map((r) => `${r.label} — ${r.detail}`).join("; ")}`);
              continue;
            }
            if (check && guards) check.rules.push(...guards.rules);

            const copies = await broadcast({
              pair,
              signal: analysis.signal,
              entry: levels.entry || currentPrice || 0,
              stopLoss: levels.stopLoss || 0,
              takeProfit: levels.takeProfit || 0,
              reasoning: (analysis.reasoning || "AI generated signal")
                + signalNotes.forAiSignal({
                  analysis,
                  ctx,
                  newsCtx,
                  price: currentPrice,
                  inputs: {
                    structure: !!ctx,
                    books: !!bookSummary || retrievedChunks.some((c) => c.source === "book"),
                    screenshots: retrievedChunks.some((c) => c.source === "screenshot"),
                    pastTrades: pastTrades.length,
                    trackRecord: !!signalStatsByPair[pair],
                    learned: !!learnedSummary,
                    news: relevantNews.length,
                    momentum: !!momentum?.summary,
                  },
                })
                + signalNotes.newsImpactSection({
                  analysis, newsCtx, atr: atrNow, price: currentPrice, isTopTier: economicCalendar.isTopTier,
                })
                + (structured.note ? `\n\n📐 Levels from market structure: ${structured.note}.` : "")
                + (levels.adjusted ? `\n\n📏 Levels adjusted for an intraday trade: ${levels.note}.` : "")
                + (check ? signalRules.checklistText(check) : "")
                + goldPriceNote(pair),
              checklist: check?.rules,
              confidence: analysis.confidence || 60,
              source: analysis.source || "ai_auto",
              sourceLabel: analysis.sourceLabel || "AI Auto",
              verified: analysis.verified ?? null,
              verificationNote: analysis.verificationNote,
              read: false,
            });
            if (!copies.length) continue;
            notifications.push(copies[0]);
            console.log(`✅ Notification created: ${analysis.signal} ${pair}`);
            pipelineStats.inc("forex.created");

            // Hands-off automation, opt-in per session: only forward a
            // signal that passed the AI's own self-verification pass
            // (claudeAI.js's verifySignal) -- an unverified or
            // verification-unavailable (null) signal still waits for
            // manual review via the "Send to MT5" button, same as today.
            if (analysis.verified === true) {
              for (const copy of copies) await maybeAutoForwardToMT5(copy);
            }
          } else {
            console.log(`⏭ Skipped duplicate: ${pair} ${analysis.signal}`);
            pipelineStats.inc("forex.dedupSkipped");
          }
        }

        // Pumzika sekunde 2 kati ya pairs — epuka rate limit
        await new Promise((resolve) => setTimeout(resolve, 2000));

      } catch (err) {
        console.error(`Error analyzing ${pair}:`, err.message);
        lastError = err.message;
        if (err.code === "AI_BUDGET") {
          pipelineStats.inc("forex.budgetSkipped");
          break;
        }
        pipelineStats.inc("forex.error");
      }
    }

    try {
      if (AI_NEWS_SIGNALS) await createNewsImpactNotifications(newsArticles, prices, "forex");
    } catch (err) {
      console.error("News impact notification error:", err.message);
    }

    console.log(`✅ Generated ${notifications.length} shared signal(s)`);
    const reason = notifications.length > 0
      ? null
      : lastError ? `error: ${lastError}` : "forex_no_signal";
    return { count: notifications.length, reason };
  } catch (err) {
    console.error("Auto generate error:", err.message);
    return { count: 0, reason: `error: ${err.message}` };
  }
}

// Strategy signals (shared, see broadcast): each of the pair's strategies whose last
// closed candle is a setup -- up to the strategy's maxOpen trades running
// and one signal per setup candle (as in the backtest), none inside the
// high-impact news window.
async function createStrategySignals(pair, price) {
  const results = await ruleStrategy.getSignals(pair, price);
  const created = [];
  for (const sig of results) {
    const n = sig.signal ? await createStrategySignal(pair, sig) : null;
    if (n) created.push(n);
  }
  const summary = results.map((r) => `${r.strategy.label}: ${r.signal ? r.signal.toUpperCase() : r.reason}`).join(" | ");
  if (!created.length) pipelineStats.noteDecision(pair, `Strategies — ${summary}`);
  return created;
}

async function createStrategySignal(pair, sig) {
  const s = sig.strategy;
  // Up to s.maxOpen trades of this setup running at once (as backtested),
  // and never two signals from the same setup candle.
  const [running, sameCandle] = await Promise.all([
    Notification.countDocuments({ ...SHARED, pair, strategy: s.key, simOutcome: { $exists: false } }),
    Notification.exists({ ...SHARED, pair, strategy: s.key, createdAt: { $gte: sig.barTime } }),
  ]);
  if (sameCandle || running >= (s.maxOpen || 1)) {
    pipelineStats.inc("strategy.busy");
    return null;
  }
  const events = await economicCalendar.getHighImpactEvents().catch(() => null);
  const ccys = economicCalendar.currenciesFor(pair);
  const now = new Date();
  const near = (events || []).find((e) => ccys.includes(e.currency)
    && e.time - now <= economicCalendar.QUIET_BEFORE_MS && now - e.time <= economicCalendar.quietAfterMs(e));
  if (near) {
    pipelineStats.inc("strategy.newsBlocked");
    pipelineStats.noteDecision(pair, `${s.label} ${sig.signal.toUpperCase()} held back: ${near.currency} ${near.title} at ${near.time.toISOString().slice(11, 16)} UTC`);
    return null;
  }
  const [notification] = await broadcast({
    pair,
    signal: sig.signal,
    entry: sig.entry,
    stopLoss: sig.stopLoss,
    initialStopLoss: sig.stopLoss,
    takeProfit: sig.takeProfit,
    maxHoldHours: s.maxHoldHours,
    strategy: s.key,
    reasoning: ruleStrategy.reasoningFor(sig, pair) + goldPriceNote(pair),
    // The tested win rate -- see notifyDispatcher's passesEmailFloor.
    confidence: s.backtest.winRate,
    source: "strategy",
    sourceLabel: `Tested strategy · ${s.label}`,
    read: false,
  });
  if (!notification) return null;
  pipelineStats.inc("strategy.created");
  pipelineStats.noteDecision(pair, `${s.label} ${sig.signal.toUpperCase()} sent: entry ${sig.entry} SL ${sig.stopLoss} TP ${sig.takeProfit}`);
  return notification;
}

// Get notifications
// Piggybacks forex/MT5 signal generation on this endpoint's own poll --
// hit every 5 minutes by both the Notifications page and NotificationBell
// (the latter lives in MainLayout, so this covers every page in the app,
// not just one). Mirrors the fix already made for Quick Trade (tied to
// the browser extension's poll instead), since the external cron alone
// proved unreliable (confirmed live: real gaps of 1.5-3+ hours despite a
// 10-minute schedule). Throttled (once per window for everyone, since
// generation is shared) so it doesn't fire on literally every poll; fire-and-forget so this response never
// blocks on a multi-pair AI generation cycle just to return whatever
// notifications already exist. The external cron stays in place as a
// backup for whenever nobody has the app open at all.
// Lowered from 15min to 5min (matching the client's own poll interval
// above) 2026-09-23 at the user's explicit request for much higher
// notification volume -- this is now the tightest it can usefully be
// without also shortening the frontend's poll interval itself.
const NOTIF_POLL_GENERATION_THROTTLE_MS = 5 * 60 * 1000;
let lastPollGenAt = 0;

exports.getNotifications = async (req, res) => {
  try {
    if (Date.now() - lastPollGenAt > NOTIF_POLL_GENERATION_THROTTLE_MS) {
      lastPollGenAt = Date.now();
      pipelineStats.inc("trigger.appPoll");
      exports.autoGenerate().catch((err) =>
        console.error("Poll-triggered auto-generate failed:", err.message)
      );
    }

    const notifications = await Notification.find({ user: req.user._id })
      .sort({ createdAt: -1 }).limit(20)
      .populate("tradeId", TRADE_RESULT_FIELDS);
    const unreadCount = await Notification.countDocuments({
      user: req.user._id, read: false,
    });
    res.json({ notifications, unreadCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Fields of a linked trade shown on its signal (result once closed).
const TRADE_RESULT_FIELDS = "status outcome profitLoss closedAt";

// Every per-notification action below is scoped to the logged-in user --
// these previously updated/deleted by id alone, so any logged-in account
// could modify another account's notifications given an id.

// Mark as read
exports.markAsRead = async (req, res) => {
  try {
    await Notification.updateOne({ _id: req.params.id, user: req.user._id }, { read: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Mark (or unmark) a signal as one the trader actually took.
exports.setTaken = async (req, res) => {
  try {
    const taken = req.body?.taken !== false;
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      taken ? { taken: true, takenAt: new Date(), read: true } : { taken: false, $unset: { takenAt: 1 } },
      { returnDocument: "after" }
    ).populate("tradeId", TRADE_RESULT_FIELDS);
    if (!notification) return res.status(404).json({ message: "Notification not found" });
    res.json(notification);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Today's (latest) morning brief for the Dashboard.
exports.getBrief = async (req, res) => {
  try {
    res.json({ brief: await require("../services/morningBrief").getLatestBrief() });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// How the AI's signals actually played out (auto-tracked against real
// prices, taken or not), by pair and direction.
exports.getSignalStats = async (req, res) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    res.json(await signalOutcomes.getStats(req.user._id, days));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// All signals the trader took (not limited to the latest 20 like the main
// list), newest first, with each linked trade's result.
exports.getTaken = async (req, res) => {
  try {
    const notifications = await Notification.find({ user: req.user._id, taken: true })
      .sort({ createdAt: -1 }).limit(200)
      .populate("tradeId", TRADE_RESULT_FIELDS);
    res.json({ notifications });
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
    const deleted = await Notification.findOneAndDelete({ _id: req.params.id, user: req.user._id });
    // Another user's copy takes over as the shared record.
    if (deleted?.primary && deleted.broadcastId) {
      await Notification.updateOne({ broadcastId: deleted.broadcastId }, { primary: true });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
