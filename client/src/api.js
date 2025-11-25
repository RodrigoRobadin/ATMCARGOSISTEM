// client/src/api.js
import axios from "axios";

export const TOKEN_KEY = "token";
export const USER_KEY = "user";

// ----------- Detectar si estamos en localhost o en dominio -----------
function isLocalHost() {
  if (typeof window === "undefined") return false;
  const origin = window.location.origin;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

// BASE:
// - Si estoy en localhost → http://localhost:4000/api
// - Si estoy en dominio (VPS) → /api  (pasa por Nginx)
const BASE = isLocalHost()
  ? "http://localhost:4000/api"
  : "/api";

// ---- helper para leer token REAL de storage ----
function getRawToken() {
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t || t === "SESSION") return null;
    return t;
  } catch {
    return null;
  }
}

// instancia de axios
export const api = axios.create({
  baseURL: BASE,
  withCredentials: false,
});

// Interceptor de request
api.interceptors.request.use((cfg) => {
  try {
    const t = getRawToken();
    if (t) {
      cfg.headers = cfg.headers || {};
      cfg.headers.Authorization = `Bearer ${t}`;
    }

    // si alguien pasa "/api/..." por error, lo limpiamos
    if (typeof cfg.url === "string" && cfg.url.startsWith("/api/")) {
      cfg.url = cfg.url.slice(4);
    }
  } catch {
    // noop
  }
  return cfg;
});

// Interceptor de response
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err?.response?.status;
    const url = err?.config?.url || "";

    if (status === 401) {
      try {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
      } catch {
        // noop
      }
    }
    return Promise.reject(err);
  }
);

// Helpers de auth
export function saveAuth({ token, user }) {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }

    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(USER_KEY);
    }
  } catch {
    // noop
  }
}

export function loadSavedAuth() {
  let t = null;
  let u = null;
  try {
    t = localStorage.getItem(TOKEN_KEY) || null;
  } catch {
    t = null;
  }

  try {
    const raw = localStorage.getItem(USER_KEY);
    u = raw ? JSON.parse(raw) : null;
  } catch {
    u = null;
  }

  return { token: t, user: u };
}

export default api;