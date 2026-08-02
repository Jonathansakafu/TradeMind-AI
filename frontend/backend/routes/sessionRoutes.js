const router = require("express").Router();
const {
  startSession,
  getActiveSession,
  getSessions,
  stopSession,
} = require("../controllers/sessionController");
const { protect } = require("../middleware/authMiddleware");

router.use(protect);

router.post("/", startSession);
router.get("/active", getActiveSession);
router.get("/", getSessions);
router.put("/:id/stop", stopSession);

module.exports = router;
