const crypto = require("crypto");
const User = require("../models/User");
const Notification = require("../models/Notification");

// Returns (generating on first request rather than at signup, so
// existing accounts don't need a migration) this user's webhook token +
// URL, for the TradingView setup page to display.
exports.getWebhookInfo = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("+tradingViewToken");
    if (!user.tradingViewToken) {
      user.tradingViewToken = crypto.randomBytes(24).toString("hex");
      await user.save();
    }
    res.json({
      token: user.tradingViewToken,
      webhookUrl: `${process.env.APP_BASE_URL || req.protocol + "://" + req.get("host")}/api/tradingview/webhook`,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Invalidates the old token (e.g. if it leaked) -- the user then has to
// update the alert(s) they already set up on TradingView with the new one.
exports.regenerateToken = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    user.tradingViewToken = crypto.randomBytes(24).toString("hex");
    await user.save();
    res.json({ token: user.tradingViewToken });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Public -- a TradingView alert POST carries no auth header of its own,
// so the user's per-account token (embedded in their alert's own JSON
// message body, set up on the TradingView page) is what identifies them
// here instead of a JWT.
//
// Deliberately does NOT auto-forward to MT5 the way an AI-generated,
// self-verified signal can (see notificationController.autoForwardToMT5)
// -- this is an unverified external input with a low-friction auth
// model, so it lands as a Notification for the trader to review and act
// on manually, same as any other signal in the feed, rather than being
// wired to place real trades on its own.
exports.webhook = async (req, res) => {
  try {
    const { token, pair, action, entry, stopLoss, takeProfit, reasoning, confidence } = req.body;
    if (!token) return res.status(401).json({ message: "Missing token" });

    const user = await User.findOne({ tradingViewToken: token }).select("_id");
    if (!user) return res.status(401).json({ message: "Invalid token" });

    if (!pair || !action) {
      return res.status(400).json({ message: "pair and action are required" });
    }
    const signal = String(action).toLowerCase();
    if (!["buy", "sell"].includes(signal)) {
      return res.status(400).json({ message: "action must be \"buy\" or \"sell\"" });
    }

    const notification = await Notification.create({
      user: user._id,
      pair: String(pair).toUpperCase().replace("/", ""),
      signal,
      entry: entry != null && entry !== "" ? Number(entry) : undefined,
      stopLoss: stopLoss != null && stopLoss !== "" ? Number(stopLoss) : undefined,
      takeProfit: takeProfit != null && takeProfit !== "" ? Number(takeProfit) : undefined,
      reasoning: reasoning || "Signal from a TradingView alert.",
      confidence: confidence != null && confidence !== "" ? Number(confidence) : undefined,
      source: "tradingview",
      sourceLabel: "TradingView Alert",
      type: "forex",
    });

    res.json({ success: true, notificationId: notification._id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
