import { Organization, TaskCategory, TaskStatus, TaskVertical } from '../../shared/types/index.js';

/**
 * Human-readable labels for the task taxonomy enums, matching the source
 * spreadsheet's "Validation" sheet verbatim. Single source of truth for the
 * `/tasks/options` endpoint the frontend uses to populate dropdowns.
 */
export const VERTICAL_LABELS: Record<TaskVertical, string> = {
  APPLICATIONS_DATABASES: '1. Applications & Databases',
  INFRASTRUCTURE: '2. Infrastructure (Compute & Storage)',
  NETWORKING: '3. Networking (LAN & WAN)',
  POWER_SOLUTIONS: '4. Power Solutions',
  CYBERSECURITY: '5. Cybersecurity Solutions',
  FINANCE: '6. Finance',
  LOGISTICS: '7. Logistics',
  BIDS: '8. Bids',
  ACCOUNT_MANAGEMENT: '9. Account Management',
  TECHNICAL_PRESALES: '10. Technical Presales',
  PROJECT_MANAGEMENT: '11. Project Management',
  ADMINISTRATION: '12. Administration',
};

export const CATEGORY_LABELS: Record<TaskCategory, string> = {
  DEPLOYMENT: 'Deployment',
  SUPPORT_BREAK_FIX: 'Support (Break/Fix)',
  PROOF_OF_CONCEPT: 'Proof of Concept (POC)',
  MAINTENANCE_UPGRADE: 'Maintenance / Upgrade',
  DESIGN_ARCHITECTURE: 'Design/Architecture',
  RECEIVABLES: 'Receivables',
  PAYABLES: 'Payables',
  RECONCILIATIONS: 'Reconciliations',
  STATUTORY: 'Statutory',
  REPORTING: 'Reporting',
  INTRODUCTION: 'Introduction',
  QUALIFICATION: 'Qualification',
  SUBMISSION: 'Submission',
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  NOT_STARTED: 'Not Started',
  IN_PROGRESS: 'In Progress',
  RESOLVED: 'Resolved',
  BLOCKED: 'Blocked',
  COMPLETED_CLOSED: 'Completed / Closed',
  ESCALATED: 'Escalated',
};

export const ORGANIZATION_LABELS: Record<Organization, string> = {
  MILLENIUM_SOLUTIONS: 'Millenium Solutions E.A Limited',
  BRESTONE_AFRICA: 'Brestone Africa Limited',
  BRIGHTON_TECHNOLOGIES: 'Brighton Technologies Limited',
  MIRACOM_AFRICA: 'Miracom Africa Limited',
  TRANSBIZ: 'Transbiz Limited',
  BIGHATCH: 'Bighatch Limited',
};

function asOptions<T extends string>(labels: Record<T, string>): Array<{ value: T; label: string }> {
  return (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
}

export function getTaskOptions() {
  return {
    verticals: asOptions(VERTICAL_LABELS),
    categories: asOptions(CATEGORY_LABELS),
    statuses: asOptions(STATUS_LABELS),
    organizations: asOptions(ORGANIZATION_LABELS),
  };
}

/** Statuses that count as "done" for the weekly completed-task counts. */
export const COMPLETED_STATUSES: TaskStatus[] = [TaskStatus.RESOLVED, TaskStatus.COMPLETED_CLOSED];
