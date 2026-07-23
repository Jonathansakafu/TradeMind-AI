const router = require("express").Router();
const {
  sendSignal,
  getSignals,
  updateSignalStatus,
  getStats,
} = require("../controllers/mt5Controller");
const { protect } = require("../middleware/authMiddleware");

router.use(protect);
router.post("/signal", sendSignal);
router.get("/signals", getSignals);
router.put("/signal/:id/status", updateSignalStatus);
router.get("/stats", getStats);

module.exports = router;