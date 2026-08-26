import { AppContext } from '../../context.js';

export type FlowStep =
  | 'idle'
  | 'task_add_vertical'
  | 'task_add_category'
  | 'task_add_description'
  | 'task_add_project'
  | 'task_add_status'
  | 'task_add_hours'
  | 'task_add_attachment'
  | 'task_add_confirm'
  | 'task_update_pick'
  | 'task_update_field'
  | 'task_update_status'
  | 'task_update_percent'
  | 'task_update_blockers';

export interface Session {
  flow: FlowStep;
  data: Record<string, string>;
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h of inactivity resets the flow

function parseData(data: unknown): Record<string, string> {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return data as Record<string, string>;
  }
  return {};
}

/**
 * Persists each WhatsApp phone number's place in the task-logging wizard
 * (see FlowStep) plus its partial answers, in the `bot_sessions` table -
 * keeping the bot stateless across server restarts / multiple instances.
 */
export class BotSessionService {
  constructor(private app: AppContext) {}

  private nextExpiry(): Date {
    return new Date(Date.now() + SESSION_TTL_MS);
  }

  async get(phone: string): Promise<Session> {
    const existing = await this.app.prisma.botSession.findUnique({ where: { phone } });

    if (existing && existing.expiresAt > new Date()) {
      return { flow: existing.flow as FlowStep, data: parseData(existing.data) };
    }

    // Missing or expired - (re)start clean, but don't leave the caller
    // waiting on a write it doesn't need the result of.
    await this.reset(phone);
    return { flow: 'idle', data: {} };
  }

  async reset(phone: string): Promise<void> {
    await this.app.prisma.botSession.upsert({
      where: { phone },
      create: { phone, flow: 'idle', data: {}, expiresAt: this.nextExpiry() },
      update: { flow: 'idle', data: {}, expiresAt: this.nextExpiry() },
    });
  }

  async setFlow(phone: string, flow: FlowStep): Promise<void> {
    const existing = await this.get(phone);
    await this.app.prisma.botSession.upsert({
      where: { phone },
      create: { phone, flow, data: existing.data, expiresAt: this.nextExpiry() },
      update: { flow, data: existing.data, expiresAt: this.nextExpiry() },
    });
  }

  async setData(phone: string, key: string, value: string): Promise<void> {
    const existing = await this.get(phone);
    const data = { ...existing.data, [key]: value };
    await this.app.prisma.botSession.upsert({
      where: { phone },
      create: { phone, flow: existing.flow, data, expiresAt: this.nextExpiry() },
      update: { flow: existing.flow, data, expiresAt: this.nextExpiry() },
    });
  }
}
