import { CATEGORY_LABELS, STATUS_LABELS, VERTICAL_LABELS } from '../tasks/task-options.js';
import { TaskCategory, TaskStatus, TaskVertical } from '../../shared/types/index.js';

interface FormattableTask {
  taskVertical?: TaskVertical;
  vertical?: TaskVertical;
  taskCategory?: TaskCategory;
  category?: TaskCategory;
  description: string;
  status: TaskStatus;
  hoursSpent: number | null;
  percentComplete: number;
  customerProject?: string | null;
  blockersNotes?: string | null;
}

/** Renders a WorkTask row as a WhatsApp message block, optionally numbered. */
export function formatTaskSummary(task: FormattableTask, index?: number): string {
  const vertical = (task.vertical ?? task.taskVertical) as TaskVertical;
  const category = (task.category ?? task.taskCategory) as TaskCategory;
  const prefix = index != null ? `${index}. ` : '';

  const lines = [
    `${prefix}*${CATEGORY_LABELS[category]}*`,
    `Vertical: ${VERTICAL_LABELS[vertical]}`,
    `Status: *${STATUS_LABELS[task.status]}* (${task.percentComplete}%)`,
    task.hoursSpent != null && task.hoursSpent > 0 ? `Hours: ${task.hoursSpent}` : null,
    task.customerProject ? `Project: ${task.customerProject}` : null,
    `Notes: ${task.description}`,
    task.blockersNotes ? `Blockers: ${task.blockersNotes}` : null,
  ].filter((line): line is string => Boolean(line));

  return lines.join('\n');
}
