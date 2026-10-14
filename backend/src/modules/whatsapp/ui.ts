import { Organization, TaskCategory, TaskStatus, TaskVertical } from '../../shared/types/index.js';
import { CATEGORY_LABELS, ORGANIZATION_LABELS, STATUS_LABELS, VERTICAL_LABELS } from '../tasks/task-options.js';
import type { ListRow, ListSection } from './whatsapp.types.js';

/**
 * Presentation helpers for the WhatsApp task assistant: text gauges that stand
 * in for sliders (WhatsApp has no slider control), duration formatting, and
 * the short titles/hints shown on list rows. Plain Unicode shapes only - no
 * emoji - so it renders the same on every phone.
 */

const FILLED = '■';
const EMPTY = '□';

/** A text "slider track", e.g. gauge(0.3) -> ■■■□□□□□□□ */
export function gauge(fraction: number, cells = 10): string {
  const clamped = Math.min(1, Math.max(0, fraction));
  const filled = Math.round(clamped * cells);
  return FILLED.repeat(filled) + EMPTY.repeat(cells - filled);
}

/** 1.2 -> "1 h 12 min", 0.5 -> "30 min", 3 -> "3 h". */
export function formatDuration(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

// ── Step tracker ────────────────────────────────────────────────────────────

/** Position of each "Log New Task" step - one place to renumber when a step is added. */
export const STEP = {
  date: 1,
  vertical: 2,
  category: 3,
  organization: 4,
  description: 5,
  project: 6,
  status: 7,
  time: 8,
} as const;

export const TOTAL_STEPS = 8;

/** Footer for each "Log New Task" step, e.g. "■■■■□□□□  Step 4 of 8 · Organization". */
export function stepFooter(step: number, label: string): string {
  return `${gauge(step / TOTAL_STEPS, TOTAL_STEPS)}  Step ${step} of ${TOTAL_STEPS} · ${label}`;
}

// ── Time slider ─────────────────────────────────────────────────────────────

export const WORKDAY_HOURS = 8;

const HOUR_STOPS: Array<{ hours: number; hint: string }> = [
  { hours: 0.5, hint: 'Quick fix or follow-up' },
  { hours: 1, hint: 'One focused hour' },
  { hours: 1.5, hint: 'A short session' },
  { hours: 2, hint: 'Quarter of the day' },
  { hours: 3, hint: 'A solid block' },
  { hours: 4, hint: 'Half the day' },
  { hours: 5, hint: 'A long stretch' },
  { hours: 6, hint: 'Most of the day' },
  { hours: 8, hint: 'The full working day' },
];

export const HOURS_CUSTOM_ID = 'hrs_custom';

export function hourSliderRows(): ListRow[] {
  return [
    ...HOUR_STOPS.map(({ hours, hint }) => ({
      id: `hrs_${hours}`,
      title: formatDuration(hours),
      // One cell per half hour, so every stop on the track looks different.
      description: `${gauge(hours / WORKDAY_HOURS, WORKDAY_HOURS * 2)}  ${hint}`,
    })),
    { id: HOURS_CUSTOM_ID, title: 'Exact time', description: 'Type it yourself, for example 2h 15m or 2.25' },
  ];
}

/** Hours from a slider row id (hrs_1.5) or typed text (2.5, 2h 15m, 45m, 1:30). Null when unrecognised or outside 0-24. */
export function parseHours(input: string): number | null {
  const text = input.trim().toLowerCase();
  let hours: number | null = null;

  const fromRow = /^hrs_(\d+(?:\.\d+)?)$/.exec(text);
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(text);
  const units = /^(?:(\d+(?:[.,]\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:ins?|inutes?)?)?$/.exec(text);
  const plain = /^\d+(?:[.,]\d+)?$/.exec(text);

  if (fromRow) hours = Number(fromRow[1]);
  else if (clock) hours = Number(clock[1]) + Number(clock[2]) / 60;
  else if (plain) hours = Number(text.replace(',', '.'));
  else if (units && (units[1] || units[2])) {
    hours = Number((units[1] ?? '0').replace(',', '.')) + Number(units[2] ?? '0') / 60;
  }

  if (hours == null || !Number.isFinite(hours) || hours < 0 || hours > 24) return null;
  return Math.round(hours * 100) / 100;
}

// ── Progress slider ─────────────────────────────────────────────────────────

const PERCENT_STOPS: Array<{ pct: number; hint: string }> = [
  { pct: 0, hint: 'Not started yet' },
  { pct: 10, hint: 'Just getting going' },
  { pct: 25, hint: 'A quarter of the way' },
  { pct: 40, hint: 'Taking shape' },
  { pct: 50, hint: 'Halfway there' },
  { pct: 60, hint: 'Past the midpoint' },
  { pct: 75, hint: 'Three quarters done' },
  { pct: 90, hint: 'Final touches' },
  { pct: 100, hint: 'Complete' },
];

export const PERCENT_CUSTOM_ID = 'pct_custom';

export function percentSliderRows(): ListRow[] {
  return [
    ...PERCENT_STOPS.map(({ pct, hint }) => ({
      id: `pct_${pct}`,
      title: `${pct}%`,
      description: `${gauge(pct / 100)}  ${hint}`,
    })),
    { id: PERCENT_CUSTOM_ID, title: 'Exact value', description: 'Type any whole number from 0 to 100' },
  ];
}

/** Percent from a slider row id (pct_75) or typed text (75, 75%). Null when unrecognised or outside 0-100. */
export function parsePercent(input: string): number | null {
  const match = /^(?:pct_)?(\d{1,3}(?:\.\d+)?)\s*%?$/.exec(input.trim().toLowerCase());
  if (!match) return null;
  const pct = Number(match[1]);
  return Number.isFinite(pct) && pct >= 0 && pct <= 100 ? Math.round(pct) : null;
}

/** Statuses where progress is genuinely partial, so it's worth asking for. */
export function statusNeedsProgress(status: TaskStatus): boolean {
  return status === TaskStatus.IN_PROGRESS || status === TaskStatus.BLOCKED || status === TaskStatus.ESCALATED;
}

// ── Row titles and hints ────────────────────────────────────────────────────
// List row titles cap at 24 characters and descriptions at 72, so the long
// spreadsheet labels get a short title plus a one-line hint.

const VERTICAL_HINTS: Record<TaskVertical, string> = {
  APPLICATIONS_DATABASES: 'Business applications, databases and integrations',
  INFRASTRUCTURE: 'Compute and storage: servers, virtualisation, backup',
  NETWORKING: 'LAN and WAN: switching, routing, wireless, links',
  POWER_SOLUTIONS: 'UPS, generators and power distribution',
  CYBERSECURITY: 'Firewalls, endpoint protection and access control',
  FINANCE: 'Accounts, payments and financial reporting',
  LOGISTICS: 'Procurement, deliveries and inventory',
  BIDS: 'Tenders, RFPs and proposals',
  ACCOUNT_MANAGEMENT: 'Client relationships and renewals',
  TECHNICAL_PRESALES: 'Solution design, demos and sizing',
  PROJECT_MANAGEMENT: 'Planning, tracking and delivery',
  ADMINISTRATION: 'Office and internal operations',
  ERP_BUSINESS_APPLICATIONS: 'ERP, CRM and line-of-business systems',
  CLOUD_SERVICES: 'Public, private and hybrid cloud',
  DATA_ANALYTICS: 'BI, dashboards and data platforms',
  HUMAN_RESOURCES: 'People, recruitment and staff welfare',
};

const CATEGORY_HINTS: Record<TaskCategory, string> = {
  DEPLOYMENT: 'Installing or rolling out a new system',
  SUPPORT_BREAK_FIX: 'Fixing a fault or responding to an incident',
  PROOF_OF_CONCEPT: 'Trialling a solution with a client',
  MAINTENANCE_UPGRADE: 'Patching, upgrades and routine care',
  DESIGN_ARCHITECTURE: 'Planning and designing a solution',
  RECEIVABLES: 'Invoicing and collecting payments',
  PAYABLES: 'Paying suppliers and processing bills',
  RECONCILIATIONS: 'Matching accounts and statements',
  STATUTORY: 'Tax, compliance and regulatory filings',
  REPORTING: 'Preparing reports and summaries',
  INTRODUCTION: 'First contact with a prospect',
  QUALIFICATION: 'Assessing a lead or opportunity',
  SUBMISSION: 'Sending a proposal or bid',
  TRAINING: 'Delivering or attending training',
  DOCUMENTATION: 'Writing guides, runbooks or records',
  MIGRATION: 'Moving systems or data',
  AUDIT_COMPLIANCE: 'Audits, reviews and policy checks',
  TENDER: 'Preparing or tracking a tender',
  CUSTOMER_MEETING: 'Meeting or call with a customer',
  PREQUALIFICATION: 'Supplier registration and prequalification',
  WORKSHOP: 'Running or attending a workshop',
};

const STATUS_HINTS: Record<TaskStatus, string> = {
  NOT_STARTED: 'Planned, work has not begun',
  IN_PROGRESS: 'Work is under way',
  RESOLVED: 'Issue fixed, awaiting closure',
  BLOCKED: 'Waiting on something before it can continue',
  COMPLETED_CLOSED: 'Finished and signed off',
  ESCALATED: 'Handed up for further action',
};

/** "13. ERP & Business Applications" -> "ERP & Business Apps"; drops the number and any bracketed detail. */
export function verticalTitle(vertical: TaskVertical): string {
  if (vertical === TaskVertical.ERP_BUSINESS_APPLICATIONS) return 'ERP & Business Apps';
  return clip(
    VERTICAL_LABELS[vertical].replace(/^\d+\.\s*/, '').replace(/\s*\(.*\)$/, ''),
    24
  );
}

/** "Millenium Solutions E.A Limited" -> "Millenium Solutions". */
export function organizationShortName(org: Organization): string {
  return ORGANIZATION_LABELS[org].replace(/\s+(E\.A\s+)?Limited$/, '');
}

export function verticalRow(vertical: TaskVertical): ListRow {
  return { id: `vert_${vertical}`, title: verticalTitle(vertical), description: VERTICAL_HINTS[vertical] };
}

export function categoryRow(category: TaskCategory): ListRow {
  return { id: `cat_${category}`, title: clip(CATEGORY_LABELS[category], 24), description: CATEGORY_HINTS[category] };
}

export function statusRow(status: TaskStatus): ListRow {
  return { id: `status_${status}`, title: STATUS_LABELS[status], description: STATUS_HINTS[status] };
}

export function organizationRow(org: Organization, description = ORGANIZATION_LABELS[org]): ListRow {
  return { id: `org_${org}`, title: clip(organizationShortName(org), 24), description };
}

// ── Paged pickers ───────────────────────────────────────────────────────────

// WhatsApp lists hold at most 10 rows in total, so a middle page needs room
// for 8 options plus both "Previous" and "More" rows.
const PAGE_SIZE = 8;

/**
 * One page of a long picker as list sections: the options under a
 * "Verticals 1-8 of 16" heading, then a separate "Browse" section for paging.
 */
export function pagedSections<T extends string>(
  values: readonly T[],
  page: number,
  prefix: string,
  noun: string,
  rowFor: (value: T) => ListRow
): ListSection[] {
  const lastPage = Math.max(0, Math.ceil(values.length / PAGE_SIZE) - 1);
  const current = Math.min(Math.max(0, page), lastPage);
  const start = current * PAGE_SIZE;
  const slice = values.slice(start, start + PAGE_SIZE);

  const sections: ListSection[] = [
    { title: clip(`${noun} ${start + 1}-${start + slice.length} of ${values.length}`, 24), rows: slice.map(rowFor) },
  ];

  const nav: ListRow[] = [];
  if (current < lastPage) {
    const remaining = values.length - (start + slice.length);
    nav.push({ id: `${prefix}_next`, title: 'Show more', description: `${remaining} more ${noun.toLowerCase()}` });
  }
  if (current > 0) nav.push({ id: `${prefix}_prev`, title: 'Previous page', description: 'Go back to the earlier options' });
  if (nav.length > 0) sections.push({ title: 'Browse', rows: nav });

  return sections;
}

// ── Dates and the calendar picker ───────────────────────────────────────────
// Dates are plain "YYYY-MM-DD" strings for the Nairobi calendar day - the day
// a task is logged against - so no timezone drift creeps in near midnight.

const NAIROBI = 'Africa/Nairobi';
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Today's date in Nairobi, as YYYY-MM-DD. */
export function nairobiToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: NAIROBI, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function isoToUtcNoon(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`);
}

export function addDays(iso: string, days: number): string {
  const d = isoToUtcNoon(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((isoToUtcNoon(to).getTime() - isoToUtcNoon(from).getTime()) / 86_400_000);
}

/** "Tue 14 Oct" */
export function fmtDayShort(iso: string): string {
  return isoToUtcNoon(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** "Tuesday 14 October" */
export function fmtDayLong(iso: string): string {
  return isoToUtcNoon(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

/** "today", "yesterday", "tomorrow", or null for any other day. */
export function relativeDayName(iso: string, today: string): string | null {
  const diff = daysBetween(today, iso);
  if (diff === 0) return 'today';
  if (diff === -1) return 'yesterday';
  if (diff === 1) return 'tomorrow';
  return null;
}

/**
 * A month grid in monospace, Monday first. Today is bracketed and days that
 * already have tasks carry a dot, e.g.
 *
 *     October 2026
 *     Mo  Tu  We  Th  Fr  Sa  Su
 *               1   2   3   4•
 *     ...
 *     12• 13•[14] 15  16  17  18
 */
export function monthCalendar(today: string, loggedDays: Set<string>): string {
  const [year, month] = today.split('-').map(Number);
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = (isoToUtcNoon(first).getUTCDay() + 6) % 7; // Monday = 0

  const cell = (day: number) => {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dd = String(day).padStart(2, ' ');
    if (iso === today) return `[${dd}]`;
    return ` ${dd}${loggedDays.has(iso) ? '•' : ' '}`;
  };

  const cells = [...Array(lead).fill('    '), ...Array.from({ length: daysInMonth }, (_, i) => cell(i + 1))];
  const weeks: string[] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7).join('').replace(/\s+$/, ''));

  const title = isoToUtcNoon(first).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return ['```', title, ' Mo  Tu  We  Th  Fr  Sa  Su', ...weeks, '```'].join('\n');
}

export const DATE_OTHER_ID = 'date_other';

/** The picker rows: today, yesterday, tomorrow, then the five days before yesterday, each with its task count. */
export function dateRows(today: string, counts: Map<string, number>): ListSection[] {
  const describe = (iso: string) => {
    const n = counts.get(iso) ?? 0;
    return `${fmtDayLong(iso)} · ${n === 0 ? 'nothing logged yet' : `${n} task${n === 1 ? '' : 's'} logged`}`;
  };
  const quick = [
    { iso: today, title: 'Today' },
    { iso: addDays(today, -1), title: 'Yesterday' },
    { iso: addDays(today, 1), title: 'Tomorrow' },
  ];
  const earlier = [2, 3, 4, 5, 6].map((n) => addDays(today, -n));

  return [
    { title: 'Quick picks', rows: quick.map((q) => ({ id: `date_${q.iso}`, title: q.title, description: describe(q.iso) })) },
    { title: 'Earlier days', rows: earlier.map((iso) => ({ id: `date_${iso}`, title: fmtDayShort(iso), description: describe(iso) })) },
    { title: 'Any other day', rows: [{ id: DATE_OTHER_ID, title: 'Other date', description: 'Type it, for example 05/10/2026 or 5 Oct' }] },
  ];
}

/**
 * A date from a picker row id (date_2026-10-14) or typed text: today /
 * yesterday / tomorrow, 14/10, 14/10/2026, 14-10-2026, 2026-10-14, 14 Oct,
 * Oct 14 or 14 October 2026. Day-first, as dates are written in Kenya.
 * Null when it isn't a real calendar date.
 */
export function parseDateInput(input: string, today: string): string | null {
  const text = input.trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/,/g, ' ').replace(/\s+/g, ' ');
  const [thisYear] = today.split('-').map(Number);

  const words: Record<string, number> = { today: 0, yesterday: -1, tomorrow: 1 };
  if (text in words) return addDays(today, words[text]);

  let y: number | undefined;
  let m: number | undefined;
  let d: number | undefined;

  const fromRow = /^date_(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const isoLike = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const numeric = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(text);
  const dayMonth = /^(\d{1,2}) ([a-z]{3,9})(?: (\d{4}))?$/.exec(text);
  const monthDay = /^([a-z]{3,9}) (\d{1,2})(?: (\d{4}))?$/.exec(text);
  const monthIndex = (name: string) => MONTHS.findIndex((mn) => mn.startsWith(name)) + 1;

  if (fromRow) [y, m, d] = [Number(fromRow[1]), Number(fromRow[2]), Number(fromRow[3])];
  else if (isoLike) [y, m, d] = [Number(isoLike[1]), Number(isoLike[2]), Number(isoLike[3])];
  else if (numeric) {
    d = Number(numeric[1]);
    m = Number(numeric[2]);
    y = numeric[3] ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : thisYear;
  } else if (dayMonth && monthIndex(dayMonth[2]) > 0) {
    d = Number(dayMonth[1]);
    m = monthIndex(dayMonth[2]);
    y = dayMonth[3] ? Number(dayMonth[3]) : thisYear;
  } else if (monthDay && monthIndex(monthDay[1]) > 0) {
    m = monthIndex(monthDay[1]);
    d = Number(monthDay[2]);
    y = monthDay[3] ? Number(monthDay[3]) : thisYear;
  }

  if (!y || !m || !d) return null;
  const candidate = new Date(Date.UTC(y, m - 1, d));
  // Rejects 31/02 and similar, which Date would otherwise roll into the next month.
  if (candidate.getUTCFullYear() !== y || candidate.getUTCMonth() !== m - 1 || candidate.getUTCDate() !== d) return null;
  return candidate.toISOString().slice(0, 10);
}

/** Time-of-day greeting in Nairobi time, where the team works. */
export function greeting(now = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Africa/Nairobi' }).format(now)
  );
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
