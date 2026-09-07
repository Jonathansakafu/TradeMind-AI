import { useCallback, useMemo, useState } from "react";
import { AuthContext } from "./auth-context";

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
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setToken(null);
    setUser({});
  }, []);

  const updateUser = useCallback((nextUser) => {
    localStorage.setItem("user", JSON.stringify(nextUser));
    setUser(nextUser);
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
