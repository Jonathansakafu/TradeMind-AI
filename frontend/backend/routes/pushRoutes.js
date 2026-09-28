const router = require("express").Router();
const {
  getVapidKey,
  getStatus,
  updatePrefs,
  subscribeBrowser,
  unsubscribeBrowser,
  registerFcmToken,
  unregisterFcmToken,
  sendTest,
} = require("../controllers/pushController");
const { protect } = require("../middleware/authMiddleware");

// Public -- the browser needs it before it can create a subscription.
router.get("/vapid-public-key", getVapidKey);

router.use(protect);
router.get("/status", getStatus);
router.put("/prefs", updatePrefs);
router.post("/subscribe", subscribeBrowser);
router.post("/unsubscribe", unsubscribeBrowser);
router.post("/fcm-token", registerFcmToken);
router.post("/fcm-token/remove", unregisterFcmToken);
router.post("/test", sendTest);

module.exports = router;
