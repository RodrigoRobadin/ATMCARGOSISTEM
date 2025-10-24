// src/auth.jsx
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api, saveAuth } from "./api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const didInit = useRef(false);

  const refresh = async () => {
    try {
      // Asegura que el Authorization esté precargado si hay token persistido
      try {
        const raw = localStorage.getItem("token");
        if (raw) api.defaults.headers.Authorization = `Bearer ${raw}`;
      } catch {}
      const { data } = await api.get("/auth/me");
      setUser(data || null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    refresh();
  }, []);

  const login = async (payload) => {
    const { data } = await api.post("/auth/login", payload);
    // si el backend devuelve { token, user }, guardamos ambos; si no, igual seteamos user
    if (data?.token) {
      saveAuth({ token: data.token, user: data.user ?? null });
    }
    const nextUser = data?.user ?? data ?? null;
    setUser(nextUser);
    return nextUser;
  };

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch {}
    saveAuth({ token: null, user: null });
    setUser(null);
  };

  return (
    <AuthCtx.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  return useContext(AuthCtx);
}

export function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace state={{ from: loc }} />;
  return children;
}

export function RequireRole({ role, children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (role && !user?.roles?.includes(role)) return <Navigate to="/" replace />;
  return children;
}
