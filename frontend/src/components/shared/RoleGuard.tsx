import { Navigate } from 'react-router-dom';
import { Role } from '@/types/api';
import { useAuthStore } from '@/stores/authStore';
import { jwtRole } from '@/lib/jwt';

interface RoleGuardProps {
  allowed: Role[];
  children: React.ReactNode;
}

function RoleGuard({ allowed, children }: RoleGuardProps) {
  const { token, user } = useAuthStore();

  if (!token || !user) {
    return <Navigate to="/login" replace />;
  }

  // Trust the JWT's own role, not just client state - it can't be spoofed
  // by editing localStorage.
  const realRole = jwtRole(token);
  if (!realRole || !allowed.includes(realRole)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <>{children}</>;
}

export default RoleGuard;
