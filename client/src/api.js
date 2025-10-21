// client/src/api.js
import axios from 'axios';
export const TOKEN_KEY = 'token';
export const USER_KEY  = 'user';

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,             // 👈 NECESARIO para enviar cookie de sesión
});

// Interceptor: si hay token guardado, lo manda como Bearer
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
