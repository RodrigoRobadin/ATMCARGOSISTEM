import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { api, setAuthToken } from '../api/client';

const TOKEN_KEY = 'atmcargosistem.token';
const USER_KEY = 'atmcargosistem.user';
const RESTORE_TIMEOUT_MS = 18000;

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    function withTimeout(promise, ms, message) {
      return Promise.race([
        promise,
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error(message)), ms);
        }),
      ]);
    }
    async function restore() {
      try {
        const savedToken = await withTimeout(
          SecureStore.getItemAsync(TOKEN_KEY),
          RESTORE_TIMEOUT_MS,
          'No se pudo leer la sesion guardada'
        );
        const savedUser = await withTimeout(
          SecureStore.getItemAsync(USER_KEY),
          RESTORE_TIMEOUT_MS,
          'No se pudo leer el usuario guardado'
        );
        if (!mounted) return;
        if (savedToken) {
          setAuthToken(savedToken);
          setToken(savedToken);
          setUser(savedUser ? JSON.parse(savedUser) : null);
          try {
            const boot = await api.bootstrap();
            if (mounted && boot?.user) {
              setUser(boot.user);
              await SecureStore.setItemAsync(USER_KEY, JSON.stringify(boot.user));
            }
          } catch {
            await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => null);
            await SecureStore.deleteItemAsync(USER_KEY).catch(() => null);
            setAuthToken(null);
            if (mounted) {
              setToken(null);
              setUser(null);
            }
          }
        }
      } catch {
        setAuthToken(null);
        if (mounted) {
          setToken(null);
          setUser(null);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    restore();
    return () => {
      mounted = false;
    };
  }, []);

  const value = useMemo(
    () => ({
      token,
      user,
      loading,
      async login(email, password) {
        const result = await api.login(email, password);
        if (!result?.token || !result?.user) throw new Error('Login sin token');
        setAuthToken(result.token);
        setToken(result.token);
        setUser(result.user);
        await SecureStore.setItemAsync(TOKEN_KEY, result.token);
        await SecureStore.setItemAsync(USER_KEY, JSON.stringify(result.user));
      },
      async logout() {
        setAuthToken(null);
        setToken(null);
        setUser(null);
        await SecureStore.deleteItemAsync(TOKEN_KEY);
        await SecureStore.deleteItemAsync(USER_KEY);
      },
    }),
    [loading, token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
