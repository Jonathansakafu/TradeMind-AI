const crypto = require("crypto");
const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { sendPasswordResetEmail } = require("../utils/sendEmail");


// REGISTER
const registerUser = async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // CHECK USER
    const userExists = await User.findOne({ email });

    if (userExists) {
      return res.status(400).json({
        message: "User already exists",
      });
    }

    // HASH PASSWORD
    const salt = await bcrypt.genSalt(10);

    const hashedPassword = await bcrypt.hash(password, salt);

    // CREATE USER
    const user = await User.create({
      username,
      email,
      password: hashedPassword,
    });

    // TOKEN
    const token = jwt.sign(
      {
        id: user._id,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d",
      }
    );

    res.status(201).json({
      message: "User registered successfully",
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};


// LOGIN
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    // FIND USER
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(400).json({
        message: "Invalid credentials",
      });
    }

    // CHECK PASSWORD
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({
        message: "Invalid credentials",
      });
    }

    // TOKEN
    const token = jwt.sign(
      {
        id: user._id,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d",
      }
    );

    res.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// FORGOT PASSWORD — always responds the same way regardless of whether the
// email exists, so this endpoint can't be used to enumerate registered users.
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (user) {
      const rawToken = crypto.randomBytes(32).toString("hex");
      user.resetPasswordToken = crypto
        .createHash("sha256")
        .update(rawToken)
        .digest("hex");
      user.resetPasswordExpires = Date.now() + 60 * 60 * 1000; // 1 hour
      await user.save();

      const resetUrl = `${process.env.APP_BASE_URL}/reset-password?token=${rawToken}&email=${encodeURIComponent(email)}`;
      await sendPasswordResetEmail(email, resetUrl);
    }

    res.status(200).json({
      message: "If an account exists for that email, a reset link has been sent.",
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};


// RESET PASSWORD
const resetPassword = async (req, res) => {
  try {
    const { email, token, password } = req.body;

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    const user = await User.findOne({
      email,
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    }).select("+resetPasswordToken +resetPasswordExpires");

    if (!user) {
      return res.status(400).json({
        message: "This reset link is invalid or has expired.",
      });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.status(200).json({
      message: "Password reset successfully — you can now log in.",
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// UPDATE PROFILE (name only — email is immutable, used as the login identity)
const updateProfile = async (req, res) => {
  try {
    const { name } = req.body;

    const user = await User.findById(req.user._id);
    user.username = name;
    await user.save();

    res.status(200).json({
      id: user._id,
      username: user.username,
      email: user.email,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};


// UPDATE PASSWORD (while logged in — requires the current password)
const updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user._id).select("+password");
    const isMatch = await bcrypt.compare(currentPassword, user.password);

    if (!isMatch) {
      return res.status(400).json({
        message: "Current password is incorrect",
      });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    res.status(200).json({
      message: "Password updated successfully",
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// RISK SETTINGS (logged in): account balance, risk % per trade, daily
// loss limit %, plus today's closed P/L so the app can show the guard.
const getRiskSettings = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("riskSettings");
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const Trade = require("../models/Trade");
    const today = await Trade.aggregate([
      { $match: { user: req.user._id, outcome: { $exists: true }, closedAt: { $gte: start } } },
      { $group: { _id: null, pl: { $sum: "$profitLoss" } } },
    ]);
    const rs = user?.riskSettings || {};
    const todayPL = today[0]?.pl || 0;
    const limit = rs.balance && rs.dailyLossLimitPercent ? (rs.balance * rs.dailyLossLimitPercent) / 100 : null;
    res.json({
      balance: rs.balance ?? null,
      currency: rs.currency || "USD",
      riskPercent: rs.riskPercent ?? 1,
      dailyLossLimitPercent: rs.dailyLossLimitPercent ?? 3,
      todayPL,
      dailyLimitHit: limit != null && todayPL <= -limit,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updateRiskSettings = async (req, res) => {
  try {
    const { balance, riskPercent, dailyLossLimitPercent, currency } = req.body || {};
    const set = {};
    const num = (v, min, max) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
    };
    if (balance !== undefined) set["riskSettings.balance"] = balance === null || balance === "" ? undefined : num(balance, 1, 1e9);
    if (riskPercent !== undefined) set["riskSettings.riskPercent"] = num(riskPercent, 0.1, 10);
    if (dailyLossLimitPercent !== undefined) set["riskSettings.dailyLossLimitPercent"] = num(dailyLossLimitPercent, 0.5, 50);
    if (currency) set["riskSettings.currency"] = String(currency).slice(0, 3).toUpperCase();
    const bad = Object.entries(set).find(([k, v]) => v === undefined && k !== "riskSettings.balance");
    if (bad) return res.status(400).json({ message: "Risk % must be 0.1-10 and daily loss limit 0.5-50%" });
    await User.updateOne({ _id: req.user._id }, { $set: set });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getRiskSettings,
  updateRiskSettings,
  registerUser,
  loginUser,
  forgotPassword,
  resetPassword,
  updateProfile,
  updatePassword,
};