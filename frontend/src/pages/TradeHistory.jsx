import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import MainLayout from "../layouts/MainLayout";
import {
  TrendingUp, TrendingDown, Search, Download,
  X, CheckCircle, RefreshCw, LineChart
} from "lucide-react";
import { API_URL } from "../config/api";
import PriceTicker from "../components/PriceTicker";

const PIP_DECIMALS = {
  USDJPY: 100, GBPJPY: 100, EURJPY: 100,
  AUDJPY: 100, CADJPY: 100, XAUUSD: 100,
  BTCUSD: 1, ETHUSD: 1, XRPUSD: 1,
};
const PIP_VALUES = {
  EURUSD: 10, GBPUSD: 10, AUDUSD: 10, NZDUSD: 10,
  USDCAD: 10, USDCHF: 10, USDJPY: 9.1, GBPJPY: 9.1,
  EURJPY: 9.1, XAUUSD: 10, BTCUSD: 1, ETHUSD: 1, XRPUSD: 1,
};

const TRADINGVIEW_SYMBOLS = {
  EURUSD: "FX:EURUSD", GBPUSD: "FX:GBPUSD", USDJPY: "FX:USDJPY",
  AUDUSD: "FX:AUDUSD", USDCAD: "FX:USDCAD", NZDUSD: "FX:NZDUSD",
  USDCHF: "FX:USDCHF", GBPJPY: "FX:GBPJPY", EURJPY: "FX:EURJPY",
  XAUUSD: "OANDA:XAUUSD", BTCUSD: "COINBASE:BTCUSD",
  ETHUSD: "COINBASE:ETHUSD", XRPUSD: "BINANCE:XRPUSDT",
};

