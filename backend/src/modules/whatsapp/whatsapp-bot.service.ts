import { AppContext } from '../../context.js';
import { Organization, Role, TaskCategory, TaskStatus, TaskVertical } from '../../shared/types/index.js';
import type { User } from '../../generated/prisma/index.js';
import { CATEGORY_LABELS, ORGANIZATION_LABELS, STATUS_LABELS, VERTICAL_LABELS } from '../tasks/task-options.js';
import {
  ALLOWED_ATTACHMENT_MIMES,
  DOCX_MIME,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TASK,
} from '../tasks/attachment-constants.js';

const MAX_ATTACHMENT_MB = Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024));
import { TaskService } from '../tasks/task.service.js';
import { TaskAttachmentService } from '../tasks/task-attachment.service.js';
import { BotSessionService, FlowStep, Session } from './bot-session.service.js';
import { CampaignService, NOTICE_PAYLOAD_PREFIX, noticeText } from '../campaigns/campaign.service.js';
import { WhatsAppClient, isBusinessScopedUserId } from './whatsapp.client.js';
import { findUserByPhone, findUserByWhatsAppId, linkWhatsAppId, toWhatsAppNumber } from './user-lookup.js';
import { randomInt } from 'node:crypto';
import { formatTaskSummary } from './task-format.js';
import {
  ASSISTANT_NAME,
  BACK_BUTTON,
  MAIN_MENU_ACTION_IDS,
  MAIN_MENU_TEXT,
  MenuSnapshot,
  WORKWEEK_HOURS,
  dayNudge,
  mainMenuSections,
  MENU_FOOTER,
  MENU_TRIGGERS,
  REVIEW_BUTTONS,
  LEAVE_BUTTONS,
  STEP_BACK_BUTTON,
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
  organizationShortName,
  pagedSections,
  parseHours,
  parsePercent,
  percentSliderRows,
  statusNeedsProgress,
  statusRow,
  stepFooter,
  verticalRow,
  STEP,
  TOTAL_STEPS,
  DATE_OTHER_ID,
  addDays,
  dateRows,
  daysBetween,
  fmtDayLong,
  fmtDayShort,
  monthCalendar,
  nairobiToday,
  parseDateInput,
  relativeDayName,
} from './ui.js';
import type { IncomingMessage, ListSection, ReplyButton, WebhookContact, WebhookPayload } from './whatsapp.types.js';

/** Best-effort file extension for a file downloaded from WhatsApp, from its MIME type. */
function extFromMime(mimeType: string): string {
  if (mimeType === 'application/pdf') return '.pdf';
  if (mimeType === DOCX_MIME) return '.docx';
  const match = /^image\/(jpeg|png|webp|gif)$/.exec(mimeType);
  if (!match) return '';
  return `.${match[1] === 'jpeg' ? 'jpg' : match[1]}`;
}

/** "PDF", "Word document" or "Screenshot" - how a queued file is described back to the user. */
function kindOf(mimeType: string): string {
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType === DOCX_MIME) return 'Word document';
  return 'Screenshot';
}

/** A sender-supplied file name, made safe to store and display: no path parts or control characters, sensible length. */
function cleanFileName(name: string | undefined): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f"<>|*?]/g, '').trim().slice(0, 120);
}

interface PendingAttachment {
  mediaId: string;
  mimeType: string;
  /** Original name for documents; photos arrive without one. */
  fileName?: string;
}

/** An incoming photo or document, normalised to what the attachment step needs. */
interface IncomingMedia {
  id: string;
  mimeType: string;
  fileName?: string;
}

/** Files queued so far for the task being logged - stored as a JSON blob under one session key, since Session.data is a flat string map. */
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
  /** YYYY-MM-DD, the Nairobi day the task is logged against. */
  date: string;
  vertical?: TaskVertical;
  category?: TaskCategory;
  organization?: Organization;
  description?: string;
  customerProject?: string;
  status: TaskStatus;
  hoursSpent?: number;
  percentComplete: number;
}

/**
 * The sender's phone digits - from `from`, or the matching contact's `wa_id`.
 * A BSUID ("KE.1234…") is not a phone number, so it's ignored rather than
 * letting its digits accidentally match someone's phone.
 */
interface Sender {
  /** Where replies go: the phone number when shared, otherwise the business-scoped user id. */
  address: string;
  phone: string | null;
  /** Business-scoped user id ("KE.1234…"), present once Meta's username rollout reaches the sender. */
  userId: string | null;
}

function identifySender(message: IncomingMessage, contacts: WebhookContact[] | undefined): Sender | null {
  const isPhone = (v: string | undefined): v is string => !!v && /^\+?\d{9,15}$/.test(v);
  const phone = isPhone(message.from) ? message.from : contacts?.find((c) => isPhone(c.wa_id))?.wa_id ?? null;
  const userId =
    [message.from_user_id, message.from, contacts?.[0]?.user_id].find((v) => isBusinessScopedUserId(v)) ?? null;
  const address = phone ?? userId;
  return address ? { address, phone, userId } : null;
}

/** "…0480" for a phone, "username user …1918" for a user id - never the full value in logs. */
function maskAddress(address: string): string {
  return isBusinessScopedUserId(address) ? `username user …${address.slice(-4)}` : maskPhone(address);
}

const LINK_CODE_TTL_MS = 10 * 60_000;
const MAX_LINK_CODE_TRIES = 5;
const MAX_LINK_CODE_SENDS = 3;

/** "…0480" - enough to tell senders apart in logs without recording full numbers. */
function maskPhone(phone: string): string {
  return `…${phone.slice(-4)}`;
}

