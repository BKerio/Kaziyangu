import { TaskStatus } from '@/types/api';

/** Pill color class for a task status badge. */
export function statusPillClass(status: TaskStatus): string {
  switch (status) {
    case 'RESOLVED':
    case 'COMPLETED_CLOSED':
      return 'pill pill-green';
    case 'IN_PROGRESS':
      return 'pill pill-blue';
    case 'BLOCKED':
      return 'pill pill-red';
    case 'ESCALATED':
      return 'pill pill-gold';
    case 'NOT_STARTED':
    default:
      return 'pill pill-gray';
  }
}
