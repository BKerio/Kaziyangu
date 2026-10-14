import { AppContext } from '../../context.js';
import { ReminderChannel, ReminderStatus, Role, TaskStatus } from '../../shared/types/index.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors/AppError.js';
import { isWhatsAppEnabled } from '../whatsapp/whatsapp.config.js';
import { WhatsAppClient } from '../whatsapp/whatsapp.client.js';
import { isSmsEnabled, isEmailEnabled } from './reminder.config.js';
import { AdvantaSmsClient } from './sms.client.js';
import { EmailClient } from './email.client.js';

const MANAGER_ROLES: Role[] = [Role.ADMIN, Role.SUPER_ADMIN];

// Cadence for reminders created before users could pick their own times
// (empty `remindAt`): first send 30 minutes before the due time, then every
// 10 minutes until `repeatCount` sends have gone out.
const LEGACY_LEAD_MINUTES = 30;
const LEGACY_INTERVAL_MINUTES = 10;
const MAX_TIMES = 5;
// A time picked "now" can be a few seconds stale by the time it's saved.
const PAST_GRACE_MS = 60_000;

export interface CreateReminderInput {
  taskId: string;
  dueAt: string;
  channels: ReminderChannel[];
  /** ISO instants to send at. Older clients send `repeatCount` instead. */
  remindAt?: string[];
  repeatCount?: number;
}

export type UpdateReminderInput = Partial<Omit<CreateReminderInput, 'taskId'>>;

function legacySchedule(dueAt: Date, repeatCount: number): Date[] {
  const first = dueAt.getTime() - LEGACY_LEAD_MINUTES * 60_000;
  return Array.from({ length: repeatCount }, (_, i) => new Date(first + i * LEGACY_INTERVAL_MINUTES * 60_000));
}

/** Parses, de-duplicates (to the minute) and sorts reminder times, enforcing 1-5 future times at or before the due time. */
function normalizeTimes(raw: Array<string | Date>, dueAt: Date): Date[] {
  const byMinute = new Map<number, Date>();
  for (const value of raw) {
    const d = new Date(value);
    if (isNaN(d.getTime())) throw new BadRequestError('One of the reminder times is not a valid date/time');
    const minute = Math.floor(d.getTime() / 60_000) * 60_000;
    byMinute.set(minute, new Date(minute));
  }
  const times = [...byMinute.values()].sort((a, b) => a.getTime() - b.getTime());

  if (times.length === 0) throw new BadRequestError('Add at least one reminder time');
  if (times.length > MAX_TIMES) throw new BadRequestError(`You can set up to ${MAX_TIMES} reminder times`);
  if (times[0].getTime() < Date.now() - PAST_GRACE_MS) throw new BadRequestError('Reminder times must be in the future');
  if (times[times.length - 1].getTime() > dueAt.getTime()) {
    throw new BadRequestError('Reminder times must be at or before the due time');
  }
  return times;
}

function parseDueAt(value: string): Date {
  const dueAt = new Date(value);
  if (isNaN(dueAt.getTime())) throw new BadRequestError('Invalid due date/time');
  return dueAt;
}

const TASK_INCLUDE = {
  task: { include: { user: { select: { id: true, name: true, email: true, phone: true } } } },
} as const;

export class ReminderService {
  private readonly whatsapp: WhatsAppClient | null;
  private readonly sms: AdvantaSmsClient | null;
  private readonly email: EmailClient | null;

  constructor(private app: AppContext) {
    this.whatsapp = isWhatsAppEnabled(app.config) ? new WhatsAppClient(app.config, app.log) : null;
    this.sms = isSmsEnabled(app.config) ? new AdvantaSmsClient(app.config, app.log) : null;
    this.email = isEmailEnabled(app.config) ? new EmailClient(app.config, app.log) : null;
  }

  private isManager(role: Role): boolean {
    return MANAGER_ROLES.includes(role);
  }

  private validateChannels(channels: ReminderChannel[]): void {
    if (!channels || channels.length === 0) throw new BadRequestError('Pick at least one reminder channel');
  }

