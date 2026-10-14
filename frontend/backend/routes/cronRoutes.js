const router = require("express").Router();
const { runAutoGenerateForAllUsers, isAutoGenerateRunning } = require("../services/cronJobs");
const pipelineStats = require("../services/pipelineStats");

// Triggered by an external scheduler (.github/workflows/cron-generate.yml),
// not a logged-in user -- there's no JWT to check here, so a shared secret
// is the only thing stopping anyone on the internet from spamming this and
// burning through the AI/market-data API quotas for every user. No secret
// configured is treated as "not set up yet", not "open to everyone".
router.get("/generate", async (req, res) => {
  const configuredSecret = process.env.CRON_SECRET;
  if (!configuredSecret) {
    return res.status(503).json({ message: "CRON_SECRET is not configured on this server" });
  }
  if (req.query.secret !== configuredSecret) {
    return res.status(401).json({ message: "Invalid cron secret" });
  }

  // Responds immediately and runs the cycle in the background: a full
  // cycle takes minutes, and free external schedulers (e.g. cron-job.org)
  // time out after ~30s. The process keeps running after the response, and
  // this request itself is what woke Render's free instance up -- it then
  // stays awake ~15 minutes, far longer than one cycle.
  pipelineStats.inc("trigger.cron");
  const alreadyRunning = isAutoGenerateRunning();
  if (!alreadyRunning) {
    runAutoGenerateForAllUsers().catch((err) =>
      console.error("Cron-triggered auto-generate failed:", err.message)
    );
  }
  res.status(202).json({ success: true, started: !alreadyRunning, alreadyRunning });
});

