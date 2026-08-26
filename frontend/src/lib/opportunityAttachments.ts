import api from '@/api/client';

/** Uploads PDF/Word documents for an opportunity. No-ops when there's nothing to send. */
export async function uploadOpportunityAttachments(opportunityId: string, files: File[]): Promise<void> {
  if (files.length === 0) return;
  const form = new FormData();
  files.forEach((file) => form.append('files', file));
  await api.post(`/opportunities/${opportunityId}/attachments`, form);
}

export function opportunityAttachmentFileUrl(
  opportunityId: string,
  attachmentId: string,
  token: string | null,
): string {
  const base = import.meta.env.VITE_API_BASE_URL ?? '';
  return `${base}/opportunities/${opportunityId}/attachments/${attachmentId}/file?token=${encodeURIComponent(token ?? '')}`;
}
