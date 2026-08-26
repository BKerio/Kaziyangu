/** Allowed types/limits for task attachments - screenshots (or a PDF) attached as proof of work. */

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_ATTACHMENTS_PER_TASK = 8;
export const MAX_ATTACHMENT_FILES_PER_UPLOAD = 5;

export const ALLOWED_ATTACHMENT_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

export const ALLOWED_ATTACHMENT_EXTENSIONS = '.jpg,.jpeg,.png,.webp,.gif,.pdf';
