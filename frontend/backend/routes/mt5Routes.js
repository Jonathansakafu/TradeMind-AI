const router = require("express").Router();
const {
  sendSignal,
  getSignals,
  updateSignalStatus,
  getStats,
} = require("../controllers/mt5Controller");
const { protect } = require("../middleware/authMiddleware");

// protect is applied per-route (not via router.use(protect)) because this
// router shares the /api/mt5 base path with mt5PublicRoutes.js — a
// router-wide router.use(protect) would run for every request to that
// prefix before Express even checks which route matches, rejecting
// requests meant for the public /pending and /executed routes (mounted
// second) before they ever reach that router at all.
router.post("/signal", protect, sendSignal);
router.get("/signals", protect, getSignals);
router.put("/signal/:id/status", protect, updateSignalStatus);
router.get("/stats", protect, getStats);

module.exports = router;