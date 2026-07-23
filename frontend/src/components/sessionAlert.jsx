import { useEffect, useState } from "react";
import axios from "axios";
import { Bell, X, TrendingUp, Clock } from "lucide-react";
import { API_URL } from "../config/api";

const SESSIONS = [
  {
    name: "sydney",
    label: "Sydney",
    open: 22, close: 7,
    color: "blue",
    pairs: ["AUDUSD", "NZDUSD", "AUDCAD", "AUDJPY"],
  },
  {
    name: "tokyo",
    label: "Tokyo",
    open: 0, close: 9,
    color: "yellow",
    pairs: ["USDJPY", "GBPJPY", "EURJPY", "AUDJPY", "CADJPY"],
  },
  {
    name: "london",
    label: "London",
    open: 8, close: 17,
    color: "green",
    pairs: ["EURUSD", "GBPUSD", "EURGBP", "USDCHF", "GBPJPY"],
  },
  {
    name: "new_york",
    label: "New York",
    open: 13, close: 22,
    color: "orange",
    pairs: ["EURUSD", "GBPUSD", "USDCAD", "XAUUSD", "USDJPY"],
  },
];

const COLOR_MAP = {
  green: {
    bg: "bg-green-500/10",
    border: "border-green-500/30",
    text: "text-green-400",
    badge: "bg-green-500/20 text-green-300",
    dot: "bg-green-400",
  },
  blue: {
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    text: "text-blue-400",
    badge: "bg-blue-500/20 text-blue-300",
    dot: "bg-blue-400",
  },
  yellow: {
    bg: "bg-yellow-500/10",
    border: "border-yellow-500/30",
    text: "text-yellow-400",
    badge: "bg-yellow-500/20 text-yellow-300",
    dot: "bg-yellow-400",
  },
  orange: {
    bg: "bg-orange-500/10",
    border: "border-orange-500/30",
    text: "text-orange-400",
    badge: "bg-orange-500/20 text-orange-300",
    dot: "bg-orange-400",
  },
};

const getActiveSessions = () => {
  const now = new Date();
  const utcHour = now.getUTCHours();
  return SESSIONS.filter((s) => {
    if (s.open < s.close) return utcHour >= s.open && utcHour < s.close;
    return utcHour >= s.open || utcHour < s.close;
  });
};

const getTimeUntilNext = () => {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMin = now.getUTCMinutes();

  for (const s of SESSIONS) {
    if (s.open > utcHour || (s.open === utcHour && utcMin < 0)) {
      const hoursLeft = s.open - utcHour;
      return { session: s.label, hours: hoursLeft };
    }
  }
  return null;
};

function SessionAlert() {
  const [activeSessions, setActiveSessions] = useState([]);
  const [dismissed, setDismissed] = useState([]);
  const [stats, setStats] = useState({});
  const [show, setShow] = useState(true);
  const token = localStorage.getItem("token");

  useEffect(() => {
    const update = () => setActiveSessions(getActiveSessions());
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeSessions.length === 0) return;
    const fetchStats = async () => {
      try {
        const res = await axios.get(`${API_URL}/api/trades/stats`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setStats(res.data.pairMap || {});
      } catch (err) {
        console.log(err);
      }
    };
    fetchStats();
  }, [activeSessions]);

  const getWinRate = (pair) => {
    if (!stats[pair]) return null;
    const { wins, total } = stats[pair];
    if (!total) return null;
    return Math.round((wins / total) * 100);
  };

  const visibleSessions = activeSessions.filter(
    (s) => !dismissed.includes(s.name)
  );

  if (!show || visibleSessions.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 max-w-sm">
      {visibleSessions.map((session) => {
        const colors = COLOR_MAP[session.color];
        const bestPairs = session.pairs
          .map((p) => ({ pair: p, winRate: getWinRate(p) }))
          .filter((p) => p.winRate !== null)
          .sort((a, b) => b.winRate - a.winRate)
          .slice(0, 3);

        return (
          <div
            key={session.name}
            className={`${colors.bg} ${colors.border} border rounded-2xl p-4 shadow-2xl backdrop-blur-sm`}
            style={{ minWidth: 300 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${colors.dot} animate-pulse`} />
                <Bell size={14} className={colors.text} />
                <p className={`font-bold text-sm ${colors.text}`}>
                  {session.label} Session — LIVE
                </p>
              </div>
              <button
                onClick={() => setDismissed([...dismissed, session.name])}
                className="text-slate-500 hover:text-slate-300 transition"
              >
                <X size={14} />
              </button>
            </div>

            {/* Time */}
            <div className="flex items-center gap-1.5 mb-3">
              <Clock size={12} className="text-slate-400" />
              <p className="text-xs text-slate-400">
                {session.open}:00 — {session.close}:00 UTC
              </p>
            </div>

            {/* Best pairs from history */}
            {bestPairs.length > 0 ? (
              <div>
                <p className="text-xs text-slate-400 mb-2 flex items-center gap-1">
                  <TrendingUp size={11} />
                  Best pairs from your history:
                </p>
                <div className="flex flex-wrap gap-2">
                  {bestPairs.map(({ pair, winRate }) => (
                    <span
                      key={pair}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${colors.badge}`}
                    >
                      {pair} {winRate}% ✓
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <p className="text-xs text-slate-400 mb-2">
                  Pairs za kawaida kwa session hii:
                </p>
                <div className="flex flex-wrap gap-2">
                  {session.pairs.slice(0, 3).map((pair) => (
                    <span
                      key={pair}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${colors.badge}`}
                    >
                      {pair}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* AI tip */}
            <div className="mt-3 pt-3 border-t border-slate-700/50">
              <p className="text-xs text-slate-400">
                💡 {bestPairs.length > 0
                  ? `Historically unafanya vizuri zaidi na ${bestPairs[0].pair} (${bestPairs[0].winRate}% win rate) wakati wa ${session.label}`
                  : `Ongeza trades zaidi ili upate personalized suggestions kwa ${session.label} session`}
              </p>
            </div>
          </div>
        );
      })}

      {/* Hide all button */}
      {visibleSessions.length > 1 && (
        <button
          onClick={() => setShow(false)}
          className="text-xs text-slate-500 hover:text-slate-300 text-center transition"
        >
          Hide all alerts
        </button>
      )}
    </div>
  );
}

export default SessionAlert;