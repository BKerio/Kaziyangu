import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, X, CheckCircle2, Clock, Trash2, CalendarCheck } from 'lucide-react';
import { useNotificationStore } from '@/stores/notificationStore';
import DotLoader from '@/components/shared/DotLoader';
import api from '@/api/client';
import { Attachee, Attendance, AttendanceStatus, PaginatedResponse, WorkMode } from '@/types/api';
import { confirmDialog } from '@/lib/alert';

const STATUSES: AttendanceStatus[] = ['PRESENT', 'LATE', 'HALF_DAY', 'ON_LEAVE', 'ABSENT'];
const WORK_MODES: WorkMode[] = ['ON_SITE', 'REMOTE', 'HYBRID'];

function label(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
}

function statusPill(status: AttendanceStatus) {
  if (status === 'PRESENT') return 'pill-green';
  if (status === 'LATE' || status === 'HALF_DAY') return 'pill-amber';
  return 'pill-red';
}

const logSchema = z.object({
  attacheeId: z.string().min(1, 'Select an attachee'),
  date: z.string().min(1, 'Date is required'),
  status: z.enum(['PRESENT', 'LATE', 'HALF_DAY', 'ON_LEAVE', 'ABSENT']),
  checkInTime: z.string().optional(),
  checkOutTime: z.string().optional(),
  workMode: z.enum(['ON_SITE', 'REMOTE', 'HYBRID']),
  notes: z.string().optional(),
});
type LogForm = z.infer<typeof logSchema>;

