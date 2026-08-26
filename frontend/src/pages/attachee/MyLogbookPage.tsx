import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FilePlus, X, CheckCircle2, Clock, AlertCircle, FileCheck } from 'lucide-react';
import { useNotificationStore } from '@/stores/notificationStore';
import DotLoader from '@/components/shared/DotLoader';
import { useAuthStore } from '@/stores/authStore';
import api from '@/api/client';
import { PaginatedResponse, ReportStatus, TaskReport } from '@/types/api';

function label(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
}

function statusMeta(status: ReportStatus) {
  if (status === 'APPROVED') return { pill: 'pill-green', Icon: CheckCircle2 };
  if (status === 'PENDING') return { pill: 'pill-amber', Icon: Clock };
  return { pill: 'pill-red', Icon: AlertCircle };
}

const reportSchema = z.object({
  attacheeId: z.string(),
  date: z.string().min(1, 'Date is required'),
  title: z.string().min(2, 'Title is required'),
  description: z.string().min(3, 'Description is required'),
  learnings: z.string().optional(),
  category: z.string().optional(),
  hoursSpent: z.coerce.number().min(0).max(24),
});
type ReportForm = z.infer<typeof reportSchema>;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function MyLogbookPage() {
  const [addOpen, setAddOpen] = useState(false);
  const { addNotification } = useNotificationStore();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['attachments', 'my-reports'],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<TaskReport>>('/attachments/reports', { params: { limit: 100 } });
      return res.data;
    },
  });

  const addMutation = useMutation({
    mutationFn: (values: ReportForm) => api.post('/attachments/reports', values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attachments', 'my-reports'] });
      setAddOpen(false);
      addNotification({ type: 'success', title: 'Entry submitted', message: 'Your logbook entry is awaiting review.' });
    },
    onError: (err: any) => addNotification({ type: 'error', title: 'Failed to submit entry', message: err?.response?.data?.message || 'Please try again.' }),
  });

  const reports = data?.data ?? [];

  return (
    <div className="col" style={{ gap: 20 }}>
      <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <p className="eyebrow">Attachment</p>
          <h2 className="text-2xl font-bold mt-1" style={{ color: 'var(--ink)' }}>My Logbook</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Submit your daily activities and track supervisor feedback.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setAddOpen(true)}>
          <FilePlus size={16} /> Add Logbook Entry
        </button>
      </div>

      <div className="col" style={{ gap: 12 }}>
        {isLoading ? (
          <div className="card card-pad"><div className="skel" style={{ height: 160 }} /></div>
        ) : reports.length === 0 ? (
          <div className="card card-pad flex flex-col items-center text-center" style={{ gap: 8, padding: '48px 20px' }}>
            <FileCheck size={32} style={{ color: 'var(--red)' }} />
            <p className="text-base font-bold" style={{ color: 'var(--ink)' }}>No logbook entries yet</p>
          </div>
        ) : (
          reports.map((report) => {
            const { pill, Icon } = statusMeta(report.status);
            return (
              <div key={report.id} className="card">
                <div className="card-head" style={{ alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 3 }}>
                      {report.date.slice(0, 10)} • {report.hoursSpent}h{report.category ? ` • ${report.category}` : ''}
                    </div>
                    <span className="card-title" style={{ fontSize: 15 }}>{report.title}</span>
                  </div>
                  <span className={`pill ${pill}`}><Icon size={13} />{label(report.status)}{report.rating != null ? ` (${report.rating}%)` : ''}</span>
                </div>
                <div className="card-pad col" style={{ gap: 10 }}>
                  <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.6, whiteSpace: 'pre-line' }}>{report.description}</p>
                  {report.learnings && (
                    <div style={{ padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)', fontSize: 12.5 }}>
                      <b style={{ color: 'var(--green)' }}>Key learnings: </b>
                      <span style={{ color: 'var(--muted)' }}>{report.learnings}</span>
                    </div>
                  )}
                  {report.feedback ? (
                    <div style={{ padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--green-light)', fontSize: 12.5 }}>
                      <b style={{ color: 'var(--green)' }}>Supervisor feedback{report.supervisorName ? ` (${report.supervisorName})` : ''}: </b>
                      <span style={{ color: 'var(--ink-2)' }}>&ldquo;{report.feedback}&rdquo;</span>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>Awaiting supervisor review.</div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {addOpen && (
        <AddReportModal
          onClose={() => setAddOpen(false)}
          submitting={addMutation.isPending}
          onSubmit={async (values) => { await addMutation.mutateAsync(values); }}
        />
      )}
    </div>
  );
}

function AddReportModal({ onClose, onSubmit, submitting }: {
  onClose: () => void;
  onSubmit: (values: ReportForm) => Promise<void> | void;
  submitting?: boolean;
}) {
  const selfId = useAuthStore((s) => s.user?.id) ?? '';
  const { register, handleSubmit, formState: { errors } } = useForm<ReportForm>({
    resolver: zodResolver(reportSchema),
    defaultValues: { attacheeId: selfId, date: todayISO(), hoursSpent: 0 },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(10,20,15,0.45)' }}>
      <div className="card w-full" style={{ maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="card-head" style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
          <span className="card-title">Add Logbook Entry</span>
          <button className="icon-btn" onClick={onClose} type="button"><X size={16} /></button>
        </div>
        <form className="card-pad col" style={{ gap: 14 }} onSubmit={handleSubmit(async (v) => onSubmit(v))}>
          <input type="hidden" {...register('attacheeId')} />

          <div className="grid grid-cols-2 gap-3">
            <div className="field">
              <label className="label" htmlFor="rep-date">Date</label>
              <input id="rep-date" className="input" type="date" {...register('date')} />
              {errors.date && <span className="field-error">{errors.date.message}</span>}
            </div>
            <div className="field">
              <label className="label" htmlFor="rep-hours">Hours spent</label>
              <input id="rep-hours" className="input" type="number" step="0.25" min={0} max={24} {...register('hoursSpent')} />
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="rep-title">Title</label>
            <input id="rep-title" className="input" {...register('title')} />
            {errors.title && <span className="field-error">{errors.title.message}</span>}
          </div>

          <div className="field">
            <label className="label" htmlFor="rep-category">Category (optional)</label>
            <input id="rep-category" className="input" placeholder="e.g. Development, Support" {...register('category')} />
          </div>

          <div className="field">
            <label className="label" htmlFor="rep-desc">Activities / description</label>
            <textarea id="rep-desc" className="eoc-textarea" rows={3} {...register('description')} />
            {errors.description && <span className="field-error">{errors.description.message}</span>}
          </div>

          <div className="field">
            <label className="label" htmlFor="rep-learn">Key learnings (optional)</label>
            <textarea id="rep-learn" className="eoc-textarea" rows={2} {...register('learnings')} />
          </div>

          <div className="flex gap-2" style={{ marginTop: 4 }}>
            <button type="button" className="btn btn-ghost flex-1" onClick={onClose} disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary flex-1" disabled={submitting}>
              {submitting ? <DotLoader size={16} /> : null}
              {submitting ? 'Submitting…' : 'Submit entry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default MyLogbookPage;
