import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import MainLayout from "../layouts/MainLayout";
import { Brain, TrendingUp, TrendingDown, RefreshCw, AlertTriangle, Target, DollarSign, Activity, Zap }
from "lucide-react";
import { API_URL } from "../config/api";

const FOREX_PAIRS = [
  "EURUSD","GBPUSD","USDJPY","XAUUSD",
  "AUDUSD","USDCAD","NZDUSD","GBPJPY",
  "EURJPY","USDCHF",
];

const CRYPTO_PAIRS = [
  "BTCUSD","ETHUSD","XRPUSD","BNBUSD",
  "SOLUSD","ADAUSD","DOGEUSD","LTCUSD",
];

function LiveAnalysis() {
  const navigate = useNavigate();
  const [prices, setPrices] = useState({});
  const [pricesLoading, setPricesLoading] = useState(true);
  const [selectedPair, setSelectedPair] = useState("EURUSD");
  const [analysis, setAnalysis] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [activeTab, setActiveTab] = useState("forex");
  const token = localStorage.getItem("token");
  const headers = { Authorization: `Bearer ${token}` };


  const fetchPrices = async () => {
    try {
      const res = await axios.get(
        `${API_URL}/api/market/prices`,
        { headers }
      );
      setPrices(res.data.prices || {});
      setLastUpdated(new Date());
    } catch (err) {
      console.error(err);
    } finally {
      setPricesLoading(false);
    }
  };

  useEffect(() => {
    fetchPrices();
    const interval = setInterval(fetchPrices, 60000);
    return () => clearInterval(interval);
  }, []);

  const analyzePair = async (pair) => {
    setSelectedPair(pair);
    setAnalysisLoading(true);
    setAnalysis(null);
    try {
      const res = await axios.get(
        `${API_URL}/api/market/analyze/${pair}`,
        { headers }
      );
      setAnalysis(res.data);
    } catch (err) {
      alert(err.response?.data?.message || "Analysis failed");
    } finally {
      setAnalysisLoading(false);
    }
  };

  const recordTradeFromSignal = () => {
    if (!analysis) return;
    navigate("/add-trade", {
      state: {
        signal: {
          pair: analysis.pair,
          signal: analysis.analysis?.signal,
          entry: analysis.analysis?.entry,
          stopLoss: analysis.analysis?.stopLoss,
          takeProfit: analysis.analysis?.takeProfit,
          reasoning: analysis.analysis?.reasoning,
          sourceLabel: "Live Analysis — AI Signal",
        }
      }
    });
  };

  const getSignalColor = (signal) => {
    if (signal === "buy") return "text-green-400";
    if (signal === "sell") return "text-red-400";
    return "text-yellow-400";
  };

  const getSignalBg = (signal) => {
    if (signal === "buy") return "bg-green-500/10 border-green-500/30";
    if (signal === "sell") return "bg-red-500/10 border-red-500/30";
    return "bg-yellow-500/10 border-yellow-500/30";
  };

  const getSignalIcon = (signal) => {
    if (signal === "buy") return <TrendingUp size={24} className="text-green-400" />;
    if (signal === "sell") return <TrendingDown size={24} className="text-red-400" />;
    return <Activity size={24} className="text-yellow-400" />;
  };

  const formatPrice = (pair, price) => {
    if (!price) return "—";
    if (CRYPTO_PAIRS.includes(pair)) {
      return price > 1000
        ? `$${price.toLocaleString()}`
        : `$${price.toFixed(4)}`;
    }
    return ["USDJPY","GBPJPY","EURJPY","AUDJPY","CADJPY"].includes(pair)
      ? price.toFixed(3)
      : price.toFixed(5);
  };

  const displayPairs = activeTab === "forex" ? FOREX_PAIRS : CRYPTO_PAIRS;
const [mt5Loading, setMt5Loading] = useState(false);
const [mt5Success, setMt5Success] = useState(false);

const sendToMT5 = async (analysisData) => {
  setMt5Loading(true);
  setMt5Success(false);
  try {
    await axios.post(
      `${API_URL}/api/mt5/signal`,
      {
        pair: analysisData.pair,
        action: analysisData.analysis?.signal,
        entry: analysisData.analysis?.entry,
        stopLoss: analysisData.analysis?.stopLoss,
        takeProfit: analysisData.analysis?.takeProfit,
        lotSize: 0.01,
        confidence: analysisData.analysis?.confidence,
        source: "live_analysis",
        sourceLabel: "Live Analysis Signal",
        reasoning: analysisData.analysis?.reasoning,
        accountType: localStorage.getItem("mt5AccountType") || "demo",
      },
      { headers }
    );
    setMt5Success(true);
    setTimeout(() => setMt5Success(false), 5000);
  } catch {
    alert("Failed to send signal to MT5");
  } finally {
    setMt5Loading(false);
  }
};
  return (
    <MainLayout>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-3xl md:text-4xl font-bold">Live Market Analysis</h2>
          <p className="text-slate-400 mt-2">
            AI analyzes live market and compares with your trading history
          </p>
        </div>
        <button
          onClick={fetchPrices}
          className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-4 py-2.5 rounded-xl text-sm text-slate-400 hover:text-white transition"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab("forex")}
          className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition ${
            activeTab === "forex"
              ? "bg-green-500 text-slate-950"
              : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-white"
          }`}
        >
          💱 Forex Pairs
        </button>
        <button
          onClick={() => setActiveTab("crypto")}
          className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition flex items-center gap-2 ${
            activeTab === "crypto"
              ? "bg-green-500 text-slate-950"
              : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-white"
          }`}
        >
          ₿ Crypto
          <span className="text-xs bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded-md">
            24/7
          </span>
        </button>
      </div>

      {/* Prices Grid */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-300">
            {activeTab === "forex"
              ? "Live Prices — Click pair for AI Analysis"
              : "Crypto Prices — Available 24/7 including weekends"}
          </h3>
          {lastUpdated && (
            <p className="text-xs text-slate-500">
              Updated: {lastUpdated.toLocaleTimeString()}
            </p>
          )}
        </div>

        {pricesLoading ? (
          <div className="flex justify-center py-10">
            <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {displayPairs.map((pair) => {
              const price = prices[pair];
              const isSelected = selectedPair === pair;
              const isCrypto = CRYPTO_PAIRS.includes(pair);
              return (
                <button
                  key={pair}
                  onClick={() => analyzePair(pair)}
                  className={`p-4 rounded-xl border text-left transition ${
                    isSelected
                      ? "bg-green-500/10 border-green-500/50"
                      : "bg-slate-900 border-slate-800 hover:border-slate-600"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <p className={`text-xs font-semibold ${
                      isSelected ? "text-green-400" : "text-slate-400"
                    }`}>
                      {isCrypto
                        ? pair.replace("USD", "/USD")
                        : `${pair.slice(0, 3)}/${pair.slice(3)}`}
                    </p>
                    {isCrypto && (
                      <span className="text-xs text-green-400 font-bold">24/7</span>
                    )}
                  </div>
                  <p className="text-base font-bold font-mono">
                    {formatPrice(pair, price)}
                  </p>
                  {isSelected && (
                    <p className="text-xs text-green-400 mt-1">Selected ✓</p>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* AI Analysis */}
      {analysisLoading ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 flex flex-col items-center justify-center gap-4">
          <div className="w-12 h-12 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-400">AI is analyzing {selectedPair}...</p>
        </div>
      ) : analysis ? (
        <div className="space-y-6">

          {/* Main Signal */}
          <div className={`rounded-2xl p-6 border ${getSignalBg(analysis.analysis?.signal)}`}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                {getSignalIcon(analysis.analysis?.signal)}
                <div>
                  <p className={`text-2xl md:text-3xl font-bold ${getSignalColor(analysis.analysis?.signal)}`}>
                    {analysis.analysis?.signal?.toUpperCase() === "BUY"
                      ? "🟢 BUY SIGNAL"
                      : analysis.analysis?.signal?.toUpperCase() === "SELL"
                      ? "🔴 SELL SIGNAL"
                      : "⚠️ WAIT — No Clear Signal"}
                  </p>
                  <p className="text-slate-400 text-sm mt-1">
                    {analysis.pair} — Current Price:{" "}
                    <span className="font-mono font-bold text-white">
                      {formatPrice(analysis.pair, analysis.currentPrice)}
                    </span>
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-400 mb-1">AI Confidence</p>
                <p className={`text-3xl md:text-4xl font-bold ${getSignalColor(analysis.analysis?.signal)}`}>
                  {analysis.analysis?.confidence}%
                </p>
              </div>
            </div>
            <p className="text-slate-300 text-sm leading-relaxed bg-slate-800/50 rounded-xl p-4">
              {analysis.analysis?.reasoning}
            </p>
          </div>

          {/* Entry SL TP */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Target size={16} className="text-blue-400" />
                <p className="text-xs text-slate-400 font-semibold">ENTRY</p>
              </div>
              <p className="text-xl font-bold font-mono text-white">
                {analysis.analysis?.entry || "—"}
              </p>
              <p className="text-xs text-slate-500 mt-1">Suggested entry</p>
            </div>
            <div className="bg-slate-900 border border-red-500/20 rounded-2xl p-5 text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <AlertTriangle size={16} className="text-red-400" />
                <p className="text-xs text-slate-400 font-semibold">STOP LOSS</p>
              </div>
              <p className="text-xl font-bold font-mono text-red-400">
                {analysis.analysis?.stopLoss || "—"}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {analysis.analysis?.pipsToSL} pips risk
              </p>
            </div>
            <div className="bg-slate-900 border border-green-500/20 rounded-2xl p-5 text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <DollarSign size={16} className="text-green-400" />
                <p className="text-xs text-slate-400 font-semibold">TAKE PROFIT</p>
              </div>
              <p className="text-xl font-bold font-mono text-green-400">
                {analysis.analysis?.takeProfit || "—"}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {analysis.analysis?.pipsToTP} pips reward
              </p>
            </div>
          </div>

          {/* Market Info + History Match */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
              <p className="text-xs text-slate-400 mb-3 font-semibold">📊 MARKET INFO</p>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-400 text-sm">Risk/Reward</span>
                  <span className="font-semibold text-white">
                    {analysis.analysis?.riskRewardRatio || "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 text-sm">Market Condition</span>
                  <span className="font-semibold text-white capitalize">
                    {analysis.analysis?.marketCondition || "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 text-sm">Best Time</span>
                  <span className="font-semibold text-white">
                    {analysis.analysis?.bestTimeToTrade || "—"}
                  </span>
                </div>
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
              <p className="text-xs text-slate-400 mb-3 font-semibold">🧠 HISTORY MATCH</p>
              <p className="text-sm text-slate-300 leading-relaxed">
                {analysis.analysis?.historicalMatch ||
                  "Add more trades to get personalized historical match"}
              </p>
            </div>
          </div>

          {/* Warnings */}
          {analysis.analysis?.warnings?.length > 0 && (
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-2xl p-5">
              <p className="text-xs text-yellow-400 mb-3 font-semibold flex items-center gap-2">
                <AlertTriangle size={14} /> WARNINGS
              </p>
              {analysis.analysis.warnings.map((w, i) => (
                <p key={i} className="text-sm text-yellow-300 mb-1">• {w}</p>
              ))}
            </div>
          )}

          {/* Record Trade Button — Auto fills form */}
{analysis.analysis?.signal !== "wait" && (
  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
    <p className="text-sm text-slate-400 mb-1">
      Take action on this signal
    </p>
    <p className="text-xs text-slate-500 mb-4">
      Record manually or send to MT5 for auto execution
    </p>
    <div className="flex gap-3 flex-wrap">
      <button
        onClick={recordTradeFromSignal}
        className="flex items-center gap-2 bg-slate-800 border border-slate-700 hover:border-green-500/50 text-white font-semibold px-5 py-3 rounded-xl transition text-sm"
      >
        <TrendingUp size={16} className="text-green-400" />
        Record Manually
      </button>
      <button
        onClick={() => sendToMT5(analysis)}
        disabled={mt5Loading}
        className="flex items-center gap-2 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-slate-950 font-bold px-5 py-3 rounded-xl transition text-sm"
      >
        <Zap size={16} />
        {mt5Loading ? "Sending..." : "Send to MT5 ⚡"}
      </button>
    </div>
    {mt5Success && (
      <div className="mt-3 bg-green-500/10 border border-green-500/20 rounded-xl p-3">
        <p className="text-green-400 text-sm font-semibold">
          ✅ Signal sent to MT5! EA will execute within 10 seconds.
        </p>
      </div>
    )}
  </div>
)}
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center">
          <Brain size={48} className="text-slate-700 mx-auto mb-4" />
          <p className="text-slate-400 text-lg">
            Click any pair above to get AI analysis
          </p>
          <p className="text-slate-600 text-sm mt-2">
            AI will analyze live price and compare with your trading history
          </p>
          {activeTab === "crypto" && (
            <div className="mt-4 bg-green-500/10 border border-green-500/20 rounded-xl p-3 inline-block">
              <p className="text-green-400 text-sm">
                ✅ Crypto markets are open 24/7 — including weekends!
              </p>
            </div>
          )}
        </div>
      )}

    </MainLayout>
  );
}

export default LiveAnalysis;