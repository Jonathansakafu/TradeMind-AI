const router = require("express").Router();
const { getWebhookInfo, regenerateToken, webhook } = require("../controllers/tradingviewController");
const { protect } = require("../middleware/authMiddleware");

router.get("/info", protect, getWebhookInfo);
router.post("/regenerate", protect, regenerateToken);
// Public -- see tradingviewController.webhook for why (TradingView alerts
// carry no auth header; the user's own token in the alert body identifies them).
router.post("/webhook", webhook);

module.exports = router;
