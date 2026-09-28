const User = require("../models/User");
const { dispatchNotification, getVapidPublicKey } = require("../services/notifyDispatcher");

// Caps stored devices per user so stale ones can't pile up forever (the
// dispatcher also prunes any the push service reports as gone).
const MAX_DEVICES = 10;

exports.getVapidKey = async (req, res) => {
  try {
    res.json({ publicKey: await getVapidPublicKey() });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select("email notificationPrefs +pushSubscriptions +fcmTokens");
    res.json({
      prefs: {
        push: user.notificationPrefs?.push !== false,
        email: !!user.notificationPrefs?.email,
        emailMinConfidence: user.notificationPrefs?.emailMinConfidence ?? 70,
      },
      email: user.email,
      browserDevices: user.pushSubscriptions?.length || 0,
      androidDevices: user.fcmTokens?.length || 0,
      androidServerReady: !!process.env.FIREBASE_SERVICE_ACCOUNT,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.updatePrefs = async (req, res) => {
  try {
    const { push, email, emailMinConfidence } = req.body;
    const set = {};
    if (typeof push === "boolean") set["notificationPrefs.push"] = push;
    if (typeof email === "boolean") set["notificationPrefs.email"] = email;
    if (emailMinConfidence != null) {
      const n = Number(emailMinConfidence);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return res.status(400).json({ message: "emailMinConfidence must be 0-100" });
      }
      set["notificationPrefs.emailMinConfidence"] = Math.round(n);
    }
    await User.updateOne({ _id: req.user._id }, { $set: set });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.subscribeBrowser = async (req, res) => {
  try {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ message: "Invalid push subscription" });
    }
    // Pull-then-push replaces an existing entry for the same browser
    // (its keys can rotate) instead of duplicating it; $slice keeps only
    // the newest MAX_DEVICES.
    await User.updateOne({ _id: req.user._id }, { $pull: { pushSubscriptions: { endpoint } } });
    await User.updateOne({ _id: req.user._id }, {
      $push: { pushSubscriptions: { $each: [{ endpoint, keys }], $slice: -MAX_DEVICES } },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.unsubscribeBrowser = async (req, res) => {
  try {
    const { endpoint } = req.body || {};
    if (endpoint) {
      await User.updateOne({ _id: req.user._id }, { $pull: { pushSubscriptions: { endpoint } } });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.registerFcmToken = async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token || typeof token !== "string") {
      return res.status(400).json({ message: "Missing token" });
    }
    // One device token belongs to one account -- drop it from anyone else
    // first, so logging into a different account on the same phone doesn't
    // keep sending the previous account's signals there.
    await User.updateMany({ fcmTokens: token, _id: { $ne: req.user._id } }, { $pull: { fcmTokens: token } });
    await User.updateOne({ _id: req.user._id }, { $pull: { fcmTokens: token } });
    await User.updateOne({ _id: req.user._id }, {
      $push: { fcmTokens: { $each: [token], $slice: -MAX_DEVICES } },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.unregisterFcmToken = async (req, res) => {
  try {
    const { token } = req.body || {};
    if (token) await User.updateOne({ _id: req.user._id }, { $pull: { fcmTokens: token } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Sends a fake signal through every channel, ignoring on/off toggles, and
// reports what happened per channel -- the only way to tell "push isn't
// set up" apart from "no signals were generated".
exports.sendTest = async (req, res) => {
  try {
    const results = await dispatchNotification({
      _id: "test",
      user: req.user._id,
      pair: "TEST",
      signal: "buy",
      confidence: 99,
      entry: 1.2345,
      stopLoss: 1.23,
      takeProfit: 1.24,
      reasoning: "This is a test alert from TradeMind AI. If you can see it, alerts outside the app are working.",
      sourceLabel: "Test alert",
      type: "forex",
    }, { test: true });
    res.json({ results });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
