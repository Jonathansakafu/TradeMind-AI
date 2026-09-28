import { useState } from "react";
import axios from "axios";
import { ShoppingCart } from "lucide-react";
import { API_URL } from "../config/api";

// Cart toggle on a signal: marks it as one the trader actually took, so
// later (after the trade closes) they can tell exactly which signals they
// acted on. Grey outline = not taken; filled green = taken.
export function TakenButton({ notification, headers, onChange, compact = false }) {
  const [busy, setBusy] = useState(false);
  const taken = !!notification.taken;

  const toggle = async (e) => {
    e.stopPropagation();
    setBusy(true);
    try {
      await axios.put(`${API_URL}/api/notifications/${notification._id}/taken`, { taken: !taken }, { headers });
      await onChange?.();
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={toggle}
      disabled={busy}
      aria-pressed={taken}
      aria-label={taken ? "Marked as taken — tap to undo" : "Mark as a trade I took"}
      title={taken ? "You took this trade (tap to undo)" : "Mark as a trade I took"}
      className={`inline-flex items-center gap-1 rounded-lg border transition disabled:opacity-50 ${
        compact ? "p-1.5" : "px-2.5 py-1 text-xs font-semibold"
      } ${
        taken
          ? "bg-green-500 border-green-500 text-slate-950"
          : "border-slate-300 dark:border-slate-700 text-slate-400 hover:text-green-500 hover:border-green-500/50"
      }`}
    >
      <ShoppingCart size={compact ? 13 : 14} fill={taken ? "currentColor" : "none"} />
      {!compact && (taken ? "Taken" : "Take")}
    </button>
  );
}

// Result of the trade logged from this signal, once there is one.
export function TradeResultBadge({ notification }) {
  const t = notification.tradeId;
  if (!notification.taken) return null;
  if (!t || typeof t !== "object") {
    return <span className="text-xs text-slate-400">Taken · no trade logged</span>;
  }
  if (t.status !== "closed" || !t.outcome) {
    return <span className="text-xs text-blue-400">Taken · trade open</span>;
  }
  const color = t.outcome === "win" ? "text-green-500" : t.outcome === "loss" ? "text-red-400" : "text-slate-400";
  const pl = typeof t.profitLoss === "number" ? ` (${t.profitLoss >= 0 ? "+" : ""}${t.profitLoss.toFixed(2)})` : "";
  return (
    <span className={`text-xs font-semibold ${color}`}>
      Taken · {t.outcome === "win" ? "Won" : t.outcome === "loss" ? "Lost" : "Breakeven"}{pl}
    </span>
  );
}
