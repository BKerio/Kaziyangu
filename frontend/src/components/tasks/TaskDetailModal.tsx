import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, FileText, Paperclip } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useTaskOptions } from '@/hooks/useTaskOptions';
import api from '@/api/client';
import { attachmentFileUrl } from '@/lib/taskAttachments';
import { TaskAttachment, WorkTask } from '@/types/api';
import { statusPillClass } from '@/utils/taskStatus';
import { fmtDate } from '@/lib/datetime';

interface TaskDetailModalProps {
  task: WorkTask;
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function DetailField({ label, value }: { label: string; value?: string | number | null }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div>
      <p className="label" style={{ marginBottom: 2 }}>{label}</p>
      <p className="text-sm" style={{ color: 'var(--ink)' }}>{value}</p>
    </div>
  );
}

function TaskDetailModal({ task, onClose }: TaskDetailModalProps) {
  const token = useAuthStore((s) => s.token);
  const { data: options } = useTaskOptions();
  const [preview, setPreview] = useState<TaskAttachment | null>(null);

  const { data: attachments, isLoading } = useQuery({
    queryKey: ['task-attachments', task.id],
    queryFn: async () => {
      const res = await api.get<{ data: TaskAttachment[] }>(`/tasks/${task.id}/attachments`);
      return res.data.data;
    },
  });

  const verticalLabel = options?.verticals.find((o) => o.value === task.vertical)?.label ?? task.vertical;
  const categoryLabel = options?.categories.find((o) => o.value === task.category)?.label ?? task.category;
  const statusLabel = options?.statuses.find((o) => o.value === task.status)?.label ?? task.status;

  const images = (attachments ?? []).filter((a) => a.mimeType.startsWith('image/'));
  const otherFiles = (attachments ?? []).filter((a) => !a.mimeType.startsWith('image/'));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(10,20,15,0.45)' }}>
      <div className="card w-full" style={{ maxWidth: 620, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="card-head" style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
          <span className="card-title">Task Details</span>
          <button className="icon-btn" onClick={onClose} type="button"><X size={16} /></button>
        </div>

        <div className="card-pad col" style={{ gap: 16 }}>
          <div>
            <p className="text-base font-bold" style={{ color: 'var(--ink)' }}>{task.description}</p>
            <span className={statusPillClass(task.status)} style={{ marginTop: 6, display: 'inline-block' }}>{statusLabel}</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <DetailField label="Date" value={fmtDate(task.date)} />
            <DetailField label="Logged by" value={task.user?.name} />
            <DetailField label="Vertical" value={verticalLabel} />
            <DetailField label="Category" value={categoryLabel} />
            <DetailField label="Customer / Project" value={task.customerProject} />
            <DetailField label="Hours spent" value={`${task.hoursSpent}h`} />
            <DetailField label="Start time" value={task.startTime} />
            <DetailField label="End time" value={task.endTime} />
            <DetailField label="% Complete" value={`${task.percentComplete}%`} />
          </div>

          {task.keyDeliverable && (
            <div>
              <p className="label" style={{ marginBottom: 2 }}>Key deliverable / expected outcome</p>
              <p className="text-sm" style={{ color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>{task.keyDeliverable}</p>
            </div>
          )}

          {task.blockersNotes && (
            <div>
              <p className="label" style={{ marginBottom: 2 }}>Blockers / notes</p>
              <p className="text-sm" style={{ color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>{task.blockersNotes}</p>
            </div>
          )}

          <div>
            <p className="label" style={{ marginBottom: 8 }}>
              <Paperclip size={12} style={{ verticalAlign: -1, marginRight: 3 }} />
              Screenshots / proof of work
            </p>

            {isLoading ? (
              <div className="skel" style={{ height: 80 }} />
            ) : (attachments?.length ?? 0) === 0 ? (
              <p className="text-sm" style={{ color: 'var(--muted)' }}>No files attached to this task.</p>
            ) : (
              <div className="col" style={{ gap: 10 }}>
                {images.length > 0 && (
                  <div className="flex flex-wrap gap-3">
                    {images.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setPreview(a)}
                        title={`${a.fileName} (${formatBytes(a.bytes)}) - click to view`}
                        style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
                      >
                        <img
                          src={attachmentFileUrl(task.id, a.id, token)}
                          alt={a.fileName}
                          style={{ width: 140, height: 140, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border)' }}
                        />
                      </button>
                    ))}
                  </div>
                )}

                {otherFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {otherFiles.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setPreview(a)}
                        className="flex items-center gap-2"
                        style={{ padding: '7px 10px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 12.5, background: 'none', cursor: 'pointer', color: 'var(--ink)' }}
                      >
                        <FileText size={14} style={{ color: 'var(--muted)' }} />
                        {a.fileName} <span style={{ color: 'var(--muted)' }}>({formatBytes(a.bytes)})</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex gap-2" style={{ marginTop: 4 }}>
            <button type="button" className="btn btn-ghost flex-1" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>

      {preview && (
        <AttachmentLightbox
          attachment={preview}
          url={attachmentFileUrl(task.id, preview.id, token)}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

/**
 * Full-size in-app preview, layered above the detail modal - stays on the
 * same tab/page rather than navigating away or opening a new tab. Images
 * render directly; anything else (PDFs) renders in an iframe, since the
 * attachment endpoint already serves with `Content-Disposition: inline`.
 */
function AttachmentLightbox({ attachment, url, onClose }: { attachment: TaskAttachment; url: string; onClose: () => void }) {
  const isImage = attachment.mimeType.startsWith('image/');
  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-6"
      style={{ background: 'rgba(10,20,15,0.75)', zIndex: 60 }}
      onClick={onClose}
    >
      <button
        type="button"
        className="icon-btn"
        onClick={onClose}
        style={{ position: 'absolute', top: 16, right: 16, background: 'var(--surface)' }}
        title="Close"
      >
        <X size={16} />
      </button>

      {isImage ? (
        <img
          src={url}
          alt={attachment.fileName}
          onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: '90vw', maxHeight: '85vh', objectFit: 'contain', borderRadius: 8 }}
        />
      ) : (
        <iframe
          src={url}
          title={attachment.fileName}
          onClick={(e) => e.stopPropagation()}
          style={{ width: '85vw', height: '85vh', border: 'none', borderRadius: 8, background: '#fff' }}
        />
      )}
    </div>
  );
}

export default TaskDetailModal;
