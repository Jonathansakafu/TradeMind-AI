import MainLayout from "../layouts/MainLayout";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import axios from "axios";
import { API_URL } from "../config/api";

const PAIRS = [
  { label: "EUR/USD", symbol: "FX:EURUSD", pair: "EURUSD" },
  { label: "GBP/USD", symbol: "FX:GBPUSD", pair: "GBPUSD" },
  { label: "USD/JPY", symbol: "FX:USDJPY", pair: "USDJPY" },
  { label: "XAU/USD", symbol: "OANDA:XAUUSD", pair: "XAUUSD" },
  { label: "GBP/JPY", symbol: "FX:GBPJPY", pair: "GBPJPY" },
  { label: "AUD/USD", symbol: "FX:AUDUSD", pair: "AUDUSD" },
  { label: "USD/CAD", symbol: "FX:USDCAD", pair: "USDCAD" },
  { label: "EUR/JPY", symbol: "FX:EURJPY", pair: "EURJPY" },
  { label: "NZD/USD", symbol: "FX:NZDUSD", pair: "NZDUSD" },
  { label: "USD/CHF", symbol: "FX:USDCHF", pair: "USDCHF" },
  { label: "BTC/USD", symbol: "COINBASE:BTCUSD", pair: "BTCUSD" },
  { label: "ETH/USD", symbol: "COINBASE:ETHUSD", pair: "ETHUSD" },
  { label: "XRP/USD", symbol: "BINANCE:XRPUSDT", pair: "XRPUSD" },
  { label: "BNB/USD", symbol: "BINANCE:BNBUSDT", pair: "BNBUSD" },
  { label: "SOL/USD", symbol: "BINANCE:SOLUSDT", pair: "SOLUSD" },
];

const INTERVALS = [
  { label: "1m", value: "1" },
  { label: "5m", value: "5" },
  { label: "15m", value: "15" },
  { label: "1H", value: "60" },
  { label: "4H", value: "240" },
  { label: "1D", value: "D" },
  { label: "1W", value: "W" },
];

const PIP_DECIMALS = {
  USDJPY: 100, GBPJPY: 100, EURJPY: 100,
  AUDJPY: 100, CADJPY: 100, XAUUSD: 100,
  BTCUSD: 1, ETHUSD: 1, XRPUSD: 1,
  BNBUSD: 1, SOLUSD: 1,
};
const PIP_VALUES = {
  EURUSD: 10, GBPUSD: 10, AUDUSD: 10, NZDUSD: 10,
  USDCAD: 10, USDCHF: 10, USDJPY: 9.1, GBPJPY: 9.1,
  EURJPY: 9.1, XAUUSD: 10, BTCUSD: 1, ETHUSD: 1,
  XRPUSD: 1, BNBUSD: 1, SOLUSD: 1,
};

