const Groq = require("groq-sdk");
const ragService = require("./ragService");

// Constructed lazily (not at module load) so the server doesn't crash on
// startup if GROQ_API_KEY isn't set — it only throws when a request that
// actually needs the AI is made, which callers already wrap in try/catch.
let _groq = null;
function getGroqClient() {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

const cache = new Map();
const CACHE_DURATION = 2 * 60 * 60 * 1000;

const getCached = (key) => {
  const cached = cache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > CACHE_DURATION) {
    cache.delete(key);
    return null;
  }
  return cached.data;
};

const setCache = (key, data) => {
  cache.set(key, { data, timestamp: Date.now() });
};

const askGroq = async (prompt) => {
  const completion = await getGroqClient().chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    model: "llama-3.3-70b-versatile",
    temperature: 0.3,
    max_tokens: 1500,
  });
  return completion.choices[0]?.message?.content || "";
};

// Yields text deltas as they arrive from Groq instead of waiting for the
// full completion — lets the chat UI render the answer as it's written.
async function* askGroqStream(prompt) {
  const stream = await getGroqClient().chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    model: "llama-3.3-70b-versatile",
    temperature: 0.3,
    max_tokens: 1500,
    stream: true,
  });
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}

// Analyze single trade
exports.analyzeTrade = async (trade, history = [], retrievedChunks = []) => {
  const cacheKey = `trade_${trade._id}_${retrievedChunks.map((c) => c.sourceId).join(",")}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const ragCtx = ragService.formatContext(retrievedChunks);

  const prompt = `You are TradeMind AI, a professional forex trading coach. Analyze this trade and respond ONLY in JSON with no markdown:
{
  "patterns": [{"name":"","description":"","confidence":0}],
  "riskFlags": [{"type":"","severity":"low|medium|high","message":""}],
  "suggestions": [],
  "verdict": "",
  "score": 0,
  "bookInsights": []
}

Trade data: ${JSON.stringify({
    pair: trade.pair, direction: trade.direction,
    entry: trade.entryPrice, exit: trade.exitPrice,
    sl: trade.stopLoss, tp: trade.takeProfit,
    outcome: trade.outcome, pnl: trade.profitLoss,
    session: trade.session, setup: trade.setup, notes: trade.notes,
  })}

Past trades count: ${history.length}
${ragCtx}

${ragCtx ? "Ground patterns/riskFlags/suggestions in the retrieved context above where relevant, and cite the source label in bookInsights." : ""}`;

  const text = await askGroq(prompt);
  try {
    const result = JSON.parse(text.replace(/```json|```/g, "").trim());
    setCache(cacheKey, result);
    return result;
  } catch {
    return { patterns: [], riskFlags: [], suggestions: [text], verdict: "", score: 0, bookInsights: [] };
  }
};

// Detect patterns
exports.detectPatterns = async (trades, retrievedChunks = []) => {
  const cacheKey = `patterns_${trades.length}_${trades[0]?._id}_${retrievedChunks.map((c) => c.sourceId).join(",")}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const summary = trades.slice(0, 50).map((t) => ({
    pair: t.pair, direction: t.direction, outcome: t.outcome,
    session: t.session, pnl: t.profitLoss, setup: t.setup,
  }));

  const ragCtx = ragService.formatContext(retrievedChunks);

  const prompt = `You are a professional forex analyst. Analyze this trading history and respond ONLY in JSON with no markdown:
{
  "patterns": [{"name":"","description":"","confidence":0,"occurrences":0}],
  "bestSession": "",
  "worstSession": "",
  "strongestPairs": [{"pair":"","winRate":0,"avgPnl":0}],
  "weakestPairs": [{"pair":"","winRate":0,"avgPnl":0}],
  "riskBehaviors": [{"type":"","description":"","severity":"low|medium|high"}],
  "recommendations": [],
  "bookRecommendations": []
}

Trading data: ${JSON.stringify(summary)}
${ragCtx}

${ragCtx ? "Cross-reference patterns with the retrieved context above. Add book-based recommendations in bookRecommendations, citing source labels." : ""}`;

  const text = await askGroq(prompt);
  try {
    const result = JSON.parse(text.replace(/```json|```/g, "").trim());
    setCache(cacheKey, result);
    return result;
  } catch {
    return { patterns: [], recommendations: [], strongestPairs: [], riskBehaviors: [] };
  }
};

// Trade suggestion
exports.getTradeSuggestion = async (proposedTrade, history = [], retrievedChunks = []) => {
  const recent = history.slice(0, 20).map((t) => ({
    pair: t.pair, outcome: t.outcome, pnl: t.profitLoss,
    session: t.session, setup: t.setup,
  }));

  const ragCtx = ragService.formatContext(retrievedChunks);

  const prompt = `You are TradeMind AI. Should this trader take this trade? Respond ONLY in JSON with no markdown:
{
  "recommendation": "take|skip|wait",
  "confidence": 0,
  "reasoning": "",
  "risks": [],
  "improvements": [],
  "bookAlignment": ""
}

Proposed trade: ${JSON.stringify(proposedTrade)}
Recent history: ${JSON.stringify(recent)}
${ragCtx}

${ragCtx ? "Check if this trade aligns with the retrieved context above (books and/or similar past trades). Add alignment note in bookAlignment, citing source labels." : ""}`;

  const text = await askGroq(prompt);
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    return { recommendation: "wait", confidence: 50, reasoning: text, risks: [], improvements: [] };
  }
};

