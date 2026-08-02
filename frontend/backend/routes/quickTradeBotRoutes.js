const router = require("express").Router();
const { getPending, reportExecuted } = require("../controllers/quickTradeBotController");

// Public (token-authed, not JWT) — polled by the browser extension, same
// reasoning as mt5PublicRoutes.js: a local/extension client can't do JWT.
router.get("/pending", getPending);
router.post("/executed", reportExecuted);

module.exports = router;