  private async findOwnedTask(taskId: string, actor: { userId: string; role: Role }) {
    const task = await this.app.prisma.workTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundError('Task');
    if (task.userId !== actor.userId && !this.isManager(actor.role)) {
      throw new ForbiddenError('You do not have permission to set a reminder on this task');
    }
    return task;
  }

  private async findOwnedReminder(id: string, actor: { userId: string; role: Role }) {
    const reminder = await this.app.prisma.taskReminder.findUnique({ where: { id } });
    if (!reminder) throw new NotFoundError('Reminder');
    if (reminder.userId !== actor.userId && !this.isManager(actor.role)) {
      throw new ForbiddenError('You do not have permission to manage this reminder');
    }
    return reminder;
  }

  async createReminder(actor: { userId: string; role: Role }, input: CreateReminderInput) {
    this.validateChannels(input.channels);

    const task = await this.findOwnedTask(input.taskId, actor);

    const existing = await this.app.prisma.taskReminder.findUnique({ where: { taskId: input.taskId } });
    if (existing) throw new ConflictError('This task already has a reminder set - edit or delete it instead');

    const dueAt = parseDueAt(input.dueAt);
    const remindAt = normalizeTimes(input.remindAt ?? legacySchedule(dueAt, input.repeatCount ?? 1), dueAt);

    const reminder = await this.app.prisma.taskReminder.create({
      data: {
        dueAt,
        channels: input.channels,
        remindAt,
        repeatCount: remindAt.length,
        nextRunAt: remindAt[0],
        status: ReminderStatus.SCHEDULED,
        taskId: task.id,
        userId: task.userId,
      },
      include: TASK_INCLUDE,
    });

    await this.app.auditLog.record({
      actorId: actor.userId, action: 'CREATE', subjectType: 'TASK_REMINDER', subjectId: reminder.id,
      summary: `Set reminder for task "${task.description}": ${input.channels.join(', ')}`,
      newValues: reminder,
    });

    return reminder;
  }

  async listMine(actor: { userId: string; role: Role }) {
    return this.app.prisma.taskReminder.findMany({
      where: { userId: actor.userId },
      include: TASK_INCLUDE,
      orderBy: { dueAt: 'asc' },
    });
  }

  async updateReminder(id: string, actor: { userId: string; role: Role }, patch: UpdateReminderInput) {
    const reminder = await this.findOwnedReminder(id, actor);

    const channels = patch.channels ?? (reminder.channels as ReminderChannel[]);
    this.validateChannels(channels);

    const dueAt = patch.dueAt !== undefined ? parseDueAt(patch.dueAt) : reminder.dueAt;
    const remindAt = normalizeTimes(
      patch.remindAt ??
        (reminder.remindAt.length > 0 ? reminder.remindAt : legacySchedule(dueAt, patch.repeatCount ?? reminder.repeatCount)),
      dueAt
    );

    // Any edit re-arms the reminder from scratch with the new set of times.
    const updated = await this.app.prisma.taskReminder.update({
      where: { id },
      data: {
        dueAt,
        channels,
        remindAt,
        repeatCount: remindAt.length,
        sentCount: 0,
        status: ReminderStatus.SCHEDULED,
        nextRunAt: remindAt[0],
      },
      include: TASK_INCLUDE,
    });

    await this.app.auditLog.record({
      actorId: actor.userId, action: 'UPDATE', subjectType: 'TASK_REMINDER', subjectId: id,
      summary: `Updated reminder for task "${updated.task.description}"`,
      oldValues: reminder,
      newValues: updated,
    });

    return updated;
  }

  async deleteReminder(id: string, actor: { userId: string; role: Role }) {
    const reminder = await this.findOwnedReminder(id, actor);
    await this.app.prisma.taskReminder.delete({ where: { id } });
    await this.app.auditLog.record({
      actorId: actor.userId, action: 'DELETE', subjectType: 'TASK_REMINDER', subjectId: id,
      summary: 'Cancelled a task reminder',
      oldValues: reminder,
    });
  }

