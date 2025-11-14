// client/src/auth.jsx
import React, { createContext, useContext, useState, useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import api, { saveAuth, loadSavedAuth } from "./api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  // Al montar: intentamos recuperar token/user y validar con /users/me
  useEffect(() => {
    const { token: savedToken, user: savedUser } = loadSavedAuth();

    if (!savedToken) {
      // No hay token → no logueado
      setUser(null);
      setToken(null);
      setLoading(false);
      return;
    }

    setToken(savedToken);
    if (savedUser) setUser(savedUser);

    api
      .get("/users/me")
      .then((res) => {
        const me = res.data;
        setUser(me);
        saveAuth({ token: savedToken, user: me });
        if (import.meta.env?.DEV) {
          console.debug("[auth] /users/me ok", me);
        }
      })
      .catch((err) => {
        console.warn(
          "[auth] /users/me error",
          err?.response?.status,
          err?.message
        );
        saveAuth({ token: null, user: null });
        setUser(null);
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  // ---- LOGIN ----
  const login = async ({ email, password }) => {
    // Backend JWT: POST /users/login => { token, user }
    const res = await api.post("/users/login", { email, password });
    const { token: t, user: u } = res.data || {};

    if (!t) {
      throw new Error("Respuesta de login sin token");
    }

    setUser(u || null);
    setToken(t);
    saveAuth({ token: t, user: u });

    if (import.meta.env?.DEV) {
      console.debug("[auth] login ok, user:", u, "token:", t);
    }

    return u;
  };

  // ---- LOGOUT ----
  const logout = () => {
    saveAuth({ token: null, user: null });
    setUser(null);
    setToken(null);
  };

  const value = {
    user,
    token,
    loading,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Hook para usar auth fácilmente
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

// ---- Ruta protegida: requiere estar logueado ----
export function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-slate-500">
        Cargando sesión...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}

// ---- Ruta protegida por rol (string o array) ----
export function RequireRole({ allow, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-slate-500">
        Cargando sesión...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  const role = (user.role || "").toLowerCase();
  const allowed = Array.isArray(allow)
    ? allow.map((r) => String(r).toLowerCase())
    : [String(allow).toLowerCase()];

  if (!allowed.includes(role)) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-xl font-semibold mb-2">Acceso denegado</h1>
        <p className="text-sm text-slate-600">
          Tu rol (<b>{role || "sin rol"}</b>) no tiene permiso para ver esta
          sección.
        </p>
      </div>
    );
  }

  return children;
}