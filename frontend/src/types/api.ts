export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'STAFF' | 'ATTACHEE';

export interface MicrosoftCalendarEvent {
  id: string;
  subject: string;
  start: string;
  end: string;
  isAllDay: boolean;
  location: string | null;
  webLink: string;
}

export interface TeamRosterMember {
  id: string;
  name: string;
  /** Whether this person has ever actually signed in - vs. just having an active account. */
  hasLoggedIn: boolean;
  /** Snapshot at fetch time - overlay live presence:update events on top of this, don't rely on it alone. */
  isOnline: boolean;
}

export type Department = 'TECHNICAL' | 'BUSINESS_DEVELOPMENT' | 'FINANCE' | 'COMMERCIAL' | 'ADMIN';

export const DEPARTMENT_OPTIONS: { value: Department; label: string }[] = [
  { value: 'TECHNICAL', label: 'Technical' },
  { value: 'BUSINESS_DEVELOPMENT', label: 'Business Development' },
  { value: 'FINANCE', label: 'Finance' },
  { value: 'COMMERCIAL', label: 'Commercial' },
  { value: 'ADMIN', label: 'Admin' },
];

export type TaskVertical =
  | 'APPLICATIONS_DATABASES'
  | 'INFRASTRUCTURE'
  | 'NETWORKING'
  | 'POWER_SOLUTIONS'
  | 'CYBERSECURITY'
  | 'FINANCE'
  | 'LOGISTICS'
  | 'BIDS'
  | 'ACCOUNT_MANAGEMENT'
  | 'TECHNICAL_PRESALES'
  | 'PROJECT_MANAGEMENT'
  | 'ADMINISTRATION';

export type TaskCategory =
  | 'DEPLOYMENT'
  | 'SUPPORT_BREAK_FIX'
  | 'PROOF_OF_CONCEPT'
  | 'MAINTENANCE_UPGRADE'
  | 'DESIGN_ARCHITECTURE'
  | 'RECEIVABLES'
  | 'PAYABLES'
  | 'RECONCILIATIONS'
  | 'STATUTORY'
  | 'REPORTING'
  | 'INTRODUCTION'
  | 'QUALIFICATION'
  | 'SUBMISSION';

export type TaskStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'RESOLVED'
  | 'BLOCKED'
  | 'COMPLETED_CLOSED'
  | 'ESCALATED';

export type Organization =
  | 'MILLENIUM_SOLUTIONS'
  | 'BRESTONE_AFRICA'
  | 'BRIGHTON_TECHNOLOGIES'
  | 'MIRACOM_AFRICA'
  | 'TRANSBIZ'
  | 'BIGHATCH';

export interface User {
  id: string;
  email: string;
  name: string;
  phone?: string;
  role: Role;
  isActive: boolean;
  department?: Department | null;
  createdAt: string;
  updatedAt?: string;
  _count?: { tasks: number };
}

export interface PaginatedMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginatedMeta;
}

export interface WorkTask {
  id: string;
  date: string;
  vertical: TaskVertical;
  category: TaskCategory;
  description: string;
  organization?: Organization | null;
  customerProject?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  hoursSpent: number;
  status: TaskStatus;
  percentComplete: number;
  keyDeliverable?: string | null;
  blockersNotes?: string | null;
  createdAt: string;
  updatedAt: string;
  userId: string;
  user: { id: string; name: string };
  _count?: { attachments: number };
}

export interface TaskAttachment {
  id: string;
  taskId: string;
  fileName: string;
  mimeType: string;
  bytes: number;
  createdAt: string;
  uploadedById: string;
}

export interface TaskOption<T extends string = string> {
  value: T;
  label: string;
}

export interface TaskOptions {
  verticals: TaskOption<TaskVertical>[];
  categories: TaskOption<TaskCategory>[];
  statuses: TaskOption<TaskStatus>[];
  organizations: TaskOption<Organization>[];
}

export type TimeBalanceLabel = 'narrow' | 'focused' | 'balanced' | 'well_rounded' | 'none';

export interface MyTimeStats {
  from: string;
  to: string;
  totalHours: number;
  taskCount: number;
  balanceScore: number;
  balanceLabel: TimeBalanceLabel;
  insight: string;
  topVertical: { vertical: TaskVertical; hours: number; sharePct: number } | null;
  topCategory: { category: TaskCategory; hours: number; sharePct: number } | null;
  byVertical: Array<{ vertical: TaskVertical; hours: number; sharePct: number }>;
  byCategory: Array<{ category: TaskCategory; hours: number; sharePct: number }>;
  neglectedVerticals: TaskVertical[];
}

export interface ResourceWeeklyRow {
  userId: string;
  name: string;
  hoursByDay: { mon: number; tue: number; wed: number; thu: number; fri: number };
  totalWeeklyHours: number;
  utilizationPct: number;
  tasksCompleted: number;
}

