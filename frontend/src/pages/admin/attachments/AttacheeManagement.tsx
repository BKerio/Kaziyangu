import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  UserPlus, Pencil as PencilSimple, Trash2, X, Search,
  ChevronLeft as CaretLeft, ChevronRight as CaretRight, GraduationCap,
} from 'lucide-react';
import { useNotificationStore } from '@/stores/notificationStore';
import DotLoader from '@/components/shared/DotLoader';
import api from '@/api/client';
import { Attachee, DEPARTMENT_OPTIONS, PaginatedResponse, User } from '@/types/api';
import { confirmDialog } from '@/lib/alert';

const createSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  email: z.string().email('Invalid email'),
  passwordRaw: z.string().min(6, 'At least 6 characters'),
  registrationNo: z.string().min(1, 'Registration number is required'),
  course: z.string().min(1, 'Course is required'),
  department: z.enum(['TECHNICAL', 'BUSINESS_DEVELOPMENT', 'FINANCE', 'COMMERCIAL', 'ADMIN']),
  organization: z.string().min(1, 'Host organization is required'),
  // '' = unassigned; a real select value is a staff member's id.
  supervisorId: z.string().optional(),
  attachmentStart: z.string().optional(),
  attachmentEnd: z.string().optional(),
  phone: z.string().optional(),
});
type CreateForm = z.infer<typeof createSchema>;

const editSchema = createSchema.omit({ passwordRaw: true }).extend({
  password: z.string().optional(),
  supervisorId: z.string().nullable().optional(),
});
type EditForm = z.infer<typeof editSchema>;

function departmentLabel(dept?: string | null) {
  return DEPARTMENT_OPTIONS.find((d) => d.value === dept)?.label ?? '-';
}

