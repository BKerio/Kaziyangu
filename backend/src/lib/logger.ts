import pino from 'pino';
import { env } from './env.js';

/**
 * Structured, high-performance logger (Fastify used to build this in for us -
 * now wired up directly). Pretty-printed in dev, plain JSON in production.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  transport:
    env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

export type Logger = typeof logger;
