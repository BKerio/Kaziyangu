import { ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNotificationStore } from '@/stores/notificationStore';

export function SectionHeading({ children, action, color }: { children: ReactNode; action?: ReactNode; color?: string }) {
  return (
    <div className="flex items-center justify-between" style={{ gap: 8 }}>
      <h4 className="text-xs font-bold uppercase" style={{ color: color ?? 'var(--muted)', letterSpacing: '.06em' }}>{children}</h4>
      {action}
    </div>
  );
}

export const sectionStyle = { gap: 10, borderTop: '1px solid var(--border)', paddingTop: 16 } as const;
export const rowCardStyle = { padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)', fontSize: 12.5 } as const;

/**
 * A mutation that refreshes everything opportunity/customer related and
 * reports success/failure through the notification toast.
 */
export function useOpportunityMutation<TVars>(
  fn: (vars: TVars) => Promise<unknown>,
  messages: { success: string; error: string },
  onDone?: () => void,
) {
  const queryClient = useQueryClient();
  const { addNotification } = useNotificationStore();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opportunities'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['oems'] });
      addNotification({ type: 'success', title: messages.success, message: '' });
      onDone?.();
    },
    onError: (err: any) =>
      addNotification({ type: 'error', title: messages.error, message: err?.response?.data?.message || 'Please try again.' }),
  });
}

/** '' -> undefined for optional text fields before sending. */
export function clean<T extends Record<string, unknown>>(values: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) out[k] = v === '' ? undefined : v;
  return out as T;
}
