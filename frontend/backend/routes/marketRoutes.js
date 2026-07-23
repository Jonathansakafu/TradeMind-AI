const router = require("express").Router();
const {
  getLivePrices, analyzePair,
  getNews, analyzeNews,
} = require("../controllers/marketController");
const { protect } = require("../middleware/authMiddleware");

router.use(protect);
router.get("/prices", getLivePrices);
router.get("/analyze/:pair", analyzePair);
router.get("/news", getNews);
router.post("/analyze-news", analyzeNews);

module.exports = router;