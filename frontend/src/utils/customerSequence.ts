import { WorkTask } from '@/types/api';

/**
 * A staff member can log more than one task for the same customer/project on
 * the same day (e.g. three separate "Kenya Power" entries). This builds a
 * "thread" for each such cluster - display-only, nothing is persisted -
 * used by TaskTableRow to render a colored initials avatar, a "2 of 3 today"
 * badge, and a matching colored rail down the row, so the cluster reads as
 * one connected group at a glance instead of three unrelated-looking rows.
 *
 * Grouped by (userId, date, customerProject) so Team Tasks - which mixes
 * multiple people - threads each person's entries independently. Position
 * follows creation order (earliest logged = 1 of N), not the table's
 * display order (which sorts newest-first). Only built when a group has more
 * than one entry - a lone task for a customer that day gets no thread.
 */

export type GroupHue = 'violet' | 'teal' | 'pink' | 'indigo' | 'cyan';
const GROUP_HUES: GroupHue[] = ['violet', 'teal', 'pink', 'indigo', 'cyan'];

export interface CustomerGroupInfo {
  position: number; // 1-based, in creation order
  total: number;
  hue: GroupHue;
  initials: string;
}

/** Simple deterministic string hash - just needs to spread customer names across the hue palette. */
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function buildCustomerGroups(tasks: WorkTask[]): Map<string, CustomerGroupInfo> {
  const groups = new Map<string, WorkTask[]>();

  for (const task of tasks) {
    const customer = task.customerProject?.trim();
    if (!customer) continue;
    const key = `${task.userId}|${task.date.slice(0, 10)}|${customer.toLowerCase()}`;
    const group = groups.get(key);
    if (group) group.push(task);
    else groups.set(key, [task]);
  }

  const result = new Map<string, CustomerGroupInfo>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const customer = ordered[0].customerProject!.trim();
    const hue = GROUP_HUES[hashString(customer.toLowerCase()) % GROUP_HUES.length];
    const initials = initialsOf(customer);
    ordered.forEach((task, index) => {
      result.set(task.id, { position: index + 1, total: ordered.length, hue, initials });
    });
  }

  return result;
}
