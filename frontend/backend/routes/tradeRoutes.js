const router = require("express").Router();
const {
  getTrades, getTrade, createTrade,
  updateTrade, deleteTrade, getStats
} = require("../controllers/tradeController");
const { protect } = require("../middleware/authMiddleware");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

// Was multer.diskStorage writing to a local "uploads/" folder -- ephemeral
// on Render's free tier (wiped on every restart/deploy, which this app
// does constantly via auto-deploy), so nearly every trade's screenshot was
// silently gone from disk long before anyone went looking for it. Cloudinary
// gives every screenshot a real, persistent URL. file.path/file.filename
// (what tradeController already reads into screenshot.url/publicId) map
// straight to Cloudinary's secure URL and public_id -- no controller
// changes needed.
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "trademind/trade-screenshots",
    resource_type: "image",
  },
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

router.use(protect);
router.get("/stats", getStats);
// Equity curve of today / the last 7 days with its peak and low (services/equityCurve.js).
router.get("/equity", async (req, res) => {
  try {
    const period = req.query.period === "7d" ? "7d" : "today";
    res.set("Cache-Control", "no-store");
    res.json(await require("../services/equityCurve").build(req.user._id, period));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
router.get("/", getTrades);
router.post("/", upload.single("screenshot"), createTrade);
router.get("/:id", getTrade);
router.put("/:id", upload.single("screenshot"), updateTrade);
router.delete("/:id", deleteTrade);

module.exports = router;