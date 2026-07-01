import { useAuthStore } from '@/stores/useAuthStore';
import React from 'react';
import { Navigate, useLocation } from 'react-router';


interface ProtectedRouteProps {
  children: React.JSX.Element;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps): React.JSX.Element {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const location = useLocation();

  if (!isAuthenticated) {
    // Redirection vers /login en conservant l'historique de navigation
    return <Navigate to="auth/login" state={{ from: location }} replace />;
  }

  return children;
}
