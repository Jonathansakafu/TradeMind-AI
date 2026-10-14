// Helpers for recording many signals as trades in one go
// (components/GroupRecord.jsx).
import { calculatePL } from "./tradePL";

const dayKey = (d) => new Date(d).toDateString();

export function groupIneligibleReason(n) {
  if (n.type === "quick_trade") return "Quick Trade";
  if (n.signal !== "buy" && n.signal !== "sell") return "WAIT signal";
  if (!n.entry) return "No entry price";
  if (n.tradeId) return "Already recorded";
  return null;
}

export const isTodays = (n) => dayKey(n.createdAt) === dayKey(Date.now());

// Trading session at a moment (same hours as Add Trade's auto-detect).
function sessionAt(date) {
  const h = new Date(date).getUTCHours();
  if (h >= 22 || h < 7) return "sydney";
  if (h < 9) return "tokyo";
  if (h < 13) return "london";
  if (h < 17) return "overlap";
  return "new_york";
}

export function tradeFromSignal(n, lot) {
  const exit = n.simOutcome === "win" ? n.takeProfit : n.simOutcome === "loss" ? n.stopLoss : null;
  const pl = exit != null ? calculatePL(n.pair, n.signal, n.entry, exit, lot) : null;
  return {
    id: n._id,
    pair: n.pair,
    direction: n.signal,
    entryPrice: n.entry,
    stopLoss: n.stopLoss,
    takeProfit: n.takeProfit,
    lotSize: lot,
    exitPrice: exit,
    pl,
    openedAt: n.createdAt,
    closedAt: exit != null ? n.simResolvedAt || new Date().toISOString() : null,
    session: sessionAt(n.createdAt),
    notes: `AI Signal — ${n.sourceLabel || "AI Auto"} (recorded in a group)\n${n.reasoning || ""}`.trim(),
  };
}
