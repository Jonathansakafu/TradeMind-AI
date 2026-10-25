const router = require("express").Router();
const {
  getNotifications,
  getTaken,
  getSignalStats,
  getBrief,
  setTaken,
  markAsRead,
  markAllAsRead,
  deleteNotification,
} = require("../controllers/notificationController");
const { protect } = require("../middleware/authMiddleware");

router.use(protect);
router.get("/", getNotifications);
router.get("/taken", getTaken);
router.get("/signal-stats", getSignalStats);
router.get("/brief", getBrief);
// What the post-mortems learned (services/tradeResearch.js).
router.get("/lessons", async (req, res) => {
  try {
    const research = require("../services/tradeResearch");
    const pairs = ["XAUUSD", "EURUSD", "GBPUSD"];
    const byPair = Object.fromEntries(await Promise.all(pairs.map(async (p) => [p, await research.lessonsFor({ user: req.user._id }, p)])));
    res.json({ byPair, summary: await research.summaryLessons() });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.put("/:id/taken", setTaken);
router.put("/:id/read", markAsRead);
router.put("/read-all", markAllAsRead);
router.delete("/:id", deleteNotification);

module.exports = router;