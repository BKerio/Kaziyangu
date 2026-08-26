import { confirmDialog, notify } from '@/lib/alert';

export async function confirmAndSignOut(
  logout: () => void,
  navigate: (path: string) => void,
): Promise<void> {
  const confirmed = await confirmDialog({
    title: 'Sign Out',
    text: "Are you sure you want to sign out? You'll need to log in again.",
    confirmLabel: 'Sign Out',
    danger: true,
  });
  if (!confirmed) return;

  notify('success', 'Signed out', "You've been signed out of your workspace.");
  logout();
  navigate('/login');
}
