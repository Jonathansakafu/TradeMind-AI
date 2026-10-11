import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { API_URL } from "../config/api";
import { useAuth } from "./useAuth";

// Risk settings (balance, risk % per trade, daily loss limit) + today's P/L
// and whether the daily loss limit is hit. GET/PUT /api/auth/risk-settings.
export function useRiskSettings() {
  const { headers } = useAuth();
  const [settings, setSettings] = useState(null);
  const reload = useCallback(
    () => axios.get(`${API_URL}/api/auth/risk-settings`, { headers }).then((r) => setSettings(r.data)).catch(() => {}),
    [headers]
  );
  useEffect(() => { reload(); }, [reload]);
  const save = async (patch) => {
    await axios.put(`${API_URL}/api/auth/risk-settings`, patch, { headers });
    await reload();
  };
  return { settings, save, reload };
}
