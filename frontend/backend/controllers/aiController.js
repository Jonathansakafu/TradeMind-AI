const Trade = require("../models/Trade");
const Analysis = require("../models/Analysis");
const BookConcept = require("../models/BookConcept");
const claudeAI = require("../services/claudeAI");
const ragService = require("../services/ragService");
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
    const retrievedChunks = await ragService.retrieve(req.user._id, query, { topK: 6 });

    const result = await claudeAI.analyzeTrade(trade, history, retrievedChunks);

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
    const retrievedChunks = await ragService.retrieve(req.user._id, query, { topK: 8 });

    const result = await claudeAI.detectPatterns(trades, retrievedChunks);

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
    const retrievedChunks = await ragService.retrieve(req.user._id, query, { topK: 6 });
    const result = await claudeAI.getTradeSuggestion(
      proposedTrade, history, retrievedChunks
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
      try {
        const pdfParse = require("pdf-parse");
        const dataBuffer = fs.readFileSync(req.file.path);
        const pdfData = await pdfParse(dataBuffer);
        content = pdfData.text;
        fileName = req.file.originalname.replace(".pdf", "").replace(".txt", "");
        fs.unlinkSync(req.file.path);
      } catch {
        if (req.file.path && fs.existsSync(req.file.path)) {
          const rawText = fs.readFileSync(req.file.path, "utf8");
          content = rawText;
          fileName = req.file.originalname;
          fs.unlinkSync(req.file.path);
        } else {
          return res.status(400).json({ message: "Could not read file" });
        }
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

    // Save to database
    const bookConcept = await BookConcept.create({
      user: req.user._id,
      bookName: extracted.bookName || fileName,
      concepts: extracted.concepts || [],
      strategies: extracted.strategies || [],
      rules: extracted.rules || [],
      rawSummary: extracted.rawSummary || "",
    });

    const chunkCount = await ragService.indexBookChunks(
      req.user._id, bookConcept._id, bookConcept.bookName, content
    );

    res.json({
      analysis: extracted.rawSummary,
      bookConcept,
      chunksIndexed: chunkCount,
      message: `"${bookConcept.bookName}" saved — ${chunkCount} passages indexed for retrieval and will be used in all future AI analysis!`,
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
    const base64Image = imageBuffer.toString("base64");
    const mimeType = req.file.mimetype;
    fs.unlinkSync(req.file.path);

    const retrievedChunks = await ragService.retrieve(req.user._id, "chart pattern analysis", { topK: 6, sources: ["book"] });
    const result = await claudeAI.analyzeScreenshot(
      base64Image, mimeType, retrievedChunks
    );
    res.json({ analysis: result });
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

    const retrievedChunks = await ragService.retrieve(req.user._id, question, {
      topK: 8,
      sources: ["book", "trade", "guide"],
    });
    const result = await claudeAI.answerQuestion(question, retrievedChunks);

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};