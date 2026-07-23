const router = require("express").Router();
const {
  analyzeTrade, detectPatterns, getTradeSuggestion,
  analyzeDocument, analyzeScreenshot, getBooks, deleteBook, askQuestion,
} = require("../controllers/aiController");
const { protect } = require("../middleware/authMiddleware");
const multer = require("multer");

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error("File type not allowed"));
  },
});

router.use(protect);
router.post("/analyze/:tradeId", analyzeTrade);
router.post("/patterns", detectPatterns);
router.post("/suggest", getTradeSuggestion);
router.post("/document", upload.single("document"), analyzeDocument);
router.post("/screenshot", upload.single("screenshot"), analyzeScreenshot);
router.get("/books", getBooks);
router.delete("/books/:id", deleteBook);
router.post("/ask", askQuestion);

module.exports = router;