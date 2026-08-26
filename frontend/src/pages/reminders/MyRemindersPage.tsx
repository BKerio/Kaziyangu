import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, ChevronLeft as CaretLeft, ChevronRight as CaretRight, Pencil as PencilSimple, Trash2 } from 'lucide-react';
import api from '@/api/client';
import { createReminder, deleteReminder, listReminders, updateReminder } from '@/api/reminders';
import { useNotificationStore } from '@/stores/notificationStore';
import { useTaskOptions } from '@/hooks/useTaskOptions';
import { PaginatedResponse, TaskReminder, WorkTask } from '@/types/api';
import { confirmDialog } from '@/lib/alert';
import { fmtDate, fmtDateTime, NBO_TZ } from '@/lib/datetime';
import ReminderFormModal, { ReminderFormValues } from '@/components/reminders/ReminderFormModal';

const LEAD_MINUTES = 30;
const INTERVAL_MINUTES = 10;

function fmtClock(d: Date): string {
  return d.toLocaleTimeString('en-US', { timeZone: NBO_TZ, hour: 'numeric', minute: '2-digit' });
}

function reminderStatusLabel(reminder: TaskReminder): string {
  if (reminder.status === 'DONE') return `Done · ${reminder.sentCount} sent`;
  if (reminder.status === 'ACTIVE') return `Sent ${reminder.sentCount}/${reminder.repeatCount}`;
  // SCHEDULED - show the upcoming fire times.
  const due = new Date(reminder.dueAt);
  const times = Array.from({ length: reminder.repeatCount }, (_, i) =>
    fmtClock(new Date(due.getTime() - LEAD_MINUTES * 60_000 + i * INTERVAL_MINUTES * 60_000))
  );
  return `Scheduled · ${times.join(', ')}`;
}

