// client/src/auth.jsx
import React, { createContext, useContext, useState, useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import api, { saveAuth, loadSavedAuth } from "./api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { token: savedToken, user: savedUser } = loadSavedAuth();

    if (!savedToken) {
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
      })
      .catch(() => {
        saveAuth({ token: null, user: null });
        setUser(null);
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async ({ email, password }) => {
    const res = await api.post("/users/login", { email, password });
    const { token: t, user: u } = res.data || {};

    if (!t) throw new Error("Respuesta de login sin token");

    setUser(u || null);
    setToken(t);
    saveAuth({ token: t, user: u });
    return u;
  };

  const logout = () => {
    saveAuth({ token: null, user: null });
    setUser(null);
    setToken(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

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