export interface ResourceWeeklyReport {
  weekStart: string;
  rows: ResourceWeeklyRow[];
}

export interface VerticalWeeklyRow {
  vertical: TaskVertical;
  totalHours: number;
  taskCount: number;
  deploymentHours: number;
  supportHours: number;
  pocHours: number;
  topEngineer: string | null;
}

export interface VerticalWeeklySummary {
  weekStart: string;
  rows: VerticalWeeklyRow[];
}

// ── Attachment management ────────────────────────────────────────────────────

export type AttendanceStatus = 'PRESENT' | 'LATE' | 'HALF_DAY' | 'ON_LEAVE' | 'ABSENT';
export type WorkMode = 'ON_SITE' | 'REMOTE' | 'HYBRID';
export type ReportStatus = 'PENDING' | 'APPROVED' | 'NEEDS_REVISION' | 'REJECTED';

export interface Attachee {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: 'ATTACHEE';
  isActive: boolean;
  registrationNo: string | null;
  course: string | null;
  department: Department | null;
  organization: string | null;
  supervisorId: string | null;
  supervisor: { id: string; name: string; email: string } | null;
  attachmentStart: string | null;
  attachmentEnd: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface AttacheeRef {
  id: string;
  name: string;
  registrationNo: string | null;
  organization: string | null;
}

export interface Attendance {
  id: string;
  date: string;
  status: AttendanceStatus;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  workMode: WorkMode;
  notes?: string | null;
  verifiedBySupervisor: boolean;
  createdAt: string;
  updatedAt: string;
  attacheeId: string;
  attachee: AttacheeRef;
}

export interface TaskReport {
  id: string;
  date: string;
  title: string;
  description: string;
  learnings?: string | null;
  category?: string | null;
  hoursSpent: number;
  status: ReportStatus;
  rating?: number | null;
  feedback?: string | null;
  supervisorName?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  attacheeId: string;
  attachee: AttacheeRef;
}

// ── Org overview (Vertical Summary dashboard charts) ─────────────────────────

export interface DepartmentCount {
  department: Department | 'UNASSIGNED';
  count: number;
}

export interface TaskStatusCount {
  status: TaskStatus;
  count: number;
}

export interface TaskLoadBucket {
  bucket: string;
  count: number;
}

export interface OrgOverview {
  weekStart: string;
  membersByDepartment: DepartmentCount[];
  attacheesByDepartment: DepartmentCount[];
  taskStatusDistribution: TaskStatusCount[];
  taskLoadHistogram: TaskLoadBucket[];
}

// ── Opportunity Tracker ───────────────────────────────────────────────────────

export type OpportunityStage = 'NEW' | 'QUALIFICATION' | 'ASSIGNED' | 'ENGAGEMENT' | 'PROPOSAL' | 'NEGOTIATION' | 'WON' | 'LOST';
export type OpportunityPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ActivityType = 'CALL' | 'MEETING' | 'SITE_VISIT' | 'EMAIL' | 'REQUIREMENTS_GATHERING' | 'OTHER';

export const STAGE_OPTIONS: { value: OpportunityStage; label: string }[] = [
  { value: 'NEW', label: 'New' },
  { value: 'QUALIFICATION', label: 'Qualification' },
  { value: 'ASSIGNED', label: 'Assigned' },
  { value: 'ENGAGEMENT', label: 'Engagement' },
  { value: 'PROPOSAL', label: 'Proposal / Quotation' },
  { value: 'NEGOTIATION', label: 'Negotiation' },
  { value: 'WON', label: 'Won' },
  { value: 'LOST', label: 'Lost' },
];

export const PRIORITY_OPTIONS: { value: OpportunityPriority; label: string }[] = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'CRITICAL', label: 'Critical' },
];

export const ACTIVITY_TYPE_OPTIONS: { value: ActivityType; label: string }[] = [
  { value: 'CALL', label: 'Call' },
  { value: 'MEETING', label: 'Meeting' },
  { value: 'SITE_VISIT', label: 'Site visit' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'REQUIREMENTS_GATHERING', label: 'Requirements gathering' },
  { value: 'OTHER', label: 'Other' },
];

export interface OpportunityActivity {
  id: string;
  type: ActivityType;
  date: string;
  notes?: string | null;
  createdAt: string;
  loggedBy?: { id: string; name: string } | null;
}

export interface Opportunity {
  id: string;
  // 1. Identified
  name: string;
  customerName: string;
  contactPerson?: string | null;
  source?: string | null;
  dateIdentified: string;
  estimatedValue?: number | null;
  description?: string | null;

  stage: OpportunityStage;
  priority: OpportunityPriority;

