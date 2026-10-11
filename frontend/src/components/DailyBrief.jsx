import { useEffect, useState } from "react";
import axios from "axios";
import { CalendarDays, AlertOctagon } from "lucide-react";
import { API_URL } from "../config/api";
import { useAuth } from "../hooks/useAuth";
import { useRiskSettings } from "../hooks/useRiskSettings";

// Dashboard: today's pre-London plan (services/morningBrief.js) and a
// warning once today's closed losses reach the daily loss limit.
function DailyBrief() {
  const { headers } = useAuth();
  const { settings } = useRiskSettings();
  const [brief, setBrief] = useState(null);

  useEffect(() => {
    axios.get(`${API_URL}/api/notifications/brief`, { headers })
      .then((r) => setBrief(r.data.brief))
      .catch(() => {});
  }, [headers]);

  const isToday = brief?.date === new Date().toISOString().slice(0, 10);
  return (
    <>
      {settings?.dailyLimitHit && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-red-700 dark:text-red-300">
          <AlertOctagon size={20} className="flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-bold">Daily loss limit reached</p>
            <p>Today's closed P/L is {Number(settings.todayPL).toFixed(2)} {settings.currency}. MT5 auto-send is paused until tomorrow — consider stopping for today.</p>
          </div>
        </div>
      )}
      {brief?.text && brief.status === "sent" && (
        <div className="mb-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h3 className="font-bold flex items-center gap-2 text-slate-900 dark:text-white mb-2">
            <CalendarDays size={18} className="text-green-600 dark:text-green-400" />
            {isToday ? "Today's plan" : `Plan for ${brief.date}`}
          </h3>
          <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-line leading-relaxed">{brief.text}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">Made before the London open from price structure and the news calendar. Not financial advice.</p>
        </div>
      )}
    </>
  );
}

export default DailyBrief;
