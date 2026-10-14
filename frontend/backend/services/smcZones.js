// Smart-money zones shared by the signal AI's market summary
// (marketContext.js) and the signal chart (chartAnnotations.js):
// fair value gaps, order blocks, premium / discount, previous day high /
// low and the Asian session range. Pure functions over candles
// ({ datetime, open, high, low, close }, oldest first).

// Unfilled fair value gaps (needs closes beyond the gap to count as filled).
exports.fairValueGaps = fairValueGaps;
function fairValueGaps(c, atrV, upto) {
  const out = [];
  const minSize = (atrV || 0) * 0.3;
  for (let i = 2; i <= upto; i++) {
    const a = c[i - 2], b = c[i];
    if (b.low > a.high && b.low - a.high >= minSize) out.push({ dir: "bullish", top: b.low, bottom: a.high, i: i - 1 });
    if (b.high < a.low && a.low - b.high >= minSize) out.push({ dir: "bearish", top: a.low, bottom: b.high, i: i - 1 });
  }
  return out.filter((g) => {
    for (let j = g.i + 2; j <= upto; j++) {
      if (g.dir === "bullish" && c[j].close < g.bottom) return false;
      if (g.dir === "bearish" && c[j].close > g.top) return false;
    }
    return true;
  }).slice(-4);
}

// Order block for a structure break: the last opposite candle before the
// impulse that broke the level.
exports.orderBlock = orderBlock;
function orderBlock(c, ev, swingsList) {
  if (!ev) return null;
  const from = Math.max(0, ...swingsList.filter((s) => s.i < ev.i).map((s) => s.i).slice(-1), ev.i - 15);
  for (let i = ev.i - 1; i >= from; i--) {
    const bear = c[i].close < c[i].open, bull = c[i].close > c[i].open;
    if (ev.dir === "bullish" && bear) return { dir: "bullish", top: c[i].high, bottom: c[i].low, i };
    if (ev.dir === "bearish" && bull) return { dir: "bearish", top: c[i].high, bottom: c[i].low, i };
  }
  return null;
}


// One line for the AI: the zones around the current price.
exports.zonesLine = ({ candles, majorHighs, majorLows, majorEvents, atr, price, fmt }) => {
  const parts = [];
  const gaps = fairValueGaps(candles, atr, candles.length - 1)
    .filter((g) => Math.abs((g.top + g.bottom) / 2 - price) <= 3 * (atr || Infinity)).slice(-2);
  for (const g of gaps) parts.push(`${g.dir} FVG ${fmt(g.bottom)}-${fmt(g.top)}`);
  const ev = majorEvents.at(-1);
  const ob = orderBlock(candles, ev, ev?.dir === "bullish" ? majorLows : majorHighs);
  if (ob) parts.push(`${ob.dir} order block ${fmt(ob.bottom)}-${fmt(ob.top)}`);
  const h = majorHighs.at(-1), l = majorLows.at(-1);
  if (h && l && h.price > l.price) {
    const pos = (price - l.price) / (h.price - l.price);
    parts.push(`price is in ${pos > 0.5 ? "premium" : "discount"} (${Math.round(pos * 100)}% of the ${fmt(l.price)}-${fmt(h.price)} swing range; sells are better from premium, buys from discount)`);
  }
  const day = (d) => Math.floor(new Date(d).getTime() / 86400000);
  const today = day(candles.at(-1).datetime);
  const prev = candles.filter((c) => day(c.datetime) === today - 1);
  if (prev.length) parts.push(`previous day high ${fmt(Math.max(...prev.map((c) => c.high)))} / low ${fmt(Math.min(...prev.map((c) => c.low)))}`);
  const asia = candles.filter((c) => day(c.datetime) === today && new Date(c.datetime).getUTCHours() < 7);
  if (asia.length >= 3) parts.push(`Asian range ${fmt(Math.min(...asia.map((c) => c.low)))}-${fmt(Math.max(...asia.map((c) => c.high)))}`);
  return parts.length ? `- Key zones (1H): ${parts.join("; ")}` : "";
};
