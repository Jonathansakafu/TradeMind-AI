import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import MainLayout from "../layouts/MainLayout";
import {
  TrendingUp, TrendingDown, PlusCircle,
  Activity, Eye, EyeOff, ExternalLink
} from "lucide-react";
import { API_URL } from "../config/api";
import PriceTicker from "../components/PriceTicker";
import BrokerModal from "../components/BrokerModal";

function Dashboard() {
  const navigate = useNavigate();
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showPL, setShowPL] = useState(false);
  const [showBrokers, setShowBrokers] = useState(false);
  const token = localStorage.getItem("token");

  useEffect(() => {
    axios
      .get(`${API_URL}/api/trades?limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => setTrades(res.data.trades || []))
      .catch((err) => console.log(err))
      .finally(() => setLoading(false));
  }, []);

  const closedTrades = trades.filter((t) => t.outcome);
  const wins = trades.filter((t) => t.outcome === "win").length;
  const losses = trades.filter((t) => t.outcome === "loss").length;
  const winRate = closedTrades.length > 0
    ? Math.round((wins / closedTrades.length) * 100)
    : 0;
  const totalPL = trades.reduce((sum, t) => sum + (Number(t.profitLoss) || 0), 0);
  const recentTrades = trades.slice(0, 6);

  if (loading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>

      {/* HEADER */}
      <div className="flex flex-wrap justify-between items-center mb-8 gap-4">
        <div>
          <h2 className="text-3xl md:text-4xl font-bold">Trading Dashboard</h2>
          <p className="text-slate-400 mt-1">Manage your forex trades with AI</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">

          {/* MT5 Broker Selector */}
          <button
            onClick={() => setShowBrokers(true)}
            className="flex items-center gap-2 bg-slate-800 border border-slate-700 hover:border-green-500/50 px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-300 hover:text-white transition"
          >
            <ExternalLink size={16} className="text-green-400" />
            Open MT5
          </button>
          <BrokerModal open={showBrokers} onClose={() => setShowBrokers(false)} />

          <button
            onClick={() => navigate("/add-trade")}
            className="flex items-center gap-2 bg-green-500 hover:bg-green-600 px-4 py-2.5 rounded-xl font-semibold transition text-slate-950 text-sm"
          >
            <PlusCircle size={16} />
            Add Trade
          </button>
        </div>
      </div>

      {/* STATS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-slate-900 p-5 rounded-2xl shadow-lg border border-slate-800">
          <h3 className="text-slate-400 mb-2 text-sm">Total Trades</h3>
          <p className="text-3xl font-bold">{trades.length}</p>
        </div>
        <div className="bg-slate-900 p-5 rounded-2xl shadow-lg border border-slate-800">
          <h3 className="text-slate-400 mb-2 text-sm">Wins</h3>
          <p className="text-3xl font-bold text-green-400">{wins}</p>
        </div>
        <div className="bg-slate-900 p-5 rounded-2xl shadow-lg border border-slate-800">
          <h3 className="text-slate-400 mb-2 text-sm">Losses</h3>
          <p className="text-3xl font-bold text-red-400">{losses}</p>
        </div>
        <div className="bg-slate-900 p-5 rounded-2xl shadow-lg border border-slate-800">
          <h3 className="text-slate-400 mb-2 text-sm">Win Rate</h3>
          <p className={`text-3xl font-bold ${winRate >= 50 ? "text-green-400" : "text-red-400"}`}>
            {winRate}%
          </p>
        </div>
      </div>

      {/* TOTAL P&L — Hidden by default */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-slate-400 mb-1 text-sm">Total Profit / Loss</h3>
            {showPL ? (
              <p className={`text-4xl font-bold ${totalPL >= 0 ? "text-green-400" : "text-red-400"}`}>
                {totalPL >= 0 ? "+" : ""}${totalPL.toFixed(2)}
              </p>
            ) : (
              <p className="text-4xl font-bold text-slate-600 tracking-widest">
                ••••••
              </p>
            )}
          </div>
          <button
            onClick={() => setShowPL(!showPL)}
            className="p-3 rounded-xl bg-slate-800 border border-slate-700 hover:border-green-500/50 transition text-slate-400 hover:text-white"
            title={showPL ? "Hide P&L" : "Show P&L"}
          >
            {showPL ? <EyeOff size={20} /> : <Eye size={20} />}
          </button>
        </div>
      </div>

      {/* LIVE MARKET TICKER */}
      <PriceTicker />

      {/* RECENT TRADES */}
      <div className="bg-slate-900 p-6 rounded-2xl overflow-x-auto border border-slate-800">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-2xl font-bold">Recent Trades</h3>
          <Link to="/history" className="text-green-400 text-sm hover:underline">
            View all →
          </Link>
        </div>

        {recentTrades.length === 0 ? (
          <div className="text-center py-12">
            <Activity size={40} className="text-slate-700 mx-auto mb-3" />
            <p className="text-slate-500">No trades yet</p>
            <button
              onClick={() => navigate("/add-trade")}
              className="text-green-400 text-sm mt-2 inline-block hover:underline"
            >
              Add your first trade →
            </button>
          </div>
        ) : (
          <>
            {/* Mobile card list */}
            <div className="sm:hidden space-y-3">
              {recentTrades.map((trade, index) => (
                <div key={index} className="bg-slate-800/50 border border-slate-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{trade.pair}</span>
                      <span className={`flex items-center gap-1 text-xs ${
                        trade.direction === "buy" ? "text-green-400" : "text-red-400"
                      }`}>
                        {trade.direction === "buy" ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                        {trade.direction || "—"}
                      </span>
                    </div>
                    <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                      trade.outcome === "win" ? "bg-green-500/10 text-green-400"
                      : trade.outcome === "loss" ? "bg-red-500/10 text-red-400"
                      : "bg-slate-700 text-slate-400"
                    }`}>
                      {trade.outcome?.toUpperCase() || "OPEN"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-400 font-mono">
                      {trade.entryPrice || "—"} → {trade.exitPrice || "—"}
                    </span>
                    {showPL ? (
                      <span className={`font-semibold ${
                        Number(trade.profitLoss) >= 0 ? "text-green-400" : "text-red-400"
                      }`}>
                        {Number(trade.profitLoss) >= 0 ? "+" : ""}
                        ${Number(trade.profitLoss || 0).toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-slate-600 font-mono tracking-widest">••••</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <table className="w-full hidden sm:table">
              <thead>
                <tr className="text-left text-slate-400 border-b border-slate-700">
                  <th className="pb-4 text-sm font-medium">Pair</th>
                  <th className="pb-4 text-sm font-medium">Direction</th>
                  <th className="pb-4 text-sm font-medium">Entry</th>
                  <th className="pb-4 text-sm font-medium">Exit</th>
                  <th className="pb-4 text-sm font-medium">Result</th>
                  <th className="pb-4 text-sm font-medium text-right">P&L</th>
                </tr>
              </thead>
              <tbody>
                {recentTrades.map((trade, index) => (
                  <tr
                    key={index}
                    className="border-b border-slate-800 hover:bg-slate-800/40 transition"
                  >
                    <td className="py-4 font-semibold">{trade.pair}</td>
                    <td className="py-4">
                      <span className={`flex items-center gap-1.5 ${
                        trade.direction === "buy" ? "text-green-400" : "text-red-400"
                      }`}>
                        {trade.direction === "buy"
                          ? <TrendingUp size={14} />
                          : <TrendingDown size={14} />
                        }
                        {trade.direction || "—"}
                      </span>
                    </td>
                    <td className="py-4 text-slate-300 font-mono text-sm">
                      {trade.entryPrice || "—"}
                    </td>
                    <td className="py-4 text-slate-300 font-mono text-sm">
                      {trade.exitPrice || "—"}
                    </td>
                    <td className="py-4">
                      <span className={`px-3 py-1 rounded-lg text-xs font-semibold ${
                        trade.outcome === "win" ? "bg-green-500/10 text-green-400"
                        : trade.outcome === "loss" ? "bg-red-500/10 text-red-400"
                        : "bg-slate-700 text-slate-400"
                      }`}>
                        {trade.outcome?.toUpperCase() || "OPEN"}
                      </span>
                    </td>
                    <td className="py-4 text-right">
                      {showPL ? (
                        <span className={`font-semibold ${
                          Number(trade.profitLoss) >= 0 ? "text-green-400" : "text-red-400"
                        }`}>
                          {Number(trade.profitLoss) >= 0 ? "+" : ""}
                          ${Number(trade.profitLoss || 0).toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-slate-600 font-mono tracking-widest">••••</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

    </MainLayout>
  );
}

export default Dashboard;