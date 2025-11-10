// client/src/auth.jsx
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api, saveAuth, loadSavedAuth, TOKEN_KEY } from "./api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const didInit = useRef(false);

  const refresh = async () => {
    const { token: savedToken, user: savedUser } = loadSavedAuth();
    if (savedUser) setUser(savedUser);

    try {
      // OJO: sin "/" inicial (queda baseURL + "auth/me")
      const { data } = await api.get("auth/me");
      if (data && typeof data === "object") {
        setUser(data);
        saveAuth({
          token: data?.token || savedToken || localStorage.getItem(TOKEN_KEY) || null,
          user: data,
        });
      }
    } catch (err) {
      const status = err?.response?.status;
      if (status === 401) {
        saveAuth({ token: null, user: null });
        setUser(null);
      } else if (status !== 404) {
        console.warn("Auth refresh error:", err?.message || err);
      }
    } finally {
      setAuthReady(true);
    }
  };

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    refresh();
  }, []);

  const login = async (payload) => {
    // SIN "/" inicial y SIN "/api"
    const res = await api.post("auth/login", payload);
    const data = res?.data;

    const token = data?.token || null;
    const nextUser = data?.user ?? (data && typeof data === "object" ? data : null);

    saveAuth({ token, user: nextUser || user });

    if (!nextUser) {
      try {
        const me = await api.get("auth/me").then((r) => r.data);
        if (me && typeof me === "object") {
          saveAuth({ token: token || null, user: me });
          setUser(me);
          return me;
        }
      } catch (e) {
        console.warn("fetch auth/me after login failed:", e?.message || e);
      }
    }

    setUser(nextUser || null);
    return nextUser || null;
  };

  const logout = async () => {
    try {
      await api.post("auth/logout"); // si existe
    } catch {}
    saveAuth({ token: null, user: null });
    setUser(null);
  };

  return (
    <AuthCtx.Provider value={{ user, authReady, login, logout, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  return useContext(AuthCtx);
}

export function RequireAuth({ children }) {
  const { user, authReady } = useAuth();
  const loc = useLocation();
  if (!authReady) return null;
  if (!user) return <Navigate to="/login" replace state={{ from: loc }} />;
  return children;
}

export function RequireRole({ role, children }) {
  const { user, authReady } = useAuth();
  if (!authReady) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (role && !Array.isArray(user?.roles)?.includes(role)) return <Navigate to="/" replace />;
  return children;
}
