import { calculatePL } from "./tradePL";

// MT5-style live valuation of an open trade: a BUY would close at the bid,
// a SELL at the ask (GET /api/market/live).
export function closePrice(trade, quote) {
  if (!quote) return null;
  return trade.direction === "buy" ? quote.bid : quote.ask;
}

export function floatingPL(trade, quote) {
  const px = closePrice(trade, quote);
  if (px == null) return null;
  const r = calculatePL(trade.pair, trade.direction, trade.entryPrice, px, trade.lotSize || 0.01);
  return r ? { price: px, pl: Number(r.pl), pips: Number(r.pips) } : null;
}

// "45s", "12m", "2h 15m", "3d 4h"
export function fmtDuration(ms) {
  if (ms == null || !isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export const openedTime = (t) => new Date(t.openedAt || t.createdAt).getTime();
export const closedTime = (t) => (t.closedAt ? new Date(t.closedAt).getTime() : null);

// How long a trade was (or has been) open.
export const tradeDuration = (t, now = Date.now()) =>
  (t.outcome ? (closedTime(t) ?? now) : now) - openedTime(t);
