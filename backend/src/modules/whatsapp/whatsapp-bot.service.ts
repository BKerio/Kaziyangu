import { AppContext } from '../../context.js';
import { Organization, Role, TaskCategory, TaskStatus, TaskVertical } from '../../shared/types/index.js';
import type { User } from '../../generated/prisma/index.js';
import { CATEGORY_LABELS, ORGANIZATION_LABELS, STATUS_LABELS, VERTICAL_LABELS } from '../tasks/task-options.js';
import { MAX_ATTACHMENTS_PER_TASK } from '../tasks/attachment-constants.js';
import { TaskService } from '../tasks/task.service.js';
import { TaskAttachmentService } from '../tasks/task-attachment.service.js';
import { BotSessionService, Session } from './bot-session.service.js';
import { WhatsAppClient } from './whatsapp.client.js';
import { findUserByPhone } from './user-lookup.js';
import { formatTaskSummary } from './task-format.js';
import {
  ASSISTANT_NAME,
  BACK_BUTTON,
  MAIN_MENU_ROWS,
  MAIN_MENU_SECTIONS,
  MAIN_MENU_TEXT,
  MENU_FOOTER,
  MENU_TRIGGERS,
  REVIEW_BUTTONS,
  helpText,
  unregisteredText,
} from './menus.js';
import {
  HOURS_CUSTOM_ID,
  PERCENT_CUSTOM_ID,
  WORKDAY_HOURS,
  categoryRow,
  clip,
  formatDuration,
  gauge,
  greeting,
  hourSliderRows,
  organizationRow,
  pagedSections,
  parseHours,
  parsePercent,
  percentSliderRows,
  statusNeedsProgress,
  statusRow,
  stepFooter,
  verticalRow,
} from './ui.js';
import type { ImageMessage, IncomingMessage, ListSection, ReplyButton, WebhookPayload } from './whatsapp.types.js';

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

const VERTICAL_VALUES = Object.values(TaskVertical);
const CATEGORY_VALUES = Object.values(TaskCategory);
const STATUS_VALUES = Object.values(TaskStatus);
const ORGANIZATION_VALUES = Object.values(Organization);

const ADD_HEADER = 'Log New Task';
const UPDATE_HEADER = 'Update Task';

// Text messages max out at 4096 characters; leave headroom when splitting long task lists.
const CHUNK_LIMIT = 3500;
// Interactive message bodies max out at 1024 characters.
const BODY_LIMIT = 1024;

interface Draft {
  vertical?: TaskVertical;
  category?: TaskCategory;
  organization?: Organization;
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

// WhatsApp text can't carry a custom icon, so a verified staff member's name
// gets the one emoji the assistant uses - the closest match to the blue
// badge shown next to staff names in the web portal.
const VERIFIED_MARK = '☑️';

/** "*Brian Kerio* ☑️" for active staff; attachees get the plain bold name. */
function displayName(user: Pick<User, 'name' | 'role' | 'isActive'>, name = user.name): string {
  return user.isActive && user.role !== Role.ATTACHEE ? `*${name}* ${VERIFIED_MARK}` : `*${name}*`;
}

function taskWord(count: number): string {
  return count === 1 ? 'task' : 'tasks';
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** Indents every line of a (possibly multi-line) block, for nesting under a day header. */
function indent(text: string, spaces = 2): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => pad + line)
    .join('\n');
}

function resolveFromId<T extends string>(id: string, prefix: string, values: readonly T[]): T | null {
  if (!id.startsWith(`${prefix}_`)) return null;
  const candidate = id.slice(prefix.length + 1) as T;
  return values.includes(candidate) ? candidate : null;
}

/** Progress implied by a status that doesn't need asking about. */
function defaultPercentForStatus(status: TaskStatus): number {
  if (status === TaskStatus.COMPLETED_CLOSED || status === TaskStatus.RESOLVED) return 100;
  if (status === TaskStatus.IN_PROGRESS) return 50;
  return 0;
}

