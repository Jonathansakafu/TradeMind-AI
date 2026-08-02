const Trade = require("../models/Trade");
const TradingSession = require("../models/TradingSession");

// All trades logged under a session count toward maxTrades (open or closed),
// but only closed trades have a real profitLoss — open ones default to 0,
// so summing profitLoss across all of them is safe either way.
async function getSessionProgress(sessionId) {
  const trades = await Trade.find({ tradingSessionId: sessionId });
  const currentPL = trades.reduce((sum, t) => sum + (t.profitLoss || 0), 0);
  return { currentPL, tradeCount: trades.length };
}

// Re-evaluates a session against its limits and flips its status if one
// was just hit. Called after anything that could move the needle: a trade
// closing, or a Quick Trade result being logged.
async function checkAndUpdateSession(sessionId) {
  const session = await TradingSession.findById(sessionId);
  if (!session || session.status !== "active") return session;

  const { currentPL, tradeCount } = await getSessionProgress(sessionId);

  let newStatus = null;
  if (currentPL >= session.profitTarget) {
    newStatus = "stopped_profit";
  } else if (currentPL <= -session.riskLimit) {
    newStatus = "stopped_risk";
  } else if (tradeCount >= session.maxTrades) {
    newStatus = "stopped_trades";
  }

  if (newStatus) {
    session.status = newStatus;
    session.endedAt = new Date();
    // A limit-triggered stop is the common case (not the manual Stop
    // Session button) — the bot token must not outlive it, or the
    // extension could keep polling a session that looks inert but still
    // has a live token sitting around.
    session.autoExecute = false;
    session.botToken = undefined;
    await session.save();
  }

  return session;
}

module.exports = { getSessionProgress, checkAndUpdateSession };
