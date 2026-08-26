import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, CheckCircle2, Clock, AlertCircle, Award, FileCheck } from 'lucide-react';
import { useNotificationStore } from '@/stores/notificationStore';
import DotLoader from '@/components/shared/DotLoader';
import { useAuthStore } from '@/stores/authStore';
import api from '@/api/client';
import { Attachee, PaginatedResponse, ReportStatus, TaskReport } from '@/types/api';

const STATUSES: ReportStatus[] = ['PENDING', 'APPROVED', 'NEEDS_REVISION', 'REJECTED'];

function label(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
}

function statusMeta(status: ReportStatus) {
  if (status === 'APPROVED') return { pill: 'pill-green', Icon: CheckCircle2 };
  if (status === 'PENDING') return { pill: 'pill-amber', Icon: Clock };
  return { pill: 'pill-red', Icon: AlertCircle };
}

const reviewSchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'NEEDS_REVISION', 'REJECTED']),
  rating: z.coerce.number().int().min(0).max(100),
  feedback: z.string().min(1, 'Feedback is required'),
});
type ReviewForm = z.infer<typeof reviewSchema>;

function SupervisedLogbook({ attachees }: { attachees: Attachee[] }) {
  const [attacheeFilter, setAttacheeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [reviewing, setReviewing] = useState<TaskReport | null>(null);
  const { addNotification } = useNotificationStore();
  const reviewerName = useAuthStore((s) => s.user?.name);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['attachments', 'supervised-reports', attacheeFilter, statusFilter],
    queryFn: async () => {
      const params: Record<string, string | number> = { limit: 100 };
      if (attacheeFilter) params.attacheeId = attacheeFilter;
      if (statusFilter) params.status = statusFilter;
      const res = await api.get<PaginatedResponse<TaskReport>>('/attachments/reports', { params });
      return res.data;
    },
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: ReviewForm }) =>
      api.patch(`/attachments/reports/${id}`, { ...values, supervisorName: reviewerName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attachments', 'supervised-reports'] });
      setReviewing(null);
      addNotification({ type: 'success', title: 'Report reviewed', message: 'The evaluation has been saved.' });
    },
    onError: (err: any) => addNotification({ type: 'error', title: 'Review failed', message: err?.response?.data?.message || 'Please try again.' }),
  });

  const reports = data?.data ?? [];

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

      <div className="col" style={{ gap: 12 }}>
        {isLoading ? (
          <div className="card card-pad"><div className="skel" style={{ height: 160 }} /></div>
        ) : reports.length === 0 ? (
          <div className="card card-pad flex flex-col items-center text-center" style={{ gap: 8, padding: '48px 20px' }}>
            <FileCheck size={32} style={{ color: 'var(--red)' }} />
            <p className="text-base font-bold" style={{ color: 'var(--ink)' }}>No logbook entries found</p>
          </div>
        ) : (
          reports.map((report) => {
            const { pill, Icon } = statusMeta(report.status);
            return (
              <div key={report.id} className="card">
                <div className="card-head" style={{ alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 3 }}>
                      {report.attachee.name} ({report.attachee.registrationNo}) • {report.date.slice(0, 10)} • {report.hoursSpent}h
                      {report.category ? ` • ${report.category}` : ''}
                    </div>
                    <span className="card-title" style={{ fontSize: 15 }}>{report.title}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`pill ${pill}`}><Icon size={13} />{label(report.status)}{report.rating != null ? ` (${report.rating}%)` : ''}</span>
                    <button className="btn btn-sm btn-soft" onClick={() => setReviewing(report)}>
                      <Award size={13} /> {report.status === 'PENDING' ? 'Evaluate' : 'Update review'}
                    </button>
                  </div>
                </div>
                <div className="card-pad col" style={{ gap: 10 }}>
                  <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.6, whiteSpace: 'pre-line' }}>{report.description}</p>
                  {report.learnings && (
                    <div style={{ padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)', fontSize: 12.5 }}>
                      <b style={{ color: 'var(--green)' }}>Key learnings: </b>
                      <span style={{ color: 'var(--muted)' }}>{report.learnings}</span>
                    </div>
                  )}
                  {report.feedback && (
                    <div style={{ padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--green-light)', fontSize: 12.5 }}>
                      <b style={{ color: 'var(--green)' }}>Your feedback: </b>
                      <span style={{ color: 'var(--ink-2)' }}>&ldquo;{report.feedback}&rdquo;</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {reviewing && (
        <ReviewReportModal
          report={reviewing}
          onClose={() => setReviewing(null)}
          submitting={reviewMutation.isPending}
          onSubmit={async (values) => { await reviewMutation.mutateAsync({ id: reviewing.id, values }); }}
        />
      )}
    </div>
  );
}

function ReviewReportModal({ report, onClose, onSubmit, submitting }: {
  report: TaskReport;
  onClose: () => void;
  onSubmit: (values: ReviewForm) => Promise<void> | void;
  submitting?: boolean;
}) {
  const { register, handleSubmit, formState: { errors } } = useForm<ReviewForm>({
    resolver: zodResolver(reviewSchema),
    defaultValues: {
      status: report.status === 'PENDING' ? 'APPROVED' : report.status,
      rating: report.rating ?? 90,
      feedback: report.feedback ?? '',
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(10,20,15,0.45)' }}>
      <div className="card w-full" style={{ maxWidth: 480 }}>
        <div className="card-head">
          <span className="card-title">Evaluate: {report.title}</span>
          <button className="icon-btn" onClick={onClose} type="button"><X size={16} /></button>
        </div>
        <form className="card-pad col" style={{ gap: 14 }} onSubmit={handleSubmit(async (v) => onSubmit(v))}>
          <p style={{ fontSize: 12.5, color: 'var(--muted)' }}>
            Submitted by {report.attachee.name} on {report.date.slice(0, 10)} ({report.hoursSpent}h)
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div className="field">
              <label className="label" htmlFor="rev-status">Status</label>
              <select id="rev-status" className="eoc-select" {...register('status')}>
                <option value="APPROVED">Approved</option>
                <option value="NEEDS_REVISION">Needs Revision</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="rev-rating">Grade (0–100%)</label>
              <input id="rev-rating" className="input" type="number" min={0} max={100} {...register('rating')} />
              {errors.rating && <span className="field-error">{errors.rating.message}</span>}
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="rev-feedback">Feedback</label>
            <textarea id="rev-feedback" className="eoc-textarea" rows={4} {...register('feedback')} />
            {errors.feedback && <span className="field-error">{errors.feedback.message}</span>}
          </div>

          <div className="flex gap-2" style={{ marginTop: 4 }}>
            <button type="button" className="btn btn-ghost flex-1" onClick={onClose} disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary flex-1" disabled={submitting}>
              {submitting ? <DotLoader size={16} /> : null}
              {submitting ? 'Saving…' : 'Save evaluation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default SupervisedLogbook;
