import { CATEGORY_LABELS, ORGANIZATION_LABELS, STATUS_LABELS } from '../tasks/task-options.js';
import { Organization, TaskCategory, TaskStatus, TaskVertical } from '../../shared/types/index.js';
import { formatDuration, gauge, verticalTitle } from './ui.js';

interface FormattableTask {
  taskVertical?: TaskVertical;
  vertical?: TaskVertical;
  taskCategory?: TaskCategory;
  category?: TaskCategory;
  description: string;
  status: TaskStatus;
  hoursSpent: number | null;
  percentComplete: number;
  organization?: Organization | null;
  customerProject?: string | null;
  blockersNotes?: string | null;
}

/** Renders a WorkTask row as a WhatsApp task card, optionally numbered. */
export function formatTaskSummary(task: FormattableTask, index?: number): string {
  const vertical = (task.vertical ?? task.taskVertical) as TaskVertical;
  const category = (task.category ?? task.taskCategory) as TaskCategory;
  const prefix = index != null ? `${index}. ` : '';

  const lines = [
    `${prefix}*${CATEGORY_LABELS[category]}*  ·  ${verticalTitle(vertical)}`,
    task.organization ? `_${ORGANIZATION_LABELS[task.organization]}_` : null,
    `Status: *${STATUS_LABELS[task.status]}*`,
    `Progress: ${gauge(task.percentComplete / 100)} ${task.percentComplete}%`,
    task.hoursSpent != null && task.hoursSpent > 0 ? `Time: ${formatDuration(task.hoursSpent)}` : null,
    task.customerProject ? `Project: ${task.customerProject}` : null,
    `Notes: ${task.description}`,
    task.blockersNotes ? `Blockers: ${task.blockersNotes}` : null,
  ].filter((line): line is string => Boolean(line));

  return lines.join('\n');
}
