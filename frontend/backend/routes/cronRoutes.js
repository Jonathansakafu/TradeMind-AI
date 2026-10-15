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
      // How signals played out over the last 48 h (auto-scored against real
      // prices; no money figures -- this report is public in Actions logs).
      signalResults48h: await (async () => {
        const rows = await Notification.aggregate([
          { $match: { createdAt: { $gte: new Date(now - 48 * 3600e3) }, signal: { $in: ["buy", "sell"] }, type: { $ne: "quick_trade" } } },
          { $group: {
            _id: { pair: "$pair", signal: "$signal", day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "+03:00" } } },
            sent: { $sum: 1 },
            tp: { $sum: { $cond: [{ $eq: ["$simOutcome", "win"] }, 1, 0] } },
            sl: { $sum: { $cond: [{ $eq: ["$simOutcome", "loss"] }, 1, 0] } },
            expired: { $sum: { $cond: [{ $eq: ["$simOutcome", "expired"] }, 1, 0] } },
            r: { $sum: { $ifNull: ["$simR", 0] } },
            avgConf: { $avg: "$confidence" },
          } },
          { $sort: { "_id.day": 1, "_id.pair": 1 } },
        ]);
        const hours = await Notification.aggregate([
          { $match: { createdAt: { $gte: new Date(now - 48 * 3600e3) }, simOutcome: "loss", type: { $ne: "quick_trade" } } },
          { $group: { _id: { $dateToString: { format: "%m-%d %H:00", date: "$createdAt", timezone: "+03:00" } }, n: { $sum: 1 }, pairs: { $addToSet: { $concat: ["$pair", " ", "$signal"] } } } },
          { $sort: { _id: 1 } },
        ]);
        return {
          byDayPairSide: rows.map((r) => `${r._id.day} ${r._id.pair} ${r._id.signal}: sent ${r.sent}, TP ${r.tp}, SL ${r.sl}, expired ${r.expired}, ${r.r >= 0 ? "+" : ""}${r.r.toFixed(1)}R, avg conf ${Math.round(r.avgConf || 0)}%`),
          stopLossesByHourEAT: hours.map((h) => `${h._id}: ${h.n} (${h.pairs.join(", ")})`),
        };
      })().catch((err) => ({ error: err.message })),
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
    // ?includeKept=1 (dry run only): also list the ones kept as uploads.
    const includeKept = req.query.includeKept === "1";
    const candidates = await Trade.find({ entryPrice: { $gt: 0 }, ...(includeKept ? {} : { screenshotIsUpload: { $ne: true } }), "screenshot.publicId": { $not: /\/chart-[0-9a-f]{24}$/ } })
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
          // Cloudinary often kept no file name, so also by picture size: the
          // app's old snapshots are PNGs 600-1000 px wide and under 1000 px
          // tall (960x769, 937x767, 634x549...); phone screenshots are wider
          // (iPhone 1179) and MT5 captures are JPG or larger.
          const appSized = info.format === "png" && info.width >= 600 && info.width <= 1000 && info.height < 1000;
          generated = GENERATED.test(info.original_filename) || appSized;
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
        await Trade.updateOne({ _id: t._id }, { screenshot: { url: pic.url, publicId: pic.publicId }, screenshotIsUpload: false });
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

