import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Local disk storage for task attachments, keyed by task id so files for a
// deleted task are easy to spot/clean up. Swap this module out for an
// object-storage-backed implementation later without touching callers -
// they only ever deal in `storageKey` strings.
const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads', 'task-attachments');

/** Saves a file for `taskId`, returning the relative storage key to persist on the row. */
export async function saveAttachmentFile(taskId: string, buffer: Buffer, originalName: string): Promise<string> {
  const ext = path.extname(originalName).toLowerCase();
  const storageKey = `${taskId}/${randomUUID()}${ext}`;
  const fullPath = attachmentFilePath(storageKey);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, buffer);
  return storageKey;
}

/** Resolves a stored `storageKey` to an absolute path on disk. */
export function attachmentFilePath(storageKey: string): string {
  return path.join(UPLOAD_ROOT, storageKey);
}

export async function deleteAttachmentFile(storageKey: string): Promise<void> {
  try {
    await unlink(attachmentFilePath(storageKey));
  } catch {
    // Already gone - nothing left to clean up.
  }
}
