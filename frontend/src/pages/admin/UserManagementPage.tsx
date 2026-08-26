import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  UserPlus, ChevronLeft as CaretLeft, ChevronRight as CaretRight,
  Pencil as PencilSimple, Trash2, X, Users, Power,
} from 'lucide-react';
import { useNotificationStore } from '@/stores/notificationStore';
import DotLoader from '@/components/shared/DotLoader';
import api from '@/api/client';
import { DEPARTMENT_OPTIONS, PaginatedResponse, Role, User } from '@/types/api';
import { confirmDialog } from '@/lib/alert';

const ROLES: Role[] = ['STAFF', 'ADMIN', 'SUPER_ADMIN'];

const createSchema = z.object({
  email: z.string().email('Invalid email'),
  passwordRaw: z.string().min(8, 'At least 8 characters'),
  name: z.string().min(2, 'Name is required'),
  role: z.enum(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  department: z.enum(['TECHNICAL', 'BUSINESS_DEVELOPMENT', 'FINANCE']),
  phone: z.string().optional(),
});
type CreateForm = z.infer<typeof createSchema>;

const editSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  email: z.string().email('Invalid email'),
  phone: z.string().optional(),
  role: z.enum(['STAFF', 'ADMIN', 'SUPER_ADMIN']),
  department: z.enum(['TECHNICAL', 'BUSINESS_DEVELOPMENT', 'FINANCE']),
  password: z.string().optional(),
});
type EditForm = z.infer<typeof editSchema>;

function roleLabel(role: string) {
  return role.charAt(0) + role.slice(1).toLowerCase().replace('_', ' ');
}

function departmentLabel(dept?: string | null) {
  return DEPARTMENT_OPTIONS.find((d) => d.value === dept)?.label ?? '-';
}

