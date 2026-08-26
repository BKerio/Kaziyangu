/** Allowed types/limits for opportunity documents - proposals, RFQs, contracts. */

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_ATTACHMENTS_PER_OPPORTUNITY = 10;
export const MAX_ATTACHMENT_FILES_PER_UPLOAD = 5;

export const PDF_MIME = 'application/pdf';
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const DOC_MIME = 'application/msword';

export const ALLOWED_ATTACHMENT_MIMES = new Set([PDF_MIME, DOCX_MIME, DOC_MIME]);

export const ALLOWED_ATTACHMENT_EXTENSIONS = '.pdf,.docx,.doc';

const EXT_TO_MIME: Record<string, string> = {
  '.pdf': PDF_MIME,
  '.docx': DOCX_MIME,
  '.doc': DOC_MIME,
};

export function fileExtension(originalName: string): string {
  const i = originalName.lastIndexOf('.');
  return i >= 0 ? originalName.slice(i).toLowerCase() : '';
}

export function isAllowedOpportunityFile(mime: string, originalName: string): boolean {
  if (ALLOWED_ATTACHMENT_MIMES.has(mime)) return true;
  return Boolean(EXT_TO_MIME[fileExtension(originalName)]);
}

/** Canonical MIME when the browser sends a generic type (common for .docx). */
export function canonicalOpportunityMime(mime: string, originalName: string): string {
  if (ALLOWED_ATTACHMENT_MIMES.has(mime)) return mime;
  return EXT_TO_MIME[fileExtension(originalName)] ?? mime;
}
