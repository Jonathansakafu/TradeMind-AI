const router = require("express").Router();
const { runAutoGenerateForAllUsers, isAutoGenerateRunning } = require("../services/cronJobs");

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
  const alreadyRunning = isAutoGenerateRunning();
  if (!alreadyRunning) {
    runAutoGenerateForAllUsers().catch((err) =>
      console.error("Cron-triggered auto-generate failed:", err.message)
    );
  }
  res.status(202).json({ success: true, started: !alreadyRunning, alreadyRunning });
});

module.exports = router;
