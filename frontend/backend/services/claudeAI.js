const Groq = require("groq-sdk");
const ragService = require("./ragService");
const marketService = require("./marketService");
const { computeMomentum } = require("./marketAnalysis");

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
// Only evicted lazily on read otherwise — caps memory growth on the
// long-lived server process across many users/pairs/questions.
const CACHE_MAX_ENTRIES = 500;

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
  // Map preserves insertion order, so the first key is the oldest.
  if (cache.size >= CACHE_MAX_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { data, timestamp: Date.now() });
};

// Groq periodically deprecates model IDs outright (llama-3.3-70b-versatile
// was retired 2026-06-17, breaking every AI feature in this app with a
// silent 404 until this was traced down) — unlike geminiVision.js's
// floating "-latest" alias, Groq's model IDs are fixed snapshots with no
// auto-updating alias, so this string needs a manual check against
// console.groq.com/docs/deprecations if it ever 404s again.
const GROQ_MODEL = "openai/gpt-oss-120b";

const askGroq = async (prompt) => {
  const completion = await getGroqClient().chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    model: GROQ_MODEL,
    temperature: 0.3,
    max_tokens: 1500,
    reasoning_effort: "low",
  });
  return completion.choices[0]?.message?.content || "";
};

// Gives Ask AI a real way to look up live market conditions instead of
// telling the trader to go check the ticker themselves — Groq's chat
// completions API is OpenAI-compatible, so this uses standard
// function-calling. Only wired into answerQuestion/streamAnswer (the chat
// endpoints); the structured signal-generation functions already receive
// live price/momentum data directly as prompt context and don't need it.
const MARKET_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_market_snapshot",
      description: "Fetch the current live price and a short-term price-action momentum/volatility read for a forex or crypto pair. Call this whenever the trader asks about a pair's current price, whether to trade it now, or wants any live read on market conditions — never guess a price or tell them to go look it up themselves; look it up.",
      parameters: {
        type: "object",
        properties: {
          pair: {
            type: "string",
            description: "The pair as a plain symbol, e.g. EURUSD, GBPUSD, XAUUSD. Convert names like \"gold\", \"euro dollar\", or \"bitcoin\" to this form.",
          },
        },
        required: ["pair"],
      },
    },
  },
];

async function executeMarketTool(name, rawArgs) {
  if (name !== "get_market_snapshot") {
    return { error: `Unknown tool "${name}"` };
  }
  let args;
  try {
    args = JSON.parse(rawArgs || "{}");
  } catch {
    args = {};
  }
  const pair = marketService.normalizeSymbol(args.pair);
  if (!pair) return { error: "No pair given" };

  const prices = await marketService.getAllPrices();
  const currentPrice = prices[pair];
  if (currentPrice == null) {
    return { pair, error: "No live price available for this pair right now — market may be closed, or the symbol wasn't recognized." };
  }

  const formattedPair = pair.length === 6 ? `${pair.slice(0, 3)}/${pair.slice(3)}` : pair;
  let historical = [];
  try {
    historical = await marketService.getHistoricalData(formattedPair, "1h", 10);
  } catch {
    // Momentum below just reports "not enough data" — price alone is still useful.
  }

  return { pair, currentPrice, momentum: computeMomentum(historical) };
}

// Non-streaming tool-augmented chat: one round of function-calling, then a
// follow-up completion with the tool's result folded in. Caps at a single
// tool-call round (fetch live data once, then answer) — this app's chat
// endpoint doesn't need an open-ended agentic loop.
async function askGroqWithTools(messages) {
  const first = await getGroqClient().chat.completions.create({
    model: GROQ_MODEL,
    messages,
    tools: MARKET_TOOLS,
    tool_choice: "auto",
    temperature: 0.3,
    max_tokens: 1500,
    reasoning_effort: "low",
  });

  const msg = first.choices[0]?.message;
  if (msg?.tool_calls?.length) {
    const toolResults = await Promise.all(msg.tool_calls.map(async (call) => ({
      role: "tool",
      tool_call_id: call.id,
      content: JSON.stringify(await executeMarketTool(call.function.name, call.function.arguments)),
    })));

    const second = await getGroqClient().chat.completions.create({
      model: GROQ_MODEL,
      messages: [...messages, msg, ...toolResults],
      temperature: 0.3,
      max_tokens: 1500,
      reasoning_effort: "low",
    });
    return second.choices[0]?.message?.content || "";
  }

  return msg?.content || "";
}

