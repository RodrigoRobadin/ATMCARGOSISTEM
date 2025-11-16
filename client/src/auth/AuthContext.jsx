// client/src/auth/AuthContext.jsx
import React, { useCallback } from 'react';
import {
  AuthProvider as BaseAuthProvider,
  useAuth as useBaseAuth,
} from '../auth.jsx';

export function AuthProvider({ children }) {
  return <BaseAuthProvider>{children}</BaseAuthProvider>;
}

export function useAuth() {
  const ctx = useBaseAuth();
  if (!ctx) throw new Error('useAuth() debe usarse dentro de <AuthProvider>');

  const { user, token, loading, login, logout } = ctx;

  const wrappedLogin = useCallback(
    (email, password) => login({ email, password }),
    [login]
  );

  return {
    user,
    role: user?.role || null,
    token,
    loading,
    authReady: !loading,
    login: wrappedLogin,
    logout,
  };
}