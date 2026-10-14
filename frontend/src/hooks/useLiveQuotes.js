import { useEffect, useState } from "react";
import axios from "axios";
import { API_URL } from "../config/api";

// Live bid/ask for the given pairs, refreshed every `ms` while the page is
// visible (the server shares one quote per pair between all users).
export function useLiveQuotes(pairs, headers, ms = 3000) {
  const [quotes, setQuotes] = useState({});
  const [updatedAt, setUpdatedAt] = useState(null);
  const key = [...new Set(pairs)].sort().join(",");

  useEffect(() => {
    if (!key) return undefined;
    let stop = false;
    let timer;
    const tick = async () => {
      if (document.visibilityState === "visible") {
        try {
          const res = await axios.get(`${API_URL}/api/market/live`, { headers, params: { pairs: key }, timeout: 8000 });
          if (!stop) {
            setQuotes(res.data.quotes || {});
            setUpdatedAt(Date.now());
          }
        } catch { /* keep the last quotes */ }
      }
      if (!stop) timer = setTimeout(tick, ms);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [key, headers, ms]);

  return { quotes, updatedAt };
}

// A clock that re-renders every `ms` (live durations).
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
