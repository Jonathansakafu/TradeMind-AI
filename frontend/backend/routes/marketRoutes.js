const router = require("express").Router();
const {
  getLivePrices, getLiveQuotes, analyzePair,
  getNews, analyzeNews, getCalendar, checkNewsImpact,
} = require("../controllers/marketController");
const { protect } = require("../middleware/authMiddleware");

router.use(protect);
router.get("/prices", getLivePrices);
router.get("/live", getLiveQuotes);
// Signal / trade chart with its technical drawings (services/chartAnnotations.js).
router.get("/chart", async (req, res) => {
  try {
    const data = await require("../services/chartAnnotations").build(req.user._id, {
      notificationId: req.query.notificationId, tradeId: req.query.tradeId, tf: req.query.tf, query: req.query,
    });
    if (data.error) return res.status(404).json({ message: data.error });
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.get("/analyze/:pair", analyzePair);
router.get("/news", getNews);
router.post("/analyze-news", analyzeNews);
router.get("/calendar", getCalendar);
router.get("/news-impact", checkNewsImpact);

module.exports = router;