function MyRemindersPage() {
  const [page, setPage] = useState(1);
  const [reminderTarget, setReminderTarget] = useState<WorkTask | null>(null); // creating for this task
  const [editing, setEditing] = useState<TaskReminder | null>(null);
  const { addNotification } = useNotificationStore();
  const queryClient = useQueryClient();
  const { data: options } = useTaskOptions();

  const verticalLabel = (v: string) => options?.verticals.find((o) => o.value === v)?.label ?? v;

  const { data: taskData, isLoading: tasksLoading } = useQuery({
    queryKey: ['tasks', 'mine', 'for-reminders', page],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<WorkTask>>('/tasks', { params: { page, limit: 15 } });
      return res.data;
    },
  });

  const { data: reminders } = useQuery({
    queryKey: ['reminders'],
    queryFn: listReminders,
  });

  const remindersByTask = new Map((reminders ?? []).map((r) => [r.taskId, r]));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['reminders'] });
  };

  const createMutation = useMutation({
    mutationFn: (values: ReminderFormValues) => createReminder({ taskId: reminderTarget!.id, ...values }),
    onSuccess: () => {
      invalidate();
      setReminderTarget(null);
      addNotification({ type: 'success', title: 'Reminder set', message: 'You\'ll be nudged before this task is due.' });
    },
    onError: (err: any) => addNotification({ type: 'error', title: 'Failed to set reminder', message: err?.response?.data?.message || 'Please try again.' }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: ReminderFormValues }) => updateReminder(id, values),
    onSuccess: () => {
      invalidate();
      setEditing(null);
      addNotification({ type: 'success', title: 'Reminder updated', message: 'Changes have been saved.' });
    },
    onError: (err: any) => addNotification({ type: 'error', title: 'Update failed', message: err?.response?.data?.message || 'Please try again.' }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteReminder,
    onSuccess: () => {
      invalidate();
      addNotification({ type: 'success', title: 'Reminder removed', message: 'The reminder has been cancelled.' });
    },
    onError: (err: any) => addNotification({ type: 'error', title: 'Failed to remove', message: err?.response?.data?.message || 'Please try again.' }),
  });

  const handleCancelReminder = async (reminder: TaskReminder) => {
    const confirmed = await confirmDialog({
      title: 'Cancel reminder',
      text: 'This reminder will no longer be sent. You can set a new one any time.',
      confirmLabel: 'Cancel reminder',
      danger: true,
    });
    if (confirmed) deleteMutation.mutate(reminder.id);
  };

  const tasks = taskData?.data ?? [];
  const meta = taskData?.meta ?? { total: 0, page: 1, limit: 15, totalPages: 0 };

  return (
    <div className="col" style={{ gap: 20 }}>
      <div>
        <p className="eyebrow">Stay on track</p>
        <h2 className="text-2xl font-bold mt-1" style={{ color: 'var(--ink)' }}>Task Reminders</h2>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Pick a due time for any task and get nudged by SMS, Email or WhatsApp before it's due.
        </p>
      </div>

      <div className="card">
        {tasksLoading ? (
          <div className="card-pad"><div className="skel" style={{ height: 200 }} /></div>
        ) : tasks.length === 0 ? (
          <div className="card-pad flex flex-col items-center text-center" style={{ gap: 8, padding: '48px 20px' }}>
            <BellRing size={32} style={{ color: 'var(--red)' }} />
            <p className="text-base font-bold" style={{ color: 'var(--ink)' }}>No tasks to remind you about yet</p>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>Log a task first, then come back here to set a reminder.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                  {['Date', 'Vertical', 'Task', 'Reminder', ''].map((h) => (
                    <th key={h} style={{ padding: '10px 14px', color: 'var(--muted)', fontWeight: 650, fontSize: 12 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => {
                  const reminder = remindersByTask.get(t.id);
                  return (
                    <tr key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>{fmtDate(t.date)}</td>
                      <td style={{ padding: '10px 14px' }}>{verticalLabel(t.vertical)}</td>
                      <td style={{ padding: '10px 14px', maxWidth: 320 }}>{t.description}</td>
                      <td style={{ padding: '10px 14px' }}>
                        {reminder ? (
                          <div className="col" style={{ gap: 2 }}>
                            <span className="pill">{reminderStatusLabel(reminder)}</span>
                            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                              Due {fmtDateTime(reminder.dueAt)} · {reminder.channels.join(', ')}
                            </span>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--muted-2)' }}>Not set</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                        {reminder ? (
                          <>
                            <button className="icon-btn" title="Edit reminder" onClick={() => setEditing(reminder)}><PencilSimple size={14} /></button>
                            <button className="icon-btn" title="Cancel reminder" onClick={() => handleCancelReminder(reminder)}><Trash2 size={14} /></button>
                          </>
                        ) : (
                          <button className="btn btn-soft btn-sm" onClick={() => setReminderTarget(t)}>
                            <BellRing size={13} /> Set Reminder
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {meta.totalPages > 1 && (
          <div className="flex items-center justify-between card-pad" style={{ borderTop: '1px solid var(--border)' }}>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>Page {meta.page} of {meta.totalPages} · {meta.total} tasks</span>
            <div className="flex gap-2">
              <button className="btn btn-soft btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><CaretLeft size={14} /></button>
              <button className="btn btn-soft btn-sm" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}><CaretRight size={14} /></button>
            </div>
          </div>
        )}
      </div>

      {reminderTarget && (
        <ReminderFormModal
          task={reminderTarget}
          onClose={() => setReminderTarget(null)}
          submitting={createMutation.isPending}
          onSubmit={async (values) => { await createMutation.mutateAsync(values); }}
        />
      )}

      {editing && (
        <ReminderFormModal
          task={editing.task}
          initial={editing}
          onClose={() => setEditing(null)}
          submitting={updateMutation.isPending}
          onSubmit={async (values) => { await updateMutation.mutateAsync({ id: editing.id, values }); }}
        />
      )}
    </div>
  );
}

export default MyRemindersPage;
