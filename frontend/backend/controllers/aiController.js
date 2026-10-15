const Trade = require("../models/Trade");
const userDataContext = require("../services/userDataContext");
const pipelineStats = require("../services/pipelineStats");
const Analysis = require("../models/Analysis");
const BookConcept = require("../models/BookConcept");
const ChatConversation = require("../models/ChatConversation");
const claudeAI = require("../services/claudeAI");
const ragService = require("../services/ragService");
const learningService = require("../services/learningService");
const geminiVision = require("../services/geminiVision");
const { prepareImage } = require("../utils/prepareImage");
const fs = require("fs");

// Analyze single trade
exports.analyzeTrade = async (req, res) => {
  try {
    const trade = await Trade.findOne({
      _id: req.params.tradeId,
      user: req.user._id,
    });
    if (!trade) return res.status(404).json({ message: "Trade not found" });

    const history = await Trade.find({
      user: req.user._id,
      status: "closed",
    }).limit(20);

    const query = [trade.pair, trade.direction, trade.setup, trade.session, trade.notes]
      .filter(Boolean).join(" ");
    const [retrievedChunks, bookSummary] = await Promise.all([
      ragService.retrieve(req.user._id, query, { topK: 6 }),
      ragService.getBookConceptSummary(req.user._id),
    ]);

    const result = await claudeAI.analyzeTrade(trade, history, retrievedChunks, { bookSummary });

    const analysis = await Analysis.create({
      user: req.user._id,
      trade: trade._id,
      type: "trade",
      response: JSON.stringify(result),
      patterns: result.patterns || [],
      riskFlags: result.riskFlags || [],
      suggestions: result.suggestions || [],
    });

    await Trade.findByIdAndUpdate(trade._id, { aiAnalysis: analysis._id });
    res.json({ analysis, result });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Detect patterns
exports.detectPatterns = async (req, res) => {
  try {
    const trades = await Trade.find({
      user: req.user._id,
    }).sort({ openedAt: -1 }).limit(100);

    const setups = [...new Set(trades.map((t) => t.setup).filter(Boolean))].slice(0, 10);
    const pairs = [...new Set(trades.map((t) => t.pair))].slice(0, 10);
    const query = `trading patterns risk management ${setups.join(" ")} ${pairs.join(" ")}`;
    const [retrievedChunks, bookSummary] = await Promise.all([
      ragService.retrieve(req.user._id, query, { topK: 8 }),
      ragService.getBookConceptSummary(req.user._id),
    ]);

    const result = await claudeAI.detectPatterns(trades, retrievedChunks, { bookSummary });

    const analysis = await Analysis.create({
      user: req.user._id,
      type: "pattern",
      response: JSON.stringify(result),
      patterns: result.patterns || [],
      suggestions: result.recommendations || [],
      bestSession: result.bestSession,
      strongestPairs: result.strongestPairs || [],
    });

    res.json({ analysis, result });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Trade suggestion
exports.getTradeSuggestion = async (req, res) => {
  try {
    const { proposedTrade } = req.body;
    const history = await Trade.find({ user: req.user._id }).limit(30);
    const query = [proposedTrade?.pair, proposedTrade?.direction, proposedTrade?.setup, proposedTrade?.session]
      .filter(Boolean).join(" ");
    const [retrievedChunks, bookSummary, learnedSummary] = await Promise.all([
      ragService.retrieve(req.user._id, query, { topK: 6 }),
      ragService.getBookConceptSummary(req.user._id),
      learningService.getLearnedSummary(req.user._id),
    ]);
    const result = await claudeAI.getTradeSuggestion(
      proposedTrade, history, retrievedChunks, { bookSummary, learnedSummary }
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Analyze document — save concepts to database
exports.analyzeDocument = async (req, res) => {
  try {
    let content = "";
    let fileName = "Unknown Book";

    if (req.file) {
      // pdf-parse v2 is a class (PDFParse), not v1's callable function --
      // calling it the v1 way threw, and the old catch then read the raw
      // PDF *binary* as text and sent that to the AI, so every uploaded
      // book produced garbage/empty strategies.
      const filePath = req.file.path;
      fileName = req.file.originalname.replace(/\.(pdf|txt)$/i, "");
      try {
        const { PDFParse } = require("pdf-parse");
        const parser = new PDFParse({ data: fs.readFileSync(filePath) });
        try {
          content = (await parser.getText()).text || "";
        } finally {
          await parser.destroy().catch(() => {});
        }
      } catch (err) {
        console.error("PDF parse failed:", err.message);
        return res.status(400).json({ message: "Couldn't read this PDF. If it's a scanned book (pages are images), it has no text to extract -- try a text-based PDF." });
      } finally {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    } else if (req.body.content) {
      content = req.body.content;
      fileName = req.body.bookName || "Unknown Book";
    } else {
      return res.status(400).json({ message: "Please upload a PDF or text file" });
    }

    if (!content || content.trim().length < 50) {
      return res.status(400).json({ message: "File appears empty or unreadable" });
    }

    const trades = await Trade.find({ user: req.user._id }).limit(10);
    const wins = trades.filter((t) => t.outcome === "win").length;
    const userContext = `Win rate: ${trades.length ? Math.round((wins / trades.length) * 100) : 0}%, Total trades: ${trades.length}`;

    const extracted = await claudeAI.analyzeDocument(content, userContext);
    const found = (extracted.concepts?.length || 0) + (extracted.strategies?.length || 0) + (extracted.rules?.length || 0);
    // Previously saved even when the AI returned nothing usable (e.g. an
    // unparseable reply), leaving an empty "book" that silently
    // contributed nothing to signals.
    if (found === 0) {
      return res.status(422).json({ message: "The AI couldn't find any trading strategies, concepts or rules in this document. Please try again, or try a different book." });
    }

    // Save to database
    const bookConcept = await BookConcept.create({
      user: req.user._id,
      bookName: extracted.bookName || fileName,
      concepts: extracted.concepts || [],
      strategies: extracted.strategies || [],
      rules: extracted.rules || [],
      rawSummary: extracted.rawSummary || "",
    });

    // Chunking + embedding hundreds of passages on this server's CPU can
    // take minutes -- don't block the response on it. The concepts
    // already extracted above are the immediate value; full-text RAG
    // retrieval over this book becomes available a little afterward.
    ragService.indexBookChunks(req.user._id, bookConcept._id, bookConcept.bookName, content)
      .then((count) => console.log(`Indexed ${count} chunks for book "${bookConcept.bookName}"`))
      .catch((err) => console.error("Book RAG indexing failed:", err.message));

    res.json({
      analysis: extracted.rawSummary,
      bookConcept,
      message: `"${bookConcept.bookName}" saved and will be used in all future AI analysis! Full-text search indexing is finishing in the background.`,
    });
  } catch (err) {
    console.error("Document analysis error:", err);
    res.status(500).json({ message: "Document analysis failed: " + err.message });
  }
};

// Get saved books
exports.getBooks = async (req, res) => {
  try {
    const books = await BookConcept.find({ user: req.user._id })
      .select("bookName concepts strategies rules createdAt")
      .sort({ createdAt: -1 });
    res.json(books);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Delete book
exports.deleteBook = async (req, res) => {
  try {
    await BookConcept.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });
    await ragService.removeBookChunks(req.params.id);
    res.json({ message: "Book deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Analyze screenshot
exports.analyzeScreenshot = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Please upload a screenshot" });
    }
    const imageBuffer = fs.readFileSync(req.file.path);
    fs.unlinkSync(req.file.path);
    const { base64: base64Image, mimeType } = await prepareImage(imageBuffer);

    // The retrieve() call runs a local, CPU-bound embedding computation
    // (see embeddingService.js) *before* Gemini is ever reached -- on this
    // server's free-tier CPU, a cold model load alone measured ~9s, and it
    // has no timeout of its own. If it's ever slower than that (heavier
    // load, a colder start), it would hang the whole screenshot analysis
    // without Gemini's own timeout/error handling ever getting a chance to
    // apply. Retrieved book context is a nice-to-have enrichment here, not
    // the point of the request, so a slow lookup degrades to "no book
    // context this time" instead of failing the whole analysis.
    // Worst-case budget this endpoint can take: this 10s + geminiVision.js's
    // REQUEST_TIMEOUT_MS (40s) = 50s. The frontend's axios `timeout` for
    // this call (Analytics.jsx, addtrade.jsx) MUST stay comfortably above
    // that sum -- it was left at a stale 45s once before after this RAG cap
    // was added on top of an already-tight Gemini budget, so the client
    // gave up (a raw "timeout of 45000ms exceeded") before ever seeing this
    // endpoint's own properly formatted error response.
    const [retrievedChunks, bookSummary] = await Promise.all([
      Promise.race([
        ragService.retrieve(req.user._id, "chart pattern analysis", { topK: 6, sources: ["book"] }),
        new Promise((resolve) => setTimeout(() => resolve([]), 10000)),
      ]),
      ragService.getBookConceptSummary(req.user._id),
    ]);
    const result = await geminiVision.analyzeChartImage(
      base64Image, mimeType, retrievedChunks, { bookSummary }
    );

    const analysisRecord = await Analysis.create({
      user: req.user._id,
      type: "screenshot",
      response: JSON.stringify(result),
    });

    ragService.indexScreenshotAnalysis(req.user._id, analysisRecord._id, result.pair, result)
      .catch((err) => console.error("Screenshot RAG indexing failed:", err.message));

    res.json({ analysis: result });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Detect which setup/strategy a trade screenshot shows, so Add Trade can
// pre-fill it instead of leaving it to guesswork or getting skipped
exports.detectStrategy = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Please provide a screenshot" });
    }
    const imageBuffer = fs.readFileSync(req.file.path);
    fs.unlinkSync(req.file.path);
    const { base64: base64Image, mimeType } = await prepareImage(imageBuffer);

    const result = await geminiVision.detectTradeSetup(base64Image, mimeType);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Ask AI — RAG Q&A grounded in the trader's uploaded books + trade history
exports.askQuestion = async (req, res) => {
  try {
    const { question } = req.body;
    if (!question || !question.trim()) {
      return res.status(400).json({ message: "Question is required" });
    }

    const [retrievedChunks, bookSummary] = await Promise.all([
      ragService.retrieve(req.user._id, question, {
        topK: 8,
        sources: ["book", "trade", "guide", "screenshot"],
      }),
      ragService.getBookConceptSummary(req.user._id),
    ]);
    const userData = await userDataContext.build(req.user._id).catch(() => "");
    const result = await claudeAI.answerQuestion(question, retrievedChunks, { bookSummary, userData, voice: !!req.body.voice });

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Ask AI (streaming) — same as askQuestion but sends the answer as
// Server-Sent Events so the UI can render it token-by-token instead of
// waiting for the full response.
// Opens a Server-Sent Events response; send(event, data) writes one event.
function openSSE(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const state = { closed: false };
  // res, not req: on current Node, a request's "close" only means its
  // body was read -- it never reported the client disconnecting, so a
  // dropped connection kept generating (and burning AI quota) to the end.
  res.on("close", () => { if (!res.writableEnded) state.closed = true; });
  state.send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  return state;
}

// Retrieval adds an embedding call; spoken answers can't wait long for it.
const withTimeout = (p, ms, fallback) => Promise.race([p, new Promise((r) => setTimeout(() => r(fallback), ms))]);

// Saves the question to the conversation (new or continued) and streams
// the answer over an already-open SSE response.
async function answerOverSSE(req, res, sse, { question, conversationId, voice }) {
  // Load (or start) the saved conversation, and save the question right
  // away -- so it's never lost even if the answer fails or the connection
  // drops mid-stream.
  let conversation = null;
  if (conversationId) {
    conversation = await ChatConversation.findOne({ _id: conversationId, user: req.user._id }).catch(() => null);
  }
  const history = conversation ? conversation.messages.map((m) => ({ role: m.role, content: m.content })) : [];
  if (!conversation) {
    conversation = new ChatConversation({ user: req.user._id, title: question.trim().slice(0, 60) });
  }
  conversation.messages.push({ role: "user", content: question.trim() });
  await conversation.save();

  let answer = "";
  let sources = [];
  let finished = false;
  // Saves whatever answer exists, including a partial one when the
  // stream is cut off -- that's the "conversation breaks" case.
  const saveAnswer = async () => {
    if (!answer) return;
    conversation.messages.push({
      role: "assistant", content: answer, sources, incomplete: finished ? undefined : true,
    });
    await conversation.save().catch((err) => console.error("Saving chat answer failed:", err.message));
  };

  try {
    sse.send("conversation", { id: conversation._id, title: conversation.title });

    const retrieval = ragService.retrieve(req.user._id, question, {
      topK: 8,
      sources: ["book", "trade", "guide", "screenshot"],
    });
    const [retrievedChunks, bookSummary, userData] = await Promise.all([
      voice ? withTimeout(retrieval.catch(() => []), 1200, []) : retrieval,
      voice ? withTimeout(ragService.getBookConceptSummary(req.user._id).catch(() => ""), 800, "") : ragService.getBookConceptSummary(req.user._id),
      // Voice: capped so the spoken answer starts fast (Siri-style).
      (voice ? (p) => withTimeout(p, 2500, "") : (p) => p)(userDataContext.build(req.user._id).catch((err) => { console.error("userDataContext:", err.message); return ""; })),
    ]);
    if (sse.closed) return res.end();

    sources = claudeAI.answerSourcesFor(retrievedChunks);
    sse.send("sources", { sources });

    for await (const delta of claudeAI.streamAnswer(question, retrievedChunks, { bookSummary, history, userData, voice })) {
      answer += delta;
      if (sse.closed) {
        await saveAnswer();
        return res.end();
      }
      sse.send("chunk", { text: delta });
    }

    finished = true;
    await saveAnswer();
    sse.send("done", {});
    res.end();
  } catch (err) {
    await saveAnswer();
    if (!sse.closed) {
      sse.send("error", { message: err.message });
      res.end();
    }
  }
}

exports.askQuestionStream = async (req, res) => {
  const { question, conversationId } = req.body;
  if (!question || !question.trim()) {
    return res.status(400).json({ message: "Question is required" });
  }
  const sse = openSSE(res);
  await answerOverSSE(req, res, sse, { question, conversationId, voice: !!req.body.voice });
};

// Hey TradeMind in one request (fastest path): WAV audio in, then SSE out
// -- "question" (what was understood), or "nohear", then the usual
// conversation / sources / chunk / done events with a short spoken-style
// answer. ?lang=en|sw|...&conversationId=...
// Ending a hands-free conversation, in any app language (like Siri /
// Google): "thank you" -> TradeMind says "You're welcome, Jonathan" and
// closes; "stop" / "that's all" -> a short goodbye. An optional name or
// two words after it ("thank you TradeMind", "asante sana") still count;
// a real question after it ("thanks, and gold?") does not.
const TAIL = "(?:[ ,]+[\\p{L}']+){0,2}[.!?。！？、, ]*$";
const THANKS = new RegExp(`^(?:ok(?:ay)?[, ]*)?(?:thanks?(?: you)?(?: (?:so|very) much| a lot)?|thank u|cheers|asante(?: sana)?|nashukuru|merci(?: beaucoup)?|شكرا|شكراً|شكرًا|谢谢|多谢|感谢|감사합니다|고마워요?|ありがとう(?:ございます)?)${TAIL}`, "iu");
const STOP = new RegExp(`^(?:ok(?:ay)?[, ]*)?(?:stop|cancel|that'?s (?:all|it)|no,? thanks?(?: you)?|nothing(?: else)?|bye|good ?bye|hapana|basi|inatosha|c'est tout|non merci|arr[êe]te|au revoir|خلاص|توقف|مع السلامة|没有了|好了|停止|再见|그만|됐어|안녕|大丈夫です?|以上です?|ストップ|さようなら)${TAIL}`, "iu");
const VOICE_GOODBYE = { test: (q) => THANKS.test(q) || STOP.test(q), kind: (q) => (THANKS.test(q) ? "thanks" : STOP.test(q) ? "stop" : null) };
exports.VOICE_GOODBYE = VOICE_GOODBYE;

exports.voiceAsk = async (req, res) => {
  const sse = openSSE(res);
  try {
    const audio = Buffer.isBuffer(req.body) ? req.body : null;
    const heard = audio && audio.length >= 4000
      ? await claudeAI.transcribeSpeech(audio, String(req.query.lang || "").slice(0, 2))
      : { text: "", lang: null };
    const question = heard.text;
    if (sse.closed) return res.end();
    if (!question) {
      sse.send("nohear", {});
      return res.end();
    }
    // lang: the language actually spoken -- the phone answers in its voice.
    sse.send("question", { text: question, lang: heard.lang });
    const bye = VOICE_GOODBYE.kind(question.trim());
    if (bye) {
      sse.send("bye", { kind: bye, lang: heard.lang });
      return res.end();
    }
    await answerOverSSE(req, res, sse, { question, conversationId: req.query.conversationId || null, voice: true });
  } catch (err) {
    pipelineStats.recordError("chat", `voice: ${err.message}`);
    if (!sse.closed) {
      sse.send("error", { message: "Couldn't understand the audio right now." });
      res.end();
    }
  }
};

// Read-aloud in the user's language (trading terms kept in English).
exports.translateForSpeech = async (req, res) => {
  try {
    const { text, lang } = req.body || {};
    if (!text || !["sw", "fr", "ar", "zh", "ko", "ja"].includes(lang)) return res.status(400).json({ message: "text and lang (sw|fr|ar|zh|ko|ja) required" });
    res.json({ text: await claudeAI.translateForSpeech(text, lang) });
  } catch (err) {
    console.error("Speech translation failed:", err.message);
    res.status(503).json({ message: "Couldn't translate right now — try again, or listen in English." });
  }
};

// Saved Ask AI conversations
exports.listConversations = async (req, res) => {
  try {
    const conversations = await ChatConversation.find({ user: req.user._id })
      .sort({ updatedAt: -1 })
      .limit(50)
      .select("title updatedAt");
    res.json(conversations);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getConversation = async (req, res) => {
  try {
    const conversation = await ChatConversation.findOne({ _id: req.params.id, user: req.user._id });
    if (!conversation) return res.status(404).json({ message: "Conversation not found" });
    res.json(conversation);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.deleteConversation = async (req, res) => {
  try {
    await ChatConversation.deleteOne({ _id: req.params.id, user: req.user._id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Hey TradeMind: WAV audio (body) -> text of the question. Body is raw
// audio/wav (express.raw on the route), ?lang=en|sw|fr|ar|zh|ko|ja.
exports.transcribeVoice = async (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length < 4000) return res.json({ text: "" });
  try {
    const { text, lang } = await claudeAI.transcribeSpeech(req.body, String(req.query.lang || "").slice(0, 2));
    res.json({ text, lang });
  } catch (err) {
    pipelineStats.recordError("chat", `transcribe: ${err.message}`);
    res.status(502).json({ message: "Couldn't understand the audio right now." });
  }
};