function extractInput(message: IncomingMessage): string {
  if (message.type === 'text') return message.text.body.trim();
  if (message.type === 'interactive') {
    return message.interactive.button_reply?.id ?? message.interactive.list_reply?.id ?? '';
  }
  if (message.type === 'button') return message.button.payload;
  return '';
}

// WhatsApp text can't carry a custom icon, so a verified user's name gets the
// one emoji the assistant uses - the closest match to the blue badge shown
// next to names in the web portal.
const VERIFIED_MARK = '☑️';

/** "*Brian Kerio* ☑️" for every active account, matching the web portal. */
function displayName(user: Pick<User, 'name' | 'isActive'>, name = user.name): string {
  return user.isActive ? `*${name}* ${VERIFIED_MARK}` : `*${name}*`;
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

/** True once a "Log New Task" draft holds answers worth protecting - past the opening date step. */
function hasUnsavedDraft(session: Session): boolean {
  return session.flow.startsWith('task_add_') && session.flow !== 'task_add_date';
}

/** Which numbered step a draft is on, for the "Leave this task?" prompt. */
const FLOW_STEP: Partial<Record<FlowStep, number>> = {
  task_add_vertical: STEP.vertical,
  task_add_category: STEP.category,
  task_add_organization: STEP.organization,
  task_add_description: STEP.description,
  task_add_project: STEP.project,
  task_add_status: STEP.status,
  task_add_percent: STEP.status,
  task_add_hours: STEP.time,
};

/** Progress implied by a status that doesn't need asking about. */
function defaultPercentForStatus(status: TaskStatus): number {
  if (status === TaskStatus.COMPLETED_CLOSED || status === TaskStatus.RESOLVED) return 100;
  if (status === TaskStatus.IN_PROGRESS) return 50;
  return 0;
}

function draftFromSession(data: Record<string, string>): Draft {
  return {
    date: data.date || todayDateString(),
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

/** Today in Nairobi - not UTC, which is still "yesterday" until 3 am local time. */
function todayDateString(): string {
  return nairobiToday();
}

/** Monday-Sunday range containing today (Nairobi), as YYYY-MM-DD strings. */
function weekRangeStrings(): { from: string; to: string } {
  const today = todayDateString();
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const from = addDays(today, -weekday);
  return { from, to: addDays(from, 6) };
}

// How far back or ahead a task's date may be set from WhatsApp.
const MAX_DAYS_BACK = 90;
const MAX_DAYS_AHEAD = 30;

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

const MENU_ACTION_IDS = new Set(MAIN_MENU_ACTION_IDS);

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
  private readonly campaigns: CampaignService;
  private readonly portalUrl: string;

  constructor(private app: AppContext, private client: WhatsAppClient) {
    this.tasks = new TaskService(app);
    this.attachments = new TaskAttachmentService(app);
    this.sessions = new BotSessionService(app);
    this.campaigns = new CampaignService(app);
    this.portalUrl = app.config.CORS_ORIGIN.startsWith('http') ? app.config.CORS_ORIGIN : 'the staff web portal';
  }

  async processWebhook(payload: WebhookPayload): Promise<void> {
    if (payload.object !== 'whatsapp_business_account') return;

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;

        // Meta accepts a send first and reports non-delivery later, here -
        // without this, a reply that never reached someone leaves no trace.
        for (const status of value.statuses ?? []) {
          if (status.status !== 'failed') continue;
          const err = status.errors?.[0];
          this.app.log.warn(
            {
              to: status.recipient_id ? maskPhone(status.recipient_id) : status.recipient_user_id ? 'username user' : 'unknown',
              code: err?.code,
              title: err?.title,
              details: err?.error_data?.details ?? err?.message,
            },
            'WhatsApp message was not delivered'
          );
        }

        for (const message of value.messages ?? []) {
          await this.client.markAsRead(message.id);

          const sender = identifySender(message, value.contacts);
          if (!sender) {
            this.app.log.warn(
              { type: message.type, messageKeys: Object.keys(message), contactKeys: Object.keys(value.contacts?.[0] ?? {}) },
              'Inbound WhatsApp message has neither a phone number nor a user id - skipped'
            );
            continue;
          }

          try {
            await this.handleMessage(sender, message);
          } catch (err) {
            this.app.log.error({ err, from: maskAddress(sender.address) }, 'WhatsApp message handling failed');
          }
        }
      }
    }
  }

  /**
   * The staff profile behind a sender: by phone number when WhatsApp shares
   * it (remembering their user id for later), otherwise by a user id linked
   * earlier.
   */
  private async resolveUser(sender: Sender): Promise<User | null> {
    if (sender.phone) {
      const user = await findUserByPhone(this.app.prisma, sender.phone);
      if (user && sender.userId && user.whatsappUserId !== sender.userId) {
        await linkWhatsAppId(this.app.prisma, user.id, sender.userId);
      }
      if (user || !sender.userId) return user;
    }
    return sender.userId ? findUserByWhatsAppId(this.app.prisma, sender.userId) : null;
  }

  // ── Linking a username-only sender to their profile ────────────────────────

  /**
   * Someone whose WhatsApp hides their number (they use a username) can't be
   * matched by phone, so they confirm who they are once: they type the number
   * on their staff profile and we send a one-time code to that number. Only
   * the real owner of that WhatsApp number can read the code, so nobody can
   * claim someone else's profile by typing their number.
   */
  private async handleUnlinkedSender(to: string, userId: string, input: string, normalized: string): Promise<void> {
    const session = await this.sessions.get(to);

    if (session.flow === 'link_code') {
      if (normalized === 'restart') {
        await this.sessions.advance(to, 'link_phone', { code: '', linkUser: '' });
        await this.sendLinkIntro(to, 'Start again: reply with the phone number saved on your staff profile.');
        return;
      }
      await this.stepLinkCode(to, userId, input, session);
      return;
    }
    if (session.flow === 'link_phone') {
      await this.stepLinkPhone(to, input, session);
      return;
    }

    await this.sessions.reset(to);
    await this.sessions.advance(to, 'link_phone', {});
    await this.sendLinkIntro(to);
  }

  private async sendLinkIntro(to: string, lead?: string): Promise<void> {
    await this.client.sendMessage(to, {
      type: 'text',
      text:
        `*${ASSISTANT_NAME}*\n\n` +
        (lead ??
          'Welcome. Your WhatsApp uses a username, which hides your phone number, so I need to confirm who you are once.\n\n' +
            'Reply with the *phone number saved on your staff profile*, for example 0712 345 678.') +
        '\n\n_I will send a one-time code to that number to confirm it is yours._',
    });
  }

  private async stepLinkPhone(to: string, input: string, session: Session): Promise<void> {
    const digits = input.replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 15) {
      await this.sendLinkIntro(to, 'That does not look like a phone number. Reply with the number on your staff profile, for example 0712 345 678.');
      return;
    }

    const sends = Number(session.data.codeSends ?? '0');
    if (sends >= MAX_LINK_CODE_SENDS) {
      await this.client.sendMessage(to, {
        type: 'text',
        text: `Too many attempts. Please ask your administrator to check the phone number on your profile, or sign in at ${this.portalUrl}.`,
      });
      return;
    }

    const user = await findUserByPhone(this.app.prisma, digits);
    if (!user || !user.phone) {
      await this.client.sendMessage(to, {
        type: 'text',
        text:
          'No staff profile has that phone number.\n\n' +
          `Check the number and try again, or ask your administrator to add it to your profile at ${this.portalUrl}.`,
      });
      return;
    }

    const code = String(randomInt(100000, 1000000));
    const sent = await this.client.sendMessage(toWhatsAppNumber(user.phone), {
      type: 'text',
      text: `*${code}* is your Task Assistant code. Type it in the chat to link your WhatsApp to your staff profile. It expires in 10 minutes.\n\nIf you did not ask for this, ignore this message.`,
    });

    if (!sent) {
      await this.sessions.advance(to, 'link_phone', { codeSends: String(sends + 1) });
      await this.client.sendMessage(to, {
        type: 'text',
        text: 'I could not send a code to that number. Make sure it is the number you use for WhatsApp, then type it again.',
      });
      return;
    }

    await this.sessions.advance(to, 'link_code', {
      linkUser: user.id,
      code,
      codeExpires: String(Date.now() + LINK_CODE_TTL_MS),
      codeTries: '0',
      codeSends: String(sends + 1),
    });
    await this.client.sendMessage(to, {
      type: 'text',
      text:
        `I have sent a 6-digit code to the WhatsApp number ending *${user.phone.replace(/\D/g, '').slice(-4)}*. Type the code here.\n\n` +
        '_Type *restart* to use a different number._',
    });
  }

  private async stepLinkCode(to: string, userId: string, input: string, session: Session): Promise<void> {
    const { code, linkUser, codeExpires } = session.data;
    const tries = Number(session.data.codeTries ?? '0') + 1;

    if (!code || !linkUser || Date.now() > Number(codeExpires ?? 0) || tries > MAX_LINK_CODE_TRIES) {
      await this.sessions.advance(to, 'link_phone', { code: '', linkUser: '' });
      await this.sendLinkIntro(to, 'That code has expired. Reply with your phone number again to get a new one.');
      return;
    }

    if (input.replace(/\D/g, '') !== code) {
      const left = MAX_LINK_CODE_TRIES - tries;
      await this.sessions.advance(to, 'link_code', { codeTries: String(tries) });
      await this.client.sendMessage(to, {
        type: 'text',
        text: `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.`,
      });
      return;
    }

    await linkWhatsAppId(this.app.prisma, linkUser, userId);
    this.app.log.info({ userId: linkUser }, 'Linked WhatsApp username user to staff profile');
    const user = await findUserByWhatsAppId(this.app.prisma, userId);
    if (user) await this.showMainMenu(to, user, '*You are all set.* This WhatsApp is now linked to your staff profile.');
  }

  // ── Routing ──────────────────────────────────────────────────────────────

  private async handleMessage(sender: Sender, message: IncomingMessage): Promise<void> {
    const to = sender.address;
    const user = await this.resolveUser(sender);
    this.app.log.info(
      { from: maskAddress(to), viaUsername: !sender.phone, type: message.type, matchedUser: user?.id ?? null },
      'Inbound WhatsApp message'
    );
    if (!user) {
      if (!sender.phone && sender.userId) {
        const input = extractInput(message);
        await this.handleUnlinkedSender(to, sender.userId, input, input.toLowerCase().trim());
        return;
      }
      await this.client.sendMessage(to, { type: 'text', text: unregisteredText(this.portalUrl) });
      return;
    }

    if (message.type === 'image' || message.type === 'document') {
      const media: IncomingMedia =
        message.type === 'image'
          ? { id: message.image.id, mimeType: message.image.mime_type }
          : { id: message.document.id, mimeType: message.document.mime_type, fileName: cleanFileName(message.document.filename) };

      const session = await this.sessions.get(to);
      if (session.flow === 'task_add_attachment') {
        await this.stepAddAttachmentMedia(to, media);
      } else {
        await this.client.sendMessage(to, {
          type: 'buttons',
          header: ASSISTANT_NAME,
          text: 'Files are added while logging a task, just before you review it.\n\nStart with *Log New Task* and you will be asked for them at the right moment.',
          buttons: [{ id: 'task_add', title: 'Log New Task' }, BACK_BUTTON],
        });
      }
      return;
    }

    const input = extractInput(message);
    if (!input) {
      await this.client.sendMessage(to, {
        type: 'text',
        text: 'The Task Assistant understands text, photos, PDF and Word files, and menu selections. Type *menu* to see your options.',
      });
      return;
    }

    const normalized = input.toLowerCase().trim();
    const session = await this.sessions.get(to);

    // "View Notice" on a campaign notice - show the full message, then put
    // them back exactly where they were if they were mid-task.
    if (input.startsWith(NOTICE_PAYLOAD_PREFIX)) {
      const notice = await this.campaigns.openNotice(input.slice(NOTICE_PAYLOAD_PREFIX.length), user.id);
      await this.client.sendMessage(to, {
        type: 'text',
        text: notice ? noticeText(notice.title, notice.message, user) : 'That notice is no longer available.',
      });
      if (session.flow !== 'idle') await this.renderStep(to, user, session);
      return;
    }

    // "menu", "hi", "cancel" and the like mid-task would otherwise throw the
    // whole draft away on one stray message - so confirm first. Saying it a
    // second time while the confirmation is showing counts as the confirmation.
    const wantsOut = MENU_TRIGGERS.has(normalized) || normalized === 'cancel' || input === 'main_menu';
    if (wantsOut) {
      const target = normalized === 'help' ? 'help' : 'menu';
      const draft = hasUnsavedDraft(session);
      if (draft && session.data.leave !== '1') {
        await this.askLeaveConfirm(to, session, target);
        return;
      }
      if (target === 'help') await this.showHelp(to, user);
      else await this.showMainMenu(to, user, draft ? 'Task discarded. Nothing was saved.' : undefined);
      return;
    }

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
  /** Today's and this week's totals plus the last task - everything the menu previews. */
  private async menuSnapshot(user: User): Promise<MenuSnapshot> {
    const today = todayDateString();
    const { from, to: weekTo } = weekRangeStrings();
    const [{ data: week }, last] = await Promise.all([
      this.tasks.getTasks(this.actorFor(user), { userId: user.id, from, to: weekTo, page: 1, limit: 200 }),
      this.app.prisma.workTask.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        select: { category: true, organization: true },
      }),
    ]);
    const todays = week.filter((t) => t.date.toISOString().slice(0, 10) === today);
    const titleCase = (v: string) => v.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

    return {
      todayCount: todays.length,
      todayHours: todays.reduce((sum, t) => sum + t.hoursSpent, 0),
      weekCount: week.length,
      weekHours: week.reduce((sum, t) => sum + t.hoursSpent, 0),
      lastTaskLabel: last
        ? CATEGORY_LABELS[last.category] +
          (last.organization ? ` · ${organizationShortName(last.organization as Organization)}` : '')
        : null,
      roleLine: titleCase(user.role) + (user.department ? ` · ${titleCase(user.department)}` : ''),
    };
  }

  /** Greeting card: who you are, the date, today's and this week's progress, and a nudge. */
  private menuIntro(user: User, s: MenuSnapshot): string {
    const firstName = user.name.split(' ')[0] || user.name;
    const dateLine = new Intl.DateTimeFormat('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Nairobi',
    }).format(new Date());

    return (
      `${greeting()}, ${displayName(user, firstName)}\n` +
      `_${dateLine}_\n\n` +
      `*Today*\n${gauge(s.todayHours / WORKDAY_HOURS)}  ${formatDuration(s.todayHours)} of ${WORKDAY_HOURS} h · ${plural(s.todayCount, 'task')}\n\n` +
      `*This week*\n${gauge(s.weekHours / WORKWEEK_HOURS)}  ${formatDuration(s.weekHours)} of ${WORKWEEK_HOURS} h · ${plural(s.weekCount, 'task')}\n\n` +
      dayNudge(s)
    );
  }

  private async showMainMenu(to: string, user: User, lead?: string): Promise<void> {
    await this.sessions.reset(to);
    const snapshot = await this.menuSnapshot(user);
    await this.sendMenu(to, snapshot, lead ? `${lead}\n\n${MAIN_MENU_TEXT}` : `${this.menuIntro(user, snapshot)}\n\n${MAIN_MENU_TEXT}`);
  }

  /** The main menu list, carrying `body` - or, if `body` is too long for a list, as a separate text first. */
  private async sendMenu(to: string, snapshot: MenuSnapshot, body: string): Promise<void> {
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
      sections: mainMenuSections(snapshot),
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

  private async showHelp(to: string, user: User): Promise<void> {
    await this.sessions.reset(to);
    await this.sendMenu(to, await this.menuSnapshot(user), helpText(this.portalUrl));
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
        await this.startAddTask(to, user);
        return;
      case 'task_repeat':
        await this.startRepeatTask(to, user);
        return;
      case 'task_update':
        await this.startUpdateTask(to, user);
        return;
      case 'my_profile':
        await this.showProfile(to, user);
        return;
      case 'help':
        await this.showHelp(to, user);
        return;
      default:
        await this.showMainMenu(to, user);
    }
  }

  // ── Navigation safety ────────────────────────────────────────────────────

  /**
   * "Leave this task?" - shown instead of silently discarding a half-filled
   * draft. Keep Going comes first and is the default way out; the draft stays
   * untouched until Discard Task is tapped explicitly.
   */
  private async askLeaveConfirm(to: string, session: Session, target: 'menu' | 'help'): Promise<void> {
    await this.sessions.advance(to, session.flow, { leave: '1', leaveTo: target });
    const draft = draftFromSession(session.data);
    const step = FLOW_STEP[session.flow];
    const where = step ? `You're on step ${step} of ${TOTAL_STEPS}.` : "You're at the final review.";

    const saved = [
      `Date: ${fmtDayShort(draft.date)}`,
      draft.category ? `Category: ${CATEGORY_LABELS[draft.category]}` : null,
      draft.organization ? `Organization: ${organizationShortName(draft.organization)}` : null,
      draft.description ? `Description: ${clip(draft.description, 60)}` : null,
    ].filter(Boolean);

    await this.client.sendMessage(to, {
      type: 'buttons',
      header: 'Leave this task?',
      text:
        `${where} If you leave now, what you've entered will be lost:\n\n` +
        `${saved.join('\n')}\n\n` +
        'Tap *Keep Going* to carry on where you left off.',
      footer: 'Nothing is saved until you tap Save Task',
      buttons: LEAVE_BUTTONS,
    });
  }

  /** Re-sends the prompt for whichever step the session is on (after Keep Going or Back). */
  private async renderStep(to: string, user: User, session: Session): Promise<void> {
    const data = session.data;
    switch (session.flow) {
      case 'task_add_date':
        await this.sendDatePicker(to, user, data.repeat === '1' ? 'Repeat Last Task' : ADD_HEADER);
        return;
      case 'task_add_vertical':
        await this.sendVerticalPicker(to, Number(data.verticalPage ?? '0'));
        return;
      case 'task_add_category':
        await this.sendCategoryPicker(to, data.vertical as TaskVertical, Number(data.categoryPage ?? '0'));
        return;
      case 'task_add_organization':
        await this.sendOrganizationPicker(to, user, {
          header: ADD_HEADER,
          text: '*Which organization is this for?*',
          footer: stepFooter(STEP.organization, 'Organization'),
        });
        return;
      case 'task_add_description':
        await this.sendDescriptionPrompt(
          to,
          data.repeat === '1' ? 'Repeat Last Task' : ADD_HEADER,
          data.description ? `Your answer so far:\n_${clip(data.description, 300)}_\n\nType it again, changed as needed.\n\n` : ''
        );
        return;
      case 'task_add_project':
        await this.sendProjectPrompt(to, data.lastProject ?? '');
        return;
      case 'task_add_status':
        await this.sendStatusStep(to);
        return;
      case 'task_add_percent':
        await this.sendPercentStep(to, data.status as TaskStatus);
        return;
      case 'task_add_hours':
        await this.sendAddHoursSlider(to);
        return;
      case 'task_add_attachment':
        await this.sendAttachmentStep(to, attachmentsFromSession(data).length);
        return;
      case 'task_add_confirm':
        await this.showAddConfirm(to, session);
        return;
      default:
        await this.showMainMenu(to, user);
    }
  }

  /**
   * Back: one step earlier, keeping every answer given so far - a stray tap
   * costs one tap to undo, never the whole draft. From the very first step,
   * Back simply returns to the menu, as nothing has been entered yet.
   */
  private async stepBack(to: string, user: User, session: Session): Promise<void> {
    const { flow, data } = session;
    const repeat = data.repeat === '1';

    // Update Task: back out one screen at a time, to the menu at most.
    if (flow === 'task_update_pick') {
      await this.showMainMenu(to, user);
      return;
    }
    if (flow === 'task_update_field') {
      await this.startUpdateTask(to, user);
      return;
    }
    if (flow.startsWith('task_update_')) {
      await this.sessions.setFlow(to, 'task_update_field');
      if (!data.updateTaskId || !(await this.sendUpdateFieldPicker(to, user, data.updateTaskId))) await this.showMainMenu(to, user);
      return;
    }

    const previous: Partial<Record<FlowStep, FlowStep>> = {
      task_add_vertical: 'task_add_date',
      task_add_category: 'task_add_vertical',
      task_add_organization: repeat ? 'task_add_date' : 'task_add_category',
      task_add_description: repeat ? 'task_add_date' : 'task_add_organization',
      task_add_project: 'task_add_description',
      task_add_status: 'task_add_project',
      task_add_percent: 'task_add_status',
      task_add_hours: statusNeedsProgress(data.status as TaskStatus) ? 'task_add_percent' : 'task_add_status',
      task_add_attachment: 'task_add_hours',
      task_add_confirm: 'task_add_attachment',
    };

    const target = previous[flow];
    if (!target) {
      await this.showMainMenu(to, user);
      return;
    }
    await this.sessions.setFlow(to, target);
    await this.renderStep(to, user, { flow: target, data });
  }

  // ── Multi-step flows ─────────────────────────────────────────────────────

  private async handleActiveFlow(
    to: string,
    user: User,
    input: string,
    normalized: string,
    session: Session
  ): Promise<void> {
    // A "Leave this task?" prompt is showing. Anything other than an explicit
    // Discard keeps the draft: Keep Going re-shows the current step, and any
    // other reply is taken as the answer to that step, as if never asked.
    if (session.data.leave === '1') {
      const target = session.data.leaveTo;
      session = { ...session, data: { ...session.data, leave: '', leaveTo: '' } };
      await this.sessions.advance(to, session.flow, { leave: '', leaveTo: '' });
      if (input === 'leave_discard') {
        if (target === 'help') await this.showHelp(to, user);
        else await this.showMainMenu(to, user, 'Task discarded. Nothing was saved.');
        return;
      }
      if (input === 'leave_keep') {
        await this.renderStep(to, user, session);
        return;
      }
    }

    if (normalized === 'back' || input === 'nav_back') {
      await this.stepBack(to, user, session);
      return;
    }

    switch (session.flow) {
      case 'task_add_date':
        await this.stepAddDate(to, user, input, session);
        return;
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

  private async startAddTask(to: string, user: User): Promise<void> {
    await this.sessions.reset(to);
    await this.sessions.advance(to, 'task_add_date');
    await this.sendDatePicker(to, user, ADD_HEADER);
  }

  /**
   * Step 1: which day the task belongs to. The body draws this month as a
   * small calendar (today bracketed, logged days dotted); the list offers
   * Today / Yesterday / Tomorrow, the rest of the past week with each day's
   * task count, and "Other date" for typing any day.
   */
  private async sendDatePicker(to: string, user: User, header: string, preface = ''): Promise<void> {
    const today = todayDateString();
    const monthStart = `${today.slice(0, 7)}-01`;
    const from = addDays(today, -6) < monthStart ? addDays(today, -6) : monthStart;
    const { data: recent } = await this.tasks.getTasks(this.actorFor(user), {
      userId: user.id,
      from,
      to: addDays(today, 1),
      page: 1,
      limit: 500,
    });

    const counts = new Map<string, number>();
    for (const t of recent) {
      const day = t.date.toISOString().slice(0, 10);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }

    await this.client.sendMessage(to, {
      type: 'list',
      header,
      text:
        preface +
        '*Which day is this task for?*\n\n' +
        `${monthCalendar(today, new Set(counts.keys()))}\n` +
        '_[ ] today   • already has tasks_',
      footer: stepFooter(STEP.date, 'Date'),
      buttonLabel: 'Choose Day',
      sections: dateRows(today, counts),
    });
  }

  private async stepAddDate(to: string, user: User, input: string, session: Session): Promise<void> {
    if (input === DATE_OTHER_ID) {
      await this.client.sendMessage(to, {
        type: 'text',
        text: 'Type the date, day first. For example *05/10/2026*, *5 Oct* or *yesterday*.',
      });
      return;
    }

    const today = todayDateString();
    const date = parseDateInput(input, today);
    const offset = date ? daysBetween(today, date) : 0;
    if (!date || offset < -MAX_DAYS_BACK || offset > MAX_DAYS_AHEAD) {
      await this.client.sendMessage(to, {
        type: 'text',
        text: date
          ? `Pick a day within the last ${MAX_DAYS_BACK} days or the next ${MAX_DAYS_AHEAD}. Older entries can be added from the web portal.`
          : "That date wasn't recognised. Try *05/10/2026*, *5 Oct* or *yesterday*, or choose from the list.",
      });
      return;
    }

    const when = relativeDayName(date, today);
    const dayLine = `_${fmtDayLong(date)}${when ? ` (${when})` : ''}_\n\n`;

    // Repeat Last Task arrives here with its setup already filled in.
    if (session.data.repeat === '1' && session.data.vertical && session.data.category) {
      const vertical = session.data.vertical as TaskVertical;
      const category = session.data.category as TaskCategory;
      if (!session.data.organization) {
        await this.sessions.advance(to, 'task_add_organization', { date });
        await this.sendOrganizationPicker(to, user, {
          header: 'Repeat Last Task',
          text: `${dayLine}*${CATEGORY_LABELS[category]}* · ${VERTICAL_LABELS[vertical].replace(/^\d+\.\s*/, '')}\n\n*Which organization is this for?*`,
          footer: stepFooter(STEP.organization, 'Organization'),
        });
        return;
      }
      await this.sessions.advance(to, 'task_add_description', { date });
      await this.sendDescriptionPrompt(
        to,
        'Repeat Last Task',
        dayLine +
          `${CATEGORY_LABELS[category]} · ${VERTICAL_LABELS[vertical].replace(/^\d+\.\s*/, '')}\n` +
          `${ORGANIZATION_LABELS[session.data.organization as Organization]}\n\n`
      );
      return;
    }

    await this.sessions.advance(to, 'task_add_vertical', { date, verticalPage: '0' });
    await this.sendVerticalPicker(to, 0, dayLine);
  }

  private async sendVerticalPicker(to: string, page: number, preface = ''): Promise<void> {
    await this.client.sendMessage(to, {
      type: 'list',
      header: ADD_HEADER,
      text: `${preface}*Which area of the business was this?*\n\nChoose the vertical this task belongs to.`,
      footer: stepFooter(STEP.vertical, 'Vertical'),
      buttonLabel: 'Choose Vertical',
      sections: pagedSections(VERTICAL_VALUES, page, 'vert', 'Verticals', verticalRow),
    });
  }

  private async sendCategoryPicker(to: string, vertical: TaskVertical, page: number): Promise<void> {
    await this.client.sendMessage(to, {
      type: 'list',
      header: ADD_HEADER,
      text: `*What kind of work was it?*\n\nVertical: ${VERTICAL_LABELS[vertical].replace(/^\d+\.\s*/, '')}`,
      footer: stepFooter(STEP.category, 'Category'),
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
      footer: stepFooter(STEP.organization, 'Organization'),
    });
  }

  private async stepAddOrganization(to: string, user: User, input: string): Promise<void> {
    const organization = resolveFromId(input, 'org', ORGANIZATION_VALUES);
    if (!organization) {
      await this.sendOrganizationPicker(to, user, {
        header: ADD_HEADER,
        text: '*Which organization is this for?*\n\nChoose one from the list.',
        footer: stepFooter(STEP.organization, 'Organization'),
      });
      return;
    }
    await this.sessions.advance(to, 'task_add_description', { organization });
    await this.sendDescriptionPrompt(to, ADD_HEADER);
  }

  private async sendDescriptionPrompt(to: string, header: string, preface = ''): Promise<void> {
    await this.client.sendMessage(to, {
      type: 'buttons',
      header,
      text:
        preface +
        '*Describe what you worked on*\n\n' +
        'Type a sentence or two, as you would in your daily report.\n\n' +
        '_For example: Configured VLANs on the core switch at the Westlands branch._',
      footer: stepFooter(STEP.description, 'Description'),
      buttons: [STEP_BACK_BUTTON],
    });
  }

  /**
   * "Repeat Last Task": copies the vertical, category and organization of the
   * user's most recent task and jumps straight to the description, so a
   * recurring kind of work takes a few taps instead of seven steps. The
   * project is offered as "Same as Last" at the next step as usual.
   */
  private async startRepeatTask(to: string, user: User): Promise<void> {
    const last = await this.app.prisma.workTask.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: { vertical: true, category: true, organization: true, customerProject: true },
    });
    if (!last) {
      await this.startAddTask(to, user);
      return;
    }

    await this.sessions.reset(to);
    const vertical = last.vertical as TaskVertical;
    const category = last.category as TaskCategory;
    const organization = (last.organization as Organization | null) ?? undefined;

    // Pick the day first, like a new task; stepAddDate then skips straight to
    // the description (or asks for an organization on older tasks without one).
    await this.sessions.advance(to, 'task_add_date', {
      repeat: '1',
      vertical,
      category,
      ...(organization ? { organization } : {}),
    });
    await this.sendDatePicker(
      to,
      user,
      'Repeat Last Task',
      '*Same setup as your last task*\n' +
        `${CATEGORY_LABELS[category]} · ${VERTICAL_LABELS[vertical].replace(/^\d+\.\s*/, '')}` +
        (organization ? `\n${ORGANIZATION_LABELS[organization]}` : '') +
        (last.customerProject ? `\nProject: ${clip(last.customerProject, 80)}` : '') +
        '\n\n'
    );
  }

  private async stepAddDescription(to: string, user: User, input: string): Promise<void> {
    if (input.length < 5) {
      await this.client.sendMessage(to, {
        type: 'buttons',
        header: ADD_HEADER,
        text: 'A little more detail, please. The description needs at least 5 characters.',
        footer: stepFooter(STEP.description, 'Description'),
        buttons: [STEP_BACK_BUTTON],
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
    buttons.push({ id: 'proj_skip', title: 'Skip' }, STEP_BACK_BUTTON);

    await this.client.sendMessage(to, {
      type: 'buttons',
      header: ADD_HEADER,
      text:
        '*Customer or project*\n\nType the customer or project name.' +
        (lastProject ? `\n\nLast used: *${clip(lastProject, 120)}*` : ''),
      footer: stepFooter(STEP.project, 'Customer / Project'),
      buttons,
    });
  }

  private async stepAddProject(to: string, input: string, normalized: string, session: Session): Promise<void> {
    let customerProject = '';
    if (input === 'proj_last') customerProject = session.data.lastProject ?? '';
    else if (input !== 'proj_skip' && normalized !== 'skip') customerProject = input;

    await this.sessions.advance(to, 'task_add_status', { customerProject });
    await this.sendStatusStep(to);
  }

  private async sendStatusStep(to: string): Promise<void> {
    await this.sendStatusPicker(to, {
      header: ADD_HEADER,
      text: '*Where does it stand?*\n\nChoose the current status. Type *back* to change the project.',
      footer: stepFooter(STEP.status, 'Status'),
    });
  }

  private async sendPercentStep(to: string, status: TaskStatus): Promise<void> {
    await this.sendPercentSlider(to, {
      header: ADD_HEADER,
      text: `*How far along is it?*\n\nStatus: ${STATUS_LABELS[status]}\n\nSlide to the closest mark, or choose *Exact value*.`,
      footer: stepFooter(STEP.status, 'Progress'),
    });
  }

  private async stepAddStatus(to: string, input: string): Promise<void> {
    const status = resolveFromId(input, 'status', STATUS_VALUES);
    if (!status) {
      await this.sendStatusStep(to);
      return;
    }

    if (statusNeedsProgress(status)) {
      await this.sessions.advance(to, 'task_add_percent', { status });
      await this.sendPercentStep(to, status);
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
        footer: stepFooter(STEP.status, 'Progress'),
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
      footer: stepFooter(STEP.time, 'Time spent'),
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
        footer: stepFooter(STEP.time, 'Time spent'),
      });
      return;
    }

    await this.sessions.advance(to, 'task_add_attachment', hours != null ? { hoursSpent: String(hours) } : {});
    await this.sendAttachmentStep(to, 0);
  }

  private async sendAttachmentStep(to: string, count: number): Promise<void> {
    await this.client.sendMessage(to, {
      type: 'buttons',
      header: ADD_HEADER,
      text:
        '*Proof of work (optional)*\n\n' +
        (count > 0
          ? `${plural(count, 'file')} attached so far. Send another, or continue to review.\n\n`
          : `Send up to ${MAX_ATTACHMENTS_PER_TASK} files, one at a time: screenshots, photos, PDFs or Word documents (.docx), up to ${MAX_ATTACHMENT_MB} MB each. ` +
            'They will be attached to this task.\n\n') +
        '_To send a file, tap the attachment icon, then Document._',
      footer: 'Almost done · You will review everything next',
      buttons: [
        { id: count > 0 ? 'att_done' : 'att_skip', title: count > 0 ? 'Continue to Review' : 'Skip to Review' },
        STEP_BACK_BUTTON,
      ],
    });
  }

  private async stepAddAttachment(to: string, normalized: string, session: Session): Promise<void> {
    if (normalized === 'att_skip' || normalized === 'att_done' || normalized === 'skip' || normalized === 'done') {
      await this.showAddConfirm(to, session);
      return;
    }
    await this.sendAttachmentStep(to, attachmentsFromSession(session.data).length);
  }

  private async stepAddAttachmentMedia(to: string, media: IncomingMedia): Promise<void> {
    const session = await this.sessions.get(to);
    const pending = attachmentsFromSession(session.data);
    const continueButton: ReplyButton = {
      id: pending.length > 0 ? 'att_done' : 'att_skip',
      title: pending.length > 0 ? 'Continue to Review' : 'Skip to Review',
    };

    if (!ALLOWED_ATTACHMENT_MIMES.has(media.mimeType)) {
      await this.client.sendMessage(to, {
        type: 'buttons',
        header: ADD_HEADER,
        text:
          `*${media.fileName || 'That file'}* can't be attached.\n\n` +
          'Send a photo or screenshot (JPG, PNG, WEBP, GIF), a PDF, or a Word document (.docx). ' +
          'Older .doc files need to be saved as .docx first.',
        buttons: [continueButton],
      });
      return;
    }

    if (pending.length >= MAX_ATTACHMENTS_PER_TASK) {
      await this.client.sendMessage(to, {
        type: 'buttons',
        header: ADD_HEADER,
        text: `This task already has the maximum of ${MAX_ATTACHMENTS_PER_TASK} files.`,
        buttons: [{ id: 'att_done', title: 'Continue to Review' }],
      });
      return;
    }

    const updated: PendingAttachment[] = [...pending, { mediaId: media.id, mimeType: media.mimeType, fileName: media.fileName }];
    await this.sessions.setData(to, 'attachments', JSON.stringify(updated));

    const remaining = MAX_ATTACHMENTS_PER_TASK - updated.length;
    await this.client.sendMessage(to, {
      type: 'buttons',
      header: ADD_HEADER,
      text:
        `*${kindOf(media.mimeType)} received*` +
        (media.fileName ? `\n${clip(media.fileName, 80)}` : '') +
        `\n\n${gauge(updated.length / MAX_ATTACHMENTS_PER_TASK, MAX_ATTACHMENTS_PER_TASK)}  ${updated.length} of ${MAX_ATTACHMENTS_PER_TASK} files\n\n` +
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
    const evidence = attachmentCount > 0 ? `\nEvidence: ${plural(attachmentCount, 'file')}` : '';
    const when = relativeDayName(draft.date, todayDateString());
    const dateLine = `Date: *${fmtDayShort(draft.date)}*${when ? ` (${when})` : ''}\n`;

    await this.sessions.setFlow(to, 'task_add_confirm');
    await this.client.sendMessage(to, {
      type: 'buttons',
      header: 'Review Task',
      text: `${dateLine}${card}${evidence}`,
      footer: 'Nothing is saved until you tap Save Task',
      buttons: REVIEW_BUTTONS,
    });
  }

  private async stepAddConfirm(to: string, user: User, normalized: string, session: Session): Promise<void> {
    if (normalized === 'confirm_yes') {
      await this.completeAddTask(to, user, session);
      return;
    }
    if (normalized === 'confirm_no') {
      // Discard is one tap from Save, so it asks before throwing work away.
      await this.askLeaveConfirm(to, session, 'menu');
      return;
    }
    await this.showAddConfirm(to, session);
  }

  private async completeAddTask(to: string, user: User, session: Session): Promise<void> {
    const draft = draftFromSession(session.data);

    try {
      const task = await this.tasks.createTask(this.actorFor(user), {
        date: draft.date,
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

  /** Downloads every file queued in the session and attaches each to the newly created task. */
  private async saveAttachmentsFromSession(taskId: string, user: User, session: Session): Promise<string> {
    const pending = attachmentsFromSession(session.data);
    if (pending.length === 0) return '';

    let saved = 0;
    const failures: string[] = [];
    for (const [index, att] of pending.entries()) {
      const label = att.fileName || `${kindOf(att.mimeType).toLowerCase()} ${index + 1}`;
      const media = await this.client.downloadMedia(att.mediaId);
      if (!media) {
        failures.push(label);
        continue;
      }
      const mimeType = media.mimeType || att.mimeType;
      if (!ALLOWED_ATTACHMENT_MIMES.has(mimeType)) {
        failures.push(`${label} (unsupported type)`);
        continue;
      }
      if (media.buffer.length > MAX_ATTACHMENT_BYTES) {
        failures.push(`${label} (over ${MAX_ATTACHMENT_MB} MB)`);
        continue;
      }
      try {
        // Keep a document's own name; give photos (which arrive unnamed) a readable one.
        const fileName =
          att.fileName && /\.[a-z0-9]+$/i.test(att.fileName)
            ? att.fileName
            : `${att.fileName || `whatsapp-${kindOf(mimeType).toLowerCase().replace(/\s+/g, '-')}-${index + 1}`}${extFromMime(mimeType)}`;
        await this.attachments.addFromBuffer(taskId, user.id, media.buffer, mimeType, fileName);
        saved++;
      } catch (err) {
        this.app.log.error({ err, taskId }, 'Saving WhatsApp attachment failed');
        failures.push(label);
      }
    }

    if (failures.length === 0) return `\nEvidence: ${plural(saved, 'file')} attached`;
    const failedList = failures.map((f) => clip(f, 60)).join(', ');
    if (saved === 0) return `\nEvidence: could not save ${failedList}. Add ${failures.length === 1 ? 'it' : 'them'} from the web portal.`;
    return `\nEvidence: ${plural(saved, 'file')} attached. Could not save ${failedList}.`;
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
