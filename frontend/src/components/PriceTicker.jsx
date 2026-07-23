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

// Slow, steady drift rather than a brisk scroll — roughly constant speed
// regardless of how many prices are in the feed, since duration scales
// with the (doubled) content length.
const PIXELS_PER_SECOND = 22;
const ESTIMATED_CHIP_WIDTH = 150;

// className/mb let callers control outer spacing without fighting the
// component's own margin; compact renders a slimmer variant for use
// inline within a page (e.g. Trade History) instead of as a dashboard hero.
function PriceTicker({ compact = false, className = "" }) {
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

  const durationSeconds = Math.max(30, Math.round((items.length * ESTIMATED_CHIP_WIDTH) / PIXELS_PER_SECOND));
  const animationName = `tm-ticker-scroll-${compact ? "compact" : "full"}`;

  const renderChip = (item, key) => (
    <div
      key={key}
      className={`flex items-center flex-shrink-0 border-r border-slate-800 ${
        compact ? "gap-1.5 px-4 py-2.5" : "gap-2.5 px-5 py-3"
      }`}
    >
      <span className={`text-xs font-bold ${CRYPTO_PAIRS.has(item.pair) ? "text-yellow-400" : "text-slate-500"}`}>
        {CRYPTO_PAIRS.has(item.pair) ? "₿" : "FX"}
      </span>
      <span className={`font-semibold text-white ${compact ? "text-xs" : "text-sm"}`}>
        {formatLabel(item.pair)}
      </span>
      <span className={`font-mono ${compact ? "text-xs" : "text-sm"} ${
        item.direction === "up" ? "text-green-400" : item.direction === "down" ? "text-red-400" : "text-slate-300"
      }`}>
        {formatPrice(item.pair, item.price)}
      </span>
      {!compact && item.direction === "up" && <TrendingUp size={13} className="text-green-400" />}
      {!compact && item.direction === "down" && <TrendingDown size={13} className="text-red-400" />}
    </div>
  );

  return (
    <div className={`relative w-full min-w-0 overflow-hidden bg-slate-900 border border-slate-800 rounded-2xl ${className || (compact ? "" : "mb-8")}`}>
      <style>{`
        @keyframes ${animationName} {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        .${animationName} {
          animation: ${animationName} ${durationSeconds}s linear infinite;
        }
        .${animationName}:hover {
          animation-play-state: paused;
        }
        @media (prefers-reduced-motion: reduce) {
          .${animationName} { animation: none; }
        }
      `}</style>
      <div className={`flex w-max ${animationName}`}>
        {items.map((item, i) => renderChip(item, `a-${i}`))}
        {items.map((item, i) => renderChip(item, `b-${i}`))}
      </div>
    </div>
  );
}

export default PriceTicker;
