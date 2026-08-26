/**
 * Shared TypeScript types and interfaces used across the entire backend.
 * Import from here to avoid circular dependencies between modules.
 */

// ── Prisma Enums ──────────────────────────────────────────────────────────────
import {
  Role, TaskVertical, TaskCategory, TaskStatus, AttendanceStatus, WorkMode, ReportStatus, Department,
  OpportunityStage, OpportunityPriority, ActivityType, ReminderChannel, ReminderStatus,
} from '../../generated/prisma/index.js';
export {
  Role, TaskVertical, TaskCategory, TaskStatus, AttendanceStatus, WorkMode, ReportStatus, Department,
  OpportunityStage, OpportunityPriority, ActivityType, ReminderChannel, ReminderStatus,
};

// ── JWT ───────────────────────────────────────────────────────────────────────
// Shape of the payload encoded inside every JWT token
export interface JwtPayload {
  userId: string;
  role: Role;
}

// TypeScript declaration merging - makes `req.user` fully typed on every
// Express request, set by middleware/auth.ts once the token is verified.
declare global {
  namespace Express {
    interface Request {
      user: JwtPayload;
    }
  }
}

// ── Pagination ────────────────────────────────────────────────────────────────
export interface PaginationQuery {
  page?: number;   // 1-indexed, default: 1
  limit?: number;  // default: 20, max: 100
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ── Standard API Envelope ─────────────────────────────────────────────────────
// Every API response will follow this shape for consistency
export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  message?: string;
}
