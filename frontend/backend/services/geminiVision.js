const { GoogleGenerativeAI } = require("@google/generative-ai");
const ragService = require("./ragService");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// An alias, not a pinned version -- verified working directly against this
// project's API key (several pinned versions, including gemini-2.5-flash
// despite being listed as available, returned 404 "no longer available to
// new users"). Staying on an alias avoids re-breaking when Google rotates
// which concrete model backs it.
const MODEL_NAME = "gemini-flash-latest";

// Groq (used everywhere else in this app) has no vision model -- chart
// screenshot analysis needs an actual multimodal model, so this one
// specific feature goes through Gemini instead, which is already
// configured (GEMINI_API_KEY) but was previously unused.
exports.analyzeChartImage = async (base64Image, mimeType, retrievedChunks = []) => {
  const model = genAI.getGenerativeModel({ model: MODEL_NAME });
  const ragCtx = ragService.formatContext(retrievedChunks);

  const prompt = `You are TradeMind AI, a professional forex chart analyst. Analyze this chart screenshot and provide a structured trading analysis.
${ragCtx ? `\nApply this retrieved context from the trader's own uploaded books where relevant:\n${ragCtx}` : ""}

Respond ONLY in JSON with no markdown:
{
  "pair": "",
  "trend": "bullish|bearish|sideways",
  "supportResistance": [{"level": 0, "type": "support|resistance"}],
  "patterns": [""],
  "recommendedSetup": "buy|sell|wait",
  "entry": 0,
  "stopLoss": 0,
  "takeProfit": 0,
  "riskLevel": "low|medium|high",
  "bookAlignment": "",
  "reasoning": ""
}

If the instrument/pair is identifiable on the chart (symbol label, watermark, etc.) put it in "pair" (e.g. "EURUSD"), otherwise leave it empty. Be specific with price levels where visible on the chart. If a level isn't visible/determinable, use 0 and say so in reasoning.${
    ragCtx ? " Note which retrieved source (cite by label) applies to this chart, in bookAlignment." : ""
  }`;

  const result = await model.generateContent([
    prompt,
    { inlineData: { data: base64Image, mimeType } },
  ]);

  const text = result.response.text();
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    return {
      pair: "", trend: "unknown", supportResistance: [], patterns: [],
      recommendedSetup: "wait", entry: 0, stopLoss: 0, takeProfit: 0,
      riskLevel: "medium", bookAlignment: "", reasoning: text,
    };
  }
};

// Trades logged without a screenshot or a chosen setup lose exactly the
// context that would make them useful to review later. This looks at the
// screenshot attached when recording a trade and identifies which setup
// from the app's own dropdown it most resembles, so a trader doesn't have
// to correctly self-label their own strategy every time.
const KNOWN_SETUPS = [
  "Break of Structure", "Order Block", "Fair Value Gap",
  "Support/Resistance", "Trend Follow", "Reversal",
  "Breakout", "ICT Concept", "Supply & Demand", "Other",
];

exports.detectTradeSetup = async (base64Image, mimeType) => {
  const model = genAI.getGenerativeModel({ model: MODEL_NAME });

  const prompt = `You are TradeMind AI. Look at this trade chart screenshot and identify which trading setup/strategy it shows.

Choose the closest match from exactly this list: ${KNOWN_SETUPS.join(", ")}.
Use "Other" only if genuinely none of the rest fit.

Respond ONLY in JSON with no markdown:
{
  "setup": "",
  "confidence": 0,
  "reasoning": ""
}

"confidence" is 0-100. "reasoning" is one short sentence explaining what you saw that indicates this setup (e.g. a visible order block, a clean support bounce, structure break, etc). If the image isn't a readable trading chart at all, set "setup" to "Other", "confidence" to 0, and say so in reasoning.`;

  const result = await model.generateContent([
    prompt,
    { inlineData: { data: base64Image, mimeType } },
  ]);

  const text = result.response.text();
  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    if (!KNOWN_SETUPS.includes(parsed.setup)) parsed.setup = "Other";
    return parsed;
  } catch {
    return { setup: "Other", confidence: 0, reasoning: text };
  }
};
