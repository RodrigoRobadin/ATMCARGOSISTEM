// client/src/api.js
import axios from "axios";

export const TOKEN_KEY = "token";
export const USER_KEY  = "user";

// Base URL segura para prod/dev (respeta Nginx /api en el mismo dominio)
const baseURL =
  (import.meta.env.VITE_API_BASE && import.meta.env.VITE_API_BASE.trim()) ||
  `${window.location.origin}/api`;

export const api = axios.create({
  baseURL,
  withCredentials: true, // para cookie de sesión si el backend la usa
});

function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

// Cargar token al boot (evita primer 401 en tablets/PWA)
(() => {
  const t = getToken();
  if (t) api.defaults.headers.Authorization = `Bearer ${t}`;
})();

// Interceptor request: siempre mandar el Bearer si existe
api.interceptors.request.use((cfg) => {
  const t = getToken();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

// Interceptor response: si el token es inválido/expiró ⇒ limpiar y mandar a /login
api.interceptors.response.use(
  (r) => r,
  (err) => {
    const st = err?.response?.status;
    const msg = String(err?.response?.data?.error || "").toLowerCase();
    if (st === 401 || st === 403 || msg.includes("token")) {
      try {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
      } catch {}
      delete api.defaults.headers.Authorization;
      if (!location.pathname.startsWith("/login")) {
        location.href = "/login";
      }
    }
    return Promise.reject(err);
  }
);

export default api;

// Guardar/limpiar auth y sincronizar header por defecto
export function saveAuth({ token, user }) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    api.defaults.headers.Authorization = `Bearer ${token}`;
  } else {
    localStorage.removeItem(TOKEN_KEY);
    delete api.defaults.headers.Authorization;
  }
  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(USER_KEY);
  }
}
