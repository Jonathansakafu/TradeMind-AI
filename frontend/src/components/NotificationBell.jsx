import { useState, useEffect, useRef } from "react";
import axios from "axios";
import {
  Bell, X, RefreshCw,
  BookOpen, Brain, History
} from "lucide-react";
import { API_URL } from "../config/api";

const SOURCE_ICONS = {
  past_trades: <History size={12} className="text-blue-400" />,
  books: <BookOpen size={12} className="text-purple-400" />,
  ai_auto: <Brain size={12} className="text-green-400" />,
};

const SOURCE_COLORS = {
  past_trades: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  books: "text-purple-400 bg-purple-500/10 border-purple-500/20",
  ai_auto: "text-green-400 bg-green-500/10 border-green-500/20",
};

function NotificationBell() {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const dropdownRef = useRef(null);
  const token = localStorage.getItem("token");
  const headers = { Authorization: `Bearer ${token}` };

  const fetchNotifications = async () => {
    try {
      const res = await axios.get(
        `${API_URL}/api/notifications`,
        { headers }
      );
      setNotifications(res.data.notifications || []);
      setUnreadCount(res.data.unreadCount || 0);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const generateAlerts = async () => {
    setGenerating(true);
    try {
      await axios.post(
        `${API_URL}/api/notifications/generate`,
        {},
        { headers }
      );
      await fetchNotifications();
    } catch (err) {
      console.error(err);
    } finally {
      setGenerating(false);
    }
  };

  const markAsRead = async (id) => {
    try {
      await axios.put(
        `${API_URL}/api/notifications/${id}/read`,
        {},
        { headers }
      );
      setNotifications(notifications.map((n) =>
        n._id === id ? { ...n, read: true } : n
      ));
      setUnreadCount(Math.max(0, unreadCount - 1));
    } catch (err) {
      console.error(err);
    }
  };

  const markAllAsRead = async () => {
    try {
      await axios.put(
        `${API_URL}/api/notifications/read-all`,
        {},
        { headers }
      );
      setNotifications(notifications.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error(err);
    }
  };

  const deleteNotification = async (id) => {
    try {
      await axios.delete(
        `${API_URL}/api/notifications/${id}`,
        { headers }
      );
      setNotifications(notifications.filter((n) => n._id !== id));
      const deleted = notifications.find((n) => n._id === id);
      if (deleted && !deleted.read) setUnreadCount(Math.max(0, unreadCount - 1));
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <>
      {/* Bell Button */}
      <div ref={dropdownRef}>
        <button
          onClick={() => setOpen(!open)}
          className="relative p-2 rounded-xl bg-slate-800 border border-slate-700 hover:border-green-500/50 transition"
        >
          <Bell size={16} className="text-slate-300" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-xs text-white flex items-center justify-center font-bold leading-none">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* Dropdown — Fixed to top-right corner of screen */}
      {open && (
        <div
          className="fixed z-[999] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden"
          style={{
            top: "16px",
            right: "16px",
            width: "380px",
            maxWidth: "calc(100vw - 32px)",
            maxHeight: "85vh",
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900 sticky top-0 z-10">
            <div>
              <p className="font-bold text-white text-sm">AI Alerts</p>
              <p className="text-xs text-slate-400">
                {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="text-xs text-green-400 hover:text-green-300 transition"
                >
                  Mark all read
                </button>
              )}
              <button
                onClick={generateAlerts}
                disabled={generating}
                className="flex items-center gap-1.5 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-slate-950 text-xs font-bold px-3 py-1.5 rounded-lg transition"
              >
                <RefreshCw size={11} className={generating ? "animate-spin" : ""} />
                {generating ? "..." : "Generate"}
              </button>
              <button
                onClick={() => setOpen(false)}
                className="text-slate-500 hover:text-white transition ml-1"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="overflow-y-auto" style={{ maxHeight: "calc(85vh - 65px)" }}>
            {notifications.length === 0 ? (
              <div className="text-center py-10">
                <Bell size={32} className="text-slate-700 mx-auto mb-3" />
                <p className="text-slate-500 text-sm">No alerts yet</p>
                <p className="text-slate-600 text-xs mt-1">
                  Click "Generate" to get AI alerts
                </p>
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n._id}
                  onClick={() => !n.read && markAsRead(n._id)}
                  className={`px-5 py-4 border-b border-slate-800 cursor-pointer transition hover:bg-slate-800/50 ${
                    !n.read ? "bg-slate-800/20" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">

                      {/* Signal + Pair */}
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          !n.read ? "bg-red-500" : "bg-slate-600"
                        }`} />
                        <span className={`text-sm font-bold ${
                          n.signal === "buy" ? "text-green-400"
                          : n.signal === "sell" ? "text-red-400"
                          : "text-yellow-400"
                        }`}>
                          {n.signal === "buy" ? "🟢 BUY"
                            : n.signal === "sell" ? "🔴 SELL"
                            : "⚠️ WAIT"}
                        </span>
                        <span className="font-bold text-white text-sm">{n.pair}</span>
                        <span className="text-xs text-slate-400 ml-auto">
                          {n.confidence}%
                        </span>
                      </div>

                      {/* Entry SL TP */}
                      <div className="grid grid-cols-3 gap-2 mb-2">
                        <div className="bg-slate-800 rounded-lg px-2 py-1 text-center">
                          <p className="text-xs text-slate-500">Entry</p>
                          <p className="text-xs font-mono text-white">{n.entry || "—"}</p>
                        </div>
                        <div className="bg-slate-800 rounded-lg px-2 py-1 text-center">
                          <p className="text-xs text-slate-500">SL</p>
                          <p className="text-xs font-mono text-red-400">{n.stopLoss || "—"}</p>
                        </div>
                        <div className="bg-slate-800 rounded-lg px-2 py-1 text-center">
                          <p className="text-xs text-slate-500">TP</p>
                          <p className="text-xs font-mono text-green-400">{n.takeProfit || "—"}</p>
                        </div>
                      </div>

                      {/* Reasoning */}
                      <p className="text-xs text-slate-400 leading-relaxed mb-2 line-clamp-2">
                        {n.reasoning}
                      </p>

                      {/* Source + Time */}
                      <div className="flex items-center justify-between flex-wrap gap-1">
                        <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs font-medium ${
                          SOURCE_COLORS[n.source] || SOURCE_COLORS.ai_auto
                        }`}>
                          {SOURCE_ICONS[n.source] || SOURCE_ICONS.ai_auto}
                          <span className="ml-1">{n.sourceLabel || "AI Auto"}</span>
                        </div>
                        <p className="text-xs text-slate-600">
                          {new Date(n.createdAt).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>

                    {/* Delete */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteNotification(n._id);
                      }}
                      className="text-slate-600 hover:text-red-400 transition flex-shrink-0"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default NotificationBell;