function AttendanceManagement() {
  const [attacheeFilter, setAttacheeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [logOpen, setLogOpen] = useState(false);
  const { addNotification } = useNotificationStore();
  const queryClient = useQueryClient();

  const { data: attacheeData } = useQuery({
    queryKey: ['attachments', 'attachees', 'all'],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<Attachee>>('/attachments/attachees', { params: { limit: 200 } });
      return res.data.data;
    },
  });
  const attachees = attacheeData ?? [];

  const { data, isLoading } = useQuery({
    queryKey: ['attachments', 'attendance', attacheeFilter, statusFilter],
    queryFn: async () => {
      const params: Record<string, string | number> = { limit: 100 };
      if (attacheeFilter) params.attacheeId = attacheeFilter;
      if (statusFilter) params.status = statusFilter;
      const res = await api.get<PaginatedResponse<Attendance>>('/attachments/attendance', { params });
      return res.data;
    },
  });

  const logMutation = useMutation({
    mutationFn: (values: LogForm) => api.post('/attachments/attendance', values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attachments', 'attendance'] });
      setLogOpen(false);
      addNotification({ type: 'success', title: 'Attendance logged', message: 'The entry has been recorded.' });
    },
    onError: (err: any) => addNotification({ type: 'error', title: 'Failed to log attendance', message: err?.response?.data?.message || 'Please try again.' }),
  });

  const verifyMutation = useMutation({
    mutationFn: ({ id, verifiedBySupervisor }: { id: string; verifiedBySupervisor: boolean }) =>
      api.patch(`/attachments/attendance/${id}`, { verifiedBySupervisor }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attachments', 'attendance'] });
      addNotification({ type: 'success', title: 'Verification updated', message: 'Attendance status changed.' });
    },
    onError: (err: any) => addNotification({ type: 'error', title: 'Update failed', message: err?.response?.data?.message || 'Please try again.' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/attachments/attendance/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attachments', 'attendance'] });
      addNotification({ type: 'success', title: 'Record deleted', message: 'The attendance entry was removed.' });
    },
    onError: (err: any) => addNotification({ type: 'error', title: 'Delete failed', message: err?.response?.data?.message || 'Please try again.' }),
  });

  const handleDelete = async (rec: Attendance) => {
    const confirmed = await confirmDialog({
      title: 'Delete attendance record',
      text: `Delete the ${rec.date.slice(0, 10)} entry for ${rec.attachee.name}?`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (confirmed) deleteMutation.mutate(rec.id);
  };

  const records = data?.data ?? [];

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          <select className="eoc-select" value={attacheeFilter} onChange={(e) => setAttacheeFilter(e.target.value)} style={{ maxWidth: 220 }}>
            <option value="">All attachees</option>
            {attachees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select className="eoc-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ maxWidth: 180 }}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
        </div>
        <button className="btn btn-primary" onClick={() => setLogOpen(true)} disabled={attachees.length === 0}>
          <CalendarPlus size={16} /> Log Attendance
        </button>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="card-pad"><div className="skel" style={{ height: 240 }} /></div>
        ) : records.length === 0 ? (
          <div className="card-pad flex flex-col items-center text-center" style={{ gap: 8, padding: '48px 20px' }}>
            <CalendarCheck size={32} style={{ color: 'var(--red)' }} />
            <p className="text-base font-bold" style={{ color: 'var(--ink)' }}>No attendance records found</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                  {['Attachee', 'Date', 'Status', 'Check-in / out', 'Work mode', 'Notes', ''].map((h) => (
                    <th key={h} style={{ padding: '10px 14px', color: 'var(--muted)', fontWeight: 650, fontSize: 12 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((rec) => (
                  <tr key={rec.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ fontWeight: 650, color: 'var(--ink)' }}>{rec.attachee.name}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>Reg: {rec.attachee.registrationNo}</div>
                    </td>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{rec.date.slice(0, 10)}</td>
                    <td style={{ padding: '10px 14px' }}><span className={`pill ${statusPill(rec.status)}`}>{label(rec.status)}</span></td>
                    <td style={{ padding: '10px 14px', color: 'var(--muted)' }}>
                      <span className="flex items-center gap-1"><Clock size={13} />{rec.checkInTime || '--'} – {rec.checkOutTime || '--'}</span>
                    </td>
                    <td style={{ padding: '10px 14px' }}>{label(rec.workMode)}</td>
                    <td style={{ padding: '10px 14px', color: 'var(--muted)', maxWidth: 200 }}>{rec.notes || '-'}</td>
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                      <button
                        className={`btn btn-sm ${rec.verifiedBySupervisor ? 'btn-soft' : 'btn-primary'}`}
                        onClick={() => verifyMutation.mutate({ id: rec.id, verifiedBySupervisor: !rec.verifiedBySupervisor })}
                      >
                        <CheckCircle2 size={13} /> {rec.verifiedBySupervisor ? 'Verified' : 'Verify'}
                      </button>
                      <button className="icon-btn" title="Delete" onClick={() => handleDelete(rec)}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {logOpen && (
        <LogAttendanceModal
          attachees={attachees}
          onClose={() => setLogOpen(false)}
          submitting={logMutation.isPending}
          onSubmit={async (values) => { await logMutation.mutateAsync(values); }}
        />
      )}
    </div>
  );
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function LogAttendanceModal({ attachees, onClose, onSubmit, submitting }: {
  attachees: Attachee[];
  onClose: () => void;
  onSubmit: (values: LogForm) => Promise<void> | void;
  submitting?: boolean;
}) {
  const { register, handleSubmit, formState: { errors } } = useForm<LogForm>({
    resolver: zodResolver(logSchema),
    defaultValues: { date: todayISO(), status: 'PRESENT', workMode: 'ON_SITE', attacheeId: attachees[0]?.id ?? '' },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(10,20,15,0.45)' }}>
      <div className="card w-full" style={{ maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="card-head" style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
          <span className="card-title">Log Attendance</span>
          <button className="icon-btn" onClick={onClose} type="button"><X size={16} /></button>
        </div>
        <form className="card-pad col" style={{ gap: 14 }} onSubmit={handleSubmit(async (v) => onSubmit(v))}>
          <div className="field">
            <label className="label" htmlFor="att-attachee">Attachee</label>
            <select id="att-attachee" className="eoc-select" {...register('attacheeId')}>
              {attachees.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.registrationNo})</option>)}
            </select>
            {errors.attacheeId && <span className="field-error">{errors.attacheeId.message}</span>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="field">
              <label className="label" htmlFor="att-date">Date</label>
              <input id="att-date" className="input" type="date" {...register('date')} />
              {errors.date && <span className="field-error">{errors.date.message}</span>}
            </div>
            <div className="field">
              <label className="label" htmlFor="att-status">Status</label>
              <select id="att-status" className="eoc-select" {...register('status')}>
                {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="field">
              <label className="label" htmlFor="att-in">Check-in</label>
              <input id="att-in" className="input" type="time" {...register('checkInTime')} />
            </div>
            <div className="field">
              <label className="label" htmlFor="att-out">Check-out</label>
              <input id="att-out" className="input" type="time" {...register('checkOutTime')} />
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="att-mode">Work mode</label>
            <select id="att-mode" className="eoc-select" {...register('workMode')}>
              {WORK_MODES.map((m) => <option key={m} value={m}>{label(m)}</option>)}
            </select>
          </div>

          <div className="field">
            <label className="label" htmlFor="att-notes">Notes</label>
            <textarea id="att-notes" className="eoc-textarea" rows={2} {...register('notes')} />
          </div>

          <div className="flex gap-2" style={{ marginTop: 4 }}>
            <button type="button" className="btn btn-ghost flex-1" onClick={onClose} disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary flex-1" disabled={submitting}>
              {submitting ? <DotLoader size={16} /> : null}
              {submitting ? 'Saving…' : 'Log attendance'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AttendanceManagement;
