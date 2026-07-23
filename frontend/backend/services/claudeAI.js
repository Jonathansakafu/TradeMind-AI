const Groq = require("groq-sdk");
const ragService = require("./ragService");

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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
  const completion = await groq.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    model: "llama-3.3-70b-versatile",
    temperature: 0.3,
    max_tokens: 1500,
  });
  return completion.choices[0]?.message?.content || "";
};

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

// Analyze screenshot with retrieved book context
exports.analyzeScreenshot = async (base64Image, mimeType, retrievedChunks = []) => {
  const ragCtx = ragService.formatContext(retrievedChunks);

  const prompt = `You are TradeMind AI, a professional forex chart analyst. Analyze this chart and provide detailed trading analysis.
${ragCtx ? `\nApply this retrieved context in your analysis:\n${ragCtx}` : ""}

Provide:
1. Trend direction (bullish/bearish/sideways)
2. Key support and resistance levels
3. Chart patterns visible
4. Recommended trade setup (buy/sell/wait)
5. Entry price suggestion
6. Stop loss placement
7. Take profit target
8. Risk assessment (low/medium/high)
${ragCtx ? "9. Which retrieved source (cite by label) applies to this chart setup" : ""}

Be specific with price levels where visible.`;

  return prompt + "\n\n[Note: Groq does not support image analysis. Please use the chart description to manually input trade details, or upgrade to a vision-capable AI model.]";
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

// RAG Q&A — answer a free-form question grounded only in retrieved chunks
exports.answerQuestion = async (question, retrievedChunks = []) => {
  const ragCtx = ragService.formatContext(retrievedChunks);

  if (!ragCtx) {
    return {
      answer: "I don't have any uploaded books or trade history to ground an answer yet. Upload a trading book (PDF) or log some trades first, then ask again.",
      sources: [],
    };
  }

  const prompt = `You are TradeMind AI. Answer the trader's question using ONLY the retrieved context below — do not invent facts that aren't present in it. If the context doesn't contain the answer, say so honestly.

${ragCtx}

Question: ${question}

Respond ONLY in JSON with no markdown:
{
  "answer": ""
}`;

  const text = await askGroq(prompt);
  const sources = retrievedChunks.map((c) => ({
    label: c.label || c.source,
    source: c.source,
    snippet: c.text.slice(0, 220),
    score: c.score,
  }));

  try {
    const result = JSON.parse(text.replace(/```json|```/g, "").trim());
    return { answer: result.answer || text, sources };
  } catch {
    return { answer: text, sources };
  }
};
