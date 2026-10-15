import { notify, signOutDialog } from '@/lib/alert';
import { queryClient } from '@/lib/queryClient';
import { socket } from '@/lib/socket';
import { useAuthStore } from '@/stores/authStore';

export async function confirmAndSignOut(
  logout: () => void,
  navigate: (path: string, opts?: { replace?: boolean }) => void,
): Promise<void> {
  const user = useAuthStore.getState().user;
  const confirmed = await signOutDialog(user);
  if (!confirmed) return;

  // Drop the live connection and every cached response so the next person to
  // sign in on this browser never sees the previous user's data.
  socket.disconnect();
  queryClient.clear();
  logout();
  navigate('/login', { replace: true });

  const firstName = user?.name?.split(' ')[0];
  notify('success', 'Signed out', firstName ? `See you soon, ${firstName}.` : "You've been signed out of your workspace.", 3500);
}
