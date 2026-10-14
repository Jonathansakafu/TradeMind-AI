import { useEffect, useState } from "react";
import axios from "axios";
import { API_URL } from "../config/api";
import { floatingPL } from "../utils/livePL";

// Today's (or the last 7 days') equity change with its peak and low.
// The server rebuilds the curve from minute prices (GET /api/trades/equity,
// every 60 s); between those, the live bid / ask of open trades (every 3 s)
// moves the current value and can set a new peak or low at once.
export function useEquityLive(headers, period = "today") {
  const [state, setState] = useState({ data: null, current: null, peak: null, low: null, updatedAt: null });

  useEffect(() => {
    let stop = false;
    let server = null;
    let timer;
    let lastServerAt = 0;

    const merge = (prev, value, at) => {
      const peak = !prev.peak || value > prev.peak.value ? { value, at } : prev.peak;
      const low = !prev.low || value < prev.low.value ? { value, at } : prev.low;
      return { ...prev, current: value, peak, low, updatedAt: at };
    };

    const tick = async () => {
      if (document.visibilityState === "visible") {
        try {
          if (!server || Date.now() - lastServerAt > 60000) {
            const res = await axios.get(`${API_URL}/api/trades/equity`, { headers, params: { period }, timeout: 20000 });
            server = res.data;
            lastServerAt = Date.now();
            if (!stop) {
              setState((prev) => {
                // Keep a live extreme the minute candles haven't caught yet.
                const peak = prev.peak && prev.data?.period === period && prev.peak.value > server.peak.value ? prev.peak : server.peak;
                const low = prev.low && prev.data?.period === period && prev.low.value < server.low.value ? prev.low : server.low;
                return { data: server, current: server.current, peak, low, updatedAt: Date.now() };
              });
            }
          }
          if (server?.open?.length) {
            const pairs = [...new Set(server.open.map((t) => t.pair))].join(",");
            const res = await axios.get(`${API_URL}/api/market/live`, { headers, params: { pairs }, timeout: 8000 });
            const quotes = res.data.quotes || {};
            let floating = 0, priced = 0;
            for (const t of server.open) {
              const f = floatingPL(t, quotes[t.pair]);
              if (f) { floating += f.pl - (t.baseline || 0); priced++; }
            }
            if (priced && !stop) {
              const value = Math.round((server.realized + floating) * 100) / 100;
              setState((prev) => merge(prev, value, Date.now()));
            }
          }
        } catch { /* keep the last values */ }
      }
      if (!stop) timer = setTimeout(tick, 3000);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [headers, period]);

  return state;
}
