import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ChevronLeft as CaretLeft, ChevronRight as CaretRight, ListChecks } from 'lucide-react';
import api from '@/api/client';
import { uploadTaskAttachments } from '@/lib/taskAttachments';
import { useNotificationStore } from '@/stores/notificationStore';
import { useTaskOptions } from '@/hooks/useTaskOptions';
import { PaginatedResponse, User, WorkTask } from '@/types/api';
import { buildCustomerGroups } from '@/utils/customerSequence';
import { confirmDialog } from '@/lib/alert';
import TaskFormModal, { TaskFormValues } from '@/components/tasks/TaskFormModal';
import TaskDetailModal from '@/components/tasks/TaskDetailModal';
import TaskTableRow from '@/components/tasks/TaskTableRow';

function TeamTasksPage() {
  const [page, setPage] = useState(1);
  const [userFilter, setUserFilter] = useState('');
  const [verticalFilter, setVerticalFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<WorkTask | null>(null);
  const [viewing, setViewing] = useState<WorkTask | null>(null);
  const { addNotification } = useNotificationStore();
  const queryClient = useQueryClient();
  const { data: options } = useTaskOptions();

  const verticalLabel = (v: string) => options?.verticals.find((o) => o.value === v)?.label ?? v;
  const categoryLabel = (c: string) => options?.categories.find((o) => o.value === c)?.label ?? c;
  const statusLabel = (s: string) => options?.statuses.find((o) => o.value === s)?.label ?? s;

  const { data: usersResponse } = useQuery({
    queryKey: ['admin', 'users', 'all'],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<User>>('/admin/users', { params: { limit: 200 } });
      return res.data.data;
    },
  });
  const users = usersResponse ?? [];

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', 'team', page, userFilter, verticalFilter, statusFilter],
    queryFn: async () => {
      const params: Record<string, string | number> = { page, limit: 15 };
      if (userFilter) params.userId = userFilter;
      if (verticalFilter) params.vertical = verticalFilter;
      if (statusFilter) params.status = statusFilter;
      const res = await api.get<PaginatedResponse<WorkTask>>('/tasks', { params });
      return res.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async ({ values, files }: { values: TaskFormValues; files: File[] }) => {
      const res = await api.post<{ data: WorkTask }>('/tasks', values);
      await uploadTaskAttachments(res.data.data.id, files);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', 'team'] });
      queryClient.invalidateQueries({ queryKey: ['tasks', 'my-stats'] });
      setModalOpen(false);
      addNotification({ type: 'success', title: 'Task logged', message: 'The task entry has been saved.' });
    },
    onError: (err: any) => addNotification({ type: 'error', title: 'Failed to save', message: err?.response?.data?.message || 'Please try again.' }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, values, files }: { id: string; values: TaskFormValues; files: File[] }) => {
      const res = await api.patch(`/tasks/${id}`, values);
      await uploadTaskAttachments(id, files);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', 'team'] });
      queryClient.invalidateQueries({ queryKey: ['tasks', 'my-stats'] });
      setEditing(null);
      addNotification({ type: 'success', title: 'Task updated', message: 'Changes have been saved.' });
    },
    onError: (err: any) => addNotification({ type: 'error', title: 'Update failed', message: err?.response?.data?.message || 'Please try again.' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/tasks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', 'team'] });
      queryClient.invalidateQueries({ queryKey: ['tasks', 'my-stats'] });
      addNotification({ type: 'success', title: 'Task deleted', message: 'The entry has been removed.' });
    },
    onError: (err: any) => addNotification({ type: 'error', title: 'Delete failed', message: err?.response?.data?.message || 'Please try again.' }),
  });

  const handleDelete = async (task: WorkTask) => {
    const confirmed = await confirmDialog({
      title: 'Delete task',
      text: `Delete "${task.description.slice(0, 60)}" logged by ${task.user.name}? This can't be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (confirmed) deleteMutation.mutate(task.id);
  };

  const tasks = data?.data ?? [];
  const meta = data?.meta ?? { total: 0, page: 1, limit: 15, totalPages: 0 };
  const customerGroups = buildCustomerGroups(tasks);

  return (
    <div className="col" style={{ gap: 20 }}>
      <div className="flex items-center justify-between">
        <div>
          <p className="eyebrow">Team</p>
          <h2 className="text-2xl font-bold mt-1" style={{ color: 'var(--ink)' }}>Team Tasks</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Everything the team has logged, across all verticals</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModalOpen(true)}>
          <Plus size={16} /> Log Task
        </button>
      </div>

      <div className="card card-pad flex flex-wrap gap-3">
        <select className="eoc-select" value={userFilter} onChange={(e) => { setUserFilter(e.target.value); setPage(1); }} style={{ maxWidth: 220 }}>
          <option value="">All people</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select className="eoc-select" value={verticalFilter} onChange={(e) => { setVerticalFilter(e.target.value); setPage(1); }} style={{ maxWidth: 260 }}>
          <option value="">All verticals</option>
          {options?.verticals.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
        </select>
        <select className="eoc-select" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} style={{ maxWidth: 200 }}>
          <option value="">All statuses</option>
          {options?.statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="card-pad"><div className="skel" style={{ height: 200 }} /></div>
        ) : tasks.length === 0 ? (
          <div className="card-pad flex flex-col items-center text-center" style={{ gap: 8, padding: '48px 20px' }}>
            <ListChecks size={32} style={{ color: 'var(--red)' }} />
            <p className="text-base font-bold" style={{ color: 'var(--ink)' }}>No tasks match these filters</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', background: 'var(--surface-2)' }}>
                  {['#', 'Date', 'Person', 'Work', 'Customer/Project', 'Description', 'Hours Spent', 'Status', 'Progress', 'Attached Files', ''].map((h) => (
                    <th key={h} style={{ padding: '11px 14px', color: 'var(--muted)', fontWeight: 650, fontSize: 12 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.map((t, i) => (
                  <TaskTableRow
                    key={t.id}
                    task={t}
                    taskNumber={(meta.page - 1) * meta.limit + i + 1}
                    customerGroups={customerGroups}
                    verticalLabel={verticalLabel}
                    categoryLabel={categoryLabel}
                    statusLabel={statusLabel}
                    showPerson
                    onView={setViewing}
                    onEdit={setEditing}
                    onDelete={handleDelete}
                  />
                ))}
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

      {modalOpen && (
        <TaskFormModal
          assignableUsers={users}
          onClose={() => setModalOpen(false)}
          submitting={createMutation.isPending}
          onSubmit={async (values, files) => { await createMutation.mutateAsync({ values, files }); }}
        />
      )}

      {editing && (
        <TaskFormModal
          initial={editing}
          onClose={() => setEditing(null)}
          submitting={updateMutation.isPending}
          onSubmit={async (values, files) => { await updateMutation.mutateAsync({ id: editing.id, values, files }); }}
        />
      )}

      {viewing && <TaskDetailModal task={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

export default TeamTasksPage;
