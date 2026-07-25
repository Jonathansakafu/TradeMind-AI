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

Be specific with price levels where visible on the chart. If a level isn't visible/determinable, use 0 and say so in reasoning.${
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
      trend: "unknown", supportResistance: [], patterns: [],
      recommendedSetup: "wait", entry: 0, stopLoss: 0, takeProfit: 0,
      riskLevel: "medium", bookAlignment: "", reasoning: text,
    };
  }
};
