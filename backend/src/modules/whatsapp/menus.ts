import type { ListRow, ListSection, ReplyButton } from './whatsapp.types.js';

export const MENU_TRIGGERS = new Set(['hi', 'hello', 'hey', 'start', 'menu', '0', 'help']);

export const ASSISTANT_NAME = 'Task Assistant';
export const MENU_FOOTER = 'Millenium Solutions · Type menu at any time';
export const MAIN_MENU_TEXT = 'What would you like to do?';

/**
 * Grouped under labeled headings so the menu reads as three clear actions
 * (view, manage, account) rather than one flat list of six rows.
 */
export const MAIN_MENU_SECTIONS: ListSection[] = [
  {
    title: 'Manage Tasks',
    rows: [
      {
        id: 'task_add',
        title: 'Log New Task',
        description: 'Record what you worked on, step by step',
      },
      {
        id: 'task_update',
        title: 'Update Task',
        description: 'Change status, progress, time or blockers on a task from today',
      },
    ],
  },
  {
    title: 'View Tasks',
    rows: [
      {
        id: 'tasks_today',
        title: "Today's Tasks",
        description: "Everything you've logged today, with time and progress",
      },
      {
        id: 'tasks_week',
        title: 'This Week',
        description: 'Your full task log for the week, day by day',
      },
    ],
  },
  {
    title: 'Account',
    rows: [
      {
        id: 'my_profile',
        title: 'My Profile',
        description: 'Your name, phone, department and role',
      },
      {
        id: 'help',
        title: 'Help',
        description: 'What each option does and how to move around',
      },
    ],
  },
];

/** Flattened row list - used where a plain id lookup is needed rather than the grouped display. */
export const MAIN_MENU_ROWS: ListRow[] = MAIN_MENU_SECTIONS.flatMap((section) => section.rows);

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
