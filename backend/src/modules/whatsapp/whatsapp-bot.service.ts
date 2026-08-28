import { AppContext } from '../../context.js';
import { Role, TaskCategory, TaskStatus, TaskVertical } from '../../shared/types/index.js';
import type { User } from '../../generated/prisma/index.js';
import { CATEGORY_LABELS, STATUS_LABELS, VERTICAL_LABELS } from '../tasks/task-options.js';
import { MAX_ATTACHMENTS_PER_TASK } from '../tasks/attachment-constants.js';
import { TaskService } from '../tasks/task.service.js';
import { TaskAttachmentService } from '../tasks/task-attachment.service.js';
import { BotSessionService, Session } from './bot-session.service.js';
import { WhatsAppClient } from './whatsapp.client.js';
import { findUserByPhone } from './user-lookup.js';
import { formatTaskSummary } from './task-format.js';
import {
  BACK_BUTTON,
  MAIN_MENU_ROWS,
  MAIN_MENU_SECTIONS,
  MAIN_MENU_TEXT,
  MENU_TRIGGERS,
  UPDATE_FIELD_BUTTONS,
  YES_NO_BUTTONS,
  helpText,
  unregisteredText,
} from './menus.js';
import type { ImageMessage, IncomingMessage, ListRow, WebhookPayload } from './whatsapp.types.js';

/** Best-effort file extension for a screenshot downloaded from WhatsApp, from its MIME type. */
function extFromMime(mimeType: string): string {
  const match = /^image\/(jpeg|png|webp|gif)$/.exec(mimeType);
  if (!match) return '';
  return `.${match[1] === 'jpeg' ? 'jpg' : match[1]}`;
}

interface PendingAttachment {
  mediaId: string;
  mimeType: string;
}

/** Screenshots queued so far for the task being logged - stored as a JSON blob under one session key, since Session.data is a flat string map. */
function attachmentsFromSession(data: Record<string, string>): PendingAttachment[] {
  if (!data.attachments) return [];
  try {
    const parsed = JSON.parse(data.attachments);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const LIST_PAGE_SIZE = 9; // WhatsApp lists cap at 10 rows/section; 1 slot reserved for pagination

const VERTICAL_VALUES = Object.values(TaskVertical);
const CATEGORY_VALUES = Object.values(TaskCategory);
const STATUS_VALUES = Object.values(TaskStatus);

interface Draft {
  vertical?: TaskVertical;
  category?: TaskCategory;
  description?: string;
  customerProject?: string;
  status: TaskStatus;
  hoursSpent?: number;
  percentComplete: number;
}

function extractInput(message: IncomingMessage): string {
  if (message.type === 'text') return message.text.body.trim();
  if (message.type === 'interactive') {
    return message.interactive.button_reply?.id ?? message.interactive.list_reply?.id ?? '';
  }
  if (message.type === 'button') return message.button.payload;
  return '';
}

function taskWord(count: number): string {
  return count === 1 ? 'task' : 'tasks';
}

/** Indents every line of a (possibly multi-line) block, for nesting under a day header. */
function indent(text: string, spaces = 2): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => pad + line)
    .join('\n');
}

function shortTitle(label: string, max = 24): string {
  const stripped = label.replace(/^\d+\.\s*/, '');
  return stripped.length <= max ? stripped : `${stripped.slice(0, max - 1)}…`;
}

function resolveFromId<T extends string>(id: string, prefix: string, values: readonly T[]): T | null {
  if (!id.startsWith(`${prefix}_`)) return null;
  const candidate = id.slice(prefix.length + 1) as T;
  return values.includes(candidate) ? candidate : null;
}

function paginatedRows<T extends string>(
  values: readonly T[],
  labels: Record<T, string>,
  page: number,
  prefix: string
): ListRow[] {
  const start = page * LIST_PAGE_SIZE;
  const slice = values.slice(start, start + LIST_PAGE_SIZE);
  const rows: ListRow[] = slice.map((value) => ({
    id: `${prefix}_${value}`,
    title: shortTitle(labels[value]),
    description: labels[value].slice(0, 72),
  }));

  if (start + LIST_PAGE_SIZE < values.length) {
    rows.push({ id: `${prefix}_next`, title: 'More options', description: 'Next page' });
  }
  if (page > 0) {
    rows.push({ id: `${prefix}_prev`, title: 'Previous page', description: 'Go back' });
  }
  return rows;
}