function Charts() {
  const containerRef = useRef(null);
  const location = useLocation();
  const token = localStorage.getItem("token");
  const headers = { Authorization: `Bearer ${token}` };

  const incomingSymbol = location.state?.symbol;
  const incomingPair = location.state?.pair;
  const incomingTrade = location.state?.trade;

  const defaultPair = PAIRS.find(
    (p) => p.symbol === incomingSymbol || p.pair === incomingPair
  ) || PAIRS[0];

  const [selectedPair, setSelectedPair] = useState(defaultPair);
  const [selectedInterval, setSelectedInterval] = useState("60");
  const [openTrades, setOpenTrades] = useState([]);
  const [selectedTrade, setSelectedTrade] = useState(incomingTrade || null);
  const [livePrice, setLivePrice] = useState(null);
  const [loading, setLoading] = useState(false);

  // Fetch open trades for selected pair
  const fetchOpenTrades = async (pair) => {
    try {
      const res = await axios.get(
        `${API_URL}/api/trades?limit=50`,
        { headers }
      );
      const trades = res.data.trades || [];
      const open = trades.filter(
        (t) => !t.outcome && t.pair === pair
      );
      setOpenTrades(open);
      if (open.length > 0 && !selectedTrade) {
        setSelectedTrade(open[0]);
      } else if (open.length === 0) {
        setSelectedTrade(null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Fetch live price
  const fetchLivePrice = async (pair) => {
    try {
      const res = await axios.get(
        `${API_URL}/api/market/prices`,
        { headers }
      );
      const prices = res.data.prices || {};
      setLivePrice(prices[pair] || null);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchOpenTrades(selectedPair.pair);
    fetchLivePrice(selectedPair.pair);
    const interval = setInterval(() => {
      fetchLivePrice(selectedPair.pair);
    }, 30000);
    return () => clearInterval(interval);
  }, [selectedPair]);

  // TradingView chart
  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = "";
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: selectedPair.symbol,
      interval: selectedInterval,
      timezone: "Africa/Nairobi",
      theme: "dark",
      style: "1",
      locale: "en",
      backgroundColor: "#0f172a",
      gridColor: "#1e293b",
      hide_top_toolbar: false,
      hide_legend: false,
      allow_symbol_change: false,
      save_image: true,
      studies: ["RSI@tv-basicstudies", "MACD@tv-basicstudies"],
    });
    containerRef.current.appendChild(script);
  }, [selectedPair, selectedInterval]);

  // Calculate live P&L
  const calculateLivePL = (trade) => {
    if (!livePrice || !trade) return null;
    const entry = parseFloat(trade.entryPrice);
    const lots = parseFloat(trade.lotSize || 0.01);
    const pipDecimal = PIP_DECIMALS[trade.pair] || 10000;
    const pipValue = PIP_VALUES[trade.pair] || 10;
    const priceDiff = trade.direction === "buy"
      ? livePrice - entry
      : entry - livePrice;
    const pips = priceDiff * pipDecimal;
    const pl = pips * pipValue * lots;
    return {
      pl: pl.toFixed(2),
      pips: pips.toFixed(1),
      isProfit: pl >= 0,
    };
  };

  const formatPrice = (pair, price) => {
    if (!price) return "—";
    const jpyPairs = ["USDJPY","GBPJPY","EURJPY","AUDJPY","CADJPY"];
    const cryptoPairs = ["BTCUSD","ETHUSD","XRPUSD","BNBUSD","SOLUSD"];
    if (cryptoPairs.includes(pair)) return `$${Number(price).toLocaleString()}`;
    if (jpyPairs.includes(pair)) return Number(price).toFixed(3);
    return Number(price).toFixed(5);
  };

  const livePL = selectedTrade ? calculateLivePL(selectedTrade) : null;

  return (
    <MainLayout>

      {/* Header */}
      <div className="mb-5">
        <h1 className="text-3xl md:text-4xl font-bold text-white">Live Charts</h1>
        <p className="text-slate-400 mt-1 text-sm">
          TradingView charts with your open trade levels
        </p>
      </div>

      {/* Pair Selector */}
      <div className="flex flex-wrap gap-2 mb-3">
        {PAIRS.map((pair) => (
          <button
            key={pair.symbol}
            onClick={() => {
              setSelectedPair(pair);
              setSelectedTrade(null);
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
              selectedPair.symbol === pair.symbol
                ? "bg-green-500 text-slate-950"
                : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-white"
            }`}
          >
            {pair.label}
          </button>
        ))}
      </div>

      {/* Interval Selector */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {INTERVALS.map((i) => (
          <button
            key={i.value}
            onClick={() => setSelectedInterval(i.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              selectedInterval === i.value
                ? "bg-green-500 text-slate-950"
                : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-white"
            }`}
          >
            {i.label}
          </button>
        ))}
      </div>

      {/* Trade Info Panel */}
      {openTrades.length > 0 && (
        <div className="mb-4 space-y-3">

          {/* Trade selector kama kuna zaidi ya moja */}
          {openTrades.length > 1 && (
            <div className="flex gap-2 flex-wrap">
              <span className="text-xs text-slate-400 self-center">Open trades:</span>
              {openTrades.map((t, i) => (
                <button
                  key={t._id}
                  onClick={() => setSelectedTrade(t)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                    selectedTrade?._id === t._id
                      ? "bg-green-500 text-slate-950"
                      : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-white"
                  }`}
                >
                  {t.direction?.toUpperCase()} @ {t.entryPrice}
                </button>
              ))}
            </div>
          )}

          {/* Trade details panel */}
          {selectedTrade && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className={`px-3 py-1.5 rounded-xl text-sm font-bold ${
                    selectedTrade.direction === "buy"
                      ? "bg-green-500/10 text-green-400 border border-green-500/20"
                      : "bg-red-500/10 text-red-400 border border-red-500/20"
                  }`}>
                    {selectedTrade.direction?.toUpperCase()}
                  </div>
                  <span className="text-white font-bold text-lg">
                    {selectedTrade.pair}
                  </span>
                  <span className="px-2 py-1 rounded-lg text-xs font-bold bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                    ⏳ OPEN
                  </span>
                </div>

                {/* Live P&L */}
                {livePL && (
                  <div className={`px-4 py-2 rounded-xl border text-right ${
                    livePL.isProfit
                      ? "bg-green-500/10 border-green-500/30"
                      : "bg-red-500/10 border-red-500/30"
                  }`}>
                    <p className="text-xs text-slate-400">Live P&L</p>
                    <p className={`text-xl font-bold font-mono ${
                      livePL.isProfit ? "text-green-400" : "text-red-400"
                    }`}>
                      {livePL.isProfit ? "+" : ""}${livePL.pl}
                    </p>
                    <p className={`text-xs ${livePL.isProfit ? "text-green-400" : "text-red-400"}`}>
                      {livePL.isProfit ? "+" : ""}{livePL.pips} pips
                    </p>
                  </div>
                )}
              </div>

              {/* Price Levels */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-slate-800 rounded-xl p-3 text-center">
                  <p className="text-xs text-slate-400 mb-1">Entry</p>
                  <p className="font-mono font-bold text-blue-400 text-sm">
                    {formatPrice(selectedTrade.pair, selectedTrade.entryPrice)}
                  </p>
                  <div className="w-full h-0.5 bg-blue-500/40 mt-2 rounded" />
                </div>

                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-center">
                  <p className="text-xs text-slate-400 mb-1">Stop Loss</p>
                  <p className="font-mono font-bold text-red-400 text-sm">
                    {selectedTrade.stopLoss
                      ? formatPrice(selectedTrade.pair, selectedTrade.stopLoss)
                      : "Not set"}
                  </p>
                  <div className="w-full h-0.5 bg-red-500/40 mt-2 rounded" />
                </div>

                <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3 text-center">
                  <p className="text-xs text-slate-400 mb-1">Take Profit</p>
                  <p className="font-mono font-bold text-green-400 text-sm">
                    {selectedTrade.takeProfit
                      ? formatPrice(selectedTrade.pair, selectedTrade.takeProfit)
                      : "Not set"}
                  </p>
                  <div className="w-full h-0.5 bg-green-500/40 mt-2 rounded" />
                </div>

                <div className="bg-slate-800 rounded-xl p-3 text-center">
                  <p className="text-xs text-slate-400 mb-1">Live Price</p>
                  <p className="font-mono font-bold text-white text-sm">
                    {formatPrice(selectedTrade.pair, livePrice)}
                  </p>
                  <div className={`w-full h-0.5 mt-2 rounded ${
                    livePL?.isProfit ? "bg-green-500/40" : "bg-red-500/40"
                  }`} />
                </div>
              </div>

              {/* Risk levels indicator */}
              {selectedTrade.stopLoss && selectedTrade.takeProfit && livePrice && (
                <div className="mt-4">
                  <p className="text-xs text-slate-400 mb-2">Price Position</p>
                  <div className="relative h-6 bg-slate-800 rounded-full overflow-hidden">
                    {(() => {
                      const sl = parseFloat(selectedTrade.stopLoss);
                      const tp = parseFloat(selectedTrade.takeProfit);
                      const entry = parseFloat(selectedTrade.entryPrice);
                      const current = livePrice;
                      const range = tp - sl;
                      if (range === 0) return null;
                      const slPos = 0;
                      const tpPos = 100;
                      const entryPos = ((entry - sl) / range) * 100;
                      const currentPos = Math.max(0, Math.min(100, ((current - sl) / range) * 100));
                      return (
                        <>
                          <div className="absolute inset-0 bg-gradient-to-r from-red-500/20 via-slate-700/20 to-green-500/20" />
                          {/* SL marker */}
                          <div className="absolute top-0 bottom-0 w-0.5 bg-red-500" style={{ left: "2%" }}>
                            <span className="absolute -top-5 left-1 text-xs text-red-400 whitespace-nowrap">SL</span>
                          </div>
                          {/* Entry marker */}
                          <div className="absolute top-0 bottom-0 w-0.5 bg-blue-400" style={{ left: `${Math.max(5, Math.min(95, entryPos))}%` }}>
                            <span className="absolute -top-5 -translate-x-1/2 text-xs text-blue-400 whitespace-nowrap">Entry</span>
                          </div>
                          {/* Current price marker */}
                          <div
                            className={`absolute top-0 bottom-0 w-1 rounded ${livePL?.isProfit ? "bg-green-400" : "bg-red-400"}`}
                            style={{ left: `${Math.max(2, Math.min(98, currentPos))}%` }}
                          >
                            <span className={`absolute -bottom-5 -translate-x-1/2 text-xs whitespace-nowrap font-bold ${livePL?.isProfit ? "text-green-400" : "text-red-400"}`}>
                              Now
                            </span>
                          </div>
                          {/* TP marker */}
                          <div className="absolute top-0 bottom-0 w-0.5 bg-green-500" style={{ left: "97%" }}>
                            <span className="absolute -top-5 -translate-x-full text-xs text-green-400 whitespace-nowrap">TP</span>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* Trade info footer */}
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-800 flex-wrap gap-2">
                <div className="flex items-center gap-4 text-xs text-slate-400">
                  <span>Lot: <span className="text-white font-semibold">{selectedTrade.lotSize || "—"}</span></span>
                  <span>Opened: <span className="text-white font-semibold">
                    {selectedTrade.openedAt
                      ? new Date(selectedTrade.openedAt).toLocaleDateString()
                      : "—"}
                  </span></span>
                  {selectedTrade.setup && (
                    <span>Setup: <span className="text-white font-semibold">{selectedTrade.setup}</span></span>
                  )}
                </div>
                <div className={`text-xs px-3 py-1 rounded-lg font-semibold ${
                  livePL?.isProfit
                    ? "bg-green-500/10 text-green-400"
                    : "bg-red-500/10 text-red-400"
                }`}>
                  {livePL?.isProfit ? "✅ In Profit" : "❌ In Loss"}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* No open trades message */}
      {openTrades.length === 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-4 flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-slate-600" />
          <p className="text-slate-400 text-sm">
            No open trades for <span className="text-white font-semibold">{selectedPair.label}</span> —
            chart shown for analysis only
          </p>
        </div>
      )}

      {/* TradingView Chart */}
      <div
        className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden"
        style={{ height: openTrades.length > 0 ? "500px" : "620px" }}
      >
        <div
          className="tradingview-widget-container"
          ref={containerRef}
          style={{ height: "100%", width: "100%" }}
        />
      </div>

      <p className="text-slate-600 text-xs mt-3 text-center">
        Charts powered by TradingView · Prices update every 30 seconds
      </p>

    </MainLayout>
  );
}

export default Charts;