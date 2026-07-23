require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const connectDB = require("./config/db");

const app = express();

connectDB();

const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim());

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error("Not allowed by CORS"));
  },
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/trades", require("./routes/tradeRoutes"));
app.use("/api/ai", require("./routes/aiRoutes"));
app.use("/api/market", require("./routes/marketRoutes"));
app.use("/api/notifications", require("./routes/notificationRoutes"));
app.use("/api/mt5", require("./routes/mt5Routes"));
app.use("/api/mt5", require("./routes/mt5PublicRoutes"));

app.get("/api/health", (req, res) =>
  res.json({ status: "ok", app: "TradeMind AI" })
);

const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);

  // Subiri MongoDB iwe tayari kwanza
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const { ensureVectorIndex } = require("./scripts/createVectorIndex");
  ensureVectorIndex().catch((err) => console.warn("Vector index setup skipped:", err.message));

  const ragService = require("./services/ragService");
  const { getFullGuideText } = require("./data/userGuide");
  const GUIDE_ID = "000000000000000000000001";
  ragService.indexGuideChunks(GUIDE_ID, getFullGuideText())
    .then((count) => console.log(`📘 User guide indexed (${count} chunks)`))
    .catch((err) => console.warn("Guide indexing skipped:", err.message));

  const User = require("./models/User");
  const { autoGenerate } = require("./controllers/notificationController");

  const runAutoGenerate = async () => {
    try {
      const users = await User.find({}).select("_id");
      if (users.length === 0) {
        console.log("No users found — skipping auto-generate");
        return;
      }
      console.log(`🔔 Auto-generating for ${users.length} user(s)...`);
      for (const user of users) {
        await autoGenerate(user._id);
        // Pumzika sekunde 5 kati ya users
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      console.log("✅ Auto-generate complete");
    } catch (err) {
      console.error("Auto-generate error:", err.message);
    }
  };

  // Anza mara moja baada ya sekunde 30
  setTimeout(runAutoGenerate, 30 * 1000);

  // Kisha kila masaa 2
  setInterval(runAutoGenerate, 2 * 60 * 60 * 1000);
});