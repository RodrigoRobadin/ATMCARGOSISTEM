// client/src/components/RequireRole.jsx
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function RequireRole({ allow = [], children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!allow.includes(user.role)) {
    return <div className="p-4 text-sm text-red-600">Permiso denegado.</div>;
  }
  return children;
}
