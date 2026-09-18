const newsService = require("./newsService");
const BookConcept = require("../models/BookConcept");
const claudeAI = require("./claudeAI");

// Keeps the global market-wisdom pool from growing forever -- older,
// lower-signal extractions age out rather than accumulate indefinitely
// (and getBookConceptSummary only ever surfaces the newest few anyway).
const MAX_GLOBAL_ENTRIES = 20;

// Cheap pre-filter before spending an AI call. newsService.getTradingSkillNews
// already targets strategy/technique content with its own search query, but
// NewsAPI's full-text match is loose -- plenty of results are still just
// generic market commentary that happens to contain one matched word.
const SKILL_KEYWORDS = [
  "strategy", "technique", "price action", "smart money", "ict",
  "risk management", "trading psychology", "order block", "liquidity",
  "how to trade", "trading rules", "trading plan", "chart pattern",
];
function looksLikeSkillContent(article) {
  const text = `${article.title} ${article.description || ""}`.toLowerCase();
  return SKILL_KEYWORDS.some((kw) => text.includes(kw));
}

// Extracts genuine trading technique/strategy content out of recent news
// (as opposed to newsService's other use of news -- market-event
// sentiment) into the same BookConcept shape an uploaded book produces,
// so it surfaces through the exact same ragService.getBookConceptSummary
// path every signal/analysis prompt already reads. No dedicated throttle
// timestamp needed to call this often: getTradingSkillNews's own 1h cache
// already bounds the real cost (the NewsAPI call), and the keyword
// pre-filter + 5-article cap bound the AI-call cost per run regardless of
// how frequently this function itself is invoked.
exports.extractSkillKnowledgeFromNews = async () => {
  const articles = await newsService.getTradingSkillNews();
  const candidates = articles.filter(looksLikeSkillContent).slice(0, 5);

  let extracted = 0;
  for (const article of candidates) {
    // Dedup on title against past extractions -- cheap and good enough;
    // exact re-syndication of the same piece under a different URL is
    // rare for this kind of content.
    const exists = await BookConcept.findOne({ bookName: article.title, user: { $exists: false } });
    if (exists) continue;

    const content = `${article.title}\n\n${article.description || ""}\n\n${article.content || ""}`;
    let result;
    try {
      result = await claudeAI.analyzeDocument(
        content,
        "This is a news article, not a book -- only extract genuine trading technique/strategy/psychology content if it's actually present. Leave concepts/strategies/rules empty if this is really just market/event news with no real technique content."
      );
    } catch (err) {
      console.error(`Skill extraction failed for "${article.title}":`, err.message);
      continue;
    }

    // A macro/event article that only slipped past the keyword filter on a
    // loose match (e.g. "risk" appearing in an unrelated context) yields
    // nothing extractable -- skip rather than store an empty entry.
    const hasContent = result.concepts?.length || result.strategies?.length || result.rules?.length;
    if (!hasContent) continue;

    await BookConcept.create({
      bookName: article.title,
      concepts: result.concepts,
      strategies: result.strategies,
      rules: result.rules,
      rawSummary: result.rawSummary,
      // user left unset -- global entry, see BookConcept.js
    });
    extracted++;
  }

  const globalCount = await BookConcept.countDocuments({ user: { $exists: false } });
  if (globalCount > MAX_GLOBAL_ENTRIES) {
    const excess = await BookConcept.find({ user: { $exists: false } })
      .sort({ createdAt: 1 })
      .limit(globalCount - MAX_GLOBAL_ENTRIES)
      .select("_id");
    await BookConcept.deleteMany({ _id: { $in: excess.map((e) => e._id) } });
  }

  if (extracted > 0 || candidates.length > 0) {
    console.log(`News skill-knowledge extraction: ${extracted} new entries from ${candidates.length} candidate article(s).`);
  }
  return extracted;
};
