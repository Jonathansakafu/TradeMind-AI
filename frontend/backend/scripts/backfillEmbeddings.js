require("dotenv").config();
const mongoose = require("mongoose");
const Trade = require("../models/Trade");
const BookConcept = require("../models/BookConcept");
const ragService = require("../services/ragService");

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const trades = await Trade.find({});
  console.log(`Indexing ${trades.length} existing trade(s)...`);
  for (const trade of trades) {
    await ragService.indexTrade(trade.user, trade);
  }

  const books = await BookConcept.find({});
  console.log(`Indexing ${books.length} existing book(s) — raw PDF text wasn't retained pre-RAG, so this indexes the saved concepts/strategies/rules/summary instead...`);
  for (const book of books) {
    const text = [
      `Book: ${book.bookName}`,
      book.concepts?.length ? `Concepts: ${book.concepts.join(", ")}` : "",
      book.strategies?.length ? `Strategies: ${book.strategies.join(", ")}` : "",
      book.rules?.length ? `Rules: ${book.rules.join(", ")}` : "",
      book.rawSummary || "",
    ].filter(Boolean).join("\n");
    await ragService.indexBookChunks(book.user, book._id, book.bookName, text);
  }

  console.log("Backfill complete");
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
