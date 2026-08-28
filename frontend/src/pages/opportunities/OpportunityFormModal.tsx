import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ChangeEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Paperclip, Trash2, FileText } from 'lucide-react';
import DotLoader from '@/components/shared/DotLoader';
import { useNotificationStore } from '@/stores/notificationStore';
import api from '@/api/client';
import { uploadOpportunityAttachments } from '@/lib/opportunityAttachments';
import { Opportunity, PRIORITY_OPTIONS, User } from '@/types/api';

const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_ATTACHMENT_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);
const ALLOWED_ATTACHMENT_EXTS = ['.pdf', '.docx', '.doc'];
const ALLOWED_ATTACHMENT_ACCEPT = '.pdf,.docx,.doc';

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

const createSchema = z.object({
  name: z.string().min(2, 'Opportunity name is required'),
  customerName: z.string().min(1, 'Customer / organization is required'),
  contactPerson: z.string().optional(),
  source: z.string().optional(),
  dateIdentified: z.string().min(1, 'Date is required'),
  estimatedValue: z.coerce.number().min(0).optional(),
  description: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  assignedToId: z.string().optional(),
  followUpDate: z.string().optional(),
});
type CreateForm = z.infer<typeof createSchema>;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function OpportunityFormModal({ staff, onClose, onCreated }: {
  staff: User[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { addNotification } = useNotificationStore();
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors } } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { dateIdentified: todayISO(), priority: 'MEDIUM' },
  });

  const handleFilesSelected = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (picked.length === 0) return;

    const room = MAX_ATTACHMENTS - files.length;
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

    setFiles((prev) => [...prev, ...accepted]);
    setFileError(error);
  };

  const createMutation = useMutation({
    mutationFn: async (values: CreateForm) => {
      const res = await api.post<{ data: Opportunity }>('/opportunities', {
        ...values,
        assignedToId: values.assignedToId || undefined,
      });
      await uploadOpportunityAttachments(res.data.data.id, files);
      return res.data;
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['opportunities'] });
      addNotification({ type: 'success', title: 'Opportunity added', message: 'It has entered the pipeline.' });
      onCreated(res.data.id);
    },
    onError: (err: any) => addNotification({ type: 'error', title: 'Failed to add opportunity', message: err?.response?.data?.message || 'Please try again.' }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(10,20,15,0.45)' }}>
      <div className="card w-full" style={{ maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="card-head" style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
          <span className="card-title">Add Opportunity</span>
          <button className="icon-btn" onClick={onClose} type="button"><X size={16} /></button>
        </div>
        <form className="card-pad col" style={{ gap: 14 }} onSubmit={handleSubmit((v) => createMutation.mutate(v))}>
          <div className="field">
            <label className="label" htmlFor="op-name">Opportunity name</label>
            <input id="op-name" className="input" placeholder="e.g. Core Network Upgrade" {...register('name')} />
            {errors.name && <span className="field-error">{errors.name.message}</span>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="field">
              <label className="label" htmlFor="op-customer">Customer / organization</label>
              <input id="op-customer" className="input" {...register('customerName')} />
              {errors.customerName && <span className="field-error">{errors.customerName.message}</span>}
            </div>
            <div className="field">
              <label className="label" htmlFor="op-contact">Contact person</label>
              <input id="op-contact" className="input" {...register('contactPerson')} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="field">
              <label className="label" htmlFor="op-source">Source</label>
              <input id="op-source" className="input" placeholder="e.g. Referral, Website, Cold call" {...register('source')} />
            </div>
            <div className="field">
              <label className="label" htmlFor="op-date">Date identified</label>
              <input id="op-date" className="input" type="date" {...register('dateIdentified')} />
              {errors.dateIdentified && <span className="field-error">{errors.dateIdentified.message}</span>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="field">
              <label className="label" htmlFor="op-value">Estimated value (KSh)</label>
              <input id="op-value" className="input" type="number" min={0} step="1000" {...register('estimatedValue')} />
            </div>
            <div className="field">
              <label className="label" htmlFor="op-priority">Priority</label>
              <select id="op-priority" className="eoc-select" {...register('priority')}>
                {PRIORITY_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="op-desc">Description</label>
            <textarea id="op-desc" className="eoc-textarea" rows={2} {...register('description')} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="field">
              <label className="label" htmlFor="op-assignee">Assign to (optional)</label>
              <select id="op-assignee" className="eoc-select" {...register('assignedToId')}>
                <option value="">Unassigned</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="op-followup">Follow-up date (optional)</label>
              <input id="op-followup" className="input" type="date" {...register('followUpDate')} />
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="op-files">Documents</label>
            <input
              id="op-files"
              className="input"
              type="file"
              accept={ALLOWED_ATTACHMENT_ACCEPT}
              multiple
              onChange={handleFilesSelected}
            />
            <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
              <Paperclip size={11} style={{ verticalAlign: -1, marginRight: 3 }} />
              PDF or Word (.docx), up to {MAX_ATTACHMENTS} files, 10MB each.
            </span>
            {fileError && <span className="field-error">{fileError}</span>}
            {files.length > 0 && (
              <div className="flex flex-wrap gap-2" style={{ marginTop: 8 }}>
                {files.map((f, i) => (
                  <div
                    key={`${f.name}-${f.size}-${i}`}
                    className="flex items-center gap-2"
                    style={{ padding: '5px 8px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 12, maxWidth: 240 }}
                  >
                    <FileText size={14} style={{ color: 'var(--red)', flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.name} ({formatBytes(f.size)})
                    </span>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      title="Remove"
                      style={{ marginLeft: 'auto', flexShrink: 0 }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2" style={{ marginTop: 4 }}>
            <button type="button" className="btn btn-ghost flex-1" onClick={onClose} disabled={createMutation.isPending}>Cancel</button>
            <button type="submit" className="btn btn-primary flex-1" disabled={createMutation.isPending}>
              {createMutation.isPending ? <DotLoader size={16} /> : null}
              {createMutation.isPending ? 'Adding…' : 'Add opportunity'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default OpportunityFormModal;
