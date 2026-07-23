const router = require("express").Router();
const { 
  getTrades, getTrade, createTrade, 
  updateTrade, deleteTrade, getStats 
} = require("../controllers/tradeController");
const { protect } = require("../middleware/authMiddleware");
const multer = require("multer");

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

router.use(protect);
router.get("/stats", getStats);
router.get("/", getTrades);
router.post("/", upload.single("screenshot"), createTrade);
router.get("/:id", getTrade);
router.put("/:id", updateTrade);
router.delete("/:id", deleteTrade);

module.exports = router;