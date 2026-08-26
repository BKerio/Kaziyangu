import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, CheckCircle2, Clock } from 'lucide-react';
import { useNotificationStore } from '@/stores/notificationStore';
import api from '@/api/client';
import { Attachee, Attendance, AttendanceStatus, PaginatedResponse } from '@/types/api';

const STATUSES: AttendanceStatus[] = ['PRESENT', 'LATE', 'HALF_DAY', 'ON_LEAVE', 'ABSENT'];

function label(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
}

function statusPill(status: AttendanceStatus) {
  if (status === 'PRESENT') return 'pill-green';
  if (status === 'LATE' || status === 'HALF_DAY') return 'pill-amber';
  return 'pill-red';
}

function SupervisedAttendance({ attachees }: { attachees: Attachee[] }) {
  const [attacheeFilter, setAttacheeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const { addNotification } = useNotificationStore();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['attachments', 'supervised-attendance', attacheeFilter, statusFilter],
    queryFn: async () => {
      const params: Record<string, string | number> = { limit: 100 };
      if (attacheeFilter) params.attacheeId = attacheeFilter;
      if (statusFilter) params.status = statusFilter;
      const res = await api.get<PaginatedResponse<Attendance>>('/attachments/attendance', { params });
      return res.data;
    },
  });

  const verifyMutation = useMutation({
    mutationFn: ({ id, verifiedBySupervisor }: { id: string; verifiedBySupervisor: boolean }) =>
      api.patch(`/attachments/attendance/${id}`, { verifiedBySupervisor }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attachments', 'supervised-attendance'] });
      addNotification({ type: 'success', title: 'Verification updated', message: 'Attendance status changed.' });
    },
    onError: (err: any) => addNotification({ type: 'error', title: 'Update failed', message: err?.response?.data?.message || 'Please try again.' }),
  });

  const records = data?.data ?? [];

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
        <select className="eoc-select" value={attacheeFilter} onChange={(e) => setAttacheeFilter(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="">All my attachees</option>
          {attachees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select className="eoc-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ maxWidth: 180 }}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default SupervisedAttendance;
