import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { TrendingUp, TrendingDown } from "lucide-react";
import { API_URL } from "../config/api";

const CRYPTO_PAIRS = new Set([
  "BTCUSD", "ETHUSD", "XRPUSD", "BNBUSD", "SOLUSD", "ADAUSD", "DOGEUSD", "LTCUSD",
]);

const JPY_PAIRS = new Set(["USDJPY", "GBPJPY", "EURJPY"]);

const formatPrice = (pair, price) => {
  if (CRYPTO_PAIRS.has(pair)) {
    return price >= 1000 ? price.toFixed(0) : price.toFixed(2);
  }
  return JPY_PAIRS.has(pair) ? price.toFixed(3) : price.toFixed(5);
};

const formatLabel = (pair) =>
  CRYPTO_PAIRS.has(pair) ? `${pair.slice(0, -3)}/${pair.slice(-3)}` : `${pair.slice(0, 3)}/${pair.slice(3)}`;

function PriceTicker() {
  const [items, setItems] = useState([]);
  const prevPrices = useRef({});

  useEffect(() => {
    const fetchPrices = async () => {
      try {
        const res = await axios.get(`${API_URL}/api/market/prices`);
        const prices = res.data.prices || {};
        const next = Object.entries(prices).map(([pair, price]) => {
          const prev = prevPrices.current[pair];
          const direction = prev == null ? "flat" : price > prev ? "up" : price < prev ? "down" : "flat";
          return { pair, price, direction };
        });
        prevPrices.current = prices;
        if (next.length > 0) setItems(next);
      } catch {
        // Keep showing the last known prices if a poll fails
      }
    };

    fetchPrices();
    const interval = setInterval(fetchPrices, 30000);
    return () => clearInterval(interval);
  }, []);

  if (items.length === 0) return null;

  const renderChip = (item, key) => (
    <div
      key={key}
      className="flex items-center gap-2.5 px-5 py-3 flex-shrink-0 border-r border-slate-800"
    >
      <span className={`text-xs font-bold ${CRYPTO_PAIRS.has(item.pair) ? "text-yellow-400" : "text-slate-500"}`}>
        {CRYPTO_PAIRS.has(item.pair) ? "₿" : "FX"}
      </span>
      <span className="text-sm font-semibold text-white">{formatLabel(item.pair)}</span>
      <span className={`text-sm font-mono ${
        item.direction === "up" ? "text-green-400" : item.direction === "down" ? "text-red-400" : "text-slate-300"
      }`}>
        {formatPrice(item.pair, item.price)}
      </span>
      {item.direction === "up" && <TrendingUp size={13} className="text-green-400" />}
      {item.direction === "down" && <TrendingDown size={13} className="text-red-400" />}
    </div>
  );

  return (
    <div className="relative overflow-hidden bg-slate-900 border border-slate-800 rounded-2xl mb-8">
      <style>{`
        @keyframes tm-ticker-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        .tm-ticker-track {
          animation: tm-ticker-scroll 40s linear infinite;
        }
        .tm-ticker-track:hover {
          animation-play-state: paused;
        }
        @media (prefers-reduced-motion: reduce) {
          .tm-ticker-track { animation: none; }
        }
      `}</style>
      <div className="flex w-max tm-ticker-track">
        {items.map((item, i) => renderChip(item, `a-${i}`))}
        {items.map((item, i) => renderChip(item, `b-${i}`))}
      </div>
    </div>
  );
}

export default PriceTicker;
