// client/src/auth.jsx
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api, saveAuth, loadSavedAuth, TOKEN_KEY, USER_KEY } from "./api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const didInit = useRef(false);

  const refresh = async () => {
    // 1) Levantá estado desde localStorage para evitar "logout instantáneo"
    const { token: savedToken, user: savedUser } = loadSavedAuth();
    if (savedToken || savedUser) {
      // Mostramos al menos el user guardado mientras validamos con el backend
      setUser(savedUser || user);
      setLoading(false); // evitá redirecciones mientras validamos /auth/me
    }

    // 2) Intentá validar sesión con el backend (cookie o bearer)
    try {
      const { data } = await api.get("/auth/me"); // si existe en tu API
      if (data && typeof data === "object") {
        setUser(data);
        // Actualizá el user persistido si llegó uno más completo
        saveAuth({ token: savedToken || localStorage.getItem(TOKEN_KEY), user: data });
      }
    } catch (err) {
      const status = err?.response?.status;
      if (status === 401) {
        // Sesión inválida → limpiar todo
        saveAuth({ token: null, user: null });
        setUser(null);
      } else if (status === 404) {
        // Tu backend no tiene /auth/me → NO deslogueamos. Se usará cookie+Bearer en las llamadas normales.
        // No hacemos nada.
      } else {
        // Errores de red u otros: no forzamos logout inmediato
      }
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
    // Soporta respuestas con { token, user } o solo { user } o 204 con cookie
    const { data } = await api.post("/auth/login", payload);

    const token = data?.token || null;
    const nextUser = data?.user ?? data ?? null;

    // Guardar lo que haya
    saveAuth({ token, user: nextUser });
    setUser(nextUser);

    return nextUser;
  };

  const logout = async () => {
    try {
      await api.post("/auth/logout"); // si tu backend lo expone; si no, sólo limpia local
    } catch {}
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