// Streaming version of the above. Text deltas stream through immediately
// (the common case — no tool needed); a tool-call turn instead streams
// only `tool_calls` deltas (no content), which are accumulated by index
// per the OpenAI-compatible streaming shape, executed once the turn ends,
// then a second streamed completion carries the actual answer.
async function* streamGroqWithTools(messages) {
  const stream = await getGroqClient().chat.completions.create({
    model: GROQ_MODEL,
    messages,
    tools: MARKET_TOOLS,
    tool_choice: "auto",
    temperature: 0.3,
    max_tokens: 1500,
    reasoning_effort: "low",
    stream: true,
  });

  const toolCalls = [];
  let finishReason = null;

  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (choice?.delta?.content) yield choice.delta.content;
    if (choice?.delta?.tool_calls) {
      for (const tc of choice.delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!toolCalls[idx]) toolCalls[idx] = { id: tc.id, type: "function", function: { name: "", arguments: "" } };
        if (tc.id) toolCalls[idx].id = tc.id;
        if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
        if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
      }
    }
  }

  if (finishReason === "tool_calls" && toolCalls.length > 0) {
    const assistantMsg = { role: "assistant", content: null, tool_calls: toolCalls };
    const toolResults = await Promise.all(toolCalls.map(async (call) => ({
      role: "tool",
      tool_call_id: call.id,
      content: JSON.stringify(await executeMarketTool(call.function.name, call.function.arguments)),
    })));

    const followup = await getGroqClient().chat.completions.create({
      model: GROQ_MODEL,
      messages: [...messages, assistantMsg, ...toolResults],
      temperature: 0.3,
      max_tokens: 1500,
      reasoning_effort: "low",
      stream: true,
    });
    for await (const chunk of followup) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}

