import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import axios from "axios";
import MainLayout from "../layouts/MainLayout";
import {
  TrendingUp, TrendingDown, PlusCircle,
  Activity, Eye, EyeOff, ExternalLink
} from "lucide-react";
import { API_URL } from "../config/api";
import { computeStats } from "../utils/tradeStats";
import PriceTicker from "../components/PriceTicker";
import BrokerModal from "../components/BrokerModal";
import SessionBanner from "../components/SessionBanner";
import SpeakButton from "../components/SpeakButton";
import { useAuth } from "../hooks/useAuth";

function Dashboard() {
  const { t } = useTranslation(["dashboard", "common"]);
  const navigate = useNavigate();
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showPL, setShowPL] = useState(false);
  const [showBrokers, setShowBrokers] = useState(false);
  const { headers } = useAuth();

  useEffect(() => {
    axios
      // Same trade set as the Performance page (was the latest 100 only),
      // so both always show the same win rate.
      .get(`${API_URL}/api/trades?limit=2000`, { headers })
      .then((res) => setTrades(res.data.trades || []))
      .catch((err) => console.log(err))
      .finally(() => setLoading(false));
  }, [headers]);

  // One calculation shared with the Performance page (utils/tradeStats.js)
  // so the two screens can't disagree.
  const { wins, losses, breakeven, closed, winRate, totalPL, recentTrades } = useMemo(() => {
    const s = computeStats(trades);
    return {
      wins: s.wins,
      losses: s.losses,
      breakeven: s.breakeven,
      closed: s.closed,
      winRate: Math.round(s.winRate),
      totalPL: trades.reduce((sum, t) => sum + (Number(t.profitLoss) || 0), 0),
      recentTrades: trades.slice(0, 6),
    };
  }, [trades]);

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

      <SessionBanner className="mb-6" />

      {/* HEADER */}
      <div className="flex flex-wrap justify-between items-center mb-8 gap-4">
        <div>
          <h2 className="text-3xl md:text-4xl font-bold flex items-center gap-2">
            {t("title", { ns: "dashboard" })}
            <SpeakButton text={`${t("title", { ns: "dashboard" })}. ${t("subtitle", { ns: "dashboard" })}`} />
          </h2>
          <p className="text-slate-500 dark:text-slate-400 mt-1">{t("subtitle", { ns: "dashboard" })}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">

          {/* MT5 Broker Selector */}
          <button
            onClick={() => setShowBrokers(true)}
            className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-green-500/50 px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition"
          >
            <ExternalLink size={16} className="text-green-600 dark:text-green-400" />
            {t("openMT5", { ns: "dashboard" })}
          </button>
          <BrokerModal open={showBrokers} onClose={() => setShowBrokers(false)} />

          <button
            onClick={() => navigate("/add-trade")}
            className="flex items-center gap-2 bg-green-500 hover:bg-green-600 px-4 py-2.5 rounded-xl font-semibold transition text-slate-950 text-sm"
          >
            <PlusCircle size={16} />
            {t("addTrade", { ns: "dashboard" })}
          </button>
        </div>
      </div>

      {/* STATS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {/* Each card opens the matching view: trade history (all / wins /
            losses) or, for win rate, the Performance statistics page. */}
        <Link to="/history" className="block bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-800 hover:border-green-500/50 hover:-translate-y-0.5 transition">
          <h3 className="text-slate-500 dark:text-slate-400 mb-2 text-sm">{t("stats.totalTrades", { ns: "dashboard" })}</h3>
          <p className="text-3xl font-bold">{trades.length}</p>
        </Link>
        <Link to="/history?filter=win" className="block bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-800 hover:border-green-500/50 hover:-translate-y-0.5 transition">
          <h3 className="text-slate-500 dark:text-slate-400 mb-2 text-sm">{t("stats.wins", { ns: "dashboard" })}</h3>
          <p className="text-3xl font-bold text-green-400">{wins}</p>
        </Link>
        <Link to="/history?filter=loss" className="block bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-800 hover:border-green-500/50 hover:-translate-y-0.5 transition">
          <h3 className="text-slate-500 dark:text-slate-400 mb-2 text-sm">{t("stats.losses", { ns: "dashboard" })}</h3>
          <p className="text-3xl font-bold text-red-400">{losses}</p>
        </Link>
        <Link to="/performance" className="block bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-800 hover:border-green-500/50 hover:-translate-y-0.5 transition">
          <h3 className="text-slate-500 dark:text-slate-400 mb-2 text-sm">{t("stats.winRate", { ns: "dashboard" })}</h3>
          <p className={`text-3xl font-bold ${winRate >= 50 ? "text-green-400" : "text-red-400"}`}>
            {winRate}%
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {wins} W · {losses} L{breakeven ? ` · ${breakeven} BE` : ""} of {closed} closed
          </p>
        </Link>
      </div>

      {/* TOTAL P&L — Hidden by default */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-slate-500 dark:text-slate-400 mb-1 text-sm">{t("totalPL", { ns: "dashboard" })}</h3>
            {showPL ? (
              <p className={`text-4xl font-bold ${totalPL >= 0 ? "text-green-400" : "text-red-400"}`}>
                {totalPL >= 0 ? "+" : ""}${totalPL.toFixed(2)}
              </p>
            ) : (
              <p className="text-4xl font-bold text-slate-400 dark:text-slate-600 tracking-widest">
                ••••••
              </p>
            )}
          </div>
          <button
            onClick={() => setShowPL(!showPL)}
            className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-green-500/50 transition text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            title={showPL ? t("hidePL", { ns: "dashboard" }) : t("showPL", { ns: "dashboard" })}
            aria-label={showPL ? t("hidePL", { ns: "dashboard" }) : t("showPL", { ns: "dashboard" })}
          >
            {showPL ? <EyeOff size={20} /> : <Eye size={20} />}
          </button>
        </div>
      </div>

      {/* LIVE MARKET TICKER */}
      <PriceTicker />

      {/* RECENT TRADES */}
      <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl overflow-x-auto border border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-2xl font-bold">{t("recentTrades", { ns: "dashboard" })}</h3>
          <Link to="/history" className="text-green-600 dark:text-green-400 text-sm hover:underline">
            {t("viewAll", { ns: "dashboard" })}
          </Link>
        </div>

        {recentTrades.length === 0 ? (
          <div className="text-center py-12">
            <Activity size={40} className="text-slate-300 dark:text-slate-700 mx-auto mb-3" />
            <p className="text-slate-400 dark:text-slate-500">{t("noTradesYet", { ns: "dashboard" })}</p>
            <button
              onClick={() => navigate("/add-trade")}
              className="text-green-600 dark:text-green-400 text-sm mt-2 inline-block hover:underline"
            >
              {t("addFirstTrade", { ns: "dashboard" })}
            </button>
          </div>
        ) : (
          <>
            {/* Mobile card list */}
            <div className="sm:hidden space-y-3">
              {recentTrades.map((trade, index) => (
                <div key={index} className="bg-slate-100/70 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
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
                      : "bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
                    }`}>
                      {trade.outcome?.toUpperCase() || t("table.open", { ns: "dashboard" })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500 dark:text-slate-400 font-mono">
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
                      <span className="text-slate-400 dark:text-slate-600 font-mono tracking-widest">••••</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <table className="w-full hidden sm:table">
              <thead>
                <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                  <th className="pb-4 pr-4 text-sm font-medium whitespace-nowrap">{t("table.pair", { ns: "dashboard" })}</th>
                  <th className="pb-4 pr-4 text-sm font-medium whitespace-nowrap">{t("table.direction", { ns: "dashboard" })}</th>
                  <th className="pb-4 pr-4 text-sm font-medium whitespace-nowrap">{t("table.entry", { ns: "dashboard" })}</th>
                  <th className="pb-4 pr-4 text-sm font-medium whitespace-nowrap">{t("table.exit", { ns: "dashboard" })}</th>
                  <th className="pb-4 pr-4 text-sm font-medium whitespace-nowrap">{t("table.result", { ns: "dashboard" })}</th>
                  <th className="pb-4 pr-4 text-sm font-medium whitespace-nowrap text-right">{t("table.pl", { ns: "dashboard" })}</th>
                </tr>
              </thead>
              <tbody>
                {recentTrades.map((trade, index) => (
                  <tr
                    key={index}
                    className="border-b border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800/40 transition"
                  >
                    <td className="py-4 pr-4 whitespace-nowrap font-semibold">{trade.pair}</td>
                    <td className="py-4 pr-4 whitespace-nowrap">
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
                    <td className="py-4 pr-4 whitespace-nowrap text-slate-700 dark:text-slate-300 font-mono text-sm">
                      {trade.entryPrice || "—"}
                    </td>
                    <td className="py-4 pr-4 whitespace-nowrap text-slate-700 dark:text-slate-300 font-mono text-sm">
                      {trade.exitPrice || "—"}
                    </td>
                    <td className="py-4 pr-4 whitespace-nowrap">
                      <span className={`px-3 py-1 rounded-lg text-xs font-semibold ${
                        trade.outcome === "win" ? "bg-green-500/10 text-green-400"
                        : trade.outcome === "loss" ? "bg-red-500/10 text-red-400"
                        : "bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
                      }`}>
                        {trade.outcome?.toUpperCase() || t("table.open", { ns: "dashboard" })}
                      </span>
                    </td>
                    <td className="py-4 pr-4 whitespace-nowrap text-right">
                      {showPL ? (
                        <span className={`font-semibold ${
                          Number(trade.profitLoss) >= 0 ? "text-green-400" : "text-red-400"
                        }`}>
                          {Number(trade.profitLoss) >= 0 ? "+" : ""}
                          ${Number(trade.profitLoss || 0).toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-600 font-mono tracking-widest">••••</span>
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