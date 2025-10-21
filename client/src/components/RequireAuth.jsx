// client/src/components/RequireAuth.jsx
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const loc = useLocation();

  if (loading) return <div className="p-4 text-sm text-slate-600">Verificando sesión…</div>;
  if (!user) return <Navigate to="/login" state={{ from: loc }} replace />;

  return children;
}
