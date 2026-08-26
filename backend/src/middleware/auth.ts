import { NextFunction, Request, Response } from 'express';
import { verifyToken } from '../lib/jwt.js';
import { UnauthorizedError } from '../shared/errors/AppError.js';

/**
 * Express equivalent of the old `app.authenticate` preValidation hook.
 * Reads the Bearer token, verifies it, and attaches the decoded payload to
 * `req.user` for downstream handlers/guards.
 */
// Typed as Request<any> - see the comment in shared/guards/requireRole.ts for why.
export function authenticate(request: Request<any>, _response: Response, next: NextFunction): void {
  const header = request.headers.authorization;
  const headerToken = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  // Falls back to a `?token=` query param so plain <img>/download links (which
  // can't set an Authorization header) can still load authenticated files,
  // e.g. task attachment screenshots.
  const queryToken = typeof request.query.token === 'string' ? request.query.token : undefined;
  const token = headerToken ?? queryToken;

  if (!token) {
    throw new UnauthorizedError('Invalid or missing token');
  }

  try {
    request.user = verifyToken(token);
    next();
  } catch {
    throw new UnauthorizedError('Invalid or missing token');
  }
}
