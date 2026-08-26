import { NextFunction, Request, Response } from 'express';
import { Role } from '../types/index.js';
import { ForbiddenError } from '../errors/AppError.js';

/**
 * Middleware factory to enforce Role-Based Access Control (RBAC).
 * Assumes the request has already passed `authenticate` and `req.user` is populated.
 *
 * Usage:
 *   router.post('/some-route', authenticate, requireRole(['SUPER_ADMIN', 'ADMIN']), handler)
 *
 * @param allowedRoles Array of roles that are allowed to access the route
 */
export function requireRole(allowedRoles: Role[]) {
  // Typed as Request<any> rather than plain Request: route handlers registered
  // alongside this middleware use Express 5's literal-route param inference
  // (e.g. `:id` -> `{ id: string }`), and pairing that with a middleware typed
  // against the default `ParamsDictionary` would make the overload resolver
  // fall back to `ParamsDictionary`'s `string | string[]` value type for every
  // route param. `any` opts this middleware out of that inference entirely.
  return (request: Request<any>, _response: Response, next: NextFunction): void => {
    const user = request.user;

    if (!user) {
      throw new ForbiddenError('Access denied: User context missing');
    }

    if (!allowedRoles.includes(user.role)) {
      throw new ForbiddenError(`Access denied: Requires one of [${allowedRoles.join(', ')}]`);
    }

    next();
  };
}
