import { ChangeEvent, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Trash2, FileText, ClipboardList, UploadCloud } from 'lucide-react';
import DotLoader from '@/components/shared/DotLoader';
import { useTaskOptions } from '@/hooks/useTaskOptions';
import { useAuthStore } from '@/stores/authStore';
import api from '@/api/client';
import { attachmentFileUrl } from '@/lib/taskAttachments';
import { TaskAttachment, TaskCategory, TaskStatus, TaskVertical, WorkTask } from '@/types/api';

const taskSchema = z.object({
  date: z.string().min(1, 'Date is required'),
  vertical: z.string().min(1, 'Vertical is required'),
  category: z.string().min(1, 'Category is required'),
  description: z.string().min(3, 'Description is required'),
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
const ALLOWED_ATTACHMENT_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']);
const ALLOWED_ATTACHMENT_ACCEPT = '.jpg,.jpeg,.png,.webp,.gif,.pdf';

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

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}


/** Small uppercase divider between logical groups of fields - breaks the long form into scannable sections. */
function SectionLabel({ children, first }: { children: string; first?: boolean }) {
  return (
    <p
      className="eyebrow"
      style={{ marginTop: first ? 0 : 6, marginBottom: -4, paddingTop: first ? 0 : 14, borderTop: first ? undefined : '1px solid var(--border)' }}
    >
      {children}
    </p>
  );
}

function AttachmentChip({
  name, isImage, thumbUrl, onRemove, removing,
}: {
  name: string;
  isImage: boolean;
  thumbUrl?: string;
  onRemove: () => void;
  removing?: boolean;
}) {
  return (
    <div
      className="flex items-center gap-2"
      style={{ padding: '5px 8px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 12, maxWidth: 200 }}
    >
      {isImage && thumbUrl ? (
        <img src={thumbUrl} alt={name} style={{ width: 22, height: 22, borderRadius: 5, objectFit: 'cover' }} />
      ) : (
        <FileText size={14} style={{ color: 'var(--muted)', flexShrink: 0 }} />
      )}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      <button
        type="button"
        className="icon-btn"
        onClick={onRemove}
        disabled={removing}
        title="Remove"
        style={{ marginLeft: 'auto', flexShrink: 0 }}
      >
        {removing ? <DotLoader size={12} /> : <Trash2 size={12} />}
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
          date: todayISO(),
          vertical: '' as TaskVertical,
          category: '' as TaskCategory,
          description: '',
          hoursSpent: 0,
          status: 'NOT_STARTED' as TaskStatus,
          percentComplete: 0,
        },
  });

  const startTime = watch('startTime');
  const endTime = watch('endTime');
  const percentComplete = watch('percentComplete');

  useEffect(() => {
    const hours = computeHours(startTime, endTime);
    if (hours !== null) {
      setValue('hoursSpent', hours, { shouldValidate: true });
    }
  }, [startTime, endTime, setValue]);

  const handleFilesSelected = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = ''; // allow re-selecting the same file again later
    if (picked.length === 0) return;

    const room = MAX_ATTACHMENTS - (existingAttachments?.length ?? 0) - files.length;
    let error: string | null = null;
    const accepted: File[] = [];

    for (const file of picked) {
      if (!ALLOWED_ATTACHMENT_MIMES.has(file.type)) {
        error = `"${file.name}" isn't a supported file type (JPG, PNG, WEBP, GIF or PDF only).`;
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

  const removeFile = (index: number) => setFiles((prev) => prev.filter((_, i) => i !== index));

  const hasAnyAttachments = files.length > 0 || (existingAttachments && existingAttachments.length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(10,20,15,0.45)' }}>
      <div className="card w-full" style={{ maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="card-head" style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
          <span className="card-title flex items-center gap-2">
            <ClipboardList size={17} style={{ color: 'var(--green)' }} />
            {initial ? 'Edit Task' : 'Log a Task'}
          </span>
          <button className="icon-btn" onClick={onClose} type="button"><X size={16} /></button>
        </div>

        <form className="card-pad col" style={{ gap: 14 }} onSubmit={handleSubmit(async (v) => { await onSubmit(v, files); })}>
          <SectionLabel first>Basics</SectionLabel>
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

          <div className="grid grid-cols-2 gap-3">
            <div className="field">
              <label className="label" htmlFor="task-date">Date</label>
              <input id="task-date" className="input" type="date" {...register('date')} />
              {errors.date && <span className="field-error">{errors.date.message}</span>}
            </div>
            <div className="field">
              <label className="label" htmlFor="task-status">Status</label>
              <select id="task-status" className="eoc-select" {...register('status')}>
                {options?.statuses.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="field">
              <label className="label" htmlFor="task-vertical">Vertical</label>
              <select id="task-vertical" className="eoc-select" {...register('vertical')}>
                <option value="">Select…</option>
                {options?.verticals.map((v) => (
                  <option key={v.value} value={v.value}>{v.label}</option>
                ))}
              </select>
              {errors.vertical && <span className="field-error">{errors.vertical.message}</span>}
            </div>
            <div className="field">
              <label className="label" htmlFor="task-category">Category</label>
              <select id="task-category" className="eoc-select" {...register('category')}>
                <option value="">Select…</option>
                {options?.categories.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              {errors.category && <span className="field-error">{errors.category.message}</span>}
            </div>
          </div>

          <SectionLabel>Details</SectionLabel>
          <div className="field">
            <label className="label" htmlFor="task-description">Task description</label>
            <textarea id="task-description" className="eoc-textarea" rows={2} {...register('description')} />
            {errors.description && <span className="field-error">{errors.description.message}</span>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="field">
              <label className="label" htmlFor="task-organization">Organization</label>
              <select id="task-organization" className="eoc-select" {...register('organization')}>
                <option value="">Select…</option>
                {options?.organizations.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="task-customer">Customer / Project</label>
              <input id="task-customer" className="input" type="text" {...register('customerProject')} placeholder="e.g. Client X - DR Project" />
            </div>
          </div>

          <SectionLabel>Schedule &amp; Progress</SectionLabel>
          <div className="grid grid-cols-3 gap-3">
            <div className="field">
              <label className="label" htmlFor="task-start">Start time</label>
              <input id="task-start" className="input" type="time" {...register('startTime')} />
            </div>
            <div className="field">
              <label className="label" htmlFor="task-end">End time</label>
              <input id="task-end" className="input" type="time" {...register('endTime')} />
            </div>
            <div className="field">
              <label className="label" htmlFor="task-hours">Hours spent</label>
              <input
                id="task-hours"
                className="input"
                type="number"
                step="0.25"
                min={0}
                max={24}
                readOnly={Boolean(startTime && endTime)}
                title={startTime && endTime ? 'Computed from start and end time' : undefined}
                {...register('hoursSpent')}
              />
            </div>
          </div>

          <div className="field">
            <div className="flex items-center justify-between">
              <label className="label" htmlFor="task-percent">% Complete</label>
              <span className="mono tnum" style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>{percentComplete}%</span>
            </div>
            <input
              id="task-percent"
              className="range-slider"
              type="range"
              min={0}
              max={100}
              step={5}
              style={{ ['--range-fill' as string]: `${percentComplete}%` }}
              {...register('percentComplete')}
            />
          </div>

          <SectionLabel>Notes</SectionLabel>
          <div className="field">
            <label className="label" htmlFor="task-deliverable">Key deliverable / expected outcome</label>
            <textarea id="task-deliverable" className="eoc-textarea" rows={2} {...register('keyDeliverable')} />
          </div>

          <div className="field">
            <label className="label" htmlFor="task-blockers">Blockers / notes</label>
            <textarea id="task-blockers" className="eoc-textarea" rows={2} {...register('blockersNotes')} />
          </div>

          <SectionLabel>Attachments</SectionLabel>
          <div className="field">
            <label className="label" htmlFor="task-files">Screenshots / proof of work</label>
            <label htmlFor="task-files" className="file-dropzone">
              <UploadCloud size={20} />
              <span>Click to attach screenshots or a PDF</span>
              <span className="file-dropzone-hint">up to {MAX_ATTACHMENTS} files, 10MB each</span>
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

            {hasAnyAttachments && (
              <div className="flex flex-wrap gap-2" style={{ marginTop: 8 }}>
                {existingAttachments?.map((a) => (
                  <AttachmentChip
                    key={a.id}
                    name={a.fileName}
                    isImage={a.mimeType.startsWith('image/')}
                    thumbUrl={a.mimeType.startsWith('image/') ? attachmentFileUrl(initial!.id, a.id, token) : undefined}
                    onRemove={() => deleteAttachmentMutation.mutate(a.id)}
                    removing={deleteAttachmentMutation.isPending && deleteAttachmentMutation.variables === a.id}
                  />
                ))}
                {files.map((f, i) => (
                  <AttachmentChip
                    key={`${f.name}-${f.size}-${i}`}
                    name={`${f.name} (${formatBytes(f.size)})`}
                    isImage={f.type.startsWith('image/')}
                    onRemove={() => removeFile(i)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2" style={{ marginTop: 4 }}>
            <button type="button" className="btn btn-ghost flex-1" onClick={onClose} disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary flex-1" disabled={submitting}>
              {submitting ? <DotLoader size={16} /> : null}
              {submitting ? 'Saving…' : initial ? 'Save changes' : 'Log task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default TaskFormModal;
