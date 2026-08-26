import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, X, Clock, ShieldCheck, CalendarCheck } from 'lucide-react';
import { useNotificationStore } from '@/stores/notificationStore';
import DotLoader from '@/components/shared/DotLoader';
import { useAuthStore } from '@/stores/authStore';
import api from '@/api/client';
import { Attendance, AttendanceStatus, PaginatedResponse, WorkMode } from '@/types/api';

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
  attacheeId: z.string(),
  date: z.string().min(1, 'Date is required'),
  status: z.enum(['PRESENT', 'LATE', 'HALF_DAY', 'ON_LEAVE', 'ABSENT']),
  checkInTime: z.string().optional(),
  checkOutTime: z.string().optional(),
  workMode: z.enum(['ON_SITE', 'REMOTE', 'HYBRID']),
  notes: z.string().optional(),
});
type LogForm = z.infer<typeof logSchema>;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function MyAttendancePage() {
  const [logOpen, setLogOpen] = useState(false);
  const { addNotification } = useNotificationStore();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['attachments', 'my-attendance'],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<Attendance>>('/attachments/attendance', { params: { limit: 100 } });
      return res.data;
    },
  });

  const logMutation = useMutation({
    mutationFn: (values: LogForm) => api.post('/attachments/attendance', values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attachments', 'my-attendance'] });
      setLogOpen(false);
      addNotification({ type: 'success', title: 'Attendance logged', message: 'Your entry has been recorded.' });
    },
    onError: (err: any) => addNotification({ type: 'error', title: 'Failed to log attendance', message: err?.response?.data?.message || 'Please try again.' }),
  });

  const records = data?.data ?? [];

  return (
    <div className="col" style={{ gap: 20 }}>
      <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <p className="eyebrow">Attachment</p>
          <h2 className="text-2xl font-bold mt-1" style={{ color: 'var(--ink)' }}>My Attendance</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Log your daily attendance and track supervisor verification.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setLogOpen(true)}>
          <CalendarPlus size={16} /> Log Today's Attendance
        </button>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="card-pad"><div className="skel" style={{ height: 240 }} /></div>
        ) : records.length === 0 ? (
          <div className="card-pad flex flex-col items-center text-center" style={{ gap: 8, padding: '48px 20px' }}>
            <CalendarCheck size={32} style={{ color: 'var(--red)' }} />
            <p className="text-base font-bold" style={{ color: 'var(--ink)' }}>No attendance logged yet</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                  {['Date', 'Status', 'Check-in / out', 'Work mode', 'Notes', 'Verified'].map((h) => (
                    <th key={h} style={{ padding: '10px 14px', color: 'var(--muted)', fontWeight: 650, fontSize: 12 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((rec) => (
                  <tr key={rec.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{rec.date.slice(0, 10)}</td>
                    <td style={{ padding: '10px 14px' }}><span className={`pill ${statusPill(rec.status)}`}>{label(rec.status)}</span></td>
                    <td style={{ padding: '10px 14px', color: 'var(--muted)' }}>
                      <span className="flex items-center gap-1"><Clock size={13} />{rec.checkInTime || '--'} – {rec.checkOutTime || '--'}</span>
                    </td>
                    <td style={{ padding: '10px 14px' }}>{label(rec.workMode)}</td>
                    <td style={{ padding: '10px 14px', color: 'var(--muted)', maxWidth: 220 }}>{rec.notes || '-'}</td>
                    <td style={{ padding: '10px 14px' }}>
                      {rec.verifiedBySupervisor ? (
                        <span className="pill pill-green"><ShieldCheck size={13} /> Verified</span>
                      ) : (
                        <span className="pill pill-gray">Pending</span>
                      )}
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
          onClose={() => setLogOpen(false)}
          submitting={logMutation.isPending}
          onSubmit={async (values) => { await logMutation.mutateAsync(values); }}
        />
      )}
    </div>
  );
}

function LogAttendanceModal({ onClose, onSubmit, submitting }: {
  onClose: () => void;
  onSubmit: (values: LogForm) => Promise<void> | void;
  submitting?: boolean;
}) {
  const selfId = useAuthStore((s) => s.user?.id) ?? '';
  const { register, handleSubmit, formState: { errors } } = useForm<LogForm>({
    resolver: zodResolver(logSchema),
    defaultValues: { attacheeId: selfId, date: todayISO(), status: 'PRESENT', workMode: 'ON_SITE' },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(10,20,15,0.45)' }}>
      <div className="card w-full" style={{ maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="card-head" style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
          <span className="card-title">Log Attendance</span>
          <button className="icon-btn" onClick={onClose} type="button"><X size={16} /></button>
        </div>
        <form className="card-pad col" style={{ gap: 14 }} onSubmit={handleSubmit(async (v) => onSubmit(v))}>
          <input type="hidden" {...register('attacheeId')} />

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

export default MyAttendancePage;
