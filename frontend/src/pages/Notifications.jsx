import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import MainLayout from "../layouts/MainLayout";
import {
  Bell, RefreshCw, BookOpen, Brain,
  History, X, CheckCheck, PlusCircle, Zap,
  TrendingUp, TrendingDown, Clock,
} from "lucide-react";
import { API_URL } from "../config/api";
import SessionBanner from "../components/SessionBanner";

const SOURCE_ICONS = {
  past_trades: <History size={14} className="text-blue-400" />,
  books: <BookOpen size={14} className="text-purple-400" />,
  ai_auto: <Brain size={14} className="text-green-400" />,
};

const SOURCE_COLORS = {
  past_trades: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  books: "text-purple-400 bg-purple-500/10 border-purple-500/20",
  ai_auto: "text-green-400 bg-green-500/10 border-green-500/20",
};

function Notifications() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generateMessage, setGenerateMessage] = useState(null);
  const [filter, setFilter] = useState("all");
  const [sendingId, setSendingId] = useState(null);
  const [reportingId, setReportingId] = useState(null);
  const [activeSession, setActiveSession] = useState(null);
  const token = localStorage.getItem("token");
  const headers = { Authorization: `Bearer ${token}` };

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const res = await axios.get(
        `${API_URL}/api/notifications`,
        { headers }
      );
      setNotifications(res.data.notifications || []);
      setUnreadCount(res.data.unreadCount || 0);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchActiveSession = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/sessions/active`, { headers });
      setActiveSession(res.data.session);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchNotifications();
    fetchActiveSession();
  }, []);

  const generateAlerts = async () => {
    setGenerating(true);
    setGenerateMessage(null);
    try {
      const res = await axios.post(
        `${API_URL}/api/notifications/generate`,
        {},
        { headers }
      );
      setGenerateMessage({
        type: res.data.generated > 0 ? "success" : "info",
        text: res.data.message,
      });
      await fetchNotifications();
    } catch (err) {
      setGenerateMessage({
        type: "error",
        text: err.response?.data?.message || "Failed to generate alerts",
      });
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

  const addTradeFromSignal = (n) => {
    navigate("/add-trade", {
      state: {
        signal: {
          pair: n.pair,
          signal: n.signal,
          entry: n.entry,
          stopLoss: n.stopLoss,
          takeProfit: n.takeProfit,
          reasoning: n.reasoning,
          sourceLabel: n.sourceLabel,
        }
      }
    });
  };

  const sendSignalToMT5 = async (notification) => {
    setSendingId(notification._id);
    try {
      await axios.post(
        `${API_URL}/api/mt5/signal`,
        {
          pair: notification.pair,
          action: notification.signal,
          entry: notification.entry,
          stopLoss: notification.stopLoss,
          takeProfit: notification.takeProfit,
          lotSize: 0.01,
          confidence: notification.confidence,
          source: notification.source,
          sourceLabel: notification.sourceLabel,
          reasoning: notification.reasoning,
          accountType: localStorage.getItem("mt5AccountType") || "demo",
        },
        { headers }
      );
      alert(`✅ Signal sent to MT5 — EA will execute ${notification.pair} ${notification.signal?.toUpperCase()} shortly!`);
    } catch {
      alert("Failed to send to MT5");
    } finally {
      setSendingId(null);
    }
  };

  // Won/Lost is a single tap — P&L is computed from the session's stake +
  // payout % (set once at session start) rather than typed in each time.
  const reportQuickTradeResult = async (notification, outcome) => {
    if (!activeSession || activeSession.mode !== "quick_trade") return;
    setReportingId(notification._id);
    try {
      const profitLoss = outcome === "win"
        ? activeSession.stake * (activeSession.payoutPercent / 100)
        : -activeSession.stake;

      await axios.post(
        `${API_URL}/api/trades`,
        {
          pair: notification.pair,
          direction: notification.signal,
          type: "quick_trade",
          tradingSessionId: activeSession._id,
          entryPrice: notification.entry || 0,
          outcome,
          profitLoss,
          status: "closed",
          closedAt: new Date().toISOString(),
        },
        { headers }
      );
      await markAsRead(notification._id);
      await fetchActiveSession();
    } catch {
      alert("Failed to log trade result");
    } finally {
      setReportingId(null);
    }
  };

  const filtered = notifications.filter((n) => {
    if (filter === "unread") return !n.read;
    if (filter === "buy") return n.signal === "buy";
    if (filter === "sell") return n.signal === "sell";
    return true;
  });

  return (
    <MainLayout>

      {/* Header */}
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <h2 className="text-3xl md:text-4xl font-bold flex items-center gap-3">
            <Bell className="text-green-600 dark:text-green-400" size={32} />
            Notifications
          </h2>
          <p className="text-slate-500 dark:text-slate-400 mt-2">
            {unreadCount > 0 ? `${unreadCount} unread alerts` : "All caught up"}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {unreadCount > 0 && (
            <button
              onClick={markAllAsRead}
              className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-2.5 rounded-xl text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition"
            >
              <CheckCheck size={14} />
              Mark all read
            </button>
          )}
          <button
            onClick={generateAlerts}
            disabled={generating}
            className="flex items-center gap-2 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-slate-950 font-semibold px-4 py-2.5 rounded-xl text-sm transition"
          >
            <RefreshCw size={14} className={generating ? "animate-spin" : ""} />
            {generating ? "Generating..." : "Generate Alerts"}
          </button>
        </div>
      </div>

      <SessionBanner className="mb-6" />

      {generateMessage && (
        <div className={`mb-6 rounded-xl p-3 text-sm border flex items-center justify-between gap-3 ${
          generateMessage.type === "success"
            ? "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20"
            : generateMessage.type === "error"
            ? "bg-red-500/10 text-red-500 dark:text-red-400 border-red-500/20"
            : "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
        }`}>
          <span>{generateMessage.text}</span>
          <button onClick={() => setGenerateMessage(null)} aria-label="Dismiss" className="flex-shrink-0 opacity-70 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {["all", "unread", "buy", "sell"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-xl text-sm font-medium capitalize transition ${
              filter === f
                ? "bg-green-500 text-slate-950"
                : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            {f === "all" ? "All"
              : f === "unread" ? `Unread (${unreadCount})`
              : f.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <Bell size={48} className="text-slate-300 dark:text-slate-700 mx-auto mb-4" />
          <p className="text-slate-500 dark:text-slate-400 text-lg font-semibold">No alerts yet</p>
          <p className="text-slate-400 dark:text-slate-500 text-sm mt-2">
            Click "Generate Alerts" to get AI-powered trading signals
          </p>
          <button
            onClick={generateAlerts}
            disabled={generating}
            className="mt-6 flex items-center gap-2 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-slate-950 font-bold px-6 py-3 rounded-xl transition mx-auto"
          >
            <RefreshCw size={16} className={generating ? "animate-spin" : ""} />
            {generating ? "Generating..." : "Generate Now"}
          </button>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {filtered.map((n) => (
            <div
              key={n._id}
              className={`bg-white dark:bg-slate-900 border rounded-2xl p-5 transition ${
                !n.read ? "border-slate-300 dark:border-slate-700 shadow-lg" : "border-slate-200 dark:border-slate-800 opacity-75"
              }`}
            >
              {/* Card Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1 ${
                    !n.read ? "bg-red-500 animate-pulse" : "bg-slate-600"
                  }`} />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`text-lg font-bold ${
                        n.signal === "buy" ? "text-green-400"
                        : n.signal === "sell" ? "text-red-400"
                        : "text-yellow-400"
                      }`}>
                        {n.signal === "buy" ? "🟢 BUY"
                          : n.signal === "sell" ? "🔴 SELL"
                          : "⚠️ WAIT"}
                      </span>
                      <span className="text-slate-900 dark:text-white font-bold text-lg">{n.pair}</span>
                    </div>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                      {new Date(n.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold px-2.5 py-1 rounded-lg ${
                    n.signal === "buy" ? "bg-green-500/10 text-green-400"
                    : n.signal === "sell" ? "bg-red-500/10 text-red-400"
                    : "bg-yellow-500/10 text-yellow-400"
                  }`}>
                    {n.confidence}%
                  </span>
                  <button
                    onClick={() => deleteNotification(n._id)}
                    aria-label="Delete notification"
                    className="p-2 -m-2 text-slate-400 dark:text-slate-600 hover:text-red-400 transition"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              {/* Entry SL TP (forex) / Direction + expiry (Quick Trade) */}
              {n.type === "quick_trade" ? (
                <div className="flex items-center gap-3 mb-4 bg-slate-100 dark:bg-slate-800 rounded-xl p-3">
                  {n.signal === "buy"
                    ? <TrendingUp size={18} className="text-green-500 flex-shrink-0" />
                    : <TrendingDown size={18} className="text-red-500 flex-shrink-0" />
                  }
                  <p className="text-sm text-slate-700 dark:text-slate-300 flex-1">
                    Predicted <span className="font-bold">{n.signal === "buy" ? "UP" : "DOWN"}</span> — place this trade on your platform now
                  </p>
                  {n.expiresInMinutes && (
                    <span className="flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500 flex-shrink-0">
                      <Clock size={12} /> {n.expiresInMinutes}m
                    </span>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="bg-slate-100 dark:bg-slate-800 rounded-xl p-3 text-center">
                    <p className="text-xs text-slate-400 dark:text-slate-500 mb-1">Entry</p>
                    <p className="font-mono font-bold text-slate-900 dark:text-white text-sm">
                      {n.entry || "—"}
                    </p>
                  </div>
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-center">
                    <p className="text-xs text-slate-400 dark:text-slate-500 mb-1">Stop Loss</p>
                    <p className="font-mono font-bold text-red-400 text-sm">
                      {n.stopLoss || "—"}
                    </p>
                  </div>
                  <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3 text-center">
                    <p className="text-xs text-slate-400 dark:text-slate-500 mb-1">Take Profit</p>
                    <p className="font-mono font-bold text-green-400 text-sm">
                      {n.takeProfit || "—"}
                    </p>
                  </div>
                </div>
              )}

              {/* Reasoning */}
              <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed mb-4 bg-slate-100/70 dark:bg-slate-800/50 rounded-xl p-3 line-clamp-3">
                {n.reasoning}
              </p>

              {/* Footer */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium ${
                  SOURCE_COLORS[n.source] || SOURCE_COLORS.ai_auto
                }`}>
                  {SOURCE_ICONS[n.source] || SOURCE_ICONS.ai_auto}
                  <span>{n.sourceLabel || "AI Auto"}</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {!n.read && (
                    <button
                      onClick={() => markAsRead(n._id)}
                      className="text-xs text-slate-500 dark:text-slate-400 hover:text-green-400 transition flex items-center gap-1"
                    >
                      <CheckCheck size={12} /> Read
                    </button>
                  )}
                  {n.type === "quick_trade" ? (
                    <>
                      <button
                        onClick={() => reportQuickTradeResult(n, "win")}
                        disabled={reportingId === n._id || !activeSession}
                        className="flex items-center gap-1.5 text-xs bg-green-500/10 border border-green-500/30 text-green-400 hover:bg-green-500/20 disabled:opacity-50 px-3 py-1.5 rounded-lg transition font-semibold"
                      >
                        <CheckCheck size={12} />
                        {reportingId === n._id ? "Logging..." : "Won"}
                      </button>
                      <button
                        onClick={() => reportQuickTradeResult(n, "loss")}
                        disabled={reportingId === n._id || !activeSession}
                        className="flex items-center gap-1.5 text-xs bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 disabled:opacity-50 px-3 py-1.5 rounded-lg transition font-semibold"
                      >
                        <X size={12} />
                        {reportingId === n._id ? "Logging..." : "Lost"}
                      </button>
                    </>
                  ) : (
                    <>
                      {n.signal !== "wait" && (
                        <button
                          onClick={() => sendSignalToMT5(n)}
                          disabled={sendingId === n._id}
                          className="flex items-center gap-1.5 text-xs bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/20 disabled:opacity-50 px-3 py-1.5 rounded-lg transition font-semibold"
                        >
                          <Zap size={12} className={sendingId === n._id ? "animate-pulse" : ""} />
                          {sendingId === n._id ? "Sending..." : "MT5"}
                        </button>
                      )}
                      {n.signal !== "wait" && (
                        <button
                          onClick={() => addTradeFromSignal(n)}
                          className="flex items-center gap-1.5 text-xs bg-green-500/10 border border-green-500/30 text-green-400 hover:bg-green-500/20 px-3 py-1.5 rounded-lg transition font-semibold"
                        >
                          <PlusCircle size={12} />
                          Add Trade
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

            </div>
          ))}
        </div>
      )}

    </MainLayout>
  );
}

export default Notifications;