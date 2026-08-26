import type { ListRow, ListSection, ReplyButton } from './whatsapp.types.js';

export const MENU_TRIGGERS = new Set(['hi', 'hello', 'hey', 'start', 'menu', '0', 'help']);

export const MAIN_MENU_TEXT = 'Choose an option below to view, log, or update your daily tasks.';

/**
 * Grouped under labeled headings so the menu reads as three clear actions
 * (view, manage, account) rather than one flat list of six rows.
 */
export const MAIN_MENU_SECTIONS: ListSection[] = [
  {
    title: 'View Tasks',
    rows: [
      {
        id: 'tasks_today',
        title: "Today's Tasks",
        description: "See everything you've logged today, with hours and status",
      },
      {
        id: 'tasks_week',
        title: 'This Week',
        description: 'Review your full task log for the week, day by day',
      },
    ],
  },
  {
    title: 'Manage Tasks',
    rows: [
      {
        id: 'task_add',
        title: 'Log New Task',
        description: 'Record a new task: vertical, category, status, and hours',
      },
      {
        id: 'task_update',
        title: 'Update Task',
        description: 'Edit the status, progress, or blockers on a task from today',
      },
    ],
  },
  {
    title: 'Account',
    rows: [
      {
        id: 'my_profile',
        title: 'My Profile',
        description: 'View your name, phone, department, and role',
      },
      {
        id: 'help',
        title: 'Help',
        description: 'See what each option does and how to navigate the assistant',
      },
    ],
  },
];

/** Flattened row list - used where a plain id lookup is needed rather than the grouped display. */
export const MAIN_MENU_ROWS: ListRow[] = MAIN_MENU_SECTIONS.flatMap((section) => section.rows);

export const BACK_BUTTON: ReplyButton = { id: 'main_menu', title: 'Main Menu' };
export const YES_NO_BUTTONS: ReplyButton[] = [
  { id: 'confirm_yes', title: 'Yes, Save' },
  { id: 'confirm_no', title: 'Cancel' },
  BACK_BUTTON,
];

export const UPDATE_FIELD_BUTTONS: ReplyButton[] = [
  { id: 'upd_status', title: 'Status' },
  { id: 'upd_progress', title: 'Progress %' },
  { id: 'upd_blockers', title: 'Blockers' },
  BACK_BUTTON,
];

export function helpText(portalUrl: string): string {
  return (
    '*Task Assistant Help*\n\n' +
    'Type *menu* or *hi* at any time to see your options.\n\n' +
    "*Today's Tasks*: view what you logged today\n" +
    "*This Week*: review this week's entries\n" +
    '*Log New Task*: record vertical, category, description, and status\n' +
    '*Update Task*: change status, progress, or blockers\n\n' +
    'Type *back* or *cancel* at any step to return to the menu.\n\n' +
    `For the full editor, visit ${portalUrl}.`
  );
}

export function unregisteredText(portalUrl: string): string {
  return (
    '*Staff profile not found*\n\n' +
    'This WhatsApp number is not linked to a staff profile.\n\n' +
    `Please sign in at ${portalUrl} and add this number under *My Profile*, or ask your administrator to set it for you.`
  );
}
