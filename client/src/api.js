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

// axios instance
export const api = axios.create({
  baseURL: BASE,         // p.ej. http://localhost:4000/api o /api
  withCredentials: true, // importantísimo para cookie de sesión "sid"
});

// ==== Interceptor de request ====
// - Agrega Bearer si hay token
// - Evita que se duplique /api si accidentalmente pasás urls que empiecen con "/api/"
api.interceptors.request.use((cfg) => {
  try {
    // 1) Bearer
    const t = localStorage.getItem(TOKEN_KEY);
    if (t) {
      cfg.headers = cfg.headers || {};
      cfg.headers.Authorization = `Bearer ${t}`;
    }

    // 2) Evitar /api/api
    if (typeof cfg.url === "string") {
      if (cfg.url.startsWith("/api/")) {
        cfg.url = cfg.url.slice(4); // quita "/api"
      }
    }
  } catch {
    // noop
  }
  return cfg;
});

// ==== Interceptor de response: limpia credenciales en 401 (no redirige aquí) ====
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err?.response?.status;
    if (status === 401) {
      try {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
      } catch {
        // noop
      }
      // NO redirigimos desde aquí; el AuthProvider decide.
    }
    return Promise.reject(err);
  }
);

export default api;

export function saveAuth({ token, user }) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);

    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch {
    // noop
  }
}

export function loadSavedAuth() {
  const t = localStorage.getItem(TOKEN_KEY) || null;
  let u = null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    u = raw ? JSON.parse(raw) : null;
  } catch {
    u = null;
  }
  return { token: t, user: u };
}