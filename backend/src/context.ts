import type { Server } from 'socket.io';
import type { PrismaClient } from './generated/prisma/index.js';
import type { EnvConfig } from './lib/env.js';
import type { Logger } from './lib/logger.js';
import type { AuditLogService } from './modules/audit/audit-log.service.js';

/**
 * Shared application context - passed into every route module / service
 * constructor instead of reaching for globals.
 */
export interface AppContext {
  prisma: PrismaClient;
  io: Server;
  log: Logger;
  config: EnvConfig;
  auditLog: AuditLogService;
}
