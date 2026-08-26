import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../shared/errors/AppError.js';
import { logger } from '../lib/logger.js';

/**
 * Global error handler - Fastify used to do this automatically by reading
 * `error.statusCode` off anything thrown; this is the explicit Express
 * equivalent. Must be registered LAST, after all routes.
 */
export function errorHandler(err: unknown, request: Request, response: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    if (!err.isOperational) {
      logger.error({ err }, 'Unexpected (non-operational) error');
    }
    response.status(err.statusCode).send({ ok: false, message: err.message });
    return;
  }

  if (err instanceof ZodError) {
    response.status(400).send({ ok: false, message: err.issues[0]?.message ?? 'Invalid request' });
    return;
  }

  logger.error({ err, url: request.url, method: request.method }, 'Unhandled error');
  response.status(500).send({ ok: false, message: 'Internal server error' });
}

/** 404 handler for routes that don't match anything - registered after all routes, before errorHandler. */
export function notFoundHandler(request: Request, response: Response): void {
  response.status(404).send({ ok: false, message: `Route ${request.method} ${request.url} not found` });
}
