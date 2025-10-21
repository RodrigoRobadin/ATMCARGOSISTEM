// client/src/auth/AuthContext.jsx
import React, { createContext, useContext, useMemo, useState, useEffect } from 'react';
import { api } from '../api';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('auth_user');
    return raw ? JSON.parse(raw) : null;
  });
  const [loading, setLoading] = useState(false);

  async function login(email, password) {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('auth_token', data.token);
    localStorage.setItem('auth_user', JSON.stringify(data.user));
    setUser(data.user);
  }

  function logout() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    setUser(null);
  }

  // opcional: refrescar /me al cargar si hay token
  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token || user) return;
    (async () => {
      try {
        setLoading(true);
        const { data } = await api.get('/auth/me');
        setUser(data);
        localStorage.setItem('auth_user', JSON.stringify(data));
      } catch {
        logout();
      } finally {
        setLoading(false);
      }
    })();
  }, []); // eslint-disable-line

  const value = useMemo(() => ({ user, role: user?.role, login, logout, loading }), [user, loading]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  return useContext(AuthCtx);
}