function TradeHistory() {
  const navigate = useNavigate();
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [closingTrade, setClosingTrade] = useState(null);
  const [exitPrice, setExitPrice] = useState("");
  const [closeLoading, setCloseLoading] = useState(false);
  const [livePrices, setLivePrices] = useState({});
  const [fetchingCurrentPrice, setFetchingCurrentPrice] = useState(false);
  const token = localStorage.getItem("token");
  const headers = { Authorization: `Bearer ${token}` };

  const fetchTrades = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await axios.get(
        `${API_URL}/api/trades?limit=200`,
        { headers }
      );
      setTrades(res.data.trades || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const fetchLivePrices = async () => {
    try {
      const res = await axios.get(
        `${API_URL}/api/market/prices`,
        { headers }
      );
      setLivePrices(res.data.prices || {});
    } catch (err) {
      console.error(err);
    }
  };

  // Fetch live price for a specific pair when closing trade
  const fetchCurrentPriceForPair = async (pair) => {
    setFetchingCurrentPrice(true);
    try {
      const res = await axios.get(
        `${API_URL}/api/market/prices`,
        { headers }
      );
      const prices = res.data.prices || {};
      const price = prices[pair];
      if (price) {
        setExitPrice(String(price));
        setLivePrices(prices);
      } else {
        alert(`Live price not available for ${pair} — market may be closed`);
      }
    } catch {
      alert("Failed to fetch live price");
    } finally {
      setFetchingCurrentPrice(false);
    }
  };

  useEffect(() => {
    fetchTrades();
    fetchLivePrices();
    const interval = setInterval(fetchLivePrices, 60000);
    return () => clearInterval(interval);
  }, []);

  const filtered = trades.filter((t) => {
    const matchSearch = t.pair?.toLowerCase().includes(search.toLowerCase());
    const matchFilter =
      filter === "all" ||
      t.outcome === filter ||
      (filter === "open" && !t.outcome) ||
      (filter === "closed" && t.outcome);
    return matchSearch && matchFilter;
  });

  const calculateClosePL = (trade, exitPx) => {
    const entry = parseFloat(trade.entryPrice);
    const exit = parseFloat(exitPx);
    const lots = parseFloat(trade.lotSize || 0.01);
    if (isNaN(entry) || isNaN(exit) || isNaN(lots)) return null;
    const pipDecimal = PIP_DECIMALS[trade.pair] || 10000;
    const pipValue = PIP_VALUES[trade.pair] || 10;
    const priceDiff = trade.direction === "buy" ? exit - entry : entry - exit;
    const pips = priceDiff * pipDecimal;
    const pl = pips * pipValue * lots;
    const slPips = trade.stopLoss
      ? Math.abs((trade.direction === "buy"
          ? entry - parseFloat(trade.stopLoss)
          : parseFloat(trade.stopLoss) - entry) * pipDecimal)
      : null;
    const riskRatio = slPips && slPips > 0
      ? (Math.abs(pips) / slPips).toFixed(2)
      : null;
    return {
      pl: pl.toFixed(2),
      pips: pips.toFixed(1),
      outcome: pl > 0 ? "win" : pl < 0 ? "loss" : "breakeven",
      riskRatio,
    };
  };

  const closeTrade = async () => {
    if (!exitPrice || !closingTrade) return;
    const calc = calculateClosePL(closingTrade, exitPrice);
    if (!calc) return alert("Invalid exit price");
    setCloseLoading(true);
    try {
      await axios.put(
        `${API_URL}/api/trades/${closingTrade._id}`,
        {
          exitPrice: parseFloat(exitPrice),
          profitLoss: parseFloat(calc.pl),
          outcome: calc.outcome,
          status: "closed",
          closedAt: new Date(),
        },
        { headers }
      );
      setClosingTrade(null);
      setExitPrice("");
      await fetchTrades();
    } catch {
      alert("Failed to close trade");
    } finally {
      setCloseLoading(false);
    }
  };

  const previewClose = exitPrice && closingTrade
    ? calculateClosePL(closingTrade, exitPrice)
    : null;

  const formatPrice = (pair, price) => {
    if (!price) return "—";
    const jpyPairs = ["USDJPY","GBPJPY","EURJPY","AUDJPY","CADJPY"];
    const cryptoPairs = ["BTCUSD","ETHUSD","XRPUSD","BNBUSD","SOLUSD"];
    if (cryptoPairs.includes(pair)) return `$${Number(price).toLocaleString()}`;
    if (jpyPairs.includes(pair)) return Number(price).toFixed(3);
    return Number(price).toFixed(5);
  };

  const exportCSV = () => {
    const csvHeaders = [
      "Pair","Direction","Entry","Exit","Stop Loss",
      "Take Profit","Lot Size","Session","Setup/Strategy",
      "Outcome","P&L","Date","Notes"
    ];
    const rows = filtered.map((t) => [
      t.pair, t.direction, t.entryPrice, t.exitPrice || "",
      t.stopLoss || "", t.takeProfit || "", t.lotSize || "",
      t.session || "", t.setup || "", t.outcome || "open",
      t.profitLoss || "0",
      t.openedAt ? new Date(t.openedAt).toLocaleDateString() : "",
      `"${(t.notes || "").replace(/"/g, "'")}"`,
    ]);
    const csv = [csvHeaders, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trademind-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <MainLayout>

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-white">Trade History</h1>
          <p className="text-slate-400 mt-1 text-sm">{trades.length} trades recorded</p>
        </div>
      </div>

      {/* Filters Row */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 flex-1 min-w-[200px]">
          <Search size={15} className="text-slate-500 flex-shrink-0" />
          <input
            type="text"
            placeholder="Search pair..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent outline-none text-sm text-white flex-1 min-w-0"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {["all","open","win","loss","closed"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2.5 rounded-xl text-sm font-semibold capitalize transition ${
                filter === f
                  ? "bg-green-500 text-slate-950"
                  : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-white"
              }`}
            >
              {f}
            </button>
          ))}
          <button
            onClick={() => fetchTrades(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold bg-slate-900 border border-slate-800 text-slate-400 hover:text-green-400 transition"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "..." : "Refresh"}
          </button>
          <button
            onClick={exportCSV}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold bg-slate-900 border border-slate-800 text-slate-400 hover:text-green-400 transition"
          >
            <Download size={13} /> Export
          </button>
        </div>
      </div>

      {/* Live Prices Ticker */}
      <PriceTicker compact className="mb-5" />

      {/* Trades */}
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          <p>No trades found</p>
        </div>
      ) : (
        <>
        {/* Mobile card list — the table below is unreadable below md, so
            small screens get a stacked-card layout instead of a horizontal-
            scroll table. The switch happens at lg (1024px), not md
            (768px), because md is also where the 256px sidebar appears —
            below lg there isn't actually enough room next to the sidebar
            for a real trades table without it still needing to scroll. */}
        <div className="lg:hidden space-y-3">
          {filtered.map((trade, i) => {
            const livePrice = livePrices[trade.pair];
            const livePL = !trade.outcome && livePrice
              ? calculateClosePL(trade, livePrice)
              : null;

            return (
              <div key={trade._id || i} className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white">{trade.pair}</span>
                    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${
                      trade.direction === "buy" ? "text-green-400" : "text-red-400"
                    }`}>
                      {trade.direction === "buy" ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                      {trade.direction || "—"}
                    </span>
                  </div>
                  {!trade.outcome ? (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      ⏳ OPEN
                    </span>
                  ) : trade.outcome === "win" ? (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold bg-green-500/10 text-green-400 border border-green-500/20">
                      ✅ WIN
                    </span>
                  ) : trade.outcome === "loss" ? (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold bg-red-500/10 text-red-400 border border-red-500/20">
                      ❌ LOSS
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold bg-slate-700 text-slate-400">
                      ➖ EVEN
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="bg-slate-800 rounded-lg p-2 text-center">
                    <p className="text-[10px] text-slate-500 mb-0.5">Entry</p>
                    <p className="font-mono text-xs text-slate-300">{trade.entryPrice || "—"}</p>
                  </div>
                  <div className="bg-slate-800 rounded-lg p-2 text-center">
                    <p className="text-[10px] text-slate-500 mb-0.5">Exit</p>
                    <p className="font-mono text-xs text-slate-300">{trade.exitPrice || "—"}</p>
                  </div>
                  <div className="bg-slate-800 rounded-lg p-2 text-center">
                    <p className="text-[10px] text-slate-500 mb-0.5">Live</p>
                    <p className="font-mono text-xs text-green-400">
                      {livePrice ? formatPrice(trade.pair, livePrice) : "—"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-400 mb-3">
                  <span>{trade.setup || "No strategy"}</span>
                  <span>{trade.openedAt ? new Date(trade.openedAt).toLocaleDateString() : "—"}</span>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    {trade.outcome ? (
                      <span className={`font-bold text-sm ${
                        Number(trade.profitLoss) >= 0 ? "text-green-400" : "text-red-400"
                      }`}>
                        {Number(trade.profitLoss) >= 0 ? "+" : ""}${Number(trade.profitLoss || 0).toFixed(2)}
                      </span>
                    ) : livePL ? (
                      <span className={`text-sm font-semibold ${
                        Number(livePL.pl) >= 0 ? "text-green-400" : "text-red-400"
                      }`}>
                        {Number(livePL.pl) >= 0 ? "+" : ""}${livePL.pl} <span className="text-slate-500 font-normal">unrealized</span>
                      </span>
                    ) : (
                      <span className="text-slate-600 text-sm">—</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => navigate("/charts", {
                        state: { symbol: TRADINGVIEW_SYMBOLS[trade.pair] }
                      })}
                      className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400"
                    >
                      <LineChart size={14} />
                    </button>
                    {!trade.outcome && (
                      <button
                        onClick={() => {
                          setClosingTrade(trade);
                          setExitPrice(
                            livePrices[trade.pair] ? String(livePrices[trade.pair]) : ""
                          );
                        }}
                        className="px-3 py-2 rounded-lg text-xs font-bold bg-green-500/10 border border-green-500/30 text-green-400"
                      >
                        Close
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Desktop table */}
        <div className="hidden lg:block bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="text-left border-b border-slate-800">
                  <th className="px-4 py-3.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">Pair</th>
                  <th className="px-4 py-3.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">Direction</th>
                  <th className="px-4 py-3.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">Entry</th>
                  <th className="px-4 py-3.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">Exit</th>
                  <th className="px-4 py-3.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">Live Price</th>
                  <th className="px-4 py-3.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">Strategy</th>
                  <th className="px-4 py-3.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3.5 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right">P&L</th>
                  <th className="px-4 py-3.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">Date</th>
                  <th className="px-4 py-3.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {filtered.map((trade, i) => {
                  const livePrice = livePrices[trade.pair];
                  const livePL = !trade.outcome && livePrice
                    ? calculateClosePL(trade, livePrice)
                    : null;

                  return (
                    <tr
                      key={trade._id || i}
                      className="hover:bg-slate-800/50 transition-colors"
                    >
                      {/* Pair */}
                      <td className="px-4 py-3.5">
                        <span className="font-bold text-white text-sm">{trade.pair}</span>
                      </td>

                      {/* Direction */}
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${
                          trade.direction === "buy" ? "text-green-400" : "text-red-400"
                        }`}>
                          {trade.direction === "buy"
                            ? <TrendingUp size={13} />
                            : <TrendingDown size={13} />}
                          {trade.direction || "—"}
                        </span>
                      </td>

                      {/* Entry */}
                      <td className="px-4 py-3.5">
                        <span className="font-mono text-sm text-slate-300">
                          {trade.entryPrice || "—"}
                        </span>
                      </td>

                      {/* Exit */}
                      <td className="px-4 py-3.5">
                        <span className="font-mono text-sm text-slate-300">
                          {trade.exitPrice || "—"}
                        </span>
                      </td>

                      {/* Live Price */}
                      <td className="px-4 py-3.5">
                        {livePrice ? (
                          <div>
                            <p className="font-mono text-xs font-bold text-green-400">
                              {formatPrice(trade.pair, livePrice)}
                            </p>
                            {livePL && (
                              <p className={`text-xs font-semibold mt-0.5 ${
                                Number(livePL.pl) >= 0 ? "text-green-400" : "text-red-400"
                              }`}>
                                {Number(livePL.pl) >= 0 ? "+" : ""}${livePL.pl}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-600 text-xs">—</span>
                        )}
                      </td>

                      {/* Strategy */}
                      <td className="px-4 py-3.5">
                        <span className="text-slate-400 text-sm">
                          {trade.setup || "—"}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5">
                        {!trade.outcome ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            ⏳ OPEN
                          </span>
                        ) : trade.outcome === "win" ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-green-500/10 text-green-400 border border-green-500/20">
                            ✅ WIN
                          </span>
                        ) : trade.outcome === "loss" ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-red-500/10 text-red-400 border border-red-500/20">
                            ❌ LOSS
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-700 text-slate-400">
                            ➖ EVEN
                          </span>
                        )}
                      </td>

                      {/* P&L */}
                      <td className="px-4 py-3.5 text-right">
                        {trade.outcome ? (
                          <span className={`font-bold text-sm ${
                            Number(trade.profitLoss) >= 0 ? "text-green-400" : "text-red-400"
                          }`}>
                            {Number(trade.profitLoss) >= 0 ? "+" : ""}
                            ${Number(trade.profitLoss || 0).toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-slate-600 text-sm">—</span>
                        )}
                      </td>

                      {/* Date */}
                      <td className="px-4 py-3.5">
                        <span className="text-slate-400 text-xs">
                          {trade.openedAt
                            ? new Date(trade.openedAt).toLocaleDateString()
                            : "—"}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => navigate("/charts", {
                              state: { symbol: TRADINGVIEW_SYMBOLS[trade.pair] }
                            })}
                            title="View Live Chart"
                            className="p-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-blue-500/20 transition"
                          >
                            <LineChart size={13} />
                          </button>
                          {!trade.outcome && (
                            <button
                              onClick={() => {
                                setClosingTrade(trade);
                                setExitPrice(
                                  livePrices[trade.pair]
                                    ? String(livePrices[trade.pair])
                                    : ""
                                );
                              }}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-green-500/10 border border-green-500/30 text-green-400 hover:bg-green-500/20 transition whitespace-nowrap"
                            >
                              Close
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        </>
      )}

      {/* Close Trade Modal */}
      {closingTrade && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl">

            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-800">
              <div>
                <h3 className="text-lg font-bold text-white">
                  Close Trade
                </h3>
                <p className="text-sm text-slate-400 mt-0.5">
                  {closingTrade.pair} — {closingTrade.direction?.toUpperCase()}
                </p>
              </div>
              <button
                onClick={() => { setClosingTrade(null); setExitPrice(""); }}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4">

              {/* Trade Summary */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-800 rounded-xl p-3">
                  <p className="text-xs text-slate-400 mb-1">Entry Price</p>
                  <p className="font-mono font-bold text-white">
                    {closingTrade.entryPrice}
                  </p>
                </div>
                <div className="bg-slate-800 rounded-xl p-3">
                  <p className="text-xs text-slate-400 mb-1">Direction</p>
                  <p className={`font-bold capitalize ${
                    closingTrade.direction === "buy" ? "text-green-400" : "text-red-400"
                  }`}>
                    {closingTrade.direction}
                  </p>
                </div>
                {closingTrade.stopLoss && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                    <p className="text-xs text-slate-400 mb-1">AI Stop Loss</p>
                    <p className="font-mono font-bold text-red-400">
                      {closingTrade.stopLoss}
                    </p>
                  </div>
                )}
                {closingTrade.takeProfit && (
                  <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3">
                    <p className="text-xs text-slate-400 mb-1">AI Take Profit</p>
                    <p className="font-mono font-bold text-green-400">
                      {closingTrade.takeProfit}
                    </p>
                  </div>
                )}
              </div>

              {/* Live Price Fetch */}
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide">
                      Current Market Price
                    </p>
                    {livePrices[closingTrade.pair] ? (
                      <p className="font-mono font-bold text-green-400 text-xl mt-1">
                        {formatPrice(closingTrade.pair, livePrices[closingTrade.pair])}
                      </p>
                    ) : (
                      <p className="text-slate-500 text-sm mt-1">Not available</p>
                    )}
                  </div>
                  <button
                    onClick={() => fetchCurrentPriceForPair(closingTrade.pair)}
                    disabled={fetchingCurrentPrice}
                    className="flex items-center gap-2 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-slate-950 text-xs font-bold px-4 py-2.5 rounded-xl transition"
                  >
                    <RefreshCw size={12} className={fetchingCurrentPrice ? "animate-spin" : ""} />
                    {fetchingCurrentPrice ? "Fetching..." : "Fetch Live Price"}
                  </button>
                </div>
                {livePrices[closingTrade.pair] && (
                  <button
                    onClick={() => setExitPrice(String(livePrices[closingTrade.pair]))}
                    className="w-full text-xs text-green-400 hover:text-green-300 bg-green-500/10 border border-green-500/20 rounded-lg py-2 transition font-semibold"
                  >
                    Use {formatPrice(closingTrade.pair, livePrices[closingTrade.pair])} as Exit Price
                  </button>
                )}
              </div>

              {/* Manual Exit Price */}
              <div>
                <label className="text-sm text-slate-400 mb-2 block font-medium">
                  Exit Price
                </label>
                <input
                  type="number"
                  step="any"
                  value={exitPrice}
                  onChange={(e) => setExitPrice(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && closeTrade()}
                  placeholder="Enter exit price manually"
                  className="w-full bg-slate-800 border border-slate-700 focus:border-green-500 p-3.5 rounded-xl outline-none transition text-white font-mono text-sm"
                />
              </div>

              {/* P&L Preview */}
              {previewClose && (
                <div className={`rounded-xl p-4 border ${
                  previewClose.outcome === "win"
                    ? "bg-green-500/10 border-green-500/30"
                    : previewClose.outcome === "loss"
                    ? "bg-red-500/10 border-red-500/30"
                    : "bg-slate-800 border-slate-700"
                }`}>
                  <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-3">
                    Result Preview
                  </p>
                  <div className="grid grid-cols-3 gap-3 text-center mb-3">
                    <div>
                      <p className="text-xs text-slate-400 mb-1">P&L</p>
                      <p className={`text-xl font-bold font-mono ${
                        Number(previewClose.pl) >= 0 ? "text-green-400" : "text-red-400"
                      }`}>
                        {Number(previewClose.pl) >= 0 ? "+" : ""}${previewClose.pl}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Pips</p>
                      <p className={`text-xl font-bold ${
                        Number(previewClose.pips) >= 0 ? "text-green-400" : "text-red-400"
                      }`}>
                        {Number(previewClose.pips) >= 0 ? "+" : ""}{previewClose.pips}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Risk Ratio</p>
                      <p className="text-xl font-bold text-white">
                        {previewClose.riskRatio ? `1:${previewClose.riskRatio}` : "—"}
                      </p>
                    </div>
                  </div>
                  <div className={`text-center py-2 rounded-lg font-bold text-base ${
                    previewClose.outcome === "win"
                      ? "bg-green-500/20 text-green-400"
                      : previewClose.outcome === "loss"
                      ? "bg-red-500/20 text-red-400"
                      : "bg-slate-700 text-slate-400"
                  }`}>
                    {previewClose.outcome === "win" ? "✅ WIN"
                      : previewClose.outcome === "loss" ? "❌ LOSS"
                      : "➖ BREAKEVEN"}
                  </div>
                  {closingTrade.stopLoss && previewClose.outcome === "loss" && (
                    <p className="text-center text-xs text-slate-400 mt-2">
                      {Math.abs(parseFloat(exitPrice) - parseFloat(closingTrade.stopLoss)) < 0.002
                        ? "✅ Closed at AI suggested Stop Loss"
                        : "⚠️ Closed manually — different from AI Stop Loss"}
                    </p>
                  )}
                </div>
              )}

              {/* Confirm Button */}
              <button
                onClick={closeTrade}
                disabled={!exitPrice || closeLoading}
                className="w-full bg-green-500 hover:bg-green-600 disabled:opacity-40 text-slate-950 font-bold py-4 rounded-xl transition flex items-center justify-center gap-2 text-base"
              >
                {closeLoading ? (
                  <div className="w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <><CheckCircle size={18} /> Confirm Close Trade</>
                )}
              </button>

            </div>
          </div>
        </div>
      )}

    </MainLayout>
  );
}

export default TradeHistory;