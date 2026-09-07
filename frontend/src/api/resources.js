import axios from "axios";
import { API_URL } from "../config/api";

// Canonical fetchers for useResource() — one definition per shared
// resource key, so every polling site reads/writes the same shape.

export async function fetchMarketPrices(headers) {
  const res = await axios.get(`${API_URL}/api/market/prices`, { headers });
  return res.data.prices || {};
}

export async function fetchNotifications(headers) {
  const res = await axios.get(`${API_URL}/api/notifications`, { headers });
  return {
    notifications: res.data.notifications || [],
    unreadCount: res.data.unreadCount || 0,
  };
}

export async function fetchActiveSession(headers) {
  const res = await axios.get(`${API_URL}/api/sessions/active`, { headers });
  return {
    session: res.data.session || null,
    progress: res.data.progress || { currentPL: 0, tradeCount: 0 },
  };
}

export async function fetchMt5Dashboard(headers) {
  const [signalsRes, statsRes] = await Promise.all([
    axios.get(`${API_URL}/api/mt5/signals`, { headers }),
    axios.get(`${API_URL}/api/mt5/stats`, { headers }),
  ]);
  return { signals: signalsRes.data || [], stats: statsRes.data || null };
}
