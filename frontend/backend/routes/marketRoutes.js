const router = require("express").Router();
const {
  getLivePrices, analyzePair,
  getNews, analyzeNews, getCalendar, checkNewsImpact,
} = require("../controllers/marketController");
const { protect } = require("../middleware/authMiddleware");

router.use(protect);
router.get("/prices", getLivePrices);
router.get("/analyze/:pair", analyzePair);
router.get("/news", getNews);
router.post("/analyze-news", analyzeNews);
router.get("/calendar", getCalendar);
router.get("/news-impact", checkNewsImpact);

module.exports = router;