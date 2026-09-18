// Trades logged through the app already carry a user-picked `session`,
// but externally-reported trades (MT5 EA closed-position reports,
// TradingView webhook alerts) have no such field -- without it they'd be
// invisible to the "best/worst session" half of the weekly self-learning
// summary. Approximate standard UTC forex session windows are good enough
// for that kind of pattern analysis; exact boundary precision (which
// shifts slightly with DST) doesn't change which session a trade is
// "mostly" in.
function sessionForTime(date) {
  const hour = date.getUTCHours();
  const inTokyo = hour >= 0 && hour < 9;
  const inLondon = hour >= 8 && hour < 17;
  const inNewYork = hour >= 13 && hour < 22;

  if (inLondon && inNewYork) return "overlap";
  if (inLondon) return "london";
  if (inNewYork) return "new_york";
  if (inTokyo) return "tokyo";
  // The only hours left (22:00-23:59 UTC) fall outside every window
  // above -- Sydney's own 22:00-07:00 window, by elimination.
  return "sydney";
}

module.exports = { sessionForTime };