// Analyze single trade
exports.analyzeTrade = async (trade, history = [], retrievedChunks = [], extra = {}) => {
  const { bookSummary = "" } = extra;
  const cacheKey = `trade_${trade._id}_${retrievedChunks.map((c) => c.sourceId).join(",")}_${bookSummary ? "b" : ""}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const ragCtx = ragService.buildPromptContext({ retrievedChunks, bookSummary });

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
exports.detectPatterns = async (trades, retrievedChunks = [], extra = {}) => {
  const { bookSummary = "" } = extra;
  const cacheKey = `patterns_${trades.length}_${trades[0]?._id}_${retrievedChunks.map((c) => c.sourceId).join(",")}_${bookSummary ? "b" : ""}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const summary = trades.slice(0, 50).map((t) => ({
    pair: t.pair, direction: t.direction, outcome: t.outcome,
    session: t.session, pnl: t.profitLoss, setup: t.setup,
  }));

  const ragCtx = ragService.buildPromptContext({ retrievedChunks, bookSummary });

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
exports.getTradeSuggestion = async (proposedTrade, history = [], retrievedChunks = [], extra = {}) => {
  const { bookSummary = "" } = extra;
  const recent = history.slice(0, 20).map((t) => ({
    pair: t.pair, outcome: t.outcome, pnl: t.profitLoss,
    session: t.session, setup: t.setup,
  }));

  const ragCtx = ragService.buildPromptContext({ retrievedChunks, bookSummary });

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

// Smart Market Analysis — signals are sized for an intraday trade the
// trader closes within roughly 3-4 hours, not a multi-day swing position
// (previously the prompt left holding period unstated, and the model
// defaulted to wider, swing-style stops). Fuses every available context
// source (RAG chunks — including the trader's own uploaded chart
// screenshots, extracted book concepts, price-action momentum, and this
// pair's own recent trade history) into one consistent block via
// ragService.buildPromptContext, and reflects which of those sources
// actually contributed in sourceLabel so that's visible, not just internal.
exports.analyzeMarketSmart = async (pair, currentPrice, historicalPrices, pastTrades, retrievedChunks = [], newsArticles = [], extra = {}) => {
  const { bookSummary = "", momentum = null, pairTrades = [] } = extra;
  const cacheKey = `market_${pair}_${Math.floor(Date.now() / (30 * 60 * 1000))}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const hasTrades = pastTrades && pastTrades.length > 0;
  const hasBookChunks = retrievedChunks.some((c) => c.source === "book");
  const hasScreenshotChunks = retrievedChunks.some((c) => c.source === "screenshot");
  const hasBooks = hasBookChunks || !!bookSummary;
  const hasNews = newsArticles && newsArticles.length > 0;
  const hasMomentum = !!momentum?.summary;

  const usedSources = [];
  if (hasBooks) usedSources.push("Books");
  if (hasScreenshotChunks) usedSources.push("Screenshots");
  if (hasTrades) usedSources.push("Trade History");
  if (hasMomentum) usedSources.push("Momentum");
  const source = hasBooks ? "books" : hasTrades ? "past_trades" : "ai_auto";
  const sourceLabel = usedSources.length > 0
    ? `AI Auto — ${usedSources.join(" + ")}`
    : "AI Auto — ICT/SMC/Price Action";

  const tradeSummary = hasTrades
    ? pastTrades.slice(0, 10).map((t) => ({
        pair: t.pair, direction: t.direction, outcome: t.outcome,
        entry: t.entryPrice, sl: t.stopLoss, tp: t.takeProfit, pnl: t.profitLoss,
      }))
    : [];

  const fusedContext = ragService.buildPromptContext({ retrievedChunks, bookSummary, momentum, pairTrades });

  const newsContext = hasNews
    ? `\nRecent news: ${newsArticles.slice(0, 3).map((a) => `- ${a.title}`).join("\n")}`
    : "";

  const recentCandles = historicalPrices
    ? historicalPrices.slice(0, 10).map((p) => ({
        time: p.datetime, open: p.open, high: p.high, low: p.low, close: p.close,
      }))
    : [];

  const prompt = `You are TradeMind AI, expert forex analyst. Analyze ${pair} and provide a trading signal for an INTRADAY trade the trader intends to close within roughly 3-4 hours — this is not a multi-day swing position, so size stopLoss/takeProfit for that horizon (proportional to the recent volatility below, not arbitrary round numbers).

Current ${pair} price: ${currentPrice}
Recent candles (1H): ${JSON.stringify(recentCandles)}
${hasTrades ? `Trader's recent past trades: ${JSON.stringify(tradeSummary)}` : ""}
${fusedContext}
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
// bookSummary/momentum only (extra) -- deliberately no RAG chunk retrieval
// for this path. Quick Trade already iterates up to ~10 pairs per cycle;
// adding a CPU-bound embedding call per pair on top of that would slow
// every cycle for a lower payoff than it gives the (much less frequent)
// forex/MT5 signal path, where the same fusion does include RAG.
exports.analyzeQuickSignal = async (pair, currentPrice, historicalPrices, newsArticles = [], extra = {}) => {
  const { bookSummary = "", momentum = null } = extra;
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
  const momentumContext = momentum?.summary ? `\nMarket pressure: ${momentum.summary}` : "";

  const prompt = `You are TradeMind AI, expert short-term market analyst. Predict the next short-term price direction for ${pair} for a quick up/down (binary-style) trade.

Current ${pair} price: ${currentPrice}
Recent candles (1H): ${JSON.stringify(recentCandles)}${newsContext}${momentumContext}
${bookSummary}

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
// prices (optional): { PAIR: currentPrice } for the pairs being analyzed.
// Without this, the model had nothing to ground affectedPairs[].entry/
// stopLoss/takeProfit in and was producing plausible-looking but stale
// price levels from its training data (e.g. gold entry/SL/TP around
// $1900-2000 when the real live price was ~$4400) -- confidently wrong,
// not just imprecise, since nothing in the prompt or response hinted the
// levels weren't grounded in anything current.
exports.analyzeNewsImpact = async (article, pairs, prices = {}) => {
  const cacheKey = `news_${article.title?.slice(0, 30)}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const knownPrices = Object.fromEntries(
    pairs.map((p) => [p, prices[p]]).filter(([, price]) => price != null)
  );
  const priceContext = Object.keys(knownPrices).length > 0
    ? `\nCurrent live prices for these pairs (source every entry/stopLoss/takeProfit level off these actual prices -- never state a price level from memory/training data, it will be stale): ${JSON.stringify(knownPrices)}`
    : "\nNo live price data is available for these pairs right now -- leave entry/stopLoss/takeProfit as 0 rather than guessing a level from memory, and say so in reasoning.";

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
Pairs to analyze: ${pairs.join(", ")}${priceContext}`;

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

// Persona/context lives in `system` (not folded into the user turn) so it
// persists across a tool-call round-trip without being re-stated.
const buildAnswerMessages = (question, ragCtx, { jsonMode } = {}) => {
  const persona = ragCtx
    ? `You are TradeMind AI, an assistant embedded in a forex/crypto trading journal app. Answer the trader's question. Prefer the retrieved context below when it's relevant (cite sources by label) — it may include their own trades, their uploaded books, or the app's own user guide. If the context isn't relevant to the question, ignore it and answer from your own general trading/market knowledge instead. Never claim something is in their data if it isn't.

${ragCtx}`
    : `You are TradeMind AI, an assistant embedded in a forex/crypto trading journal app. Answer the trader's question using your general trading and market knowledge. Nothing specific to their own trades, books, or the app guide was found for this question, so answer generally and helpfully — do not refuse just because there's no personal data to cite.`;

  const toolInstruction = "\n\nYou have a get_market_snapshot tool for live price/momentum data — use it whenever the question needs current market conditions instead of describing how the trader could check themselves.";

  const formatInstruction = jsonMode
    ? '\n\nAlways give your final reply as a single JSON object with no markdown: {"answer": ""} — this applies even after using a tool; your last message must still be in this format.'
    : "\n\nRespond with plain prose only — no JSON, no markdown code fences. This applies even after using a tool.";

  return [
    { role: "system", content: persona + toolInstruction + formatInstruction },
    { role: "user", content: question },
  ];
};

const chunksToSources = (retrievedChunks) => retrievedChunks.map((c) => ({
  label: c.label || c.source,
  source: c.source,
  snippet: c.text.slice(0, 220),
  score: c.score,
}));

// RAG Q&A — answer any trading or app-usage question, grounded in
// retrieved context (books/trades/guide/screenshots) plus extracted book
// concepts when there's relevant context, falling back to general
// forex/trading knowledge otherwise.
exports.answerQuestion = async (question, retrievedChunks = [], extra = {}) => {
  const ragCtx = ragService.buildPromptContext({ retrievedChunks, bookSummary: extra.bookSummary });
  const messages = buildAnswerMessages(question, ragCtx, { jsonMode: true });

  const text = await askGroqWithTools(messages);
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
exports.streamAnswer = async function* (question, retrievedChunks = [], extra = {}) {
  const ragCtx = ragService.buildPromptContext({ retrievedChunks, bookSummary: extra.bookSummary });
  const messages = buildAnswerMessages(question, ragCtx, { jsonMode: false });

  yield* streamGroqWithTools(messages);
};

exports.answerSourcesFor = chunksToSources;
