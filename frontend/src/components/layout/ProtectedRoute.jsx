import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Loading from '../ui/Loading';

/** roles: optional array of allowed role_keys. Omit to allow any authenticated user. */
export default function ProtectedRoute({ children, roles }) {
  const { user, initializing } = useAuth();
  const location = useLocation();

  if (initializing) return <div className="p-10"><Loading /></div>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  // A temporary password (issued by an admin/branch admin) must be changed before anything
  // else — mirrors the same rule the backend enforces on every other API route.
  if (user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  if (roles && !roles.includes(user.roleKey)) {
    return (
      <div className="mx-auto max-w-xl p-10 text-center">
        <p className="text-lg font-semibold text-slate-800">You do not have permission to view this page.</p>
      </div>
    );
  }
  return children;
}
