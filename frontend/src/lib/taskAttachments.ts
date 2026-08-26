import api from '@/api/client';

/** Uploads screenshots/proof-of-work files for a task. No-ops when there's nothing to send. */
export async function uploadTaskAttachments(taskId: string, files: File[]): Promise<void> {
  if (files.length === 0) return;
  const form = new FormData();
  files.forEach((file) => form.append('files', file));
  await api.post(`/tasks/${taskId}/attachments`, form);
}

/** Authenticated download/preview URL - the token is passed as a query param since <img>/<a> can't set headers. */
export function attachmentFileUrl(taskId: string, attachmentId: string, token: string | null): string {
  const base = import.meta.env.VITE_API_BASE_URL ?? '';
  return `${base}/tasks/${taskId}/attachments/${attachmentId}/file?token=${encodeURIComponent(token ?? '')}`;
}
