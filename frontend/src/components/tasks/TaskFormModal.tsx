import { ChangeEvent, DragEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  X, Trash2, FileText, ClipboardList, UploadCloud, Check, CalendarDays, Building2, Clock3, Gauge,
  NotebookPen, Paperclip, Layers,
} from 'lucide-react';
import AppLoader from '@/components/shared/AppLoader';
import { useTaskOptions } from '@/hooks/useTaskOptions';
import { useAuthStore } from '@/stores/authStore';
import api from '@/api/client';
import { attachmentFileUrl } from '@/lib/taskAttachments';
import { nairobiTodayISO } from '@/lib/datetime';
import { statusPillClass } from '@/utils/taskStatus';
import { TaskAttachment, TaskCategory, TaskStatus, TaskVertical, WorkTask } from '@/types/api';

const taskSchema = z.object({
  date: z.string().min(1, 'Date is required'),
  vertical: z.string().min(1, 'Choose a vertical'),
  category: z.string().min(1, 'Choose a category'),
  description: z.string().min(3, 'Describe the task in a few words'),
  organization: z.string().optional(),
  customerProject: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  hoursSpent: z.coerce.number().min(0).max(24),
  status: z.string().min(1),
  percentComplete: z.coerce.number().int().min(0).max(100),
  keyDeliverable: z.string().optional(),
  blockersNotes: z.string().optional(),
  userId: z.string().optional(),
});

export type TaskFormValues = z.infer<typeof taskSchema>;

// Keep in sync with backend/src/modules/tasks/attachment-constants.ts.
const MAX_ATTACHMENTS = 8;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ALLOWED_ATTACHMENT_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', DOCX_MIME]);
const ALLOWED_ATTACHMENT_ACCEPT = '.jpg,.jpeg,.png,.webp,.gif,.pdf,.docx';

const WORKDAY_HOURS = 8;
const HOUR_SLIDER_MAX = 12;
const HOUR_PRESETS = [0.5, 1, 2, 4, 8];
const PERCENT_MARKS = [0, 25, 50, 75, 100];

interface AssignableUser {
  id: string;
  name: string;
}

interface TaskFormModalProps {
  initial?: WorkTask | null;
  assignableUsers?: AssignableUser[];
  onClose: () => void;
  onSubmit: (values: TaskFormValues, screenshots: File[]) => Promise<void> | void;
  submitting?: boolean;
}

type SectionId = 'basics' | 'details' | 'time' | 'notes' | 'evidence';

const SECTIONS: Array<{ id: SectionId; label: string; Icon: typeof Layers }> = [
  { id: 'basics', label: 'Basics', Icon: Layers },
  { id: 'details', label: 'Details', Icon: Building2 },
  { id: 'time', label: 'Time & progress', Icon: Clock3 },
  { id: 'notes', label: 'Notes', Icon: NotebookPen },
  { id: 'evidence', label: 'Evidence', Icon: Paperclip },
];

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function computeHours(startTime?: string, endTime?: string): number | null {
  if (!startTime || !endTime) return null;
  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);
  if ([startH, startM, endH, endM].some((n) => Number.isNaN(n))) return null;

  let minutes = (endH * 60 + endM) - (startH * 60 + startM);
  if (minutes < 0) minutes += 24 * 60; // crosses midnight
  return Math.round((minutes / 60) * 100) / 100;
}

