import multer from 'multer';
import {
  ALLOWED_ATTACHMENT_EXTENSIONS,
  ALLOWED_ATTACHMENT_MIMES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_FILES_PER_UPLOAD,
} from '../modules/tasks/attachment-constants.js';
import {
  ALLOWED_ATTACHMENT_EXTENSIONS as OPP_ALLOWED_EXTENSIONS,
  MAX_ATTACHMENT_BYTES as OPP_MAX_BYTES,
  MAX_ATTACHMENT_FILES_PER_UPLOAD as OPP_MAX_FILES,
  isAllowedOpportunityFile,
} from '../modules/opportunities/attachment-constants.js';
import { BadRequestError } from '../shared/errors/AppError.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: MAX_ATTACHMENT_FILES_PER_UPLOAD },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_ATTACHMENT_MIMES.has(file.mimetype)) {
      cb(new Error(`Unsupported file type. Allowed: ${ALLOWED_ATTACHMENT_EXTENSIONS}`));
      return;
    }
    cb(null, true);
  },
});

const opportunityUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: OPP_MAX_BYTES, files: OPP_MAX_FILES },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedOpportunityFile(file.mimetype, file.originalname)) {
      cb(new Error(`Unsupported file type. Allowed: ${OPP_ALLOWED_EXTENSIONS}`));
      return;
    }
    cb(null, true);
  },
});

/**
 * Multer wants its own error passed to Express's `next`, not thrown, so this
 * wraps the callback-style middleware into one route handlers can mount
 * directly - any file-type/size-limit failure surfaces as a normal 400.
 */
export function taskAttachmentUpload(req: any, res: any, next: (err?: unknown) => void): void {
  upload.array('files', MAX_ATTACHMENT_FILES_PER_UPLOAD)(req, res, (err: unknown) => {
    if (err) {
      next(new BadRequestError(err instanceof Error ? err.message : 'Upload failed'));
      return;
    }
    next();
  });
}

export function opportunityAttachmentUpload(req: any, res: any, next: (err?: unknown) => void): void {
  opportunityUpload.array('files', OPP_MAX_FILES)(req, res, (err: unknown) => {
    if (err) {
      next(new BadRequestError(err instanceof Error ? err.message : 'Upload failed'));
      return;
    }
    next();
  });
}