// Analyze document
exports.analyzeDocument = async (content, userContext = "") => {
  const prompt = `You are a professional forex trading coach. Extract and structure all key information from this forex document. Respond ONLY in JSON with no markdown:
{
  "bookName": "",
  "concepts": [],
  "strategies": [],
  "rules": [],
  "rawSummary": ""
}

Document content: ${content.slice(0, 6000)}
Trader context: ${userContext}

Extract practical trading concepts, strategies, and rules that can improve trading decisions.`;

  const text = await askGroq(prompt);
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    return { bookName: "Unknown", concepts: [], strategies: [], rules: [], rawSummary: text };
  }
};

// Smart Market Analysis
exports.analyzeMarketSmart = async (pair, currentPrice, historicalPrices, pastTrades, retrievedChunks = [], newsArticles = []) => {
  const cacheKey = `market_${pair}_${Math.floor(Date.now() / (30 * 60 * 1000))}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const hasTrades = pastTrades && pastTrades.length > 0;
  const hasBookChunks = retrievedChunks.some((c) => c.source === "book");
  const hasNews = newsArticles && newsArticles.length > 0;

  let source = "ai_auto";
  let sourceLabel = "AI Auto — ICT/SMC/Price Action";
  let contextPrompt;

  const ragCtx = ragService.formatContext(retrievedChunks);

  if (hasTrades && hasBookChunks) {
    source = "past_trades";
    sourceLabel = "Past Trades + Book Concepts";
    const tradeSummary = pastTrades.slice(0, 10).map((t) => ({
      pair: t.pair, direction: t.direction, outcome: t.outcome,
      entry: t.entryPrice, sl: t.stopLoss, tp: t.takeProfit, pnl: t.profitLoss,
    }));
    contextPrompt = `Trader's past trades: ${JSON.stringify(tradeSummary)}\n${ragCtx}`;
  } else if (hasTrades) {
    source = "past_trades";
    sourceLabel = "Past Trades Analysis";
    const tradeSummary = pastTrades.slice(0, 10).map((t) => ({
      pair: t.pair, direction: t.direction, outcome: t.outcome,
      entry: t.entryPrice, sl: t.stopLoss, tp: t.takeProfit, pnl: t.profitLoss,
    }));
    contextPrompt = `Trader's past trades: ${JSON.stringify(tradeSummary)}`;
  } else if (hasBookChunks) {
    source = "books";
    sourceLabel = "Book Concepts Analysis";
    contextPrompt = ragCtx;
  } else {
    contextPrompt = "Use ICT, SMC, and Price Action analysis. AI Auto generated.";
  }

  const newsContext = hasNews
    ? `\nRecent news: ${newsArticles.slice(0, 3).map((a) => `- ${a.title}`).join("\n")}`
    : "";

  const recentCandles = historicalPrices
    ? historicalPrices.slice(0, 10).map((p) => ({
        time: p.datetime, open: p.open, high: p.high, low: p.low, close: p.close,
      }))
    : [];

  const prompt = `You are TradeMind AI, expert forex analyst. Analyze ${pair} and provide a trading signal.

Current ${pair} price: ${currentPrice}
Recent candles (1H): ${JSON.stringify(recentCandles)}
${contextPrompt}
${newsContext}

Respond ONLY in JSON with no markdown:
{
  "signal": "buy|sell|wait",
  "confidence": 0,
  "reasoning": "",
  "entry": 0,
  "stopLoss": 0,
  "takeProfit": 0,
  "riskRewardRatio": "",
  "pipsToSL": 0,
  "pipsToTP": 0,
  "marketCondition": "",
  "historicalMatch": "",
  "warnings": [],
  "bestTimeToTrade": "",
  "newsImpact": ""
}`;

  const text = await askGroq(prompt);
  try {
    const result = JSON.parse(text.replace(/```json|```/g, "").trim());
    result.source = source;
    result.sourceLabel = sourceLabel;
    setCache(cacheKey, result);
    return result;
  } catch {
    return {
      signal: "wait", confidence: 0, reasoning: text,
      entry: currentPrice, stopLoss: 0, takeProfit: 0,
      source, sourceLabel, warnings: [],
    };
  }
};

