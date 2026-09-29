import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { AuthContext } from "./auth-context";
import { disablePush } from "../utils/pushNotifications";

function readUser() {
  try {
    return JSON.parse(localStorage.getItem("user") || "{}");
  } catch {
    return {};
  }
}

// Seeds once from localStorage instead of every consumer re-reading/
// re-parsing it on every render (layouts/pages previously did this
// independently in ~15 places). login/logout/updateUser keep localStorage
// and this context in sync so every consumer updates together.
export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem("token"));
  const [user, setUser] = useState(readUser);

  const login = useCallback((nextToken, nextUser) => {
    localStorage.setItem("token", nextToken);
    localStorage.setItem("user", JSON.stringify(nextUser));
    setToken(nextToken);
    setUser(nextUser);
  }, []);

  const logout = useCallback(() => {
    // Detach this device from the account first (while the token still
    // works), so a logged-out phone/browser stops getting its signals.
    const oldToken = localStorage.getItem("token");
    if (oldToken) {
      disablePush({ Authorization: `Bearer ${oldToken}` })
        .catch((err) => console.warn("Push unregister on logout failed:", err.message));
    }
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setToken(null);
    setUser({});
  }, []);

  const updateUser = useCallback((nextUser) => {
    localStorage.setItem("user", JSON.stringify(nextUser));
    setUser(nextUser);
  }, []);

  // A login expires after 7 days (JWT). Without this the app kept acting
  // logged in while every request quietly failed; now the backend's
  // "not logged in" answers (authMiddleware's 401 messages) end the
  // session cleanly so ProtectedRoute sends the user to the login page.
  useEffect(() => {
    const AUTH_FAILURES = ["Not authorized", "No token provided", "User not found"];
    const id = axios.interceptors.response.use(undefined, (error) => {
      if (error.response?.status === 401 && AUTH_FAILURES.includes(error.response.data?.message) && localStorage.getItem("token")) {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        setToken(null);
        setUser({});
      }
      return Promise.reject(error);
    });
    return () => axios.interceptors.response.eject(id);
  }, []);

  const headers = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : {}),
    [token]
  );

  const value = useMemo(
    () => ({ token, user, headers, login, logout, updateUser }),
    [token, user, headers, login, logout, updateUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
