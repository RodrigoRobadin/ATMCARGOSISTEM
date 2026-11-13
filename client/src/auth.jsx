// client/src/auth.jsx
import React, { createContext, useContext, useState, useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import api, { saveAuth, loadSavedAuth } from "./api";
import { DEFAULT_FONT_SCALE, readFontScale, saveFontScale } from "./utils/fontPreference.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fontPreference, setFontPreference] = useState({ userId: null, scale: DEFAULT_FONT_SCALE });
  const fontScale = user?.id && fontPreference.userId === user.id
    ? fontPreference.scale
    : readFontScale(user?.id);

  useEffect(() => {
    document.documentElement.style.fontSize = fontScale === DEFAULT_FONT_SCALE ? "" : `${fontScale}%`;
  }, [fontScale]);

  const changeFontScale = (value) => {
    if (!user?.id) return;
    const scale = saveFontScale(user.id, value);
    setFontPreference({ userId: user.id, scale });
  };

  useEffect(() => {
    const { token: savedToken, user: savedUser } = loadSavedAuth();

    if (!savedToken) {
      // Intentar sesiÃ³n de cookie si no hay token
      api
        .get("/auth/me")
        .then((res) => {
          const me = res.data;
          setUser(me);
          setToken("SESSION");
          saveAuth({ token: "SESSION", user: me });
        })
        .catch(() => {
          saveAuth({ token: null, user: null });
          setUser(null);
          setToken(null);
        })
        .finally(() => setLoading(false));
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
      .catch(async () => {
        try {
          const { data: me } = await api.get("/auth/me");
          setUser(me);
          setToken("SESSION");
          saveAuth({ token: "SESSION", user: me });
        } catch {
          saveAuth({ token: null, user: null });
          setUser(null);
          setToken(null);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async ({ email, password }) => {
    // 1) Intentar login con JWT
    try {
      const res = await api.post("/users/login", { email, password });
      const { token: t, user: u } = res.data || {};
      if (t) {
        setUser(u || null);
        setToken(t);
        saveAuth({ token: t, user: u });
        return u;
      }
    } catch (_) {
      // fallback a sesiÃ³n
    }

    // 2) Fallback: login por sesiÃ³n
    const res2 = await api.post("/auth/login", { email, password });
    const { user: u2 } = res2.data || {};
    if (!u2) throw new Error("Respuesta de login sin usuario");
    setUser(u2);
    setToken("SESSION");
    saveAuth({ token: "SESSION", user: u2 });
    return u2;
  };

  const logout = () => {
    api.post("/auth/logout").catch(() => {});
    saveAuth({ token: null, user: null });
    setUser(null);
    setToken(null);
  };

  const refreshUser = async () => {
    const { data: freshUser } = await api.get("/users/me");
    setUser(freshUser);
    saveAuth({ token, user: freshUser });
    return freshUser;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        login,
        logout,
        refreshUser,
        fontScale,
        changeFontScale,
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