/** 1.25 -> "1 h 15 min", 0.5 -> "30 min". */
function fmtDuration(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (total === 0) return '0 min';
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** "Millenium Solutions E.A Limited" -> "Millenium Solutions". */
function shortOrg(label: string): string {
  return label.replace(/\s+(E\.A\s+)?Limited$/, '');
}

/** Progress implied by a status - matches the WhatsApp assistant. */
function percentForStatus(status: string, current: number): number {
  if (status === 'COMPLETED_CLOSED' || status === 'RESOLVED') return 100;
  if (status === 'NOT_STARTED') return 0;
  return current === 0 || current === 100 ? 50 : current;
}

function Section({
  id, title, hint, Icon, children, sectionRef,
}: {
  id: SectionId;
  title: string;
  hint?: string;
  Icon: typeof Layers;
  children: ReactNode;
  sectionRef: (el: HTMLElement | null) => void;
}) {
  return (
    <section id={`tf-${id}`} ref={sectionRef} className="tf-section">
      <header className="tf-section-head">
        <span className="tf-section-icon"><Icon size={15} /></span>
        <span className="tf-section-title">{title}</span>
        {hint && <span className="tf-section-hint">{hint}</span>}
      </header>
      <div className="col" style={{ gap: 14 }}>{children}</div>
    </section>
  );
}

function AttachmentTile({
  name, detail, thumbUrl, onRemove, removing,
}: {
  name: string;
  detail?: string;
  thumbUrl?: string;
  onRemove: () => void;
  removing?: boolean;
}) {
  return (
    <div className="tf-tile" title={name}>
      <div className="tf-tile-thumb">
        {thumbUrl ? <img src={thumbUrl} alt={name} /> : <FileText size={22} />}
      </div>
      <div className="tf-tile-meta">
        <span className="tf-tile-name">{name}</span>
        {detail && <span className="tf-tile-detail">{detail}</span>}
      </div>
      <button type="button" className="tf-tile-remove" onClick={onRemove} disabled={removing} aria-label={`Remove ${name}`}>
        {removing ? <AppLoader size={14} /> : <Trash2 size={13} />}
      </button>
    </div>
  );
}

function TaskFormModal({ initial, assignableUsers, onClose, onSubmit, submitting }: TaskFormModalProps) {
  const { data: options } = useTaskOptions();
  const token = useAuthStore((s) => s.token);
  const queryClient = useQueryClient();

  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionId>('basics');
  const sectionEls = useRef<Partial<Record<SectionId, HTMLElement | null>>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: existingAttachments } = useQuery({
    queryKey: ['task-attachments', initial?.id],
    queryFn: async () => {
      const res = await api.get<{ data: TaskAttachment[] }>(`/tasks/${initial!.id}/attachments`);
      return res.data.data;
    },
    enabled: !!initial,
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: (attachmentId: string) => api.delete(`/tasks/${initial!.id}/attachments/${attachmentId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['task-attachments', initial?.id] }),
  });

  const today = nairobiTodayISO();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<TaskFormValues>({
    resolver: zodResolver(taskSchema),
    defaultValues: initial
      ? {
          date: initial.date.slice(0, 10),
          vertical: initial.vertical,
          category: initial.category,
          description: initial.description,
          organization: initial.organization ?? '',
          customerProject: initial.customerProject ?? '',
          startTime: initial.startTime ?? '',
          endTime: initial.endTime ?? '',
          hoursSpent: initial.hoursSpent,
          status: initial.status,
          percentComplete: initial.percentComplete,
          keyDeliverable: initial.keyDeliverable ?? '',
          blockersNotes: initial.blockersNotes ?? '',
          userId: initial.userId,
        }
      : {
          date: today,
          vertical: '' as TaskVertical,
          category: '' as TaskCategory,
          description: '',
          organization: '',
          hoursSpent: 0,
          status: 'NOT_STARTED' as TaskStatus,
          percentComplete: 0,
        },
  });

  const values = watch();
  const hours = Number(values.hoursSpent) || 0;
  const percent = Number(values.percentComplete) || 0;
  const timesSet = Boolean(values.startTime && values.endTime);

  useEffect(() => {
    const computed = computeHours(values.startTime, values.endTime);
    if (computed !== null) setValue('hoursSpent', computed, { shouldValidate: true });
  }, [values.startTime, values.endTime, setValue]);

  // Highlight the section currently in view in the header tracker.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActiveSection(top.target.id.replace('tf-', '') as SectionId);
      },
      { root, rootMargin: '0px 0px -60% 0px' }
    );
    Object.values(sectionEls.current).forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // Thumbnails for newly picked images.
  const previews = useMemo(() => files.map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined)), [files]);
  useEffect(() => () => previews.forEach((url) => url && URL.revokeObjectURL(url)), [previews]);

  const complete: Record<SectionId, boolean> = {
    basics: Boolean(values.date && values.vertical && values.category),
    details: (values.description ?? '').trim().length >= 3,
    time: hours > 0,
    notes: Boolean(values.keyDeliverable?.trim() || values.blockersNotes?.trim()),
    evidence: files.length + (existingAttachments?.length ?? 0) > 0,
  };

  const jumpTo = (id: SectionId) => sectionEls.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const pickStatus = (status: string) => {
    setValue('status', status, { shouldDirty: true });
    setValue('percentComplete', percentForStatus(status, percent), { shouldDirty: true });
  };

  const addFiles = (picked: File[]) => {
    if (picked.length === 0) return;
    const room = MAX_ATTACHMENTS - (existingAttachments?.length ?? 0) - files.length;
    let error: string | null = null;
    const accepted: File[] = [];

    for (const file of picked) {
      if (!ALLOWED_ATTACHMENT_MIMES.has(file.type)) {
        error = `"${file.name}" isn't a supported file type (JPG, PNG, WEBP, GIF, PDF or Word .docx only).`;
        continue;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        error = `"${file.name}" is larger than 10MB.`;
        continue;
      }
      if (accepted.length >= room) {
        error = `A task can have at most ${MAX_ATTACHMENTS} attachments.`;
        break;
      }
      accepted.push(file);
    }

    setFiles((prev) => [...prev, ...accepted]);
    setFileError(error);
  };

  const handleFilesSelected = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = ''; // allow re-selecting the same file again later
    addFiles(picked);
  };

  const handleDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  };

  const removeFile = (index: number) => setFiles((prev) => prev.filter((_, i) => i !== index));

  const onInvalid = () => {
    if (errors.vertical || errors.category || errors.date) jumpTo('basics');
    else if (errors.description) jumpTo('details');
  };

  const statusLabel = options?.statuses.find((s) => s.value === values.status)?.label;
  const categoryLabel = options?.categories.find((c) => c.value === values.category)?.label;
  const orgLabel = options?.organizations.find((o) => o.value === values.organization)?.label;
  const attachmentCount = files.length + (existingAttachments?.length ?? 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(10,20,15,0.45)' }}
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
    >
      <form
        className="card w-full tf-modal"
        onSubmit={handleSubmit(async (v) => { await onSubmit(v, files); }, onInvalid)}
      >
        {/* Header */}
        <div className="tf-head">
          <div className="flex items-start gap-3" style={{ minWidth: 0 }}>
            <span className="tf-head-icon"><ClipboardList size={19} /></span>
            <div style={{ minWidth: 0 }}>
              <h2 className="tf-head-title">{initial ? 'Edit task' : 'Log a task'}</h2>
              <p className="tf-head-sub">Record what you worked on. Fields marked <b>*</b> are required.</p>
            </div>
            <button className="icon-btn" onClick={onClose} type="button" aria-label="Close" style={{ marginLeft: 'auto' }}><X size={16} /></button>
          </div>

          <nav className="tf-steps" aria-label="Form sections">
            {SECTIONS.map(({ id, label }, i) => (
              <button
                key={id}
                type="button"
                className={`tf-step${activeSection === id ? ' active' : ''}${complete[id] ? ' done' : ''}`}
                onClick={() => jumpTo(id)}
              >
                <span className="tf-step-dot">{complete[id] ? <Check size={11} strokeWidth={3} /> : i + 1}</span>
                {label}
              </button>
            ))}
          </nav>
        </div>

        {/* Body */}
        <div className="tf-body" ref={scrollRef}>
          <Section id="basics" title="Basics" Icon={Layers} sectionRef={(el) => { sectionEls.current.basics = el; }}>
            {assignableUsers && assignableUsers.length > 0 && !initial && (
              <div className="field">
                <label className="label" htmlFor="task-user">Log for</label>
                <select id="task-user" className="eoc-select" {...register('userId')}>
                  <option value="">Myself</option>
                  {assignableUsers.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="field">
              <label className="label" htmlFor="task-date">Date worked *</label>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="input-icon" style={{ flex: '1 1 180px' }}>
                  <input id="task-date" className="input" type="date" {...register('date')} style={{ paddingLeft: 40 }} />
                  <CalendarDays size={16} />
                </div>
                {[
                  { label: 'Yesterday', value: shiftDate(today, -1) },
                  { label: 'Today', value: today },
                  { label: 'Tomorrow', value: shiftDate(today, 1) },
                ].map((d) => (
                  <button
                    key={d.label}
                    type="button"
                    className={`tf-chip${values.date === d.value ? ' on' : ''}`}
                    onClick={() => setValue('date', d.value, { shouldValidate: true })}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              {errors.date && <span className="field-error">{errors.date.message}</span>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="field">
                <label className="label" htmlFor="task-vertical">Vertical *</label>
                <select id="task-vertical" className="eoc-select" {...register('vertical')} style={errors.vertical ? { borderColor: 'var(--red)' } : undefined}>
                  <option value="">Choose a vertical…</option>
                  {options?.verticals.map((v) => (
                    <option key={v.value} value={v.value}>{v.label}</option>
                  ))}
                </select>
                {errors.vertical && <span className="field-error">{errors.vertical.message}</span>}
              </div>
              <div className="field">
                <label className="label" htmlFor="task-category">Category *</label>
                <select id="task-category" className="eoc-select" {...register('category')} style={errors.category ? { borderColor: 'var(--red)' } : undefined}>
                  <option value="">Choose a category…</option>
                  {options?.categories.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
                {errors.category && <span className="field-error">{errors.category.message}</span>}
              </div>
            </div>

            <div className="field">
              <span className="label">Status</span>
              <input type="hidden" {...register('status')} />
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Status">
                {options?.statuses.map((s) => {
                  const on = values.status === s.value;
                  return (
                    <button
                      key={s.value}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className={on ? `${statusPillClass(s.value as TaskStatus)} tf-status on` : 'tf-status'}
                      onClick={() => pickStatus(s.value)}
                    >
                      <span className="tf-status-dot" />
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </Section>

          <Section id="details" title="Details" Icon={Building2} sectionRef={(el) => { sectionEls.current.details = el; }}>
            <div className="field">
              <div className="flex items-center justify-between">
                <label className="label" htmlFor="task-description">Task description *</label>
                <span style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>{(values.description ?? '').length} characters</span>
              </div>
              <textarea
                id="task-description"
                className="eoc-textarea"
                rows={3}
                placeholder="e.g. Configured VLANs on the core switch at the Westlands branch"
                {...register('description')}
                style={errors.description ? { borderColor: 'var(--red)' } : undefined}
              />
              {errors.description && <span className="field-error">{errors.description.message}</span>}
            </div>

            <div className="field">
              <span className="label">Organization</span>
              <input type="hidden" {...register('organization')} />
              <div className="tf-org-grid" role="radiogroup" aria-label="Organization">
                {options?.organizations.map((o) => {
                  const on = values.organization === o.value;
                  const initials = shortOrg(o.label).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
                  return (
                    <button
                      key={o.value}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      title={o.label}
                      className={`tf-org${on ? ' on' : ''}`}
                      onClick={() => setValue('organization', on ? '' : o.value, { shouldDirty: true })}
                    >
                      <span className="tf-org-mark">{on ? <Check size={14} strokeWidth={3} /> : initials}</span>
                      <span className="tf-org-name">{shortOrg(o.label)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="field">
              <label className="label" htmlFor="task-customer">Customer / Project</label>
              <input id="task-customer" className="input" type="text" {...register('customerProject')} placeholder="e.g. KPLC - Interactive screen board" />
            </div>
          </Section>

          <Section id="time" title="Time & progress" Icon={Clock3} sectionRef={(el) => { sectionEls.current.time = el; }}>
            <div className="grid grid-cols-2 gap-3">
              <div className="field">
                <label className="label" htmlFor="task-start">Start time</label>
                <input id="task-start" className="input" type="time" {...register('startTime')} />
              </div>
              <div className="field">
                <label className="label" htmlFor="task-end">End time</label>
                <input id="task-end" className="input" type="time" {...register('endTime')} />
              </div>
            </div>

            <div className="tf-meter">
              <div className="flex items-baseline justify-between gap-2">
                <label className="label" htmlFor="task-hours-slider" style={{ margin: 0 }}>Time spent</label>
                <span className="tf-meter-value">{fmtDuration(hours)}</span>
              </div>
              <input
                id="task-hours-slider"
                className="range-slider"
                type="range"
                min={0}
                max={HOUR_SLIDER_MAX}
                step={0.25}
                value={Math.min(hours, HOUR_SLIDER_MAX)}
                disabled={timesSet}
                onChange={(e) => setValue('hoursSpent', Number(e.target.value), { shouldValidate: true, shouldDirty: true })}
                style={{ ['--range-fill' as string]: `${(Math.min(hours, HOUR_SLIDER_MAX) / HOUR_SLIDER_MAX) * 100}%` }}
              />
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex flex-wrap gap-1">
                  {HOUR_PRESETS.map((h) => (
                    <button
                      key={h}
                      type="button"
                      className={`tf-chip sm${hours === h ? ' on' : ''}`}
                      disabled={timesSet}
                      onClick={() => setValue('hoursSpent', h, { shouldValidate: true, shouldDirty: true })}
                    >
                      {fmtDuration(h)}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  <input
                    id="task-hours"
                    className="input"
                    type="number"
                    step="0.25"
                    min={0}
                    max={24}
                    readOnly={timesSet}
                    aria-label="Hours spent (exact)"
                    {...register('hoursSpent')}
                    style={{ width: 84, height: 34, textAlign: 'right' }}
                  />
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>hrs</span>
                </div>
              </div>
              <p className="tf-meter-hint">
                {timesSet
                  ? 'Worked out from your start and end time.'
                  : `${Math.round((hours / WORKDAY_HOURS) * 100)}% of an ${WORKDAY_HOURS}-hour day. Drag, tap a preset, or type an exact value.`}
              </p>
            </div>

            <div className="tf-meter">
              <div className="flex items-baseline justify-between gap-2">
                <label className="label" htmlFor="task-percent" style={{ margin: 0 }}>Progress</label>
                <span className="tf-meter-value">{percent}%</span>
              </div>
              <input
                id="task-percent"
                className="range-slider"
                type="range"
                min={0}
                max={100}
                step={5}
                style={{ ['--range-fill' as string]: `${percent}%` }}
                {...register('percentComplete')}
              />
              <div className="tf-marks">
                {PERCENT_MARKS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`tf-mark${percent === m ? ' on' : ''}`}
                    onClick={() => setValue('percentComplete', m, { shouldDirty: true })}
                  >
                    {m}%
                  </button>
                ))}
              </div>
              {statusLabel && <p className="tf-meter-hint">Set automatically when you pick a status ({statusLabel}). Adjust it if needed.</p>}
            </div>
          </Section>

          <Section id="notes" title="Notes" hint="Optional" Icon={NotebookPen} sectionRef={(el) => { sectionEls.current.notes = el; }}>
            <div className="field">
              <label className="label" htmlFor="task-deliverable">Key deliverable / expected outcome</label>
              <textarea id="task-deliverable" className="eoc-textarea" rows={2} placeholder="What does done look like?" {...register('keyDeliverable')} />
            </div>

            <div className="field">
              <label className="label" htmlFor="task-blockers">
                Blockers / notes
                {values.status === 'BLOCKED' && <span className="pill pill-red" style={{ marginLeft: 8, fontSize: 10.5 }}>Blocked - explain why</span>}
              </label>
              <textarea
                id="task-blockers"
                className="eoc-textarea"
                rows={2}
                placeholder="Anything holding this up, or worth flagging to your manager"
                {...register('blockersNotes')}
                style={values.status === 'BLOCKED' && !values.blockersNotes ? { borderColor: 'var(--red)' } : undefined}
              />
            </div>
          </Section>

          <Section id="evidence" title="Evidence" hint={`${attachmentCount} of ${MAX_ATTACHMENTS}`} Icon={Paperclip} sectionRef={(el) => { sectionEls.current.evidence = el; }}>
            <div className="field">
              <label
                htmlFor="task-files"
                className={`file-dropzone tf-drop${dragging ? ' dragging' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
              >
                <UploadCloud size={24} />
                <span>{dragging ? 'Drop to attach' : 'Drag screenshots here, or click to browse'}</span>
                <span className="file-dropzone-hint">Images, PDF or Word (.docx) · up to {MAX_ATTACHMENTS} files, 10MB each</span>
              </label>
              <input
                id="task-files"
                className="sr-only"
                type="file"
                accept={ALLOWED_ATTACHMENT_ACCEPT}
                multiple
                onChange={handleFilesSelected}
              />
              {fileError && <span className="field-error">{fileError}</span>}

              {attachmentCount > 0 && (
                <div className="tf-tiles">
                  {existingAttachments?.map((a) => (
                    <AttachmentTile
                      key={a.id}
                      name={a.fileName}
                      detail="Saved"
                      thumbUrl={a.mimeType.startsWith('image/') ? attachmentFileUrl(initial!.id, a.id, token) : undefined}
                      onRemove={() => deleteAttachmentMutation.mutate(a.id)}
                      removing={deleteAttachmentMutation.isPending && deleteAttachmentMutation.variables === a.id}
                    />
                  ))}
                  {files.map((f, i) => (
                    <AttachmentTile
                      key={`${f.name}-${f.size}-${i}`}
                      name={f.name}
                      detail={`${formatBytes(f.size)} · new`}
                      thumbUrl={previews[i]}
                      onRemove={() => removeFile(i)}
                    />
                  ))}
                </div>
              )}
            </div>
          </Section>
        </div>

        {/* Footer */}
        <div className="tf-foot">
          <div className="tf-summary">
            <Gauge size={15} style={{ color: 'var(--red)', flexShrink: 0 }} />
            <span>
              <b>{categoryLabel ?? 'New task'}</b>
              {orgLabel && ` · ${shortOrg(orgLabel)}`}
              {` · ${fmtDuration(hours)} · ${percent}%`}
              {attachmentCount > 0 && ` · ${attachmentCount} file${attachmentCount === 1 ? '' : 's'}`}
            </span>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting} style={{ minWidth: 140 }}>
              {submitting ? <AppLoader size={20} /> : <Check size={16} />}
              {submitting ? 'Saving…' : initial ? 'Save changes' : 'Log task'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export default TaskFormModal;
