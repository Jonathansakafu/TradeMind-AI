const express = require("express");

const {
  registerUser,
  loginUser,
  forgotPassword,
  resetPassword,
  updateProfile,
  updatePassword,
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


module.exports = router;