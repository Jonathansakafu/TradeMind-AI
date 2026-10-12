const { GoogleGenerativeAI } = require("@google/generative-ai");
const pipelineStats = require("./pipelineStats");

// Backup text model for when Groq refuses a call (daily token quota, the
// app's own hourly budget, or an outage). Groq's paid tier is closed to
// new upgrades (2026-09-28), and GEMINI_API_KEY is already configured for
// chart screenshots, so this needs no new account.
//
// Aliases, not pinned versions: pinned Gemini versions returned 404 "no
// longer available to new users" for this project's key (see
// geminiVision.js). Flash-Lite first -- its own free quota (~1,000
// requests/day) is separate from the Flash model screenshot analysis uses.
const MODELS = ["gemini-flash-lite-latest", "gemini-flash-latest"];
const REQUEST_TIMEOUT_MS = 30000;

// Background (automatic signal) calls are capped per hour so they can't
// eat the whole free daily quota; the rest stays for Ask AI and
// user-triggered analysis.
const BACKGROUND_CALLS_PER_HOUR = 30;
// Daily cap too: on 2026-10-11/12 background signals made ~480 Gemini calls
// overnight and used up the whole free daily quota, leaving none for Ask
// AI. Background now stops at 250/day; the rest is kept for chat.
const BACKGROUND_CALLS_PER_DAY = 250;
const bg = { hour: null, calls: 0, day: null, dayCalls: 0 };
let pausedUntil = 0;
let workingModel = null;

let client;
function getClient() {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  client ||= new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return client;
}

function claim(background) {
  // The pause after a 429 only holds back background calls -- chat still
  // tries (the next model alias has its own quota, see withModel).
  if (background && Date.now() < pausedUntil) throw new Error("Backup AI (Gemini) is rate-limited right now");
  if (!background) return;
  const hour = Math.floor(Date.now() / 3600000);
  if (bg.hour !== hour) { bg.hour = hour; bg.calls = 0; }
  const day = new Date().toISOString().slice(0, 10);
  if (bg.day !== day) { bg.day = day; bg.dayCalls = 0; }
  if (bg.calls >= BACKGROUND_CALLS_PER_HOUR) throw new Error("Backup AI hourly budget for automatic signals used up");
  if (bg.dayCalls >= BACKGROUND_CALLS_PER_DAY) throw new Error("Backup AI daily budget for automatic signals used up");
  bg.calls++;
  bg.dayCalls++;
}

function onError(err) {
  if (err?.status === 429 || /quota|rate.?limit/i.test(err?.message || "")) {
    pausedUntil = Date.now() + 5 * 60 * 1000;
  }
}

// Tries each model alias in order, remembering the first that works so
// later calls skip ones this key can't use (404).
// Each model alias has its own free quota, so a 429 / 503 on one moves on
// to the next when `tryNextOnBusy` (chat); 404 always moves on.
async function withModel(fn, { tryNextOnBusy = false } = {}) {
  const order = workingModel ? [workingModel, ...MODELS.filter((m) => m !== workingModel)] : MODELS;
  let lastErr;
  for (const name of order) {
    try {
      const result = await fn(name);
      if (!tryNextOnBusy) workingModel = name;
      return result;
    } catch (err) {
      lastErr = err;
      const busy = err?.status === 429 || err?.status === 503;
      if (!(err?.status === 404 || (busy && tryNextOnBusy))) break;
    }
  }
  throw lastErr;
}

// Single prompt -> text. json: ask Gemini for strict JSON output (every
// structured prompt in claudeAI.js expects bare JSON back).
exports.generate = async (prompt, { json = false, background = false } = {}) => {
  claim(background);
  try {
    const text = await withModel(async (name) => {
      const model = getClient().getGenerativeModel({
        model: name,
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1500,
          ...(json ? { responseMimeType: "application/json" } : {}),
        },
      }, { timeout: REQUEST_TIMEOUT_MS });
      const res = await model.generateContent(prompt);
      return res.response.text();
    });
    pipelineStats.inc(background ? "gemini.backgroundOk" : "gemini.ok");
    return text;
  } catch (err) {
    onError(err);
    pipelineStats.inc("gemini.error");
    pipelineStats.recordError("gemini", err.message);
    throw err;
  }
};

// Chat-style streaming for Ask AI: OpenAI-style [{role, content}] (system
// first) -> Gemini's systemInstruction + user/model turns. No tool calling
// here -- the live-price tool is Groq-only -- so this answers from the
// retrieved context and general knowledge.
exports.streamChat = async function* (messages) {
  claim(false);
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const contents = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  let stream;
  try {
    stream = await withModel(async (name) => {
      const model = getClient().getGenerativeModel({
        model: name,
        systemInstruction: system || undefined,
        generationConfig: { temperature: 0.3, maxOutputTokens: 1500 },
      }, { timeout: REQUEST_TIMEOUT_MS });
      return model.generateContentStream({ contents });
    }, { tryNextOnBusy: true });
  } catch (err) {
    onError(err);
    pipelineStats.inc("gemini.error");
    pipelineStats.recordError("gemini", err.message);
    throw err;
  }
  pipelineStats.inc("gemini.chatOk");
  for await (const chunk of stream.stream) {
    const text = chunk.text();
    if (text) yield text;
  }
};

// Used by GET /api/cron/health?probe=1 to prove the key + model work in
// production (the key only exists on Render).
exports.probe = async () => {
  try {
    const reply = await exports.generate("Reply with OK");
    return { ok: true, model: workingModel, reply: reply.trim().slice(0, 20) };
  } catch (err) {
    return { ok: false, error: (err.message || "").slice(0, 300) };
  }
};

exports.status = () => ({
  model: workingModel,
  backgroundCallsThisHour: bg.hour === Math.floor(Date.now() / 3600000) ? bg.calls : 0,
  backgroundCallsPerHour: BACKGROUND_CALLS_PER_HOUR,
  backgroundCallsToday: bg.day === new Date().toISOString().slice(0, 10) ? bg.dayCalls : 0,
  backgroundCallsPerDay: BACKGROUND_CALLS_PER_DAY,
  pausedUntil: pausedUntil > Date.now() ? new Date(pausedUntil) : null,
});
