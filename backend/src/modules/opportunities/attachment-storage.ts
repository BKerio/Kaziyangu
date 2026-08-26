import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads', 'opportunity-attachments');

/** Saves a file for `opportunityId`, returning the relative storage key to persist on the row. */
export async function saveOpportunityAttachmentFile(
  opportunityId: string,
  buffer: Buffer,
  originalName: string,
): Promise<string> {
  const ext = path.extname(originalName).toLowerCase();
  const storageKey = `${opportunityId}/${randomUUID()}${ext}`;
  const fullPath = opportunityAttachmentFilePath(storageKey);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, buffer);
  return storageKey;
}

export function opportunityAttachmentFilePath(storageKey: string): string {
  return path.join(UPLOAD_ROOT, storageKey);
}

export async function deleteOpportunityAttachmentFile(storageKey: string): Promise<void> {
  try {
    await unlink(opportunityAttachmentFilePath(storageKey));
  } catch {
    // Already gone.
  }
}
