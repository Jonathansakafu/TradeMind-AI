const router = require("express").Router();
const {
  getNotifications,
  getTaken,
  setTaken,
  markAsRead,
  markAllAsRead,
  deleteNotification,
} = require("../controllers/notificationController");
const { protect } = require("../middleware/authMiddleware");

router.use(protect);
router.get("/", getNotifications);
router.get("/taken", getTaken);
router.put("/:id/taken", setTaken);
router.put("/:id/read", markAsRead);
router.put("/read-all", markAllAsRead);
router.delete("/:id", deleteNotification);

module.exports = router;