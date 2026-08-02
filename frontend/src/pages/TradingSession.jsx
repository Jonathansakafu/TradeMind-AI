import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import MainLayout from "../layouts/MainLayout";
import {
  Bot, Target, ShieldAlert, Hash, Zap, LineChart,
  CheckCircle, XCircle, StopCircle, TrendingUp, TrendingDown, ShieldCheck,
} from "lucide-react";
import { API_URL } from "../config/api";

const FOREX_PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "AUDUSD", "USDCAD"];
const CRYPTO_PAIRS = ["BTCUSD", "ETHUSD", "XRPUSD"];

const STATUS_LABELS = {
  stopped_profit: { text: "Profit target reached 🎉", color: "text-green-600 dark:text-green-400" },
  stopped_risk: { text: "Risk limit reached", color: "text-red-500 dark:text-red-400" },
  stopped_trades: { text: "Max trades reached", color: "text-yellow-500 dark:text-yellow-400" },
  stopped_manual: { text: "Stopped manually", color: "text-slate-500 dark:text-slate-400" },
};

function TradingSession() {
  const token = localStorage.getItem("token");
  const headers = { Authorization: `Bearer ${token}` };

  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [progress, setProgress] = useState({ currentPL: 0, tradeCount: 0 });
  const [sessionTrades, setSessionTrades] = useState([]);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);

  const [mode, setMode] = useState("mt5");
  const [profitTarget, setProfitTarget] = useState("50");
  const [riskLimit, setRiskLimit] = useState("30");
  const [maxTrades, setMaxTrades] = useState("20");
  const [selectedPairs, setSelectedPairs] = useState([]);
  const [stake, setStake] = useState("10");
  const [payoutPercent, setPayoutPercent] = useState("85");
  const [accountType, setAccountType] = useState("demo");
  const [accountReady, setAccountReady] = useState(false);

  const togglePair = (pair) => {
    setSelectedPairs((prev) =>
      prev.includes(pair) ? prev.filter((p) => p !== pair) : [...prev, pair]
    );
  };

  const fetchActiveSession = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/api/sessions/active`, { headers });
      setSession(res.data.session);
      if (res.data.progress) setProgress(res.data.progress);
      if (res.data.session) {
        const tradesRes = await axios.get(
          `${API_URL}/api/trades?tradingSessionId=${res.data.session._id}&limit=50`,
          { headers }
        );
        setSessionTrades(tradesRes.data.trades || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActiveSession();
    const interval = setInterval(fetchActiveSession, 30000);
    return () => clearInterval(interval);
  }, [fetchActiveSession]);

  const startSession = async () => {
    setError(null);
    setErrorCode(null);
    if (!profitTarget || !riskLimit || !maxTrades) {
      setError("Please fill in profit target, risk limit, and max trades");
      return;
    }
    if (mode === "quick_trade" && (!stake || !payoutPercent)) {
      setError("Please fill in stake and payout % for Quick Trade sessions");
      return;
    }
    if (mode === "quick_trade" && !accountReady) {
      setError("Please confirm your Pocket Option/Expert Option account is ready");
      return;
    }
    setStarting(true);
    try {
      await axios.post(
        `${API_URL}/api/sessions`,
        {
          mode,
          profitTarget: Number(profitTarget),
          riskLimit: Number(riskLimit),
          maxTrades: Number(maxTrades),
          pairs: selectedPairs,
          accountType,
          accountReady,
          stake: mode === "quick_trade" ? Number(stake) : undefined,
          payoutPercent: mode === "quick_trade" ? Number(payoutPercent) : undefined,
        },
        { headers }
      );
      await fetchActiveSession();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to start session");
      setErrorCode(err.response?.data?.code || null);
    } finally {
      setStarting(false);
    }
  };

  const stopSession = async () => {
    if (!session) return;
    setStopping(true);
    try {
      await axios.put(`${API_URL}/api/sessions/${session._id}/stop`, {}, { headers });
      await fetchActiveSession();
    } catch (err) {
      console.error(err);
    } finally {
      setStopping(false);
    }
  };

  const startNewSession = () => {
    setSession(null);
    setSessionTrades([]);
    setProgress({ currentPL: 0, tradeCount: 0 });
  };

  if (loading) {
    return (
      <MainLayout>
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </MainLayout>
    );
  }

  const isFinished = session && session.status !== "active";

  return (
    <MainLayout>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
          <Bot className="text-green-600 dark:text-green-400" size={32} />
          Trading Robot
        </h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1 text-sm">
          Set a goal, let the AI manage your risk, and it stops for you.
        </p>
      </div>

      {!session && (
        <div className="max-w-2xl space-y-6">
          {/* Mode picker */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
            <h3 className="font-bold text-slate-900 dark:text-white mb-4">Choose Mode</h3>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setMode("mt5")}
                className={`p-4 rounded-xl border text-left transition ${
                  mode === "mt5"
                    ? "bg-green-500/10 border-green-500 text-green-600 dark:text-green-400"
                    : "bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"
                }`}
              >
                <Bot size={20} className="mb-2" />
                <p className="font-bold text-sm">MT5 Auto-Trade</p>
                <p className="text-xs mt-1 opacity-80">Signals execute automatically via your MT5 EA</p>
              </button>
              <button
                onClick={() => setMode("quick_trade")}
                className={`p-4 rounded-xl border text-left transition ${
                  mode === "quick_trade"
                    ? "bg-green-500/10 border-green-500 text-green-600 dark:text-green-400"
                    : "bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"
                }`}
              >
                <Zap size={20} className="mb-2" />
                <p className="font-bold text-sm">Quick Trade</p>
                <p className="text-xs mt-1 opacity-80">AI signals for Pocket Option/Expert Option — you tap Won/Lost</p>
              </button>
            </div>
          </div>

          {/* Account */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
            <h3 className="font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
              <ShieldCheck size={18} /> Account
            </h3>
            <div className="flex items-center bg-slate-100 dark:bg-slate-950/50 rounded-xl p-1 mb-4">
              <button
                onClick={() => setAccountType("demo")}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-semibold transition ${
                  accountType === "demo" ? "bg-green-500 text-slate-950" : "text-slate-500 dark:text-slate-400"
                }`}
              >
                Demo
              </button>
              <button
                onClick={() => setAccountType("real")}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-semibold transition ${
                  accountType === "real" ? "bg-red-500 text-white" : "text-slate-500 dark:text-slate-400"
                }`}
              >
                Real
              </button>
            </div>

            {mode === "quick_trade" ? (
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={accountReady}
                  onChange={(e) => setAccountReady(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-green-500 flex-shrink-0"
                />
                <span className="text-sm text-slate-600 dark:text-slate-300">
                  I have a Pocket Option or Expert Option account open and ready to trade
                </span>
              </label>
            ) : (
              <p className="text-xs text-slate-400 dark:text-slate-500">
                Requires your MT5 EA to have connected at least once — set it up on the{" "}
                <Link to="/mt5" className="text-green-600 dark:text-green-400 hover:underline">MT5 page</Link> first if you haven't.
              </p>
            )}
          </div>

          {/* Goal */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
            <h3 className="font-bold text-slate-900 dark:text-white mb-4">Set Your Goal</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1.5">
                  <Target size={12} /> Profit Target ($)
                </label>
                <input
                  type="number"
                  value={profitTarget}
                  onChange={(e) => setProfitTarget(e.target.value)}
                  className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 rounded-xl outline-none focus:border-green-500 transition text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1.5">
                  <ShieldAlert size={12} /> Risk Limit ($)
                </label>
                <input
                  type="number"
                  value={riskLimit}
                  onChange={(e) => setRiskLimit(e.target.value)}
                  className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 rounded-xl outline-none focus:border-green-500 transition text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1.5">
                  <Hash size={12} /> Max Trades
                </label>
                <input
                  type="number"
                  value={maxTrades}
                  onChange={(e) => setMaxTrades(e.target.value)}
                  className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 rounded-xl outline-none focus:border-green-500 transition text-slate-900 dark:text-white"
                />
              </div>
            </div>

            {mode === "quick_trade" && (
              <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-slate-200 dark:border-slate-800">
                <div>
                  <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Stake per trade ($)</label>
                  <input
                    type="number"
                    value={stake}
                    onChange={(e) => setStake(e.target.value)}
                    className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 rounded-xl outline-none focus:border-green-500 transition text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Payout (%)</label>
                  <input
                    type="number"
                    value={payoutPercent}
                    onChange={(e) => setPayoutPercent(e.target.value)}
                    className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 rounded-xl outline-none focus:border-green-500 transition text-slate-900 dark:text-white"
                  />
                </div>
                <p className="col-span-2 text-xs text-slate-400 dark:text-slate-500">
                  Set once — after this, logging each trade is a single tap (Won/Lost) and the app calculates your P&amp;L automatically.
                </p>
              </div>
            )}
          </div>

          {/* Pairs */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
            <h3 className="font-bold text-slate-900 dark:text-white mb-1">Focus Pairs</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Optional — leave empty to let the AI pick.</p>
            <div className="flex flex-wrap gap-2">
              {[...FOREX_PAIRS, ...CRYPTO_PAIRS].map((pair) => (
                <button
                  key={pair}
                  onClick={() => togglePair(pair)}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold transition ${
                    selectedPairs.includes(pair)
                      ? "bg-green-500 text-slate-950"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  {pair}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl p-3 text-sm">
              {error}
              {errorCode === "mt5_not_connected" && (
                <>
                  {" "}
                  <Link to="/mt5" className="underline font-semibold">Go to MT5 setup →</Link>
                </>
              )}
            </div>
          )}

          <button
            onClick={startSession}
            disabled={starting}
            className="w-full bg-green-500 hover:bg-green-600 disabled:opacity-50 text-slate-950 font-bold py-4 rounded-xl transition flex items-center justify-center gap-2"
          >
            {starting
              ? <div className="w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
              : <><Zap size={18} /> Start Session</>
            }
          </button>
        </div>
      )}

      {session && (
        <div className="max-w-2xl space-y-6">
          {isFinished && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 text-center">
              <p className={`text-xl font-bold mb-1 ${STATUS_LABELS[session.status]?.color}`}>
                {STATUS_LABELS[session.status]?.text || "Session stopped"}
              </p>
              <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">
                Final P&amp;L: <span className={progress.currentPL >= 0 ? "text-green-500" : "text-red-500"}>
                  {progress.currentPL >= 0 ? "+" : ""}${progress.currentPL.toFixed(2)}
                </span> across {progress.tradeCount} trade{progress.tradeCount === 1 ? "" : "s"}
              </p>
              <button
                onClick={startNewSession}
                className="bg-green-500 hover:bg-green-600 text-slate-950 font-bold px-8 py-3 rounded-xl transition"
              >
                Start New Session
              </button>
            </div>
          )}

          {/* Live progress */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                {session.mode === "mt5" ? <Bot size={18} /> : <Zap size={18} />}
                {session.mode === "mt5" ? "MT5 Auto-Trade" : "Quick Trade"} Session
              </h3>
              {!isFinished && (
                <button
                  onClick={stopSession}
                  disabled={stopping}
                  className="flex items-center gap-1.5 text-xs font-semibold text-red-500 dark:text-red-400 hover:text-red-600 disabled:opacity-50 transition"
                >
                  <StopCircle size={14} /> {stopping ? "Stopping..." : "Stop Session"}
                </button>
              )}
            </div>

            {/* Profit progress bar */}
            <div className="mb-4">
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1"><Target size={12} /> Profit</span>
                <span className="text-slate-900 dark:text-white font-mono">
                  ${Math.max(progress.currentPL, 0).toFixed(2)} / ${session.profitTarget}
                </span>
              </div>
              <div className="h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 transition-all"
                  style={{ width: `${Math.min(Math.max(progress.currentPL, 0) / session.profitTarget * 100, 100)}%` }}
                />
              </div>
            </div>

            {/* Risk progress bar */}
            <div className="mb-4">
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1"><ShieldAlert size={12} /> Risk</span>
                <span className="text-slate-900 dark:text-white font-mono">
                  ${Math.max(-progress.currentPL, 0).toFixed(2)} / ${session.riskLimit}
                </span>
              </div>
              <div className="h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-red-500 transition-all"
                  style={{ width: `${Math.min(Math.max(-progress.currentPL, 0) / session.riskLimit * 100, 100)}%` }}
                />
              </div>
            </div>

            {/* Trade count */}
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
              <span className="flex items-center gap-1"><Hash size={12} /> Trades</span>
              <span className="text-slate-900 dark:text-white font-mono">
                {progress.tradeCount} / {session.maxTrades}
              </span>
            </div>
            <div className="h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all"
                style={{ width: `${Math.min(progress.tradeCount / session.maxTrades * 100, 100)}%` }}
              />
            </div>
          </div>

          {/* Session trades */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <LineChart size={16} /> Session Trades
              </h3>
            </div>
            {sessionTrades.length === 0 ? (
              <p className="text-center text-slate-400 dark:text-slate-600 text-sm py-10">
                No trades logged in this session yet
              </p>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {sessionTrades.map((t) => (
                  <div key={t._id} className="px-5 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {t.direction === "buy"
                        ? <TrendingUp size={14} className="text-green-500" />
                        : <TrendingDown size={14} className="text-red-500" />
                      }
                      <span className="font-semibold text-sm text-slate-900 dark:text-white">{t.pair}</span>
                      {t.outcome === "win" && <CheckCircle size={14} className="text-green-500" />}
                      {t.outcome === "loss" && <XCircle size={14} className="text-red-500" />}
                    </div>
                    <span className={`text-sm font-mono font-semibold ${
                      Number(t.profitLoss) >= 0 ? "text-green-500" : "text-red-500"
                    }`}>
                      {Number(t.profitLoss) >= 0 ? "+" : ""}${Number(t.profitLoss || 0).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </MainLayout>
  );
}

export default TradingSession;