// One-off (2026-10-15): re-score recent signals with the entry-fill rule
// (signalOutcomes.resolve) and correct what depended on the old result:
// trades the system closed automatically from a signal (closedBy: signal)
// get the corrected exit / P/L, or -- when the entry was never reached --
// are reopened (removed if the system itself recorded them from a taken
// signal); post-mortems and result charts are redone. Trades closed by the
// trader are not touched. ?days=10 ?limit=800 ?dry=1; call until remaining = 0.
router.get("/rescore-signals", async (req, res) => {
  const configuredSecret = process.env.CRON_SECRET;
  if (!configuredSecret || req.query.secret !== configuredSecret) {
    return res.status(401).json({ message: "Invalid cron secret" });
  }
  try {
    const Notification = require("../models/Notification");
    const Trade = require("../models/Trade");
    const marketService = require("../services/marketService");
    const { resolve } = require("../services/signalOutcomes");
    const { calculatePL } = require("../utils/tradePL");
    const ongoing = require("../services/ongoingTrades");
    const days = Math.min(30, Number(req.query.days) || 10);
    const limit = Math.min(3000, Number(req.query.limit) || 800);
    const dry = req.query.dry === "1";
    const query = {
      simOutcome: { $exists: true }, simRescored: { $ne: true }, type: { $ne: "quick_trade" },
      signal: { $in: ["buy", "sell"] }, entry: { $gt: 0 }, createdAt: { $gte: new Date(Date.now() - days * 864e5) },
      // Gold history comes from futures shifted by today's futures-spot gap
      // (and the contract rolls), so old gold days can't be re-scored exactly.
      pair: { $ne: "XAUUSD" },
    };
    const total = await Notification.countDocuments(query);
    const list = await Notification.find(query).sort({ createdAt: 1 }).limit(dry ? 5000 : limit).lean();
    const candlesBy = {};
    const out = { checked: 0, changed: 0, transitions: {}, tradesCorrected: 0, tradesRemoved: 0, tradesToReview: 0, review: [], examples: [] };
    const k = (n, r) => `${n.simOutcome}→${r.simOutcome}`;
    for (const n of list) {
      if (!candlesBy[n.pair]) candlesBy[n.pair] = await marketService.getYahooCandles(n.pair, { interval: "5m", range: "1mo" }).catch(() => []);
      const r = resolve(n, candlesBy[n.pair], Date.now());
      out.checked++;
      if (!r) continue;
      const same = r.simOutcome === n.simOutcome && Math.abs((r.simR || 0) - (n.simR || 0)) < 0.01;
      if (!same) {
        out.changed++;
        const kind = k(n, r);
        out.transitions[kind] = (out.transitions[kind] || 0) + 1;
        const sameKind = out.examples.filter((e) => e.endsWith(kind)).length;
        if (sameKind < 3) out.examples.push(`${n.pair} ${n.signal.toUpperCase()} ${n.entry} SL ${n.stopLoss} TP ${n.takeProfit} @${new Date(n.createdAt).toISOString().slice(5, 16)} filled ${r.filledAt ? new Date(r.filledAt).toISOString().slice(5, 16) : "-"} ended ${new Date(r.at).toISOString().slice(5, 16)}: ${kind}`);
      }
      const trades = same ? [] : await Trade.find({ notificationId: n._id, closedBy: "signal" });
      for (const t of trades) {
        // Trades the trader recorded themselves may have been entered at
        // market price -- never rewritten automatically, only listed.
        if (t.batchId !== "auto-taken") {
          out.tradesToReview++;
          if (out.review.length < 20) out.review.push(`${t.pair} ${t.direction} ${t.entryPrice} (signal ${n.createdAt.toISOString().slice(5, 16)}): ${k(n, r)}`);
          continue;
        }
        if (r.simOutcome === "unfilled") {
          out.tradesRemoved++;
          if (dry) continue;
          await Trade.deleteOne({ _id: t._id });
          await Notification.updateOne({ _id: n._id }, { $unset: { tradeId: 1 } });
          continue;
        }
        const risk = Math.abs(n.entry - n.stopLoss);
        const exit = r.simOutcome === "win" ? n.takeProfit : r.simOutcome === "loss" ? n.stopLoss
          : n.entry + (n.signal === "buy" ? 1 : -1) * r.simR * risk; // expired: the price after 24 h
        out.tradesCorrected++;
        if (dry) continue;
        const pl = calculatePL(t.pair, t.direction, t.entryPrice, exit, t.lotSize || 0.01);
        await Trade.updateOne({ _id: t._id }, { exitPrice: exit, profitLoss: pl?.pl ?? 0, outcome: pl?.outcome, closedAt: new Date(r.at) });
        await ongoing.attachResultChart(t._id);
      }
      if (dry) continue;
      const set = { simOutcome: r.simOutcome, simR: r.simR, simResolvedAt: new Date(r.at), simFilledAt: r.filledAt ? new Date(r.filledAt) : null, simRescored: true };
      await Notification.updateOne({ _id: n._id }, same ? { $set: { simRescored: true, simFilledAt: set.simFilledAt } } : { $set: set, $unset: { research: 1, resultChartImage: 1 } });
    }
    res.json({ ...out, remaining: dry ? total : Math.max(0, total - list.length), dry });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
