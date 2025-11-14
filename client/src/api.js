// client/src/api.js
import axios from "axios";

export const TOKEN_KEY = "token";
export const USER_KEY = "user";

// Normaliza baseURL: si viene con /api o sin, dejamos UNA sola vez.
function normalizeBaseURL(raw) {
  if (!raw) return "/api";
  let u = String(raw).trim();
  // quita barras finales
  u = u.replace(/\/+$/g, "");
  // si NO termina en /api, lo agregamos
  if (!/\/api$/i.test(u)) u = u + "/api";
  return u;
}

// ----- Resolución de BASE URL -----
// Prioridad:
// 1) VITE_API_URL (si está definida)
// 2) Si estoy en localhost/127.0.0.1 -> http://localhost:4000/api
// 3) Producción (dominio) -> /api
let BASE;

const RAW = import.meta.env?.VITE_API_URL;

if (RAW && String(RAW).trim() !== "") {
  // Caso explícito por .env
  BASE = normalizeBaseURL(RAW);
} else {
  // Caso sin .env: decidimos según el host del navegador
  let isLocal = false;
  try {
    if (typeof window !== "undefined") {
      const origin = window.location.origin;
      isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
    }
  } catch {
    // SSR o algo raro -> asumimos producción
    isLocal = false;
  }

  if (isLocal) {
    // Entorno local: front en 5173, API en 4000
    BASE = "http://localhost:4000/api";
  } else {
    // Producción: mismo dominio, Nginx proxy_pass /api -> 4000
    BASE = "/api";
  }
}

// ---- helper para leer token REAL de storage ----
function getRawToken() {
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t || t === "SESSION") return null; // por si quedó basura vieja
    return t;
  } catch {
    return null;
  }
}

// axios instance
export const api = axios.create({
  baseURL: BASE,        // p.ej. http://localhost:4000/api o /api
  withCredentials: false, // con JWT no necesitamos cookies de sesión
});

// ==== Interceptor de request ====
// - Agrega Bearer si hay token
// - Evita que se duplique /api si accidentalmente pasás urls que empiecen con "/api/"
api.interceptors.request.use((cfg) => {
  try {
    const t = getRawToken();
    if (t) {
      cfg.headers = cfg.headers || {};
      cfg.headers.Authorization = `Bearer ${t}`;
    }

    if (typeof cfg.url === "string" && cfg.url.startsWith("/api/")) {
      cfg.url = cfg.url.slice(4); // quita "/api"
    }

    if (import.meta.env?.DEV) {
      console.debug(
        "[api] request",
        cfg.method?.toUpperCase(),
        cfg.url,
        "token?",
        !!t
      );
    }
  } catch {
    // noop
  }
  return cfg;
});

// ==== Interceptor de response: limpia credenciales en 401 ====
// (NO redirige; eso lo maneja el AuthProvider)
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err?.response?.status;
    const url = err?.config?.url || "";

    if (status === 401) {
      if (import.meta.env?.DEV) {
        console.warn("[api] 401 en", url);
      }
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

export default api;

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