function defaultPercentForStatus(status: TaskStatus): number {
  if (status === TaskStatus.COMPLETED_CLOSED) return 100;
  if (status === TaskStatus.IN_PROGRESS) return 50;
  return 0;
}

function draftFromSession(data: Record<string, string>): Draft {
  return {
    vertical: (data.vertical as TaskVertical) || undefined,
    category: (data.category as TaskCategory) || undefined,
    description: data.description || undefined,
    customerProject: data.customerProject || undefined,
    status: (data.status as TaskStatus) || TaskStatus.NOT_STARTED,
    hoursSpent: data.hoursSpent ? Number(data.hoursSpent) : undefined,
    percentComplete: data.percentComplete ? Number(data.percentComplete) : 0,
  };
}

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Monday-Sunday range containing today, as YYYY-MM-DD strings. */
function weekRangeStrings(): { from: string; to: string } {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() + (day === 0 ? -6 : 1 - day));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
}

const MENU_ACTION_IDS = new Set([...MAIN_MENU_ROWS.map((r) => r.id), 'main_menu', 'task_add', 'task_update']);

/**
 * Routes inbound WhatsApp messages to the daily-task wizard, backed by the
 * same TaskService used by the HTTP API - so every WhatsApp-created/updated
 * task gets identical validation, ownership checks, and socket broadcasts.
 */
export class WhatsAppBotService {
  private readonly tasks: TaskService;
  private readonly attachments: TaskAttachmentService;
  private readonly sessions: BotSessionService;
  private readonly portalUrl: string;

  constructor(private app: AppContext, private client: WhatsAppClient) {
    this.tasks = new TaskService(app);
    this.attachments = new TaskAttachmentService(app);
    this.sessions = new BotSessionService(app);
    this.portalUrl = app.config.CORS_ORIGIN.startsWith('http') ? app.config.CORS_ORIGIN : 'the staff web portal';
  }

  async processWebhook(payload: WebhookPayload): Promise<void> {
    if (payload.object !== 'whatsapp_business_account') return;

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value?.messages?.length) continue;

