const router = require("express").Router();
const { runAutoGenerateForAllUsers } = require("../services/cronJobs");

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

  try {
    const result = await runAutoGenerateForAllUsers();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
