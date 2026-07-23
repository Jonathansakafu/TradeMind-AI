const router = require("express").Router();
const MT5Signal = require("../models/MT5Signal");

// MT5 EA inapata signals zinazongoja — bila JWT auth
router.get("/pending", async (req, res) => {
  try {
    const { userId } = req.query;
    const filter = {
      status: "sent",
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    };
    if (userId) filter.user = userId;

    const signals = await MT5Signal.find(filter)
      .sort({ createdAt: -1 })
      .limit(10);

    res.json(signals);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// MT5 EA inarudisha status baada ya kuexecute
router.post("/executed", async (req, res) => {
  try {
    const { signalId, token, status, mt5Response } = req.body;

    const signal = await MT5Signal.findById(signalId);
    if (!signal) return res.status(404).json({ message: "Signal not found" });
    if (signal.token !== token) return res.status(401).json({ message: "Invalid token" });

    await MT5Signal.findByIdAndUpdate(signalId, {
      status: status || "executed",
      mt5Response,
      executedAt: new Date(),
    });

    res.json({ success: true, message: "Signal status updated" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;