function AttacheeManagement() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Attachee | null>(null);
  const { addNotification } = useNotificationStore();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['attachments', 'attachees', page, search],
    queryFn: async () => {
      const params: Record<string, string | number> = { page, limit: 15 };
      if (search) params.search = search;
      const res = await api.get<PaginatedResponse<Attachee>>('/attachments/attachees', { params });
      return res.data;
    },
  });

  // Candidate supervisors - the same staff roster shown on the Staff Members page.
  const { data: staffData } = useQuery({
    queryKey: ['admin', 'users', 'all'],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<User>>('/admin/users', { params: { limit: 200 } });
      return res.data.data;
    },
  });
  const staff = staffData ?? [];

  const createMutation = useMutation({
    mutationFn: (values: CreateForm) => api.post('/attachments/attachees', values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attachments', 'attachees'] });
      setCreateOpen(false);
      addNotification({ type: 'success', title: 'Attachee added', message: 'Their login account is ready.' });
    },
    onError: (err: any) => addNotification({ type: 'error', title: 'Failed to add attachee', message: err?.response?.data?.message || 'Please try again.' }),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: Partial<EditForm> }) => api.patch(`/attachments/attachees/${id}`, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attachments', 'attachees'] });
      setEditing(null);
      addNotification({ type: 'success', title: 'Attachee updated', message: 'Changes have been saved.' });
    },
    onError: (err: any) => addNotification({ type: 'error', title: 'Update failed', message: err?.response?.data?.message || 'Please try again.' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/attachments/attachees/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attachments', 'attachees'] });
      addNotification({ type: 'success', title: 'Attachee removed', message: 'The record has been deleted.' });
    },
    onError: (err: any) => addNotification({ type: 'error', title: 'Delete failed', message: err?.response?.data?.message || 'Please try again.' }),
  });

  const handleDelete = async (attachee: Attachee) => {
    const confirmed = await confirmDialog({
      title: 'Remove attachee',
      text: `Remove ${attachee.name} (${attachee.registrationNo})? This can't be undone.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (confirmed) deleteMutation.mutate(attachee.id);
  };

  const attachees = data?.data ?? [];
  const meta = data?.meta ?? { total: 0, page: 1, limit: 15, totalPages: 0 };

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="input-icon" style={{ maxWidth: 340, flex: 1 }}>
          <input
            className="input"
            placeholder="Search by name, reg no, email, or host company…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
          <Search size={16} />
        </div>
        <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
          <UserPlus size={16} /> Add Attachee
        </button>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="card-pad"><div className="skel" style={{ height: 240 }} /></div>
        ) : attachees.length === 0 ? (
          <div className="card-pad flex flex-col items-center text-center" style={{ gap: 8, padding: '48px 20px' }}>
            <GraduationCap size={32} style={{ color: 'var(--red)' }} />
            <p className="text-base font-bold" style={{ color: 'var(--ink)' }}>No attachees found</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                  {['Candidate', 'Course & Dept', 'Host Company', 'Supervisor', 'Status', ''].map((h) => (
                    <th key={h} style={{ padding: '10px 14px', color: 'var(--muted)', fontWeight: 650, fontSize: 12 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {attachees.map((a) => (
                  <tr key={a.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ fontWeight: 650, color: 'var(--ink)' }}>{a.name}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>Reg: {a.registrationNo} • {a.email}</div>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ fontWeight: 600 }}>{a.course || '-'}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{departmentLabel(a.department)}</div>
                    </td>
                    <td style={{ padding: '10px 14px' }}>{a.organization || '-'}</td>
                    <td style={{ padding: '10px 14px', color: 'var(--muted)' }}>{a.supervisor?.name ?? '-'}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span className={`pill ${a.isActive ? 'pill-green' : 'pill-gray'}`}>{a.isActive ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                      <button className="icon-btn" title="Edit" onClick={() => setEditing(a)}><PencilSimple size={14} /></button>
                      <button className="icon-btn" title="Remove" onClick={() => handleDelete(a)}><Trash2 size={14} /></button>
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
        <AttacheeFormModal
          title="Add Attachee"
          submitLabel="Add attachee"
          staff={staff}
          onClose={() => setCreateOpen(false)}
          submitting={createMutation.isPending}
          onSubmit={async (values) => {
            const v = values as CreateForm;
            await createMutation.mutateAsync({ ...v, supervisorId: v.supervisorId || undefined });
          }}
        />
      )}

      {editing && (
        <AttacheeFormModal
          title="Edit Attachee"
          submitLabel="Save changes"
          attachee={editing}
          staff={staff}
          onClose={() => setEditing(null)}
          submitting={editMutation.isPending}
          onSubmit={async (values) => {
            const { passwordRaw, ...rest } = values as CreateForm & { passwordRaw?: string };
            await editMutation.mutateAsync({
              id: editing.id,
              values: { ...rest, supervisorId: rest.supervisorId || null, password: passwordRaw || undefined },
            });
          }}
        />
      )}
    </div>
  );
}

function AttacheeFormModal({ title, submitLabel, attachee, staff, onClose, onSubmit, submitting }: {
  title: string;
  submitLabel: string;
  attachee?: Attachee;
  staff: User[];
  onClose: () => void;
  onSubmit: (values: CreateForm | EditForm) => Promise<void> | void;
  submitting?: boolean;
}) {
  const schema = attachee ? editSchema : createSchema;
  const { register, handleSubmit, formState: { errors } } = useForm<CreateForm & { password?: string }>({
    resolver: zodResolver(schema as any),
    defaultValues: attachee
      ? {
          name: attachee.name,
          email: attachee.email,
          registrationNo: attachee.registrationNo ?? '',
          course: attachee.course ?? '',
          department: attachee.department ?? DEPARTMENT_OPTIONS[0].value,
          organization: attachee.organization ?? '',
          supervisorId: attachee.supervisorId ?? '',
          attachmentStart: attachee.attachmentStart?.slice(0, 10) ?? '',
          attachmentEnd: attachee.attachmentEnd?.slice(0, 10) ?? '',
          phone: attachee.phone ?? '',
          password: '',
        }
      : { registrationNo: '', course: '', department: DEPARTMENT_OPTIONS[0].value, organization: '', supervisorId: '' },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(10,20,15,0.45)' }}>
      <div className="card w-full" style={{ maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="card-head" style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
          <span className="card-title">{title}</span>
          <button className="icon-btn" onClick={onClose} type="button"><X size={16} /></button>
        </div>
        <form className="card-pad col" style={{ gap: 14 }} onSubmit={handleSubmit(async (v) => onSubmit(v))}>
          <div className="grid grid-cols-2 gap-3">
            <div className="field">
              <label className="label" htmlFor="at-name">Full name</label>
              <input id="at-name" className="input" {...register('name')} />
              {errors.name && <span className="field-error">{errors.name.message}</span>}
            </div>
            <div className="field">
              <label className="label" htmlFor="at-reg">Registration no.</label>
              <input id="at-reg" className="input" {...register('registrationNo')} />
              {errors.registrationNo && <span className="field-error">{errors.registrationNo.message}</span>}
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="at-email">Email</label>
            <input id="at-email" className="input" type="email" {...register('email')} />
            {errors.email && <span className="field-error">{errors.email.message}</span>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="field">
              <label className="label" htmlFor="at-password">{attachee ? 'Reset password (optional)' : 'Login password'}</label>
              <input
                id="at-password"
                className="input"
                type="text"
                placeholder={attachee ? 'Leave blank to keep current' : 'Min. 6 characters'}
                {...register(attachee ? 'password' : 'passwordRaw')}
              />
              {errors.passwordRaw && <span className="field-error">{errors.passwordRaw.message}</span>}
            </div>
            <div className="field">
              <label className="label" htmlFor="at-phone">Phone (optional)</label>
              <input id="at-phone" className="input" type="tel" {...register('phone')} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="field">
              <label className="label" htmlFor="at-course">Course</label>
              <input id="at-course" className="input" {...register('course')} />
              {errors.course && <span className="field-error">{errors.course.message}</span>}
            </div>
            <div className="field">
              <label className="label" htmlFor="at-dept">Department</label>
              <select id="at-dept" className="eoc-select" {...register('department')}>
                {DEPARTMENT_OPTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
              {errors.department && <span className="field-error">{errors.department.message}</span>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="field">
              <label className="label" htmlFor="at-org">Host organization / company</label>
              <input id="at-org" className="input" {...register('organization')} />
              {errors.organization && <span className="field-error">{errors.organization.message}</span>}
            </div>
            <div className="field">
              <label className="label" htmlFor="at-sup">Assigned supervisor</label>
              <select id="at-sup" className="eoc-select" {...register('supervisorId')}>
                <option value="">Unassigned</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="field">
              <label className="label" htmlFor="at-start">Attachment start</label>
              <input id="at-start" className="input" type="date" {...register('attachmentStart')} />
            </div>
            <div className="field">
              <label className="label" htmlFor="at-end">Attachment end</label>
              <input id="at-end" className="input" type="date" {...register('attachmentEnd')} />
            </div>
          </div>

          <div className="flex gap-2" style={{ marginTop: 4 }}>
            <button type="button" className="btn btn-ghost flex-1" onClick={onClose} disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary flex-1" disabled={submitting}>
              {submitting ? <DotLoader size={16} /> : null}
              {submitting ? 'Saving…' : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AttacheeManagement;
