import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/index.js';

/**
 * Creates a PrismaClient instance using the pg driver adapter.
 * Required for Prisma 7 which no longer reads the DB URL from schema.prisma.
 * The DATABASE_URL must be available in process.env when this is called.
 */
export function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);

  return new PrismaClient({ adapter }) as unknown as PrismaClient;
}
