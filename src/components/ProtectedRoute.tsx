import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export const ProtectedRoute: React.FC = () => {
  const { user, loading } = useAuth();

  if (loading) return <div>Loading...</div>;

  if (!user) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
};

export const AdminRoute: React.FC = () => {
  const { isAdmin, loading } = useAuth();

  if (loading) return <div>Loading...</div>;

  if (!isAdmin) {
    return <Navigate to="/app" replace />;
  }

  return <Outlet />;
};