        for (const message of value.messages) {
          await this.client.markAsRead(message.id);
          try {
            await this.handleMessage(message.from, message);
          } catch (err) {
            this.app.log.error({ err, from: message.from }, 'WhatsApp message handling failed');
          }
        }
      }
    }
  }

  // ── Routing ──────────────────────────────────────────────────────────────

  private async handleMessage(to: string, message: IncomingMessage): Promise<void> {
    if (message.type === 'image') {
      const user = await findUserByPhone(this.app.prisma, to);
      if (!user) {
        await this.client.sendMessage(to, { type: 'text', text: unregisteredText(this.portalUrl) });
        return;
      }
      const session = await this.sessions.get(to);
      if (session.flow === 'task_add_attachment') {
        await this.stepAddAttachmentImage(to, message);
      } else {
        await this.client.sendMessage(to, {
          type: 'text',
          text: "I wasn't expecting a photo right now. When logging a task you'll be asked for a screenshot - type *menu* to get started.",
        });
      }
      return;
    }

    const input = extractInput(message);
    if (!input) {
      await this.client.sendMessage(to, {
        type: 'text',
        text: 'I can only respond to text messages, photos, and menu selections for now.',
      });
      return;
    }

    const normalized = input.toLowerCase().trim();
    const user = await findUserByPhone(this.app.prisma, to);

    if (!user) {
      await this.client.sendMessage(to, { type: 'text', text: unregisteredText(this.portalUrl) });
      return;
    }

    if (MENU_TRIGGERS.has(normalized)) {
      if (normalized === 'help') await this.showHelp(to);
      else await this.showMainMenu(to, user);
      return;
    }

    const session = await this.sessions.get(to);

    if (session.flow !== 'idle') {
      await this.handleActiveFlow(to, user, input, normalized, session);
      return;
    }

    if (MENU_ACTION_IDS.has(input)) {
      await this.handleMenuAction(to, user, input);
      return;
    }

    await this.client.sendMessage(to, {
      type: 'text',
      text:
        `Hello, *${user.name}*.\n\n` +
        '*Task Assistant* helps you log and manage your daily tasks from WhatsApp.\n\n' +
        'Type *menu* to get started.',
    });
    await this.showMainMenu(to, user);
  }

  private actorFor(user: User): { userId: string; role: Role } {
    return { userId: user.id, role: user.role };
  }

  // ── Menu screens ─────────────────────────────────────────────────────────

  private async showMainMenu(to: string, user: User): Promise<void> {
    await this.sessions.reset(to);
    await this.client.sendMessage(to, {
      type: 'list',
      text: `Welcome back, *${user.name}*.\n\n${MAIN_MENU_TEXT}`,
      buttonLabel: 'Open Menu',
      sections: MAIN_MENU_SECTIONS,
    });
  }

  private async showHelp(to: string): Promise<void> {
    await this.client.sendMessage(to, { type: 'text', text: helpText(this.portalUrl) });
    await this.client.sendMessage(to, {
      type: 'list',
      text: 'Need anything else?',
      buttonLabel: 'Open Menu',
      sections: MAIN_MENU_SECTIONS,
    });
  }

  private async showProfile(to: string, user: User): Promise<void> {
    await this.sessions.reset(to);
    await this.client.sendMessage(to, {
      type: 'text',
      text:
        `*Your Profile*\n\n` +
        `Name: *${user.name}*\n` +
        `Phone: *${user.phone}*\n` +
        `Department: ${user.department ?? 'Not set'}\n` +
        `Role: ${user.role}\n` +
        (user.email ? `Email: ${user.email}\n` : ''),
    });
    await this.client.sendMessage(to, { type: 'buttons', text: 'Back to task menu?', buttons: [BACK_BUTTON] });
  }

  private async showTodayTasks(to: string, user: User): Promise<void> {
    await this.sessions.reset(to);
    const today = todayDateString();
    const { data: taskList } = await this.tasks.getTasks(this.actorFor(user), {
      userId: user.id,
      from: today,
      to: today,
      page: 1,
      limit: 50,
    });

    if (taskList.length === 0) {
      await this.client.sendMessage(to, {
        type: 'text',
        text: `*Today's Tasks* (${today})\n\nNo tasks logged yet today.\n\nSelect *Log New Task* from the menu to add one.`,
      });
    } else {
      const totalHours = taskList.reduce((sum, t) => sum + t.hoursSpent, 0);
      const header = `*Today's Tasks* (${today})\n${taskList.length} ${taskWord(taskList.length)} logged, ${totalHours.toFixed(1)}h total\n\n`;

      const chunks: string[] = [];
      let current = header;
      taskList.forEach((task, index) => {
        const block = `${formatTaskSummary(task, index + 1)}\n\n`;
        if (current.length + block.length > 3500) {
          chunks.push(current.trim());
          current = block;
        } else {
          current += block;
        }
      });
      chunks.push(current.trim());

      for (const text of chunks) {
        await this.client.sendMessage(to, { type: 'text', text });
      }
    }

    await this.client.sendMessage(to, {
      type: 'buttons',
      text: 'What next?',
      buttons: [{ id: 'task_add', title: 'Log New Task' }, { id: 'task_update', title: 'Update Task' }, BACK_BUTTON],
    });
  }

  private async showWeekTasks(to: string, user: User): Promise<void> {
    await this.sessions.reset(to);
    const { from, to: rangeTo } = weekRangeStrings();
    const { data: taskList } = await this.tasks.getTasks(this.actorFor(user), {
      userId: user.id,
      from,
      to: rangeTo,
      page: 1,
      limit: 200,
    });

    if (taskList.length === 0) {
      await this.client.sendMessage(to, {
        type: 'text',
        text: `*This Week* (${from} to ${rangeTo})\n\nNo tasks logged this week yet.`,
      });
    } else {
      const byDate = new Map<string, typeof taskList>();
      for (const task of taskList) {
        const key = task.date.toISOString().slice(0, 10);
        const list = byDate.get(key) ?? [];
        list.push(task);
        byDate.set(key, list);
      }

      const totalHours = taskList.reduce((sum, t) => sum + t.hoursSpent, 0);
      const header =
        `*This Week* (${from} to ${rangeTo})\n` +
        `${taskList.length} ${taskWord(taskList.length)} logged, ${totalHours.toFixed(1)}h total\n\n`;

      const chunks: string[] = [];
      let current = header;

      for (const [date, dayTasks] of [...byDate.entries()].sort()) {
        const dayHours = dayTasks.reduce((sum, t) => sum + t.hoursSpent, 0);
        let block = `*${date}* (${dayTasks.length} ${taskWord(dayTasks.length)}, ${dayHours.toFixed(1)}h)\n`;
        dayTasks.forEach((task, i) => {
          block += `${indent(formatTaskSummary(task, i + 1))}\n`;
        });
        block += '\n';

        if (current.length + block.length > 3500) {
          chunks.push(current.trim());
          current = block;
        } else {
          current += block;
        }
      }
      chunks.push(current.trim());

      for (const text of chunks) {
        await this.client.sendMessage(to, { type: 'text', text });
      }
    }

    await this.client.sendMessage(to, { type: 'buttons', text: 'What next?', buttons: [BACK_BUTTON] });
  }

  private async startAddTask(to: string): Promise<void> {
    await this.sessions.reset(to);
    await this.sessions.setFlow(to, 'task_add_vertical');
    await this.sessions.setData(to, 'verticalPage', '0');
    await this.client.sendMessage(to, {
      type: 'list',
      text: '*Log New Task*\n\nStep 1 of 5: Select the *task vertical*.',
      buttonLabel: 'Select Vertical',
      rows: paginatedRows(VERTICAL_VALUES, VERTICAL_LABELS, 0, 'vert'),
    });
  }

  private async startUpdateTask(to: string, user: User): Promise<void> {
    const today = todayDateString();
    const { data: taskList } = await this.tasks.getTasks(this.actorFor(user), {
      userId: user.id,
      from: today,
      to: today,
      page: 1,
      limit: 10,
    });

    if (taskList.length === 0) {
      await this.client.sendMessage(to, {
        type: 'text',
        text: 'You have no tasks logged today to update.\n\nUse *Log New Task* first.',
      });
      await this.showMainMenu(to, user);
      return;
    }

    await this.sessions.reset(to);
    await this.sessions.setFlow(to, 'task_update_pick');
    await this.client.sendMessage(to, {
      type: 'list',
      text: '*Update Task*\n\nSelect a task from today.',
      buttonLabel: 'Select Task',
      rows: [
        ...taskList.map((task, index) => ({
          id: `task_${task.id}`,
          title: shortTitle(`${index + 1}. ${CATEGORY_LABELS[task.category]}`, 24),
          description: `${STATUS_LABELS[task.status]} · ${VERTICAL_LABELS[task.vertical].replace(/^\d+\.\s*/, '').slice(0, 40)}`,
        })),
        { id: 'main_menu', title: 'Main Menu', description: 'Cancel' },
      ],
    });
  }

  private async showAddConfirm(to: string, session: Session): Promise<void> {
    const draft = draftFromSession(session.data);
    const hoursLine = draft.hoursSpent != null ? `Hours: *${draft.hoursSpent}*\n` : '';
    const attachmentCount = attachmentsFromSession(session.data).length;
    const attachmentLine =
      attachmentCount > 0 ? `📎 Screenshot${attachmentCount === 1 ? '' : 's'}: *${attachmentCount} attached*\n` : '';

    await this.sessions.setFlow(to, 'task_add_confirm');
    await this.client.sendMessage(to, {
      type: 'buttons',
      text:
        '*Confirm New Task*\n\n' +
        `Vertical: *${VERTICAL_LABELS[draft.vertical!]}*\n` +
        `Category: *${CATEGORY_LABELS[draft.category!]}*\n` +
        `Status: *${STATUS_LABELS[draft.status]}*\n` +
        hoursLine +
        attachmentLine +
        `Description: ${draft.description ?? 'Not provided'}\n` +
        (draft.customerProject ? `Project: ${draft.customerProject}\n` : '') +
        '\nSave this task?',
      buttons: YES_NO_BUTTONS,
    });
  }

  private async completeAddTask(to: string, user: User, session: Session): Promise<void> {
    const draft = draftFromSession(session.data);

    try {
      const task = await this.tasks.createTask(this.actorFor(user), {
        date: todayDateString(),
        vertical: draft.vertical!,
        category: draft.category!,
        description: draft.description!,
        customerProject: draft.customerProject,
        status: draft.status,
        hoursSpent: draft.hoursSpent,
        percentComplete: draft.percentComplete,
      });

      let attachmentNote = '';
      if (attachmentsFromSession(session.data).length > 0) {
        attachmentNote = await this.saveAttachmentsFromSession(task.id, user, session);
      }

      await this.sessions.reset(to);
      await this.client.sendMessage(to, { type: 'text', text: '✓ Task saved.\n\n' + formatTaskSummary(task) + attachmentNote });
    } catch (err) {
      this.app.log.error({ err }, 'Create task from WhatsApp bot failed');
      await this.client.sendMessage(to, {
        type: 'text',
        text: 'Could not save the task. Please check your entries and try again.',
      });
    }
  }

  /** Downloads every screenshot queued in the session and attaches each to the newly created task. */
  private async saveAttachmentsFromSession(taskId: string, user: User, session: Session): Promise<string> {
    const pending = attachmentsFromSession(session.data);
    if (pending.length === 0) return '';

    let saved = 0;
    let failed = 0;
    for (const [index, att] of pending.entries()) {
      const media = await this.client.downloadMedia(att.mediaId);
      if (!media) {
        failed++;
        continue;
      }
      try {
        await this.attachments.addFromBuffer(
          taskId,
          user.id,
          media.buffer,
          media.mimeType || att.mimeType,
          `whatsapp-screenshot-${index + 1}${extFromMime(media.mimeType || att.mimeType)}`
        );
        saved++;
      } catch (err) {
        this.app.log.error({ err, taskId }, 'Saving WhatsApp screenshot attachment failed');
        failed++;
      }
    }

    if (failed === 0) return `\n\n📎 ${saved} screenshot${saved === 1 ? '' : 's'} attached.`;
    if (saved === 0) {
      return `\n\n⚠️ ${failed} screenshot${failed === 1 ? '' : 's'} could not be saved, but the task was saved without ${failed === 1 ? 'it' : 'them'}.`;
    }
    return `\n\n📎 ${saved} screenshot${saved === 1 ? '' : 's'} attached (${failed} failed to save).`;
  }

  private async handleMenuAction(to: string, user: User, actionId: string): Promise<void> {
    switch (actionId) {
      case 'tasks_today':
        await this.showTodayTasks(to, user);
        return;
      case 'tasks_week':
        await this.showWeekTasks(to, user);
        return;
      case 'task_add':
        await this.startAddTask(to);
        return;
      case 'task_update':
        await this.startUpdateTask(to, user);
        return;
      case 'my_profile':
        await this.showProfile(to, user);
        return;
      case 'help':
        await this.showHelp(to);
        return;
      case 'main_menu':
        await this.showMainMenu(to, user);
        return;
      default:
        await this.client.sendMessage(to, { type: 'text', text: "I didn't recognize that option. Please choose from the menu." });
        await this.showMainMenu(to, user);
    }
  }

  // ── Multi-step flows ─────────────────────────────────────────────────────

  private async handleActiveFlow(
    to: string,
    user: User,
    input: string,
    normalized: string,
    session: Session
  ): Promise<void> {
    if (normalized === 'back' || normalized === 'cancel' || normalized === 'main_menu') {
      await this.showMainMenu(to, user);
      return;
    }

    switch (session.flow) {
      case 'task_add_vertical':
        await this.stepAddVertical(to, input, session);
        return;
      case 'task_add_category':
        await this.stepAddCategory(to, input, session);
        return;
      case 'task_add_description':
        await this.stepAddDescription(to, input);
        return;
      case 'task_add_project':
        await this.stepAddProject(to, input, normalized);
        return;
      case 'task_add_status':
        await this.stepAddStatus(to, input);
        return;
      case 'task_add_hours':
        await this.stepAddHours(to, input, normalized, session);
        return;
      case 'task_add_attachment':
        await this.stepAddAttachment(to, normalized);
        return;
      case 'task_add_confirm':
        await this.stepAddConfirm(to, user, normalized, session);
        return;
      case 'task_update_pick':
        await this.stepUpdatePick(to, user, input);
        return;
      case 'task_update_field':
        await this.stepUpdateField(to, user, input, session);
        return;
      case 'task_update_status':
        await this.stepUpdateStatus(to, user, input, session);
        return;
      case 'task_update_percent':
        await this.stepUpdatePercent(to, user, input, session);
        return;
      case 'task_update_blockers':
        await this.stepUpdateBlockers(to, user, input, normalized, session);
        return;
      default:
        await this.showMainMenu(to, user);
    }
  }

  private async stepAddVertical(to: string, input: string, session: Session): Promise<void> {
    const page = Number(session.data.verticalPage ?? '0');
    if (input === 'vert_next' || input === 'vert_prev') {
      const nextPage = input === 'vert_next' ? page + 1 : Math.max(0, page - 1);
      await this.sessions.setData(to, 'verticalPage', String(nextPage));
      await this.client.sendMessage(to, {
        type: 'list',
        text: 'Select the *task vertical*:',
        buttonLabel: 'Select Vertical',
        rows: paginatedRows(VERTICAL_VALUES, VERTICAL_LABELS, nextPage, 'vert'),
      });
      return;
    }

    const vertical = resolveFromId(input, 'vert', VERTICAL_VALUES);
    if (!vertical) {
      await this.startAddTask(to);
      return;
    }
    await this.sessions.setData(to, 'vertical', vertical);
    await this.sessions.setData(to, 'categoryPage', '0');
    await this.sessions.setFlow(to, 'task_add_category');
    await this.client.sendMessage(to, {
      type: 'list',
      text: 'Step 2 of 5: Select the *task category*:',
      buttonLabel: 'Select Category',
      rows: paginatedRows(CATEGORY_VALUES, CATEGORY_LABELS, 0, 'cat'),
    });
  }

  private async stepAddCategory(to: string, input: string, session: Session): Promise<void> {
    const page = Number(session.data.categoryPage ?? '0');
    if (input === 'cat_next' || input === 'cat_prev') {
      const nextPage = input === 'cat_next' ? page + 1 : Math.max(0, page - 1);
      await this.sessions.setData(to, 'categoryPage', String(nextPage));
      await this.client.sendMessage(to, {
        type: 'list',
        text: 'Select the *task category*:',
        buttonLabel: 'Select Category',
        rows: paginatedRows(CATEGORY_VALUES, CATEGORY_LABELS, nextPage, 'cat'),
      });
      return;
    }

    const category = resolveFromId(input, 'cat', CATEGORY_VALUES);
    if (!category) {
      await this.client.sendMessage(to, {
        type: 'list',
        text: 'Select the *task category*:',
        buttonLabel: 'Select Category',
        rows: paginatedRows(CATEGORY_VALUES, CATEGORY_LABELS, page, 'cat'),
      });
      return;
    }
    await this.sessions.setData(to, 'category', category);
    await this.sessions.setFlow(to, 'task_add_description');
    await this.client.sendMessage(to, {
      type: 'text',
      text: 'Step 3 of 5: Describe what you worked on.\n\nEnter a short *task description* (at least 5 characters).',
    });
  }

  private async stepAddDescription(to: string, input: string): Promise<void> {
    if (input.length < 5) {
      await this.client.sendMessage(to, { type: 'text', text: 'Please enter a bit more detail (at least 5 characters).' });
      return;
    }
    await this.sessions.setData(to, 'description', input);
    await this.sessions.setFlow(to, 'task_add_project');
    await this.client.sendMessage(to, {
      type: 'text',
      text: 'Step 4 of 5: Customer or project name?\n\nEnter the name, or type *skip* to leave blank.',
    });
  }

  private async stepAddProject(to: string, input: string, normalized: string): Promise<void> {
    if (normalized !== 'skip') {
      await this.sessions.setData(to, 'customerProject', input);
    }
    await this.sessions.setFlow(to, 'task_add_status');
    await this.client.sendMessage(to, {
      type: 'list',
      text: 'Step 5 of 5: Select the *status*:',
      buttonLabel: 'Select Status',
      rows: paginatedRows(STATUS_VALUES, STATUS_LABELS, 0, 'status'),
    });
  }

  private async stepAddStatus(to: string, input: string): Promise<void> {
    const status = resolveFromId(input, 'status', STATUS_VALUES);
    if (!status) {
      await this.client.sendMessage(to, {
        type: 'list',
        text: 'Select the *status*:',
        buttonLabel: 'Select Status',
        rows: paginatedRows(STATUS_VALUES, STATUS_LABELS, 0, 'status'),
      });
      return;
    }
    await this.sessions.setData(to, 'status', status);
    await this.sessions.setData(to, 'percentComplete', String(defaultPercentForStatus(status)));
    await this.sessions.setFlow(to, 'task_add_hours');
    await this.client.sendMessage(to, {
      type: 'text',
      text: 'How many *hours* did you spend? (e.g. 2.5)\n\nType *skip* if unknown.',
    });
  }

  private async stepAddHours(to: string, input: string, normalized: string, session: Session): Promise<void> {
    if (normalized !== 'skip') {
      const hours = Number(input.replace(/,/g, ''));
      if (!Number.isFinite(hours) || hours < 0 || hours > 24) {
        await this.client.sendMessage(to, { type: 'text', text: 'Enter a valid number of hours (0 to 24), or type *skip*.' });
        return;
      }
      await this.sessions.setData(to, 'hoursSpent', String(hours));
    }
    await this.sessions.setFlow(to, 'task_add_attachment');
    await this.client.sendMessage(to, {
      type: 'text',
      text:
        `Optional: send one or more *screenshots* as proof of work (up to ${MAX_ATTACHMENTS_PER_TASK}, one at a time), ` +
        'or type *skip* to continue without any.',
    });
  }

  private async stepAddAttachment(to: string, normalized: string): Promise<void> {
    if (normalized === 'skip' || normalized === 'done') {
      await this.showAddConfirm(to, await this.sessions.get(to));
      return;
    }
    const session = await this.sessions.get(to);
    const count = attachmentsFromSession(session.data).length;
    await this.client.sendMessage(to, {
      type: 'text',
      text:
        count > 0
          ? `You've attached ${count} screenshot${count === 1 ? '' : 's'} so far. Send another photo, or type *done* to continue.`
          : 'Send a photo as proof of work, or type *skip* to continue.',
    });
  }

  private async stepAddAttachmentImage(to: string, message: ImageMessage): Promise<void> {
    const session = await this.sessions.get(to);
    const pending = attachmentsFromSession(session.data);

    if (pending.length >= MAX_ATTACHMENTS_PER_TASK) {
      await this.client.sendMessage(to, {
        type: 'text',
        text: `You've reached the ${MAX_ATTACHMENTS_PER_TASK}-screenshot limit for a task. Type *done* to continue.`,
      });
      return;
    }

    const updated = [...pending, { mediaId: message.image.id, mimeType: message.image.mime_type }];
    await this.sessions.setData(to, 'attachments', JSON.stringify(updated));

    const remaining = MAX_ATTACHMENTS_PER_TASK - updated.length;
    await this.client.sendMessage(to, {
      type: 'text',
      text:
        `📎 Screenshot ${updated.length} received.\n\n` +
        (remaining > 0
          ? `Send another, or type *done* to continue (up to ${remaining} more).`
          : `That's the limit of ${MAX_ATTACHMENTS_PER_TASK}. Type *done* to continue.`),
    });
  }

  private async stepAddConfirm(to: string, user: User, normalized: string, session: Session): Promise<void> {
    if (normalized === 'confirm_yes') {
      await this.completeAddTask(to, user, session);
      await this.showMainMenu(to, user);
      return;
    }
    if (normalized === 'confirm_no') {
      await this.showMainMenu(to, user);
    }
  }

  private async stepUpdatePick(to: string, user: User, input: string): Promise<void> {
    if (!input.startsWith('task_')) {
      await this.startUpdateTask(to, user);
      return;
    }
    const taskId = input.slice('task_'.length);
    try {
      const task = await this.tasks.getTaskById(taskId, this.actorFor(user));
      await this.sessions.setData(to, 'updateTaskId', taskId);
      await this.sessions.setFlow(to, 'task_update_field');
      await this.client.sendMessage(to, { type: 'text', text: formatTaskSummary(task!) });
      await this.client.sendMessage(to, { type: 'buttons', text: 'What would you like to update?', buttons: UPDATE_FIELD_BUTTONS });
    } catch {
      await this.client.sendMessage(to, { type: 'text', text: 'Task not found. It may have been removed.' });
      await this.showMainMenu(to, user);
    }
  }

  private async stepUpdateField(to: string, user: User, input: string, session: Session): Promise<void> {
    if (!session.data.updateTaskId) {
      await this.showMainMenu(to, user);
      return;
    }

    if (input === 'upd_status') {
      await this.sessions.setFlow(to, 'task_update_status');
      await this.client.sendMessage(to, {
        type: 'list',
        text: 'Select the new *status*:',
        buttonLabel: 'Select Status',
        rows: paginatedRows(STATUS_VALUES, STATUS_LABELS, 0, 'status'),
      });
      return;
    }
    if (input === 'upd_progress') {
      await this.sessions.setFlow(to, 'task_update_percent');
      await this.client.sendMessage(to, { type: 'text', text: 'Enter progress as a percentage (0 to 100), for example 75.' });
      return;
    }
    if (input === 'upd_blockers') {
      await this.sessions.setFlow(to, 'task_update_blockers');
      await this.client.sendMessage(to, { type: 'text', text: 'Enter *blocker notes*, or type *clear* to remove blockers.' });
      return;
    }
    await this.client.sendMessage(to, { type: 'buttons', text: 'Choose a field to update:', buttons: UPDATE_FIELD_BUTTONS });
  }

  private async stepUpdateStatus(to: string, user: User, input: string, session: Session): Promise<void> {
    const status = resolveFromId(input, 'status', STATUS_VALUES);
    const taskId = session.data.updateTaskId;
    if (!status || !taskId) {
      await this.client.sendMessage(to, {
        type: 'list',
        text: 'Select the new *status*:',
        buttonLabel: 'Select Status',
        rows: paginatedRows(STATUS_VALUES, STATUS_LABELS, 0, 'status'),
      });
      return;
    }
    await this.finishUpdate(to, user, taskId, { status, percentComplete: defaultPercentForStatus(status) }, '✓ Task updated.');
  }

  private async stepUpdatePercent(to: string, user: User, input: string, session: Session): Promise<void> {
    const taskId = session.data.updateTaskId;
    const pct = Number(input.replace('%', '').trim());
    if (!taskId || !Number.isFinite(pct) || pct < 0 || pct > 100) {
      await this.client.sendMessage(to, { type: 'text', text: 'Enter a number between 0 and 100.' });
      return;
    }
    await this.finishUpdate(to, user, taskId, { percentComplete: Math.round(pct) }, '✓ Progress updated.');
  }

  private async stepUpdateBlockers(to: string, user: User, input: string, normalized: string, session: Session): Promise<void> {
    const taskId = session.data.updateTaskId;
    if (!taskId) {
      await this.showMainMenu(to, user);
      return;
    }
    const notes = normalized === 'clear' ? '' : input;
    await this.finishUpdate(to, user, taskId, { blockersNotes: notes }, '✓ Blockers updated.');
  }

  private async finishUpdate(
    to: string,
    user: User,
    taskId: string,
    data: Parameters<TaskService['updateTask']>[2],
    successHeading: string
  ): Promise<void> {
    try {
      const updated = await this.tasks.updateTask(taskId, this.actorFor(user), data);
      await this.sessions.reset(to);
      await this.client.sendMessage(to, { type: 'text', text: `${successHeading}\n\n${formatTaskSummary(updated)}` });
    } catch (err) {
      this.app.log.error({ err }, 'Update task from WhatsApp bot failed');
      await this.sessions.reset(to);
      await this.client.sendMessage(to, { type: 'text', text: 'Could not update the task. Please try again.' });
    }
    await this.showMainMenu(to, user);
  }
}
