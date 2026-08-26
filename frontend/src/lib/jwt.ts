import { Role } from '@/types/api';

/** Reads the real login role out of the JWT payload - immune to any local UI override. */
export function jwtRole(token: string | null): Role | null {
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return (JSON.parse(json).role as Role) ?? null;
  } catch {
    return null;
  }
}