// Quick Trade signal — short-duration up/down call for binary-style
// platforms (Pocket Option, Expert Option). No entry/SL/TP: the trader
// executes on the platform themselves, so all that matters is direction,
// confidence, and a suggested expiry window.
exports.analyzeQuickSignal = async (pair, currentPrice, historicalPrices, newsArticles = []) => {
  const cacheKey = `quick_${pair}_${Math.floor(Date.now() / (5 * 60 * 1000))}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const recentCandles = historicalPrices
    ? historicalPrices.slice(0, 10).map((p) => ({
        time: p.datetime, open: p.open, high: p.high, low: p.low, close: p.close,
      }))
    : [];

  const newsContext = newsArticles && newsArticles.length > 0
    ? `\nRecent news: ${newsArticles.slice(0, 3).map((a) => `- ${a.title}`).join("\n")}`
    : "";

  const prompt = `You are TradeMind AI, expert short-term market analyst. Predict the next short-term price direction for ${pair} for a quick up/down (binary-style) trade.

Current ${pair} price: ${currentPrice}
Recent candles (1H): ${JSON.stringify(recentCandles)}${newsContext}

Respond ONLY in JSON with no markdown:
{
  "direction": "buy|sell|wait",
  "confidence": 0,
  "reasoning": "",
  "expiresInMinutes": 5
}`;

  const text = await askGroq(prompt);
  try {
    const result = JSON.parse(text.replace(/```json|```/g, "").trim());
    setCache(cacheKey, result);
    return result;
  } catch {
    return { direction: "wait", confidence: 0, reasoning: text, expiresInMinutes: 5 };
  }
};

// Analyze news impact
exports.analyzeNewsImpact = async (article, pairs) => {
  const cacheKey = `news_${article.title?.slice(0, 30)}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const prompt = `You are a forex news analyst. Analyze this news and its impact on forex pairs. Respond ONLY in JSON with no markdown:
{
  "headline": "",
  "summary": "",
  "sentiment": "bullish|bearish|neutral",
  "impactLevel": "high|medium|low",
  "affectedPairs": [{"pair":"","impact":"bullish|bearish|neutral","reasoning":"","entry":0,"stopLoss":0,"takeProfit":0}],
  "tradingAdvice": ""
}

News: ${article.title}
Content: ${article.description || ""}
Pairs to analyze: ${pairs.join(", ")}`;

  const text = await askGroq(prompt);
  try {
    const result = JSON.parse(text.replace(/```json|```/g, "").trim());
    setCache(cacheKey, result);
    return result;
  } catch {
    return {
      headline: article.title, summary: article.description || "",
      sentiment: "neutral", impactLevel: "low",
      affectedPairs: [], tradingAdvice: text,
    };
  }
};

exports.analyzeLiveMarket = async (pair, currentPrice, historicalPrices, pastTrades) => {
  return exports.analyzeMarketSmart(pair, currentPrice, historicalPrices, pastTrades, [], []);
};

const buildAnswerPrompt = (question, ragCtx) => ragCtx
  ? `You are TradeMind AI, an assistant embedded in a forex/crypto trading journal app. Answer the trader's question. Prefer the retrieved context below when it's relevant (cite sources by label) — it may include their own trades, their uploaded books, or the app's own user guide. If the context isn't relevant to the question, ignore it and answer from your own general trading/market knowledge instead. Never claim something is in their data if it isn't.

${ragCtx}

Question: ${question}`
  : `You are TradeMind AI, an assistant embedded in a forex/crypto trading journal app. Answer the trader's question using your general trading and market knowledge. Nothing specific to their own trades, books, or the app guide was found for this question, so answer generally and helpfully — do not refuse just because there's no personal data to cite.

Question: ${question}`;

const chunksToSources = (retrievedChunks) => retrievedChunks.map((c) => ({
  label: c.label || c.source,
  source: c.source,
  snippet: c.text.slice(0, 220),
  score: c.score,
}));

// RAG Q&A — answer any trading or app-usage question, grounded in
// retrieved context (books/trades/guide) when there's relevant context,
// falling back to general forex/trading knowledge otherwise.
exports.answerQuestion = async (question, retrievedChunks = []) => {
  const ragCtx = ragService.formatContext(retrievedChunks);
  const prompt = buildAnswerPrompt(question, ragCtx) + `

Respond ONLY in JSON with no markdown:
{
  "answer": ""
}`;

  const text = await askGroq(prompt);
  const sources = chunksToSources(retrievedChunks);

  try {
    const result = JSON.parse(text.replace(/```json|```/g, "").trim());
    return { answer: result.answer || text, sources };
  } catch {
    return { answer: text, sources };
  }
};

// Same as answerQuestion but yields plain-text deltas as they're
// generated, for the streaming (SSE) chat endpoint. No JSON wrapper here
// -- partial JSON can't be rendered progressively, so this asks for and
// streams plain prose directly.
exports.streamAnswer = async function* (question, retrievedChunks = []) {
  const ragCtx = ragService.formatContext(retrievedChunks);
  const prompt = buildAnswerPrompt(question, ragCtx) +
    "\n\nRespond with plain prose only — no JSON, no markdown code fences.";

  yield* askGroqStream(prompt);
};

exports.answerSourcesFor = chunksToSources;
