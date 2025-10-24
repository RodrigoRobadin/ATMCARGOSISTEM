// client/src/api.js
import axios from 'axios';

export const TOKEN_KEY = 'token';
export const USER_KEY  = 'user';

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true, // envía/recibe la cookie de sesión (misma raíz de dominio)
});

// Bearer si existe token guardado
api.interceptors.request.use(cfg => {
  const t = localStorage.getItem(TOKEN_KEY);
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

export default api;

export function saveAuth({ token, user }) {
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
