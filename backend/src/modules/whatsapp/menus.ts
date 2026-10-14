import type { ListSection, ReplyButton } from './whatsapp.types.js';
import { clip, formatDuration, gauge, WORKDAY_HOURS } from './ui.js';

export const MENU_TRIGGERS = new Set(['hi', 'hello', 'hey', 'start', 'menu', '0', 'help']);

export const ASSISTANT_NAME = 'Task Assistant';
export const MENU_FOOTER = 'Millenium Solutions · Type menu at any time';
export const MAIN_MENU_TEXT = 'Tap *Open Menu* to choose what to do next.';

export const WORKWEEK_HOURS = WORKDAY_HOURS * 5;

/** Every id the main menu can send back, whether or not that row is showing right now. */
export const MAIN_MENU_ACTION_IDS = ['task_add', 'task_repeat', 'task_update', 'tasks_today', 'tasks_week', 'my_profile', 'help', 'main_menu'];

/** Live figures the menu rows are built from, so each option previews what's behind it. */
export interface MenuSnapshot {
  todayCount: number;
  todayHours: number;
  weekCount: number;
  weekHours: number;
  /** "Deployment · Millenium Solutions", when there's a previous task to repeat. */
  lastTaskLabel: string | null;
  roleLine: string;
}

/**
 * The main menu, rebuilt on every open: grouped into quick actions, your
 * progress and your account, with each row's description showing live data
 * (time logged, tasks ready to update) rather than static help text.
 */
export function mainMenuSections(s: MenuSnapshot): ListSection[] {
  const quick: ListSection = {
    title: 'Quick actions',
    rows: [
      { id: 'task_add', title: 'Log New Task', description: 'Seven quick steps, about a minute' },
      ...(s.lastTaskLabel
        ? [{ id: 'task_repeat', title: 'Repeat Last Task', description: clip(`Same setup as ${s.lastTaskLabel}`, 72) }]
        : []),
      {
        id: 'task_update',
        title: 'Update Task',
        description:
          s.todayCount > 0
            ? `${s.todayCount} task${s.todayCount === 1 ? '' : 's'} from today ready to update`
            : 'Log a task first, then update it here',
      },
    ],
  };

  const progress: ListSection = {
    title: 'Your progress',
    rows: [
      {
        id: 'tasks_today',
        title: "Today's Tasks",
        description:
          s.todayCount > 0
            ? `${gauge(s.todayHours / WORKDAY_HOURS)}  ${formatDuration(s.todayHours)} · ${s.todayCount} task${s.todayCount === 1 ? '' : 's'}`
            : 'Nothing logged yet today',
      },
      {
        id: 'tasks_week',
        title: 'This Week',
        description: `${gauge(s.weekHours / WORKWEEK_HOURS)}  ${formatDuration(s.weekHours)} of ${WORKWEEK_HOURS} h`,
      },
    ],
  };

  const account: ListSection = {
    title: 'Account',
    rows: [
      { id: 'my_profile', title: 'My Profile', description: s.roleLine },
      { id: 'help', title: 'Help', description: 'How each option works, plus handy shortcuts' },
    ],
  };

  return [quick, progress, account];
}

/** One line on where the day stands, shown under the greeting. */
export function dayNudge(s: MenuSnapshot): string {
  if (s.todayCount === 0) return 'Nothing logged yet today. *Log New Task* takes about a minute.';
  if (s.todayHours >= WORKDAY_HOURS) return 'A full day logged. Great work.';
  return `${formatDuration(WORKDAY_HOURS - s.todayHours)} to go for a full day.`;
}

export const BACK_BUTTON: ReplyButton = { id: 'main_menu', title: 'Main Menu' };

export const REVIEW_BUTTONS: ReplyButton[] = [
  { id: 'confirm_yes', title: 'Save Task' },
  { id: 'confirm_restart', title: 'Start Over' },
  { id: 'confirm_no', title: 'Discard' },
];

export function helpText(portalUrl: string): string {
  return (
    '*How the Task Assistant works*\n\n' +
    '*Log New Task*\nSeven quick steps: vertical, category, organization, description, project, status and time. ' +
    'Pick from the lists, and use the sliders to set time and progress in one tap.\n\n' +
    '*Update Task*\nChange the status, progress, time, organization or blockers on anything logged today.\n\n' +
    '*Repeat Last Task*\nStarts a new task with the same vertical, category, organization and project as your last one, so you only describe the work.\n\n' +
    "*Today's Tasks* and *This Week*\nSee what you've logged, with totals.\n\n" +
    'Type *menu* at any time to start again, or *cancel* to leave a step.\n\n' +
    `For the full editor, visit ${portalUrl}`
  );
}

export function unregisteredText(portalUrl: string): string {
  return (
    '*Staff profile not found*\n\n' +
    'This WhatsApp number is not linked to a staff profile.\n\n' +
    `Sign in at ${portalUrl} and add this number under *My Profile*, or ask your administrator to add it for you.`
  );
}
