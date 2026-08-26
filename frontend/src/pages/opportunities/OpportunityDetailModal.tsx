import { ChangeEvent, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Trash2, Plus, Phone, Paperclip, FileText, Download } from 'lucide-react';
import DotLoader from '@/components/shared/DotLoader';
import { useNotificationStore } from '@/stores/notificationStore';
import { useAuthStore } from '@/stores/authStore';
import api from '@/api/client';
import { confirmDialog } from '@/lib/alert';
import { opportunityAttachmentFileUrl, uploadOpportunityAttachments } from '@/lib/opportunityAttachments';
import {
  ACTIVITY_TYPE_OPTIONS, Opportunity, OpportunityAttachment, PRIORITY_OPTIONS, STAGE_OPTIONS, User,
} from '@/types/api';
import { stagePillClass, priorityPillClass, stageLabel } from '@/utils/opportunity';

const optionalNumber = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.coerce.number().min(0).optional()
);
const optionalProbability = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.coerce.number().int().min(0).max(100).optional()
);

const detailSchema = z.object({
  name: z.string().min(2),
  customerName: z.string().min(1),
  contactPerson: z.string().optional(),
  source: z.string().optional(),
  dateIdentified: z.string().min(1),
  estimatedValue: optionalNumber,
  description: z.string().optional(),
  stage: z.enum(['NEW', 'QUALIFICATION', 'ASSIGNED', 'ENGAGEMENT', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST']),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),

  isGenuine: z.enum(['', 'true', 'false']).optional(),
  customerNeed: z.string().optional(),
  budgetConfirmed: z.string().optional(),
  decisionMaker: z.string().optional(),
  expectedTimeline: z.string().optional(),
  probability: optionalProbability,

  assignedToId: z.string().optional(),
  followUpDate: z.string().optional(),

  proposalSubmittedDate: z.string().optional(),
  proposedValue: optionalNumber,
  expectedClosingDate: z.string().optional(),

  customerFeedback: z.string().optional(),
  revisedValue: optionalNumber,
  negotiationNotes: z.string().optional(),
  competitors: z.string().optional(),

  finalValue: optionalNumber,
  contractNumber: z.string().optional(),
  closingDate: z.string().optional(),

  reasonLost: z.string().optional(),
  competitorSelected: z.string().optional(),
  lostValue: optionalNumber,
  lessonsLearned: z.string().optional(),
});
type DetailForm = z.infer<typeof detailSchema>;

const activitySchema = z.object({
  type: z.enum(['CALL', 'MEETING', 'SITE_VISIT', 'EMAIL', 'REQUIREMENTS_GATHERING', 'OTHER']),
  date: z.string().min(1),
  notes: z.string().optional(),
});
type ActivityForm = z.infer<typeof activitySchema>;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_ATTACHMENT_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);
const ALLOWED_ATTACHMENT_EXTS = ['.pdf', '.docx', '.doc'];

function isAllowedFile(file: File): boolean {
  if (ALLOWED_ATTACHMENT_MIMES.has(file.type)) return true;
  const name = file.name.toLowerCase();
  return ALLOWED_ATTACHMENT_EXTS.some((ext) => name.endsWith(ext));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function OpportunityDetailModal({ id, staff, onClose, onChanged, onDeleted }: {
  id: string;
  staff: User[];
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const { addNotification } = useNotificationStore();
  const role = useAuthStore((s) => s.user?.role);
  const token = useAuthStore((s) => s.token);
  const isManager = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const queryClient = useQueryClient();
  const [fileError, setFileError] = useState<string | null>(null);

  const { data: opportunity, isLoading } = useQuery({
    queryKey: ['opportunities', 'detail', id],
    queryFn: async () => {
      const res = await api.get<{ data: Opportunity }>(`/opportunities/${id}`);
      return res.data.data;
    },
  });

  const { register, handleSubmit, watch, formState: { errors } } = useForm<DetailForm>({
    resolver: zodResolver(detailSchema),
    values: opportunity
      ? {
          name: opportunity.name,
          customerName: opportunity.customerName,
          contactPerson: opportunity.contactPerson ?? '',
          source: opportunity.source ?? '',
          dateIdentified: opportunity.dateIdentified.slice(0, 10),
          estimatedValue: opportunity.estimatedValue ?? undefined,
          description: opportunity.description ?? '',
          stage: opportunity.stage,
          priority: opportunity.priority,
          isGenuine: opportunity.isGenuine == null ? '' : opportunity.isGenuine ? 'true' : 'false',
          customerNeed: opportunity.customerNeed ?? '',
          budgetConfirmed: opportunity.budgetConfirmed ?? '',
          decisionMaker: opportunity.decisionMaker ?? '',
          expectedTimeline: opportunity.expectedTimeline ?? '',
          probability: opportunity.probability ?? undefined,
          assignedToId: opportunity.assignedToId ?? '',
          followUpDate: opportunity.followUpDate?.slice(0, 10) ?? '',
          proposalSubmittedDate: opportunity.proposalSubmittedDate?.slice(0, 10) ?? '',
          proposedValue: opportunity.proposedValue ?? undefined,
          expectedClosingDate: opportunity.expectedClosingDate?.slice(0, 10) ?? '',
          customerFeedback: opportunity.customerFeedback ?? '',
          revisedValue: opportunity.revisedValue ?? undefined,
          negotiationNotes: opportunity.negotiationNotes ?? '',
          competitors: opportunity.competitors ?? '',
          finalValue: opportunity.finalValue ?? undefined,
          contractNumber: opportunity.contractNumber ?? '',
          closingDate: opportunity.closingDate?.slice(0, 10) ?? '',
          reasonLost: opportunity.reasonLost ?? '',
          competitorSelected: opportunity.competitorSelected ?? '',
          lostValue: opportunity.lostValue ?? undefined,
          lessonsLearned: opportunity.lessonsLearned ?? '',
        }
      : undefined,
  });
  const watchedStage = watch('stage');

  const {
    register: registerActivity, handleSubmit: handleActivitySubmit, reset: resetActivity,
  } = useForm<ActivityForm>({ resolver: zodResolver(activitySchema), defaultValues: { type: 'CALL', date: todayISO() } });

  const saveMutation = useMutation({
    mutationFn: (values: DetailForm) => {
      const { isGenuine, assignedToId, ...rest } = values;
      return api.patch(`/opportunities/${id}`, {
        ...rest,
        assignedToId: assignedToId || undefined,
        isGenuine: isGenuine === '' ? undefined : isGenuine === 'true',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opportunities'] });
      addNotification({ type: 'success', title: 'Opportunity updated', message: 'Changes have been saved.' });
      onChanged();
    },
    onError: (err: any) => addNotification({ type: 'error', title: 'Update failed', message: err?.response?.data?.message || 'Please try again.' }),
  });

  const activityMutation = useMutation({
    mutationFn: (values: ActivityForm) => api.post(`/opportunities/${id}/activities`, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opportunities', 'detail', id] });
      resetActivity({ type: 'CALL', date: todayISO(), notes: '' });
      addNotification({ type: 'success', title: 'Activity logged', message: 'Added to the engagement trail.' });
    },
    onError: (err: any) => addNotification({ type: 'error', title: 'Failed to log activity', message: err?.response?.data?.message || 'Please try again.' }),
  });

  const { data: attachments } = useQuery({
    queryKey: ['opportunities', 'attachments', id],
    queryFn: async () => {
      const res = await api.get<{ data: OpportunityAttachment[] }>(`/opportunities/${id}/attachments`);
      return res.data.data;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: (picked: File[]) => uploadOpportunityAttachments(id, picked),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opportunities'] });
      addNotification({ type: 'success', title: 'File uploaded', message: 'The document has been attached.' });
    },
    onError: (err: any) => addNotification({ type: 'error', title: 'Upload failed', message: err?.response?.data?.message || 'Please try again.' }),
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: (attachmentId: string) => api.delete(`/opportunities/${id}/attachments/${attachmentId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opportunities'] });
      addNotification({ type: 'success', title: 'File removed', message: 'The document has been deleted.' });
    },
    onError: (err: any) => addNotification({ type: 'error', title: 'Delete failed', message: err?.response?.data?.message || 'Please try again.' }),
  });

  const handleFilesSelected = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (picked.length === 0) return;

    const room = MAX_ATTACHMENTS - (attachments?.length ?? 0);
    let error: string | null = null;
    const accepted: File[] = [];

    for (const file of picked) {
      if (!isAllowedFile(file)) {
        error = `"${file.name}" isn't a supported type. Attach a PDF or Word document (.docx).`;
        continue;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        error = `"${file.name}" is larger than 10MB.`;
        continue;
      }
      if (accepted.length >= room) {
        error = `An opportunity can have at most ${MAX_ATTACHMENTS} files.`;
        break;
      }
      accepted.push(file);
    }

    setFileError(error);
    if (accepted.length > 0) uploadMutation.mutate(accepted);
  };

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/opportunities/${id}`),
    onSuccess: () => {
      addNotification({ type: 'success', title: 'Opportunity deleted', message: 'It has been removed from the pipeline.' });
      onDeleted();
    },
    onError: (err: any) => addNotification({ type: 'error', title: 'Delete failed', message: err?.response?.data?.message || 'Please try again.' }),
  });

  const handleDelete = async () => {
    if (!opportunity) return;
    const confirmed = await confirmDialog({
      title: 'Delete opportunity',
      text: `Delete "${opportunity.name}" (${opportunity.customerName})? This can't be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (confirmed) deleteMutation.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(10,20,15,0.45)' }}>
      <div className="card w-full" style={{ maxWidth: 720, maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="card-head" style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
          <span className="card-title">{opportunity ? opportunity.name : 'Opportunity'}</span>
          <div className="flex items-center gap-1">
            {opportunity && (
              <>
                <span className={stagePillClass(opportunity.stage)}>{stageLabel(opportunity.stage)}</span>
                <span className={priorityPillClass(opportunity.priority)}>{opportunity.priority}</span>
              </>
            )}
            {isManager && (
              <button className="icon-btn" title="Delete" onClick={handleDelete} disabled={deleteMutation.isPending}>
                <Trash2 size={14} />
              </button>
            )}
            <button className="icon-btn" onClick={onClose} type="button"><X size={16} /></button>
          </div>
        </div>

        {isLoading || !opportunity ? (
          <div className="card-pad"><div className="skel" style={{ height: 320 }} /></div>
        ) : (
          <form className="card-pad col" style={{ gap: 20 }} onSubmit={handleSubmit((v) => saveMutation.mutate(v))}>
            {/* 1. Identified */}
            <section className="col" style={{ gap: 10 }}>
              <h4 className="text-xs font-bold uppercase" style={{ color: 'var(--muted)', letterSpacing: '.06em' }}>1. Opportunity Identified</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="field">
                  <label className="label" htmlFor="d-name">Opportunity name</label>
                  <input id="d-name" className="input" {...register('name')} />
                  {errors.name && <span className="field-error">{errors.name.message}</span>}
                </div>
                <div className="field">
                  <label className="label" htmlFor="d-customer">Customer / organization</label>
                  <input id="d-customer" className="input" {...register('customerName')} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="field">
                  <label className="label" htmlFor="d-contact">Contact person</label>
                  <input id="d-contact" className="input" {...register('contactPerson')} />
                </div>
                <div className="field">
                  <label className="label" htmlFor="d-source">Source</label>
                  <input id="d-source" className="input" {...register('source')} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="field">
                  <label className="label" htmlFor="d-date">Date identified</label>
                  <input id="d-date" className="input" type="date" {...register('dateIdentified')} />
                </div>
                <div className="field">
                  <label className="label" htmlFor="d-value">Estimated value (KSh)</label>
                  <input id="d-value" className="input" type="number" min={0} step="1000" {...register('estimatedValue')} />
                </div>
              </div>
              <div className="field">
                <label className="label" htmlFor="d-desc">Description</label>
                <textarea id="d-desc" className="eoc-textarea" rows={2} {...register('description')} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="field">
                  <label className="label" htmlFor="d-stage">Stage</label>
                  <select id="d-stage" className="eoc-select" {...register('stage')}>
                    {STAGE_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="label" htmlFor="d-priority">Priority</label>
                  <select id="d-priority" className="eoc-select" {...register('priority')}>
                    {PRIORITY_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
              </div>
            </section>

            {/* 2. Qualification */}
            <section className="col" style={{ gap: 10, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <h4 className="text-xs font-bold uppercase" style={{ color: 'var(--muted)', letterSpacing: '.06em' }}>2. Qualification</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="field">
                  <label className="label" htmlFor="d-genuine">Genuine opportunity?</label>
                  <select id="d-genuine" className="eoc-select" {...register('isGenuine')}>
                    <option value="">Not assessed</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </div>
                <div className="field">
                  <label className="label" htmlFor="d-decision">Decision maker</label>
                  <input id="d-decision" className="input" {...register('decisionMaker')} />
                </div>
              </div>
              <div className="field">
                <label className="label" htmlFor="d-need">Customer need</label>
                <textarea id="d-need" className="eoc-textarea" rows={2} {...register('customerNeed')} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="field">
                  <label className="label" htmlFor="d-budget">Budget</label>
                  <input id="d-budget" className="input" placeholder="e.g. Confirmed, KSh 5M" {...register('budgetConfirmed')} />
                </div>
                <div className="field">
                  <label className="label" htmlFor="d-timeline">Expected timeline</label>
                  <input id="d-timeline" className="input" placeholder="e.g. Q3 2026" {...register('expectedTimeline')} />
                </div>
                <div className="field">
                  <label className="label" htmlFor="d-prob">Probability of winning (%)</label>
                  <input id="d-prob" className="input" type="number" min={0} max={100} {...register('probability')} />
                  {errors.probability && <span className="field-error">{errors.probability.message}</span>}
                </div>
              </div>
            </section>

            {/* 3. Assigned */}
            <section className="col" style={{ gap: 10, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <h4 className="text-xs font-bold uppercase" style={{ color: 'var(--muted)', letterSpacing: '.06em' }}>3. Assigned</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="field">
                  <label className="label" htmlFor="d-assignee">Salesperson / team member</label>
                  <select id="d-assignee" className="eoc-select" {...register('assignedToId')}>
                    <option value="">Unassigned</option>
                    {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="label" htmlFor="d-followup">Follow-up date</label>
                  <input id="d-followup" className="input" type="date" {...register('followUpDate')} />
                </div>
              </div>
            </section>

            {/* Documents */}
            <section className="col" style={{ gap: 10, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <h4 className="text-xs font-bold uppercase" style={{ color: 'var(--muted)', letterSpacing: '.06em' }}>Documents</h4>
              <div className="field">
                <label className="label" htmlFor="d-files">PDF or Word (.docx)</label>
                <input
                  id="d-files"
                  className="input"
                  type="file"
                  accept=".pdf,.docx,.doc"
                  multiple
                  onChange={handleFilesSelected}
                  disabled={uploadMutation.isPending}
                />
                <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                  <Paperclip size={11} style={{ verticalAlign: -1, marginRight: 3 }} />
                  Up to {MAX_ATTACHMENTS} files, 10MB each.
                </span>
                {fileError && <span className="field-error">{fileError}</span>}
              </div>
              {(attachments?.length ?? 0) === 0 && !uploadMutation.isPending ? (
                <p className="text-xs" style={{ color: 'var(--muted)' }}>No documents attached yet.</p>
              ) : (
                <div className="col" style={{ gap: 6 }}>
                  {attachments?.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center gap-2"
                      style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--surface-2)', fontSize: 12.5 }}
                    >
                      <FileText size={14} style={{ color: 'var(--red)', flexShrink: 0 }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{a.fileName}</div>
                        <div style={{ color: 'var(--muted)', fontSize: 11.5 }}>
                          {formatBytes(a.bytes)}{a.uploadedBy?.name ? ` · ${a.uploadedBy.name}` : ''}
                        </div>
                      </div>
                      <a
                        className="icon-btn"
                        href={opportunityAttachmentFileUrl(id, a.id, token)}
                        target="_blank"
                        rel="noreferrer"
                        title="Download"
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        <Download size={14} />
                      </a>
                      <button
                        type="button"
                        className="icon-btn"
                        title="Remove"
                        onClick={() => deleteAttachmentMutation.mutate(a.id)}
                        disabled={deleteAttachmentMutation.isPending && deleteAttachmentMutation.variables === a.id}
                      >
                        {deleteAttachmentMutation.isPending && deleteAttachmentMutation.variables === a.id
                          ? <DotLoader size={12} />
                          : <Trash2 size={12} />}
                      </button>
                    </div>
                  ))}
                  {uploadMutation.isPending && (
                    <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
                      <DotLoader size={14} /> Uploading…
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* 4. Engagement (activity log) */}
            <section className="col" style={{ gap: 10, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <h4 className="text-xs font-bold uppercase" style={{ color: 'var(--muted)', letterSpacing: '.06em' }}>4. Engagement</h4>
              <div className="col" style={{ gap: 8 }}>
                {(opportunity.activities ?? []).length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>No calls, meetings, or other touchpoints logged yet.</p>
                ) : (
                  opportunity.activities!.map((a) => (
                    <div key={a.id} className="flex items-start gap-2" style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--surface-2)', fontSize: 12.5 }}>
                      <Phone size={13} style={{ marginTop: 2, color: 'var(--muted)', flexShrink: 0 }} />
                      <div>
                        <b>{ACTIVITY_TYPE_OPTIONS.find((t) => t.value === a.type)?.label ?? a.type}</b>
                        <span style={{ color: 'var(--muted)' }}> • {a.date.slice(0, 10)}{a.loggedBy ? ` • ${a.loggedBy.name}` : ''}</span>
                        {a.notes && <div style={{ color: 'var(--ink-2)', marginTop: 2 }}>{a.notes}</div>}
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="flex items-end gap-2" style={{ flexWrap: 'wrap' }}>
                <div className="field" style={{ minWidth: 140 }}>
                  <label className="label" htmlFor="a-type">Type</label>
                  <select id="a-type" className="eoc-select" {...registerActivity('type')}>
                    {ACTIVITY_TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div className="field" style={{ minWidth: 140 }}>
                  <label className="label" htmlFor="a-date">Date</label>
                  <input id="a-date" className="input" type="date" {...registerActivity('date')} />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 180 }}>
                  <label className="label" htmlFor="a-notes">Notes</label>
                  <input id="a-notes" className="input" placeholder="Optional notes" {...registerActivity('notes')} />
                </div>
                <button
                  type="button"
                  className="btn btn-soft btn-sm"
                  disabled={activityMutation.isPending}
                  onClick={handleActivitySubmit((v) => activityMutation.mutate(v))}
                >
                  {activityMutation.isPending ? <DotLoader size={14} /> : <Plus size={14} />} Log
                </button>
              </div>
            </section>

            {/* 5. Proposal / Quotation */}
            <section className="col" style={{ gap: 10, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <h4 className="text-xs font-bold uppercase" style={{ color: 'var(--muted)', letterSpacing: '.06em' }}>5. Proposal / Quotation</h4>
              <div className="grid grid-cols-3 gap-3">
                <div className="field">
                  <label className="label" htmlFor="d-propdate">Proposal submitted</label>
                  <input id="d-propdate" className="input" type="date" {...register('proposalSubmittedDate')} />
                </div>
                <div className="field">
                  <label className="label" htmlFor="d-propvalue">Proposed value (KSh)</label>
                  <input id="d-propvalue" className="input" type="number" min={0} step="1000" {...register('proposedValue')} />
                </div>
                <div className="field">
                  <label className="label" htmlFor="d-closedate">Expected closing date</label>
                  <input id="d-closedate" className="input" type="date" {...register('expectedClosingDate')} />
                </div>
              </div>
            </section>

            {/* 6. Negotiation */}
            <section className="col" style={{ gap: 10, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <h4 className="text-xs font-bold uppercase" style={{ color: 'var(--muted)', letterSpacing: '.06em' }}>6. Negotiation</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="field">
                  <label className="label" htmlFor="d-revised">Revised quotation (KSh)</label>
                  <input id="d-revised" className="input" type="number" min={0} step="1000" {...register('revisedValue')} />
                </div>
                <div className="field">
                  <label className="label" htmlFor="d-competitors">Competitors</label>
                  <input id="d-competitors" className="input" placeholder="e.g. Vendor A, Vendor B" {...register('competitors')} />
                </div>
              </div>
              <div className="field">
                <label className="label" htmlFor="d-feedback">Customer feedback</label>
                <textarea id="d-feedback" className="eoc-textarea" rows={2} {...register('customerFeedback')} />
              </div>
              <div className="field">
                <label className="label" htmlFor="d-negnotes">Negotiation notes</label>
                <textarea id="d-negnotes" className="eoc-textarea" rows={2} {...register('negotiationNotes')} />
              </div>
            </section>

            {/* 7. Won / Lost */}
            {watchedStage === 'WON' && (
              <section className="col" style={{ gap: 10, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <h4 className="text-xs font-bold uppercase" style={{ color: 'var(--color-status-success, #169A5B)', letterSpacing: '.06em' }}>7. Won</h4>
                <div className="grid grid-cols-3 gap-3">
                  <div className="field">
                    <label className="label" htmlFor="d-finalvalue">Final value (KSh)</label>
                    <input id="d-finalvalue" className="input" type="number" min={0} step="1000" {...register('finalValue')} />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="d-contract">Contract / order no.</label>
                    <input id="d-contract" className="input" {...register('contractNumber')} />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="d-closing">Closing date</label>
                    <input id="d-closing" className="input" type="date" {...register('closingDate')} />
                  </div>
                </div>
              </section>
            )}

            {watchedStage === 'LOST' && (
              <section className="col" style={{ gap: 10, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <h4 className="text-xs font-bold uppercase" style={{ color: 'var(--red)', letterSpacing: '.06em' }}>7. Lost</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="field">
                    <label className="label" htmlFor="d-competitorsel">Competitor selected</label>
                    <input id="d-competitorsel" className="input" {...register('competitorSelected')} />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="d-lostvalue">Lost value (KSh)</label>
                    <input id="d-lostvalue" className="input" type="number" min={0} step="1000" {...register('lostValue')} />
                  </div>
                </div>
                <div className="field">
                  <label className="label" htmlFor="d-reason">Reason lost</label>
                  <textarea id="d-reason" className="eoc-textarea" rows={2} {...register('reasonLost')} />
                </div>
                <div className="field">
                  <label className="label" htmlFor="d-lessons">Lessons learned</label>
                  <textarea id="d-lessons" className="eoc-textarea" rows={2} {...register('lessonsLearned')} />
                </div>
              </section>
            )}

            <div className="flex gap-2" style={{ marginTop: 4, position: 'sticky', bottom: 0, background: 'var(--surface)', paddingTop: 8 }}>
              <button type="button" className="btn btn-ghost flex-1" onClick={onClose} disabled={saveMutation.isPending}>Close</button>
              <button type="submit" className="btn btn-primary flex-1" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? <DotLoader size={16} /> : null}
                {saveMutation.isPending ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default OpportunityDetailModal;
