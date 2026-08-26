import { AppContext } from '../../context.js';
import { ReminderChannel, ReminderStatus, Role, TaskStatus } from '../../shared/types/index.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors/AppError.js';
import { isWhatsAppEnabled } from '../whatsapp/whatsapp.config.js';
import { WhatsAppClient } from '../whatsapp/whatsapp.client.js';
import { isSmsEnabled, isEmailEnabled } from './reminder.config.js';
import { AdvantaSmsClient } from './sms.client.js';
import { EmailClient } from './email.client.js';

const MANAGER_ROLES: Role[] = [Role.ADMIN, Role.SUPER_ADMIN];

// Fixed reminder cadence: first send 30 minutes before the due time, then
// every 10 minutes after that until `repeatCount` sends have gone out.
const LEAD_MINUTES = 30;
const INTERVAL_MINUTES = 10;
const MIN_REPEAT = 1;
const MAX_REPEAT = 5;

export interface CreateReminderInput {
  taskId: string;
  dueAt: string;
  channels: ReminderChannel[];
  repeatCount: number;
}

export type UpdateReminderInput = Partial<CreateReminderInput>;

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

  private validateChannelsAndCount(channels: ReminderChannel[], repeatCount: number): void {
    if (!channels || channels.length === 0) throw new BadRequestError('Pick at least one reminder channel');
    if (repeatCount < MIN_REPEAT || repeatCount > MAX_REPEAT) {
      throw new BadRequestError(`Repeat count must be between ${MIN_REPEAT} and ${MAX_REPEAT}`);
    }
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
    this.validateChannelsAndCount(input.channels, input.repeatCount);

    const task = await this.findOwnedTask(input.taskId, actor);

    const existing = await this.app.prisma.taskReminder.findUnique({ where: { taskId: input.taskId } });
    if (existing) throw new ConflictError('This task already has a reminder set - edit or delete it instead');

    const dueAt = new Date(input.dueAt);
    if (isNaN(dueAt.getTime())) throw new BadRequestError('Invalid due date/time');

    const reminder = await this.app.prisma.taskReminder.create({
      data: {
        dueAt,
        channels: input.channels,
        repeatCount: input.repeatCount,
        nextRunAt: new Date(dueAt.getTime() - LEAD_MINUTES * 60_000),
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
    const repeatCount = patch.repeatCount ?? reminder.repeatCount;
    this.validateChannelsAndCount(channels, repeatCount);

    let dueAt = reminder.dueAt;
    if (patch.dueAt !== undefined) {
      dueAt = new Date(patch.dueAt);
      if (isNaN(dueAt.getTime())) throw new BadRequestError('Invalid due date/time');
    }

    // Any edit re-arms the reminder from scratch - sent count resets and the
    // next fire is recomputed from the (possibly new) due time.
    const updated = await this.app.prisma.taskReminder.update({
      where: { id },
      data: {
        dueAt,
        channels,
        repeatCount,
        sentCount: 0,
        status: ReminderStatus.SCHEDULED,
        nextRunAt: new Date(dueAt.getTime() - LEAD_MINUTES * 60_000),
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
   * `nextRunAt` has passed, then either reschedules it (10 min later) or
   * marks it DONE once `repeatCount` has been reached. A task that's been
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
      const done = sentCount >= reminder.repeatCount;
      await this.app.prisma.taskReminder.update({
        where: { id: reminder.id },
        data: {
          sentCount,
          status: done ? ReminderStatus.DONE : ReminderStatus.ACTIVE,
          nextRunAt: done ? null : new Date(Date.now() + INTERVAL_MINUTES * 60_000),
        },
      });
    }
  }
}