  /**
   * Dispatches one reminder's message across its selected channels, logging
   * one TaskReminderLog row per channel attempt. Never throws - a failed
   * channel is recorded, not fatal to the run.
   */
  private async dispatch(reminder: {
    id: string;
    channels: ReminderChannel[];
    task: { description: string; dueAtLabel: string; user: { name: string; email: string; phone: string | null } };
  }): Promise<void> {
    const { task } = reminder;
    const message = `Reminder: "${task.description}" is due at ${task.dueAtLabel}.`;

    for (const channel of reminder.channels) {
      let ok = false;
      let error: string | undefined;

      if (channel === ReminderChannel.WHATSAPP) {
        if (!this.whatsapp) {
          error = 'WhatsApp is not configured';
        } else if (!task.user.phone) {
          error = 'No phone number on file';
        } else {
          try {
            await this.whatsapp.sendMessage(task.user.phone, { type: 'text', text: message });
            ok = true;
          } catch (err) {
            error = err instanceof Error ? err.message : 'Send failed';
          }
        }
      } else if (channel === ReminderChannel.SMS) {
        if (!this.sms) {
          error = 'SMS is not configured';
        } else if (!task.user.phone) {
          error = 'No phone number on file';
        } else {
          ok = await this.sms.sendSms(task.user.phone, message);
          if (!ok) error = 'SMS gateway rejected the message';
        }
      } else if (channel === ReminderChannel.EMAIL) {
        if (!this.email) {
          error = 'Email is not configured';
        } else {
          ok = await this.email.sendMail(task.user.email, 'Task reminder', message);
          if (!ok) error = 'SMTP send failed';
        }
      }

      if (!ok) this.app.log.warn({ reminderId: reminder.id, channel, error }, 'Reminder channel send failed');

      await this.app.prisma.taskReminderLog.create({
        data: { reminderId: reminder.id, channel, status: ok ? 'SENT' : 'FAILED', error },
      });
    }
  }

  /**
   * Polled by reminder.scheduler.ts every minute. Fires every reminder whose
   * `nextRunAt` has passed, then moves it on to its next chosen time (or, for
   * older reminders without `remindAt`, 10 minutes later) - or marks it DONE
   * once there's nothing left to send. Times missed while the server was down
   * collapse into a single send rather than a burst. A task that's been
   * marked COMPLETED_CLOSED since the reminder was created is stopped
   * without sending anything further.
   */
  async runDueReminders(): Promise<void> {
    const due = await this.app.prisma.taskReminder.findMany({
      where: { status: { in: [ReminderStatus.SCHEDULED, ReminderStatus.ACTIVE] }, nextRunAt: { lte: new Date() } },
      include: { task: { include: { user: { select: { id: true, name: true, email: true, phone: true } } } } },
    });

    for (const reminder of due) {
      if (reminder.task.status === TaskStatus.COMPLETED_CLOSED) {
        await this.app.prisma.taskReminder.update({
          where: { id: reminder.id },
          data: { status: ReminderStatus.DONE, nextRunAt: null },
        });
        continue;
      }

      const dueAtLabel = reminder.dueAt.toLocaleString('en-GB', {
        timeZone: 'Africa/Nairobi', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
      });

      await this.dispatch({
        id: reminder.id,
        channels: reminder.channels as ReminderChannel[],
        task: { description: reminder.task.description, dueAtLabel, user: reminder.task.user },
      });

      const sentCount = reminder.sentCount + 1;
      const now = Date.now();
      const nextRunAt =
        reminder.remindAt.length > 0
          ? reminder.remindAt.find((t) => t.getTime() > now) ?? null
          : sentCount < reminder.repeatCount
            ? new Date(now + LEGACY_INTERVAL_MINUTES * 60_000)
            : null;

      await this.app.prisma.taskReminder.update({
        where: { id: reminder.id },
        data: {
          sentCount,
          status: nextRunAt ? ReminderStatus.ACTIVE : ReminderStatus.DONE,
          nextRunAt,
        },
      });
    }
  }
}