function draftFromSession(data: Record<string, string>): Draft {
  return {
    vertical: (data.vertical as TaskVertical) || undefined,
    category: (data.category as TaskCategory) || undefined,
    organization: (data.organization as Organization) || undefined,
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

/** Splits blocks of text into messages that each stay under the text-message size limit. */
function chunkBlocks(header: string, blocks: string[]): string[] {
  const chunks: string[] = [];
  let current = header;
  for (const block of blocks) {
    if (current.length + block.length > CHUNK_LIMIT) {
      chunks.push(current.trim());
      current = block;
    } else {
      current += block;
    }
  }
  chunks.push(current.trim());
  return chunks;
}

const MENU_ACTION_IDS = new Set([...MAIN_MENU_ROWS.map((r) => r.id), 'main_menu', 'task_add', 'task_update']);

/**
 * Routes inbound WhatsApp messages to the daily-task wizard, backed by the
 * same TaskService used by the HTTP API - so every WhatsApp-created/updated
 * task gets identical validation, ownership checks, and socket broadcasts.
 *
 * Every reply the bot sends is billed by Meta, so related content is merged
 * into one interactive message wherever it fits (e.g. "Task saved" rides on
 * the main menu rather than arriving as a separate text).
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
    const user = await findUserByPhone(this.app.prisma, to);
    if (!user) {
      await this.client.sendMessage(to, { type: 'text', text: unregisteredText(this.portalUrl) });
      return;
    }

    if (message.type === 'image') {
      const session = await this.sessions.get(to);
      if (session.flow === 'task_add_attachment') {
        await this.stepAddAttachmentImage(to, message);
      } else {
        await this.client.sendMessage(to, {
          type: 'buttons',
          header: ASSISTANT_NAME,
          text: 'Screenshots are added while logging a task, just before you review it.\n\nStart with *Log New Task* and you will be asked for them at the right moment.',
          buttons: [{ id: 'task_add', title: 'Log New Task' }, BACK_BUTTON],
        });
      }
      return;
    }

    const input = extractInput(message);
    if (!input) {
      await this.client.sendMessage(to, {
        type: 'text',
        text: 'The Task Assistant understands text, photos and menu selections. Type *menu* to see your options.',
      });
      return;
    }

    const normalized = input.toLowerCase().trim();

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

    await this.showMainMenu(to, user);
  }

  private actorFor(user: User): { userId: string; role: Role } {
    return { userId: user.id, role: user.role };
  }

  // ── Menu screens ─────────────────────────────────────────────────────────

  /** Greeting plus a one-line snapshot of what's been logged today. */
  private async menuIntro(user: User): Promise<string> {
    const today = todayDateString();
    const { data: todays } = await this.tasks.getTasks(this.actorFor(user), {
      userId: user.id,
      from: today,
      to: today,
      page: 1,
      limit: 50,
    });
    const firstName = user.name.split(' ')[0] || user.name;
    const hours = todays.reduce((sum, t) => sum + t.hoursSpent, 0);

    const snapshot =
      todays.length === 0
        ? 'Nothing logged yet today.'
        : `*Today*  ${gauge(hours / WORKDAY_HOURS)}  ${formatDuration(hours)} across ${plural(todays.length, 'task')}`;

    return `${greeting()}, ${displayName(user, firstName)}\n\n${snapshot}`;
  }

  private async showMainMenu(to: string, user: User, lead?: string): Promise<void> {
    await this.sessions.reset(to);
    await this.sendMenu(to, lead ? `${lead}\n\n${MAIN_MENU_TEXT}` : `${await this.menuIntro(user)}\n\n${MAIN_MENU_TEXT}`);
  }

  /** The main menu list, carrying `body` - or, if `body` is too long for a list, as a separate text first. */
  private async sendMenu(to: string, body: string): Promise<void> {
    if (body.length > BODY_LIMIT) {
      await this.client.sendMessage(to, { type: 'text', text: body });
      body = MAIN_MENU_TEXT;
    }
    await this.client.sendMessage(to, {
      type: 'list',
      header: ASSISTANT_NAME,
      text: body,
      footer: MENU_FOOTER,
      buttonLabel: 'Open Menu',
      sections: MAIN_MENU_SECTIONS,
    });
  }

  /** Sends text chunks, folding the last one into a buttons message when it fits. */
  private async sendChunksWithButtons(to: string, chunks: string[], buttons: ReplyButton[], footer?: string): Promise<void> {
    const last = chunks[chunks.length - 1] ?? '';
    const leading = last.length <= BODY_LIMIT ? chunks.slice(0, -1) : chunks;
    for (const text of leading) {
      await this.client.sendMessage(to, { type: 'text', text });
    }
    await this.client.sendMessage(to, {
      type: 'buttons',
      text: last.length <= BODY_LIMIT ? last : 'What next?',
      footer,
      buttons,
    });
  }

  private async showHelp(to: string): Promise<void> {
    await this.sessions.reset(to);
    await this.sendMenu(to, helpText(this.portalUrl));
  }

  private async showProfile(to: string, user: User): Promise<void> {
    await this.sessions.reset(to);
    await this.client.sendMessage(to, {
      type: 'buttons',
      header: 'My Profile',
      text:
        `${displayName(user)}\n` +
        `${user.role.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}` +
        (user.department ? ` · ${user.department.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}` : '') +
        '\n\n' +
        `Phone: ${user.phone}\n` +
        (user.email ? `Email: ${user.email}\n` : '') +
        `\nTo change these details, sign in at ${this.portalUrl}`,
      footer: MENU_FOOTER,
      buttons: [BACK_BUTTON],
    });
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

    const buttons: ReplyButton[] = [{ id: 'task_add', title: 'Log New Task' }, { id: 'task_update', title: 'Update Task' }, BACK_BUTTON];

    if (taskList.length === 0) {
      await this.client.sendMessage(to, {
        type: 'buttons',
        header: "Today's Tasks",
        text: `Nothing logged yet for ${today}.\n\nTap *Log New Task* to record your first one.`,
        buttons: [{ id: 'task_add', title: 'Log New Task' }, BACK_BUTTON],
      });
      return;
    }

    const totalHours = taskList.reduce((sum, t) => sum + t.hoursSpent, 0);
    const header =
      `*Today's Tasks*  ·  ${today}\n` +
      `${gauge(totalHours / WORKDAY_HOURS)}  ${formatDuration(totalHours)} across ${taskList.length} ${taskWord(taskList.length)}\n\n`;

    const chunks = chunkBlocks(
      header,
      taskList.map((task, index) => `${formatTaskSummary(task, index + 1)}\n\n`)
    );
    await this.sendChunksWithButtons(to, chunks, buttons);
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
        type: 'buttons',
        header: 'This Week',
        text: `Nothing logged between ${from} and ${rangeTo} yet.`,
        buttons: [{ id: 'task_add', title: 'Log New Task' }, BACK_BUTTON],
      });
      return;
    }

    const byDate = new Map<string, typeof taskList>();
    for (const task of taskList) {
      const key = task.date.toISOString().slice(0, 10);
      const list = byDate.get(key) ?? [];
      list.push(task);
      byDate.set(key, list);
    }

    const totalHours = taskList.reduce((sum, t) => sum + t.hoursSpent, 0);
    const header =
      `*This Week*  ·  ${from} to ${rangeTo}\n` +
      `${formatDuration(totalHours)} across ${taskList.length} ${taskWord(taskList.length)}\n\n`;

    const blocks = [...byDate.entries()].sort().map(([date, dayTasks]) => {
      const dayHours = dayTasks.reduce((sum, t) => sum + t.hoursSpent, 0);
      let block = `*${date}*\n${gauge(dayHours / WORKDAY_HOURS)}  ${formatDuration(dayHours)} · ${dayTasks.length} ${taskWord(dayTasks.length)}\n\n`;
      dayTasks.forEach((task, i) => {
        block += `${indent(formatTaskSummary(task, i + 1))}\n\n`;
      });
      return block;
    });

    await this.sendChunksWithButtons(to, chunkBlocks(header, blocks), [BACK_BUTTON]);
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
      default:
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
        await this.stepAddCategory(to, user, input, session);
        return;
      case 'task_add_organization':
        await this.stepAddOrganization(to, user, input);
        return;
      case 'task_add_description':
        await this.stepAddDescription(to, user, input);
        return;
      case 'task_add_project':
        await this.stepAddProject(to, input, normalized, session);
        return;
      case 'task_add_status':
        await this.stepAddStatus(to, input);
        return;
      case 'task_add_percent':
        await this.stepAddPercent(to, input);
        return;
      case 'task_add_hours':
        await this.stepAddHours(to, input, normalized);
        return;
      case 'task_add_attachment':
        await this.stepAddAttachment(to, normalized, session);
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
      case 'task_update_hours':
        await this.stepUpdateHours(to, user, input, session);
        return;
      case 'task_update_organization':
        await this.stepUpdateOrganization(to, user, input, session);
        return;
      case 'task_update_blockers':
        await this.stepUpdateBlockers(to, user, input, normalized, session);
        return;
      default:
        await this.showMainMenu(to, user);
    }
  }

  // ── Log New Task ─────────────────────────────────────────────────────────

  private async startAddTask(to: string): Promise<void> {
    await this.sessions.reset(to);
    await this.sessions.advance(to, 'task_add_vertical', { verticalPage: '0' });
    await this.sendVerticalPicker(to, 0);
  }

  private async sendVerticalPicker(to: string, page: number): Promise<void> {
    await this.client.sendMessage(to, {
      type: 'list',
      header: ADD_HEADER,
      text: '*Which area of the business was this?*\n\nChoose the vertical this task belongs to.',
      footer: stepFooter(1, 'Vertical'),
      buttonLabel: 'Choose Vertical',
      sections: pagedSections(VERTICAL_VALUES, page, 'vert', 'Verticals', verticalRow),
    });
  }

  private async sendCategoryPicker(to: string, vertical: TaskVertical, page: number): Promise<void> {
    await this.client.sendMessage(to, {
      type: 'list',
      header: ADD_HEADER,
      text: `*What kind of work was it?*\n\nVertical: ${VERTICAL_LABELS[vertical].replace(/^\d+\.\s*/, '')}`,
      footer: stepFooter(2, 'Category'),
      buttonLabel: 'Choose Category',
      sections: pagedSections(CATEGORY_VALUES, page, 'cat', 'Categories', categoryRow),
    });
  }

  /** The user's most recent organization comes first, so the usual choice is always the top row. */
  private async sendOrganizationPicker(
    to: string,
    user: User,
    opts: { header: string; text: string; footer: string }
  ): Promise<void> {
    const recent = await this.app.prisma.workTask.findFirst({
      where: { userId: user.id, organization: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { organization: true },
    });
    const recentOrg = recent?.organization as Organization | null | undefined;

    const sections: ListSection[] = recentOrg
      ? [
          { title: 'Most recent', rows: [organizationRow(recentOrg, `${ORGANIZATION_LABELS[recentOrg]} · used last time`)] },
          { title: 'All organizations', rows: ORGANIZATION_VALUES.filter((o) => o !== recentOrg).map((o) => organizationRow(o)) },
        ]
      : [{ title: 'Organizations', rows: ORGANIZATION_VALUES.map((o) => organizationRow(o)) }];

    await this.client.sendMessage(to, {
      type: 'list',
      header: opts.header,
      text: opts.text,
      footer: opts.footer,
      buttonLabel: 'Choose Organization',
      sections,
    });
  }

  private async sendStatusPicker(to: string, opts: { header: string; text: string; footer?: string }): Promise<void> {
    await this.client.sendMessage(to, {
      type: 'list',
      header: opts.header,
      text: opts.text,
      footer: opts.footer,
      buttonLabel: 'Choose Status',
      sections: [{ title: 'Status', rows: STATUS_VALUES.map(statusRow) }],
    });
  }

  private async sendPercentSlider(to: string, opts: { header: string; text: string; footer?: string }): Promise<void> {
    await this.client.sendMessage(to, {
      type: 'list',
      header: opts.header,
      text: opts.text,
      footer: opts.footer,
      buttonLabel: 'Set Progress',
      sections: [{ title: 'Progress', rows: percentSliderRows() }],
    });
  }

  private async sendHoursSlider(to: string, opts: { header: string; text: string; footer?: string }): Promise<void> {
    await this.client.sendMessage(to, {
      type: 'list',
      header: opts.header,
      text: opts.text,
      footer: opts.footer,
      buttonLabel: 'Set Time',
      sections: [{ title: 'Time spent', rows: hourSliderRows() }],
    });
  }

  private async stepAddVertical(to: string, input: string, session: Session): Promise<void> {
    const page = Number(session.data.verticalPage ?? '0');
    if (input === 'vert_next' || input === 'vert_prev') {
      const nextPage = input === 'vert_next' ? page + 1 : Math.max(0, page - 1);
      await this.sessions.setData(to, 'verticalPage', String(nextPage));
      await this.sendVerticalPicker(to, nextPage);
      return;
    }

    const vertical = resolveFromId(input, 'vert', VERTICAL_VALUES);
    if (!vertical) {
      await this.sendVerticalPicker(to, page);
      return;
    }
    await this.sessions.advance(to, 'task_add_category', { vertical, categoryPage: '0' });
    await this.sendCategoryPicker(to, vertical, 0);
  }

  private async stepAddCategory(to: string, user: User, input: string, session: Session): Promise<void> {
    const page = Number(session.data.categoryPage ?? '0');
    const vertical = session.data.vertical as TaskVertical;
    if (input === 'cat_next' || input === 'cat_prev') {
      const nextPage = input === 'cat_next' ? page + 1 : Math.max(0, page - 1);
      await this.sessions.setData(to, 'categoryPage', String(nextPage));
      await this.sendCategoryPicker(to, vertical, nextPage);
      return;
    }

    const category = resolveFromId(input, 'cat', CATEGORY_VALUES);
    if (!category) {
      await this.sendCategoryPicker(to, vertical, page);
      return;
    }
    await this.sessions.advance(to, 'task_add_organization', { category });
    await this.sendOrganizationPicker(to, user, {
      header: ADD_HEADER,
      text: `*Which organization is this for?*\n\n${CATEGORY_LABELS[category]} · ${VERTICAL_LABELS[vertical].replace(/^\d+\.\s*/, '')}`,
      footer: stepFooter(3, 'Organization'),
    });
  }

  private async stepAddOrganization(to: string, user: User, input: string): Promise<void> {
    const organization = resolveFromId(input, 'org', ORGANIZATION_VALUES);
    if (!organization) {
      await this.sendOrganizationPicker(to, user, {
        header: ADD_HEADER,
        text: '*Which organization is this for?*\n\nChoose one from the list.',
        footer: stepFooter(3, 'Organization'),
      });
      return;
    }
    await this.sessions.advance(to, 'task_add_description', { organization });
    await this.client.sendMessage(to, {
      type: 'buttons',
      header: ADD_HEADER,
      text:
        '*Describe what you worked on*\n\n' +
        'Type a sentence or two, as you would in your daily report.\n\n' +
        '_For example: Configured VLANs on the core switch at the Westlands branch._',
      footer: stepFooter(4, 'Description'),
      buttons: [{ id: 'main_menu', title: 'Cancel' }],
    });
  }

  private async stepAddDescription(to: string, user: User, input: string): Promise<void> {
    if (input.length < 5) {
      await this.client.sendMessage(to, {
        type: 'buttons',
        header: ADD_HEADER,
        text: 'A little more detail, please. The description needs at least 5 characters.',
        footer: stepFooter(4, 'Description'),
        buttons: [{ id: 'main_menu', title: 'Cancel' }],
      });
      return;
    }

    const recent = await this.app.prisma.workTask.findFirst({
      where: { userId: user.id, customerProject: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { customerProject: true },
    });
    const lastProject = recent?.customerProject?.trim() || '';

    await this.sessions.advance(to, 'task_add_project', { description: input, lastProject });
    await this.sendProjectPrompt(to, lastProject);
  }

  private async sendProjectPrompt(to: string, lastProject: string): Promise<void> {
    const buttons: ReplyButton[] = [];
    if (lastProject) buttons.push({ id: 'proj_last', title: 'Same as Last' });
    buttons.push({ id: 'proj_skip', title: 'Skip' });

    await this.client.sendMessage(to, {
      type: 'buttons',
      header: ADD_HEADER,
      text:
        '*Customer or project*\n\nType the customer or project name.' +
        (lastProject ? `\n\nLast used: *${clip(lastProject, 120)}*` : ''),
      footer: stepFooter(5, 'Customer / Project'),
      buttons,
    });
  }

  private async stepAddProject(to: string, input: string, normalized: string, session: Session): Promise<void> {
    let customerProject = '';
    if (input === 'proj_last') customerProject = session.data.lastProject ?? '';
    else if (input !== 'proj_skip' && normalized !== 'skip') customerProject = input;

    await this.sessions.advance(to, 'task_add_status', { customerProject });
    await this.sendStatusPicker(to, {
      header: ADD_HEADER,
      text: '*Where does it stand?*\n\nChoose the current status.',
      footer: stepFooter(6, 'Status'),
    });
  }

  private async stepAddStatus(to: string, input: string): Promise<void> {
    const status = resolveFromId(input, 'status', STATUS_VALUES);
    if (!status) {
      await this.sendStatusPicker(to, {
        header: ADD_HEADER,
        text: '*Where does it stand?*\n\nChoose the current status from the list.',
        footer: stepFooter(6, 'Status'),
      });
      return;
    }

    if (statusNeedsProgress(status)) {
      await this.sessions.advance(to, 'task_add_percent', { status });
      await this.sendPercentSlider(to, {
        header: ADD_HEADER,
        text: `*How far along is it?*\n\nStatus: ${STATUS_LABELS[status]}\n\nSlide to the closest mark, or choose *Exact value*.`,
        footer: stepFooter(6, 'Progress'),
      });
      return;
    }

    await this.sessions.advance(to, 'task_add_hours', { status, percentComplete: String(defaultPercentForStatus(status)) });
    await this.sendAddHoursSlider(to);
  }

  private async stepAddPercent(to: string, input: string): Promise<void> {
    if (input === PERCENT_CUSTOM_ID) {
      await this.client.sendMessage(to, { type: 'text', text: 'Type the progress as a number from 0 to 100, for example *65*.' });
      return;
    }
    const pct = parsePercent(input);
    if (pct == null) {
      await this.sendPercentSlider(to, {
        header: ADD_HEADER,
        text: 'That was not a percentage between 0 and 100. Choose a mark, or type a number such as *65*.',
        footer: stepFooter(6, 'Progress'),
      });
      return;
    }
    await this.sessions.advance(to, 'task_add_hours', { percentComplete: String(pct) });
    await this.sendAddHoursSlider(to);
  }

  private async sendAddHoursSlider(to: string): Promise<void> {
    await this.sendHoursSlider(to, {
      header: ADD_HEADER,
      text:
        '*How much time did it take?*\n\n' +
        `Each bar is measured against an ${WORKDAY_HOURS}-hour day. Choose the closest mark, or *Exact time* to type it.`,
      footer: stepFooter(7, 'Time spent'),
    });
  }

  private async stepAddHours(to: string, input: string, normalized: string): Promise<void> {
    if (input === HOURS_CUSTOM_ID) {
      await this.client.sendMessage(to, {
        type: 'text',
        text: 'Type the time spent, for example *2.5*, *2h 15m*, *45m* or *1:30*.',
      });
      return;
    }

    const hours = normalized === 'skip' ? null : parseHours(input);
    if (normalized !== 'skip' && hours == null) {
      await this.sendHoursSlider(to, {
        header: ADD_HEADER,
        text: 'That time was not recognised. Choose a mark, or type something like *2h 15m* (up to 24 hours).',
        footer: stepFooter(7, 'Time spent'),
      });
      return;
    }

    await this.sessions.advance(to, 'task_add_attachment', hours != null ? { hoursSpent: String(hours) } : {});
    await this.client.sendMessage(to, {
      type: 'buttons',
      header: ADD_HEADER,
      text:
        '*Proof of work (optional)*\n\n' +
        `Send up to ${MAX_ATTACHMENTS_PER_TASK} screenshots or photos, one at a time. They will be attached to this task.`,
      footer: 'Almost done · You will review everything next',
      buttons: [{ id: 'att_skip', title: 'Skip to Review' }],
    });
  }

  private async stepAddAttachment(to: string, normalized: string, session: Session): Promise<void> {
    if (normalized === 'att_skip' || normalized === 'att_done' || normalized === 'skip' || normalized === 'done') {
      await this.showAddConfirm(to, session);
      return;
    }
    const count = attachmentsFromSession(session.data).length;
    await this.client.sendMessage(to, {
      type: 'buttons',
      header: ADD_HEADER,
      text:
        count > 0
          ? `${plural(count, 'screenshot')} attached so far. Send another photo, or continue to review.`
          : 'Send a photo as proof of work, or continue without one.',
      buttons: [{ id: count > 0 ? 'att_done' : 'att_skip', title: count > 0 ? 'Continue to Review' : 'Skip to Review' }],
    });
  }

  private async stepAddAttachmentImage(to: string, message: ImageMessage): Promise<void> {
    const session = await this.sessions.get(to);
    const pending = attachmentsFromSession(session.data);

    if (pending.length >= MAX_ATTACHMENTS_PER_TASK) {
      await this.client.sendMessage(to, {
        type: 'buttons',
        header: ADD_HEADER,
        text: `This task already has the maximum of ${MAX_ATTACHMENTS_PER_TASK} screenshots.`,
        buttons: [{ id: 'att_done', title: 'Continue to Review' }],
      });
      return;
    }

    const updated = [...pending, { mediaId: message.image.id, mimeType: message.image.mime_type }];
    await this.sessions.setData(to, 'attachments', JSON.stringify(updated));

    const remaining = MAX_ATTACHMENTS_PER_TASK - updated.length;
    await this.client.sendMessage(to, {
      type: 'buttons',
      header: ADD_HEADER,
      text:
        `*Screenshot ${updated.length} received*\n` +
        `${gauge(updated.length / MAX_ATTACHMENTS_PER_TASK, MAX_ATTACHMENTS_PER_TASK)}  ${updated.length} of ${MAX_ATTACHMENTS_PER_TASK}\n\n` +
        (remaining > 0 ? 'Send another, or continue to review.' : 'That is the limit for one task.'),
      buttons: [{ id: 'att_done', title: 'Continue to Review' }],
    });
  }

  private async showAddConfirm(to: string, session: Session): Promise<void> {
    const draft = draftFromSession(session.data);
    const attachmentCount = attachmentsFromSession(session.data).length;

    const card = formatTaskSummary({
      vertical: draft.vertical,
      category: draft.category,
      organization: draft.organization,
      description: draft.description ?? '',
      customerProject: draft.customerProject,
      status: draft.status,
      hoursSpent: draft.hoursSpent ?? null,
      percentComplete: draft.percentComplete,
    });
    const evidence = attachmentCount > 0 ? `\nEvidence: ${plural(attachmentCount, 'screenshot')}` : '';

    await this.sessions.setFlow(to, 'task_add_confirm');
    await this.client.sendMessage(to, {
      type: 'buttons',
      header: 'Review Task',
      text: `${card}${evidence}`,
      footer: 'Nothing is saved until you tap Save Task',
      buttons: REVIEW_BUTTONS,
    });
  }

  private async stepAddConfirm(to: string, user: User, normalized: string, session: Session): Promise<void> {
    if (normalized === 'confirm_yes') {
      await this.completeAddTask(to, user, session);
      return;
    }
    if (normalized === 'confirm_restart') {
      await this.startAddTask(to);
      return;
    }
    if (normalized === 'confirm_no') {
      await this.showMainMenu(to, user, 'Task discarded. Nothing was saved.');
      return;
    }
    await this.showAddConfirm(to, session);
  }

  private async completeAddTask(to: string, user: User, session: Session): Promise<void> {
    const draft = draftFromSession(session.data);

    try {
      const task = await this.tasks.createTask(this.actorFor(user), {
        date: todayDateString(),
        vertical: draft.vertical!,
        category: draft.category!,
        organization: draft.organization,
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

      await this.showMainMenu(to, user, `*Task saved*\n\n${formatTaskSummary(task)}${attachmentNote}`);
    } catch (err) {
      this.app.log.error({ err }, 'Create task from WhatsApp bot failed');
      await this.client.sendMessage(to, {
        type: 'buttons',
        header: 'Review Task',
        text: 'The task could not be saved. Your answers are still here, so you can try again.',
        buttons: REVIEW_BUTTONS,
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

    if (failed === 0) return `\nEvidence: ${plural(saved, 'screenshot')} attached`;
    if (saved === 0) return `\nEvidence: ${plural(failed, 'screenshot')} could not be saved. Add them from the web portal.`;
    return `\nEvidence: ${saved} attached, ${failed} could not be saved`;
  }

  // ── Update Task ──────────────────────────────────────────────────────────

  private async startUpdateTask(to: string, user: User): Promise<void> {
    const today = todayDateString();
    const { data: taskList } = await this.tasks.getTasks(this.actorFor(user), {
      userId: user.id,
      from: today,
      to: today,
      page: 1,
      limit: 9, // plus the Main Menu row = WhatsApp's 10-row limit
    });

    if (taskList.length === 0) {
      await this.showMainMenu(to, user, 'There is nothing logged today to update yet. Start with *Log New Task*.');
      return;
    }

    await this.sessions.reset(to);
    await this.sessions.setFlow(to, 'task_update_pick');
    await this.client.sendMessage(to, {
      type: 'list',
      header: UPDATE_HEADER,
      text: '*Which task would you like to update?*\n\nShowing what you logged today.',
      footer: MENU_FOOTER,
      buttonLabel: 'Choose Task',
      sections: [
        {
          title: "Today's tasks",
          rows: taskList.map((task, index) => ({
            id: `task_${task.id}`,
            title: `${index + 1}. ${CATEGORY_LABELS[task.category]}`,
            description:
              `${STATUS_LABELS[task.status]} · ${task.percentComplete}%` +
              (task.hoursSpent > 0 ? ` · ${formatDuration(task.hoursSpent)}` : '') +
              ` · ${clip(task.description, 40)}`,
          })),
        },
        { title: 'Navigation', rows: [{ id: 'main_menu', title: 'Main Menu', description: 'Leave without changes' }] },
      ],
    });
  }

  /** The chosen task's card plus a list of what can be changed, each row showing its current value. */
  private async sendUpdateFieldPicker(to: string, user: User, taskId: string): Promise<boolean> {
    let task;
    try {
      task = await this.tasks.getTaskById(taskId, this.actorFor(user));
    } catch {
      task = null;
    }
    if (!task) return false;

    await this.client.sendMessage(to, {
      type: 'list',
      header: UPDATE_HEADER,
      text: `${formatTaskSummary(task)}\n\n*What would you like to change?*`,
      buttonLabel: 'Choose Field',
      sections: [
        {
          title: 'Fields',
          rows: [
            { id: 'upd_status', title: 'Status', description: `Now: ${STATUS_LABELS[task.status]}` },
            { id: 'upd_progress', title: 'Progress', description: `${gauge(task.percentComplete / 100)}  ${task.percentComplete}%` },
            {
              id: 'upd_hours',
              title: 'Time Spent',
              description:
                task.hoursSpent > 0
                  ? `${gauge(task.hoursSpent / WORKDAY_HOURS)}  ${formatDuration(task.hoursSpent)}`
                  : 'Not recorded yet',
            },
            {
              id: 'upd_org',
              title: 'Organization',
              description: task.organization ? ORGANIZATION_LABELS[task.organization as Organization] : 'Not set',
            },
            { id: 'upd_blockers', title: 'Blockers', description: task.blockersNotes ? clip(task.blockersNotes, 60) : 'None recorded' },
          ],
        },
        { title: 'Navigation', rows: [{ id: 'main_menu', title: 'Main Menu', description: 'Leave without changes' }] },
      ],
    });
    return true;
  }

  private async stepUpdatePick(to: string, user: User, input: string): Promise<void> {
    if (!input.startsWith('task_')) {
      await this.startUpdateTask(to, user);
      return;
    }
    const taskId = input.slice('task_'.length);
    await this.sessions.advance(to, 'task_update_field', { updateTaskId: taskId });
    if (!(await this.sendUpdateFieldPicker(to, user, taskId))) {
      await this.showMainMenu(to, user, 'That task could not be found. It may have been removed.');
    }
  }

  private async stepUpdateField(to: string, user: User, input: string, session: Session): Promise<void> {
    const taskId = session.data.updateTaskId;
    if (!taskId) {
      await this.showMainMenu(to, user);
      return;
    }

    switch (input) {
      case 'upd_status':
        await this.sessions.setFlow(to, 'task_update_status');
        await this.sendStatusPicker(to, { header: UPDATE_HEADER, text: '*Choose the new status*' });
        return;
      case 'upd_progress':
        await this.sessions.setFlow(to, 'task_update_percent');
        await this.sendPercentSlider(to, {
          header: UPDATE_HEADER,
          text: '*How far along is it now?*\n\nSlide to the closest mark, or choose *Exact value*.',
        });
        return;
      case 'upd_hours':
        await this.sessions.setFlow(to, 'task_update_hours');
        await this.sendHoursSlider(to, {
          header: UPDATE_HEADER,
          text: '*How much time has it taken in total?*\n\nChoose the closest mark, or *Exact time* to type it.',
        });
        return;
      case 'upd_org':
        await this.sessions.setFlow(to, 'task_update_organization');
        await this.sendOrganizationPicker(to, user, {
          header: UPDATE_HEADER,
          text: '*Which organization is this for?*',
          footer: MENU_FOOTER,
        });
        return;
      case 'upd_blockers':
        await this.sessions.setFlow(to, 'task_update_blockers');
        await this.client.sendMessage(to, {
          type: 'buttons',
          header: UPDATE_HEADER,
          text: "*What's holding it up?*\n\nType the blocker notes, or clear any existing ones.",
          buttons: [{ id: 'blk_clear', title: 'Clear Blockers' }, BACK_BUTTON],
        });
        return;
      default:
        if (!(await this.sendUpdateFieldPicker(to, user, taskId))) await this.showMainMenu(to, user);
    }
  }

  private async stepUpdateStatus(to: string, user: User, input: string, session: Session): Promise<void> {
    const status = resolveFromId(input, 'status', STATUS_VALUES);
    const taskId = session.data.updateTaskId;
    if (!status || !taskId) {
      await this.sendStatusPicker(to, { header: UPDATE_HEADER, text: '*Choose the new status* from the list.' });
      return;
    }

    // Keep partial progress the user already recorded; only snap to the
    // status's implied value when it would otherwise contradict it.
    let percentComplete: number | undefined;
    if (!statusNeedsProgress(status)) {
      percentComplete = defaultPercentForStatus(status);
    } else {
      const current = await this.tasks.getTaskById(taskId, this.actorFor(user)).catch(() => null);
      if (!current || current.percentComplete === 0 || current.percentComplete === 100) {
        percentComplete = defaultPercentForStatus(status);
      }
    }

    await this.finishUpdate(to, user, taskId, { status, ...(percentComplete !== undefined ? { percentComplete } : {}) });
  }

  private async stepUpdatePercent(to: string, user: User, input: string, session: Session): Promise<void> {
    const taskId = session.data.updateTaskId;
    if (input === PERCENT_CUSTOM_ID) {
      await this.client.sendMessage(to, { type: 'text', text: 'Type the progress as a number from 0 to 100, for example *65*.' });
      return;
    }
    const pct = parsePercent(input);
    if (!taskId || pct == null) {
      await this.sendPercentSlider(to, {
        header: UPDATE_HEADER,
        text: 'That was not a percentage between 0 and 100. Choose a mark, or type a number such as *65*.',
      });
      return;
    }
    await this.finishUpdate(to, user, taskId, { percentComplete: pct });
  }

  private async stepUpdateHours(to: string, user: User, input: string, session: Session): Promise<void> {
    const taskId = session.data.updateTaskId;
    if (input === HOURS_CUSTOM_ID) {
      await this.client.sendMessage(to, {
        type: 'text',
        text: 'Type the total time spent, for example *2.5*, *2h 15m*, *45m* or *1:30*.',
      });
      return;
    }
    const hours = parseHours(input);
    if (!taskId || hours == null) {
      await this.sendHoursSlider(to, {
        header: UPDATE_HEADER,
        text: 'That time was not recognised. Choose a mark, or type something like *2h 15m* (up to 24 hours).',
      });
      return;
    }
    await this.finishUpdate(to, user, taskId, { hoursSpent: hours });
  }

  private async stepUpdateOrganization(to: string, user: User, input: string, session: Session): Promise<void> {
    const taskId = session.data.updateTaskId;
    const organization = resolveFromId(input, 'org', ORGANIZATION_VALUES);
    if (!taskId || !organization) {
      await this.sendOrganizationPicker(to, user, {
        header: UPDATE_HEADER,
        text: '*Which organization is this for?*\n\nChoose one from the list.',
        footer: MENU_FOOTER,
      });
      return;
    }
    await this.finishUpdate(to, user, taskId, { organization });
  }

  private async stepUpdateBlockers(to: string, user: User, input: string, normalized: string, session: Session): Promise<void> {
    const taskId = session.data.updateTaskId;
    if (!taskId) {
      await this.showMainMenu(to, user);
      return;
    }
    const notes = input === 'blk_clear' || normalized === 'clear' ? '' : input;
    await this.finishUpdate(to, user, taskId, { blockersNotes: notes });
  }

  private async finishUpdate(
    to: string,
    user: User,
    taskId: string,
    data: Parameters<TaskService['updateTask']>[2]
  ): Promise<void> {
    try {
      const updated = await this.tasks.updateTask(taskId, this.actorFor(user), data);
      await this.showMainMenu(to, user, `*Task updated*\n\n${formatTaskSummary(updated)}`);
    } catch (err) {
      this.app.log.error({ err }, 'Update task from WhatsApp bot failed');
      await this.showMainMenu(to, user, 'The task could not be updated. Please try again.');
    }
  }
}