// Aggregate-only health report for the signal/notification pipeline --
// no emails/ids/signal content, since the GitHub Actions workflow that
// calls it (pipeline-health.yml) prints it to logs that are public on this
// repo. Same shared secret as /generate. ?probe=1 also makes one tiny
// Groq call to check whether the daily quota is exhausted.
router.get("/health", async (req, res) => {
  const configuredSecret = process.env.CRON_SECRET;
  if (!configuredSecret || req.query.secret !== configuredSecret) {
    return res.status(401).json({ message: "Invalid cron secret" });
  }
  try {
    const Notification = require("../models/Notification");
    const User = require("../models/User");
    const TradingSession = require("../models/TradingSession");
    const marketService = require("../services/marketService");

    const now = Date.now();
    const since = (ms) => ({ createdAt: { $gte: new Date(now - ms) } });
    const H = 60 * 60 * 1000;
    const [last1h, last6h, last24h, last7d, latest, bySource24h, byDay, users, activeSessions, pushUsers] = await Promise.all([
      Notification.countDocuments(since(H)),
      Notification.countDocuments(since(6 * H)),
      Notification.countDocuments(since(24 * H)),
      Notification.countDocuments(since(7 * 24 * H)),
      Notification.findOne({}).sort({ createdAt: -1 }).select("createdAt source type"),
      Notification.aggregate([{ $match: since(24 * H) }, { $group: { _id: "$source", n: { $sum: 1 } } }]),
      Notification.aggregate([
        { $match: since(7 * 24 * H) },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, n: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      User.countDocuments({}),
      TradingSession.aggregate([{ $match: { status: "active" } }, { $group: { _id: "$mode", n: { $sum: 1 } } }]),
      User.countDocuments({ $or: [{ "pushSubscriptions.0": { $exists: true } }, { "fcmTokens.0": { $exists: true } }] }),
    ]);

    // Per pair and direction over 7 days -- answers "why no EURUSD" /
    // "why mostly SELL on gold" with data rather than guesses.
    const byPair = await Notification.aggregate([
      { $match: since(7 * 24 * H) },
      { $group: { _id: { pair: "$pair", signal: "$signal" }, n: { $sum: 1 }, last: { $max: "$createdAt" } } },
    ]);
    const pairs7d = {};
    for (const r of byPair) {
      const p = (pairs7d[r._id.pair] ||= { buy: 0, sell: 0, last: null });
      p[r._id.signal] = r.n;
      if (!p.last || r.last > p.last) p.last = r.last;
    }

    // Email alerts: who has them on, at what confidence floor, and how
    // today's signals' confidence compares -- a "test works but real
    // alerts never arrive" report is usually signals sitting below the floor.
    const [emailPrefs, confidence24h] = await Promise.all([
      User.aggregate([
        { $match: { "notificationPrefs.email": true } },
        { $group: { _id: { $ifNull: ["$notificationPrefs.emailMinConfidence", 70] }, users: { $sum: 1 }, sentToday: { $sum: "$emailSentCount" } } },
      ]),
      Notification.aggregate([
        { $match: since(24 * H) },
        { $bucket: { groupBy: { $ifNull: ["$confidence", 0] }, boundaries: [0, 50, 60, 70, 80, 90, 101], default: "other", output: { n: { $sum: 1 } } } },
      ]),
    ]);

    let pricesAvailable = null;
    try {
      pricesAvailable = Object.keys(await marketService.getAllPrices()).sort();
    } catch (err) {
      pricesAvailable = `error: ${err.message}`;
    }

    res.json({
      now: new Date(),
      running: isAutoGenerateRunning(),
      notifications: {
        last1h, last6h, last24h, last7d,
        latest: latest && { at: latest.createdAt, source: latest.source, type: latest.type },
        bySource24h: Object.fromEntries(bySource24h.map((r) => [r._id, r.n])),
        perDay7d: Object.fromEntries(byDay.map((r) => [r._id, r.n])),
        pairs7d,
      },
      users,
      usersWithPushDevices: pushUsers,
      // Should both be 0 a cycle after a signal hits TP / SL (services/ongoingTrades.js).
      tradesFollowingSignals: await (async () => {
        const Trade = require("../models/Trade");
        const open = await Trade.find({ status: "open", notificationId: { $exists: true, $ne: null } }).select("notificationId locked").populate("notificationId", "simOutcome").lean();
        const takenNotRecorded = await Notification.countDocuments({ taken: true, $or: [{ tradeId: { $exists: false } }, { tradeId: null }], simOutcome: { $in: ["win", "loss"] }, createdAt: { $gte: new Date(now - 7 * 864e5) } });
        return {
          open: open.length,
          openWithSignalAtTpSl: open.filter((t) => ["win", "loss"].includes(t.notificationId?.simOutcome)).length,
          takenNotRecorded,
        };
      })().catch((err) => ({ error: err.message })),
      emailAlerts: {
        byMinConfidence: Object.fromEntries(emailPrefs.map((r) => [`${r._id}%+`, { users: r.users, emailsCountedToday: r.sentToday }])),
        signalConfidence24h: Object.fromEntries(confidence24h.map((r) => [r._id === "other" ? "other" : `${r._id}+`, r.n])),
      },
      aiBudget: require("../services/claudeAI").getBackgroundBudget(),
      gemini: require("../services/geminiText").status(),
      gold: marketService.getGoldStatus(),
      activeSessions: Object.fromEntries(activeSessions.map((r) => [r._id, r.n])),
      pricesAvailable,
      config: {
        groqKey: !!process.env.GROQ_API_KEY,
        cloudinary: !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET),
        resendKey: !!process.env.RESEND_API_KEY,
        firebase: !!process.env.FIREBASE_SERVICE_ACCOUNT,
      },
      sinceBoot: pipelineStats.snapshot(),
      groq: req.query.probe ? await require("../services/claudeAI").probeGroq() : undefined,
      geminiProbe: req.query.probe ? await require("../services/geminiText").probe() : undefined,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// One-off (2026-10-14): replace old auto-generated trade screenshots with
// the new signal chart picture. Only pictures the app made itself
// (Cloudinary original_filename "trade-snapshot-..." or "trade-PAIR-...")
// and trades with no screenshot; uploads and screen captures are never
// touched. The old picture is deleted once replaced (no duplicates).
// ?limit=25 per call (call again until remaining = 0), ?dry=1 to only count.
router.get("/rechart-trades", async (req, res) => {
  const configuredSecret = process.env.CRON_SECRET;
  if (!configuredSecret || req.query.secret !== configuredSecret) {
    return res.status(401).json({ message: "Invalid cron secret" });
  }
  try {
    const Trade = require("../models/Trade");
    const cloudinary = require("../config/cloudinary");
    const signalImage = require("../services/signalImage");
    const GENERATED = /^(trade-snapshot-\d+|trade-[A-Z]{6}-[0-9a-f]{24})$/;
    const limit = Math.min(60, Number(req.query.limit) || 25);
    const dry = req.query.dry === "1";
    // Skip trades already done (their picture is "chart-<id>").
    const candidates = await Trade.find({ entryPrice: { $gt: 0 }, screenshotIsUpload: { $ne: true }, "screenshot.publicId": { $not: /\/chart-[0-9a-f]{24}$/ } })
      .select("user pair entryPrice screenshot").sort({ createdAt: -1 }).lean();
    const out = { checked: 0, replaced: 0, filled: 0, keptUserUploads: 0, failed: 0, details: [] };
    let todo = 0;
    for (const t of candidates) {
      if (!dry && out.replaced + out.filled + out.failed >= limit) { todo++; continue; }
      out.checked++;
      let generated = !t.screenshot?.url;
      let original = t.screenshot?.url ? "?" : "(none)";
      if (!generated && t.screenshot?.publicId) {
        try {
          const info = await cloudinary.api.resource(t.screenshot.publicId);
          original = `${info.original_filename || "-"} ${info.format} ${info.width}x${info.height} ${String(info.created_at || "").slice(0, 10)}`;
          info.original_filename = String(info.original_filename || "");
          generated = GENERATED.test(info.original_filename);
        } catch (err) {
          generated = err?.error?.http_code === 404; // old picture already gone
        }
      }
      if (dry) out.details.push(`${generated ? "REPLACE" : "keep"} ${t.pair} ${original}`);
      if (!generated) {
        out.keptUserUploads++;
        if (!dry) await Trade.updateOne({ _id: t._id }, { screenshotIsUpload: true }); // don't check it again
        continue;
      }
      if (dry) { todo++; continue; }
      try {
        const pic = await signalImage.forTrade(t);
        if (!pic) throw new Error("no chart data");
        await Trade.updateOne({ _id: t._id }, { screenshot: { url: pic.url, publicId: pic.publicId } });
        if (t.screenshot?.publicId) await cloudinary.uploader.destroy(t.screenshot.publicId).catch(() => {});
        if (t.screenshot?.url) out.replaced++; else out.filled++;
        out.details.push(`${t.pair} ${t._id}`);
      } catch (err) {
        out.failed++;
        out.details.push(`FAILED ${t.pair} ${t._id}: ${err.message}`);
      }
    }
    res.json({ ...out, remaining: todo, dry });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
