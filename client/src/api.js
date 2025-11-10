// client/src/api.js
import axios from "axios";

export const TOKEN_KEY = "token";
export const USER_KEY = "user";

// Normaliza baseURL: si viene con /api o sin, dejamos UNA sola vez.
function normalizeBaseURL(raw) {
  if (!raw) return "/api";
  // quita espacios
  let u = String(raw).trim();
  // quita barra final duplicada
  u = u.replace(/\/+$/g, "");
  // si NO termina en /api, lo agregamos
  if (!/\/api$/.test(u)) u = u + "/api";
  return u;
}

// Usa VITE_API_URL si existe; garantizamos que termine en .../api
const BASE = normalizeBaseURL(import.meta.env?.VITE_API_URL);

// axios instance
export const api = axios.create({
  baseURL: BASE,         // p.ej. http://localhost:4000/api
  withCredentials: true, // si usás cookie de sesión
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
      // si la url empieza con "/api/", quitamos ese prefijo
      if (cfg.url.startsWith("/api/")) {
        cfg.url = cfg.url.slice(4); // quita "/api"
      }
      // recomendación: también soportar rutas SIN barra al inicio
      // (axios concatena bien con o sin barra, pero mantenemos consistencia)
    }
  } catch {}
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
      } catch {}
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
  } catch {}
}

export function loadSavedAuth() {
  const t = localStorage.getItem(TOKEN_KEY) || null;
  let u = null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    u = raw ? JSON.parse(raw) : null;
  } catch {}
  return { token: t, user: u };
}