  // 2. Qualification
  isGenuine?: boolean | null;
  customerNeed?: string | null;
  budgetConfirmed?: string | null;
  decisionMaker?: string | null;
  expectedTimeline?: string | null;
  probability?: number | null;

  // 3. Assigned
  assignedToId?: string | null;
  assignedTo?: { id: string; name: string } | null;
  followUpDate?: string | null;

  // 5. Proposal
  proposalSubmittedDate?: string | null;
  proposedValue?: number | null;
  expectedClosingDate?: string | null;

  // 6. Negotiation
  customerFeedback?: string | null;
  revisedValue?: number | null;
  negotiationNotes?: string | null;
  competitors?: string | null;

  // 7a. Won
  finalValue?: number | null;
  contractNumber?: string | null;
  closingDate?: string | null;

  // 7b. Lost
  reasonLost?: string | null;
  competitorSelected?: string | null;
  lostValue?: number | null;
  lessonsLearned?: string | null;

  createdById: string;
  createdBy: { id: string; name: string };
  createdAt: string;
  updatedAt: string;

  activities?: OpportunityActivity[];
  _count?: { attachments: number };
}

export interface OpportunityAttachment {
  id: string;
  opportunityId: string;
  fileName: string;
  mimeType: string;
  bytes: number;
  createdAt: string;
  uploadedById: string;
  uploadedBy?: { id: string; name: string };
}

export interface OpportunityStats {
  total: number;
  new: number;
  inProgress: number;
  proposals: number;
  negotiation: number;
  won: number;
  lost: number;
  pipelineValue: number;
  wonValue: number;
  winRate: number;
}

// ── Task Reminders (SMS / Email / WhatsApp) ──────────────────────────────────

export type ReminderChannel = 'SMS' | 'EMAIL' | 'WHATSAPP';
export type ReminderStatus = 'SCHEDULED' | 'ACTIVE' | 'DONE' | 'CANCELLED';

export const REMINDER_CHANNEL_OPTIONS: { value: ReminderChannel; label: string }[] = [
  { value: 'SMS', label: 'SMS' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
];

export interface TaskReminderTask {
  id: string;
  description: string;
  date: string;
  status: TaskStatus;
  user: { id: string; name: string; email: string; phone?: string | null };
}

export interface TaskReminder {
  id: string;
  dueAt: string;
  channels: ReminderChannel[];
  repeatCount: number;
  sentCount: number;
  status: ReminderStatus;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  taskId: string;
  userId: string;
  task: TaskReminderTask;
}

// ── Audit Logs (admin activity trail) ────────────────────────────────────────

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGIN_FAILED' | 'REGISTER';
export type AuditSubjectType =
  | 'USER' | 'WORK_TASK' | 'TASK_ATTACHMENT' | 'OPPORTUNITY' | 'OPPORTUNITY_ACTIVITY'
  | 'OPPORTUNITY_ATTACHMENT' | 'OUT_OF_OFFICE' | 'ATTENDANCE' | 'TASK_REPORT' | 'TASK_REMINDER';

export const AUDIT_ACTION_OPTIONS: { value: AuditAction; label: string }[] = [
  { value: 'CREATE', label: 'Create' },
  { value: 'UPDATE', label: 'Update' },
  { value: 'DELETE', label: 'Delete' },
  { value: 'LOGIN', label: 'Login' },
  { value: 'LOGIN_FAILED', label: 'Login failed' },
  { value: 'REGISTER', label: 'Register' },
];

export const AUDIT_SUBJECT_OPTIONS: { value: AuditSubjectType; label: string }[] = [
  { value: 'USER', label: 'User' },
  { value: 'WORK_TASK', label: 'Task' },
  { value: 'TASK_ATTACHMENT', label: 'Task attachment' },
  { value: 'OPPORTUNITY', label: 'Opportunity' },
  { value: 'OPPORTUNITY_ACTIVITY', label: 'Opportunity activity' },
  { value: 'OPPORTUNITY_ATTACHMENT', label: 'Opportunity attachment' },
  { value: 'OUT_OF_OFFICE', label: 'Out of office' },
  { value: 'ATTENDANCE', label: 'Attendance' },
  { value: 'TASK_REPORT', label: 'Logbook entry' },
  { value: 'TASK_REMINDER', label: 'Task reminder' },
];

export interface AuditLog {
  id: string;
  action: AuditAction;
  subjectType: AuditSubjectType;
  subjectId: string;
  summary?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
  createdAt: string;
  userId: string;
  user: { id: string; name: string; email: string; role: Role };
}

// ── Team Collaboration (out-of-office calendar) ──────────────────────────────

export interface OutOfOfficeEntry {
  id: string;
  date: string;
  reason?: string | null;
  createdAt: string;
  userId: string;
  user: { id: string; name: string; role: Role };
}
