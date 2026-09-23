import { Link } from "react-router-dom";
import { Bot, Zap, ChevronRight } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useResource } from "../hooks/useResource";
import { fetchActiveSession } from "../api/resources";

// One mode's banner -- MT5 and Quick Trade sessions can both be active at
// the same time (see sessionController's startSession), so this renders
// per-mode rather than for "the" active session, and SessionBanner below
// stacks up to two of these instead of picking just one.
function SingleSessionBanner({ mode, className }) {
  const { headers } = useAuth();
  const { data } = useResource(
    `sessions-active-${mode}`,
    () => fetchActiveSession(headers, mode),
    30000
  );
  const session = data?.session ?? null;
  const progress = data?.progress ?? { currentPL: 0, tradeCount: 0 };

  if (!session || session.status !== "active") return null;

  const profitPct = Math.min(Math.max(progress.currentPL, 0) / session.profitTarget * 100, 100);
  const riskPct = Math.min(Math.max(-progress.currentPL, 0) / session.riskLimit * 100, 100);

  return (
    <Link
      to="/session"
      className={`flex items-center gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-4 py-3 hover:border-green-500/50 transition ${className}`}
    >
      {session.mode === "mt5" ? (
        <Bot size={18} className="text-green-600 dark:text-green-400 flex-shrink-0" />
      ) : (
        <Zap size={18} className="text-green-600 dark:text-green-400 flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
          {session.mode === "mt5" ? "MT5" : "Quick Trade"} session active — {progress.tradeCount}/{session.maxTrades} trades ·{" "}
          <span className={progress.currentPL >= 0 ? "text-green-500" : "text-red-500"}>
            {progress.currentPL >= 0 ? "+" : ""}${progress.currentPL.toFixed(2)}
          </span>
        </p>
        <div className="flex gap-1 mt-1.5">
          <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-green-500" style={{ width: `${profitPct}%` }} />
          </div>
          <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-red-500" style={{ width: `${riskPct}%` }} />
          </div>
        </div>
      </div>
      <ChevronRight size={16} className="text-slate-400 dark:text-slate-600 flex-shrink-0" />
    </Link>
  );
}

// Persistent at-a-glance status for active trading session(s), shown across
// Notifications/MT5/Dashboard so the trader always knows where they stand
// without navigating to the Trading Robot page. Renders nothing if neither
// mode has an active session; renders one or two banners (stacked) if one
// or both do.
function SessionBanner({ className = "" }) {
  return (
    <div className={`space-y-3 ${className}`}>
      <SingleSessionBanner mode="mt5" />
      <SingleSessionBanner mode="quick_trade" />
    </div>
  );
}

export default SessionBanner;