function UserManagementPage() {
  const [page, setPage] = useState(1);
  const [roleFilter, setRoleFilter] = useState<Role | 'ALL'>('ALL');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const { addNotification } = useNotificationStore();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', page, roleFilter],
    queryFn: async () => {
      const params: Record<string, string | number> = { page, limit: 15 };
      if (roleFilter !== 'ALL') params.role = roleFilter;
      const res = await api.get<PaginatedResponse<User>>('/admin/users', { params });
      return res.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: (values: CreateForm) => api.post('/admin/users', values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      setCreateOpen(false);
      addNotification({ type: 'success', title: 'User created', message: 'The account is ready to sign in.' });
    },
    onError: (err: any) => addNotification({ type: 'error', title: 'Failed to create user', message: err?.response?.data?.message || 'Please try again.' }),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: Partial<EditForm> }) => api.patch(`/admin/users/${id}`, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      setEditing(null);
      addNotification({ type: 'success', title: 'User updated', message: 'Changes have been saved.' });
    },
    onError: (err: any) => addNotification({ type: 'error', title: 'Update failed', message: err?.response?.data?.message || 'Please try again.' }),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.patch(`/admin/users/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      addNotification({ type: 'success', title: 'User updated', message: 'Account status changed.' });
    },
    onError: (err: any) => addNotification({ type: 'error', title: 'Update failed', message: err?.response?.data?.message || 'Please try again.' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      addNotification({ type: 'success', title: 'User deleted', message: 'The account has been removed.' });
    },
    onError: (err: any) => addNotification({ type: 'error', title: 'Delete failed', message: err?.response?.data?.message || 'Please try again.' }),
  });

  const handleDelete = async (user: User) => {
    const confirmed = await confirmDialog({
      title: 'Delete user',
      text: `Delete ${user.name} (${user.email})? This can't be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (confirmed) deleteMutation.mutate(user.id);
  };

  const users = data?.data ?? [];
  const meta = data?.meta ?? { total: 0, page: 1, limit: 15, totalPages: 0 };

  return (
    <div className="col" style={{ gap: 20 }}>
      <div className="flex items-center justify-between">
        <div>
          <p className="eyebrow">Management</p>
          <h2 className="text-2xl font-bold mt-1" style={{ color: 'var(--ink)' }}>Users</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{meta.total} people in the workspace</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
          <UserPlus size={16} /> Add User
        </button>
      </div>

      <div className="card card-pad">
        <select className="eoc-select" value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value as Role | 'ALL'); setPage(1); }} style={{ maxWidth: 220 }}>
          <option value="ALL">All roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
        </select>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="card-pad"><div className="skel" style={{ height: 240 }} /></div>
        ) : users.length === 0 ? (
          <div className="card-pad flex flex-col items-center text-center" style={{ gap: 8, padding: '48px 20px' }}>
            <Users size={32} style={{ color: 'var(--red)' }} />
            <p className="text-base font-bold" style={{ color: 'var(--ink)' }}>No users found</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                  {['Name', 'Email', 'Phone', 'Role', 'Department', 'Tasks', 'Status', ''].map((h) => (
                    <th key={h} style={{ padding: '10px 14px', color: 'var(--muted)', fontWeight: 650, fontSize: 12 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{u.name}</td>
                    <td style={{ padding: '10px 14px' }}>{u.email}</td>
                    <td style={{ padding: '10px 14px' }}>{u.phone || '-'}</td>
                    <td style={{ padding: '10px 14px' }}><span className="pill pill-blue">{roleLabel(u.role)}</span></td>
                    <td style={{ padding: '10px 14px' }}>{departmentLabel(u.department)}</td>
                    <td style={{ padding: '10px 14px' }}>{u._count?.tasks ?? 0}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span className={`pill ${u.isActive ? 'pill-green' : 'pill-gray'}`}>{u.isActive ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                      <button className="icon-btn" title="Edit" onClick={() => setEditing(u)}><PencilSimple size={14} /></button>
                      <button
                        className="icon-btn"
                        title={u.isActive ? 'Deactivate' : 'Activate'}
                        onClick={() => toggleActiveMutation.mutate({ id: u.id, isActive: !u.isActive })}
                      >
                        <Power size={14} />
                      </button>
                      <button className="icon-btn" title="Delete" onClick={() => handleDelete(u)}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {meta.totalPages > 1 && (
          <div className="flex items-center justify-between card-pad" style={{ borderTop: '1px solid var(--border)' }}>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>Page {meta.page} of {meta.totalPages}</span>
            <div className="flex gap-2">
              <button className="btn btn-soft btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><CaretLeft size={14} /></button>
              <button className="btn btn-soft btn-sm" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}><CaretRight size={14} /></button>
            </div>
          </div>
        )}
      </div>

      {createOpen && (
        <CreateUserModal
          onClose={() => setCreateOpen(false)}
          submitting={createMutation.isPending}
          onSubmit={async (values) => { await createMutation.mutateAsync(values); }}
        />
      )}

      {editing && (
        <EditUserModal
          user={editing}
          onClose={() => setEditing(null)}
          submitting={editMutation.isPending}
          onSubmit={async (values) => { await editMutation.mutateAsync({ id: editing.id, values }); }}
        />
      )}
    </div>
  );
}

function CreateUserModal({ onClose, onSubmit, submitting }: {
  onClose: () => void;
  onSubmit: (values: CreateForm) => Promise<void> | void;
  submitting?: boolean;
}) {
  const { register, handleSubmit, formState: { errors } } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { role: 'STAFF', department: DEPARTMENT_OPTIONS[0].value },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(10,20,15,0.45)' }}>
      <div className="card w-full" style={{ maxWidth: 440 }}>
        <div className="card-head">
          <span className="card-title">Add User</span>
          <button className="icon-btn" onClick={onClose} type="button"><X size={16} /></button>
        </div>
        <form className="card-pad col" style={{ gap: 14 }} onSubmit={handleSubmit(async (v) => onSubmit(v))}>
          <div className="field">
            <label className="label" htmlFor="new-name">Full name</label>
            <input id="new-name" className="input" {...register('name')} />
            {errors.name && <span className="field-error">{errors.name.message}</span>}
          </div>
          <div className="field">
            <label className="label" htmlFor="new-email">Email</label>
            <input id="new-email" className="input" type="email" {...register('email')} />
            {errors.email && <span className="field-error">{errors.email.message}</span>}
          </div>
          <div className="field">
            <label className="label" htmlFor="new-password">Temporary password</label>
            <input id="new-password" className="input" type="text" {...register('passwordRaw')} placeholder="Minimum 8 characters" />
            {errors.passwordRaw && <span className="field-error">{errors.passwordRaw.message}</span>}
          </div>
          <div className="field">
            <label className="label" htmlFor="new-phone">Phone (optional)</label>
            <input id="new-phone" className="input" type="tel" {...register('phone')} />
          </div>
          <div className="field">
            <label className="label" htmlFor="new-role">Role</label>
            <select id="new-role" className="eoc-select" {...register('role')}>
              {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="new-department">Department</label>
            <select id="new-department" className="eoc-select" {...register('department')}>
              {DEPARTMENT_OPTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
          <div className="flex gap-2" style={{ marginTop: 4 }}>
            <button type="button" className="btn btn-ghost flex-1" onClick={onClose} disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary flex-1" disabled={submitting}>
              {submitting ? <DotLoader size={16} /> : null}
              {submitting ? 'Creating…' : 'Create user'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditUserModal({ user, onClose, onSubmit, submitting }: {
  user: User;
  onClose: () => void;
  onSubmit: (values: Partial<EditForm>) => Promise<void> | void;
  submitting?: boolean;
}) {
  const { register, handleSubmit, formState: { errors } } = useForm<EditForm>({
    resolver: zodResolver(editSchema),
    // This page only ever lists STAFF/ADMIN/SUPER_ADMIN accounts (attachees are
    // managed on the dedicated Attachment Admin page), so this narrowing is safe.
    defaultValues: {
      name: user.name,
      email: user.email,
      phone: user.phone ?? '',
      role: user.role as CreateForm['role'],
      department: user.department ?? DEPARTMENT_OPTIONS[0].value,
      password: '',
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(10,20,15,0.45)' }}>
      <div className="card w-full" style={{ maxWidth: 440 }}>
        <div className="card-head">
          <span className="card-title">Edit User</span>
          <button className="icon-btn" onClick={onClose} type="button"><X size={16} /></button>
        </div>
        <form
          className="card-pad col"
          style={{ gap: 14 }}
          onSubmit={handleSubmit(async (v) => onSubmit({ ...v, password: v.password || undefined }))}
        >
          <div className="field">
            <label className="label" htmlFor="edit-name">Full name</label>
            <input id="edit-name" className="input" {...register('name')} />
            {errors.name && <span className="field-error">{errors.name.message}</span>}
          </div>
          <div className="field">
            <label className="label" htmlFor="edit-email">Email</label>
            <input id="edit-email" className="input" type="email" {...register('email')} />
            {errors.email && <span className="field-error">{errors.email.message}</span>}
          </div>
          <div className="field">
            <label className="label" htmlFor="edit-phone">Phone</label>
            <input id="edit-phone" className="input" type="tel" {...register('phone')} />
          </div>
          <div className="field">
            <label className="label" htmlFor="edit-role">Role</label>
            <select id="edit-role" className="eoc-select" {...register('role')}>
              {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="edit-department">Department</label>
            <select id="edit-department" className="eoc-select" {...register('department')}>
              {DEPARTMENT_OPTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="edit-password">Reset password (optional)</label>
            <input id="edit-password" className="input" type="text" {...register('password')} placeholder="Leave blank to keep current password" />
          </div>
          <div className="flex gap-2" style={{ marginTop: 4 }}>
            <button type="button" className="btn btn-ghost flex-1" onClick={onClose} disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary flex-1" disabled={submitting}>
              {submitting ? <DotLoader size={16} /> : null}
              {submitting ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default UserManagementPage;
