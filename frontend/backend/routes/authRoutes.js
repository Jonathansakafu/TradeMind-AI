const express = require("express");

const {
  registerUser,
  loginUser,
  forgotPassword,
  resetPassword,
  updateProfile,
  updatePassword,
  getRiskSettings,
  updateRiskSettings,
} = require("../controllers/authController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();


// REGISTER
router.post("/register", registerUser);


// LOGIN
router.post("/login", loginUser);


// FORGOT PASSWORD
router.post("/forgot-password", forgotPassword);


// RESET PASSWORD
router.post("/reset-password", resetPassword);


// UPDATE PROFILE (logged in)
router.put("/profile", protect, updateProfile);


// UPDATE PASSWORD (logged in)
router.put("/password", protect, updatePassword);


// RISK SETTINGS (logged in)
router.get("/risk-settings", protect, getRiskSettings);
router.put("/risk-settings", protect, updateRiskSettings);


module.exports = router;