import api from '@/api/client';
import type { User } from '@/types/api';

// ── Profile (self-service) ────────────────────────────────────────────────────

export async function getMyProfile(): Promise<User> {
  const res = await api.get('/auth/me');
  return res.data.data as User;
}

export async function updateMyProfile(data: {
  name?: string;
  phone?: string;
  currentPassword?: string;
  newPassword?: string;
}): Promise<User> {
  const res = await api.patch('/auth/me', data);
  return res.data.data as User;
}

export function getErrorMessage(err: unknown): string {
  const anyErr = err as { response?: { data?: { message?: string } } };
  return anyErr?.response?.data?.message || 'Something went wrong. Please try again.';
}
