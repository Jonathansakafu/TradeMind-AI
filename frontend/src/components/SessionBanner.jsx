import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { Bot, Zap, ChevronRight } from "lucide-react";
import { API_URL } from "../config/api";

// Persistent at-a-glance status for an active trading session, shown across
// Notifications/MT5/Dashboard so the trader always knows where they stand
// without navigating to the Trading Robot page. Renders nothing if there's
// no active session — className lets callers control outer spacing.
function SessionBanner({ className = "" }) {
  const token = localStorage.getItem("token");
  const headers = { Authorization: `Bearer ${token}` };
  const [session, setSession] = useState(null);
  const [progress, setProgress] = useState({ currentPL: 0, tradeCount: 0 });

  const fetchActiveSession = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/api/sessions/active`, { headers });
      setSession(res.data.session);
      if (res.data.progress) setProgress(res.data.progress);
    } catch {
      // Silent — this is a passive status widget, not the primary page
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(fetchActiveSession, 0);
    const interval = setInterval(fetchActiveSession, 30000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [fetchActiveSession]);

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
          Session active — {progress.tradeCount}/{session.maxTrades} trades ·{" "}
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

export default SessionBanner;
