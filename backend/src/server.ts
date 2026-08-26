import { createServer } from 'node:http';
import { env } from './lib/env.js';
import { logger } from './lib/logger.js';
import { createPrismaClient } from './lib/prisma.js';
import { createSocketServer } from './lib/socket.js';
import { buildApp } from './app.js';
import { AppContext } from './context.js';
import { startReminderScheduler } from './modules/reminders/reminder.scheduler.js';
import { AuditLogService } from './modules/audit/audit-log.service.js';

async function start(): Promise<void> {
  // ── Database ───────────────────────────────────────────────────────────────
  const prisma = createPrismaClient();
  await prisma.$connect();
  logger.info('✅ Prisma connected to the database');

  const httpServer = createServer();
  const io = createSocketServer(httpServer);

  const auditLog = new AuditLogService(prisma, logger);
  const ctx: AppContext = { prisma, io, log: logger, config: env, auditLog };

  // ── Express app ────────────────────────────────────────────────────────────
  const app = buildApp(ctx);
  httpServer.on('request', app);

  // ── Background jobs ───────────────────────────────────────────────────────
  const reminderTimer = startReminderScheduler(ctx);

  httpServer.listen(parseInt(env.PORT, 10), env.HOST, () => {
    logger.info(`🚀 Task Management API listening on http://${env.HOST}:${env.PORT}`);
  });

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received - shutting down`);
    clearInterval(reminderTimer);
    io.close();
    httpServer.close();
    await prisma.$disconnect();
    logger.info('Shutdown complete');
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

start().catch((err) => {
  logger.error(err);
  process.exit(1);
});
