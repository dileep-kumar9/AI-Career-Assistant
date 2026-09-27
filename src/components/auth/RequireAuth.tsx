import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

/** When sign-in is configured, the builder and "My resumes" need an account. */
export const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { enabled, user, loading } = useAuth();
  const location = useLocation();
  if (!enabled) return <>{children}</>;
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children}</>;
};
