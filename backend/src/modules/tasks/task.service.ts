import { AppContext } from '../../context.js';
import { Prisma } from '../../generated/prisma/index.js';
import { Department, Role, TaskCategory, TaskStatus, TaskVertical } from '../../shared/types/index.js';
import { ForbiddenError, NotFoundError } from '../../shared/errors/AppError.js';
import { COMPLETED_STATUSES } from './task-options.js';

const MANAGER_ROLES: Role[] = [Role.ADMIN, Role.SUPER_ADMIN];

export interface CreateTaskInput {
  date: string;
  vertical: TaskVertical;
  category: TaskCategory;
  description: string;
  customerProject?: string;
  startTime?: string;
  endTime?: string;
  hoursSpent?: number;
  status?: TaskStatus;
  percentComplete?: number;
  keyDeliverable?: string;
  blockersNotes?: string;
  /** Admin/Super Admin only - log a task on behalf of another staff member. */
  userId?: string;
}

export type UpdateTaskInput = Partial<Omit<CreateTaskInput, 'userId'>>;

/** Monday 00:00:00 (local) of the week containing `d`. */
function mondayOf(d: Date): Date {
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() + diff);
  return monday;
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export class TaskService {
  constructor(private app: AppContext) {}

  private isManager(role: Role): boolean {
    return MANAGER_ROLES.includes(role);
  }

  private broadcast(event: 'task:created' | 'task:updated' | 'task:deleted', task: unknown, userId: string) {
    this.app.io.to(`role:${Role.ADMIN}`).to(`role:${Role.SUPER_ADMIN}`).to(`user:${userId}`).emit(event, task);
  }

  async createTask(actor: { userId: string; role: Role }, data: CreateTaskInput) {
    const targetUserId = data.userId && this.isManager(actor.role) ? data.userId : actor.userId;

    if (data.userId && data.userId !== actor.userId && !this.isManager(actor.role)) {
      throw new ForbiddenError('Only admins can log a task on behalf of another user');
    }

    const task = await this.app.prisma.workTask.create({
      data: {
        date: new Date(data.date),
        vertical: data.vertical,
        category: data.category,
        description: data.description,
        customerProject: data.customerProject,
        startTime: data.startTime,
        endTime: data.endTime,
        hoursSpent: data.hoursSpent ?? 0,
        status: data.status ?? TaskStatus.NOT_STARTED,
        percentComplete: data.percentComplete ?? 0,
        keyDeliverable: data.keyDeliverable,
        blockersNotes: data.blockersNotes,
        userId: targetUserId,
      },
      include: { user: { select: { id: true, name: true } }, _count: { select: { attachments: true } } },
    });

    this.broadcast('task:created', task, targetUserId);
    await this.app.auditLog.record({
      actorId: actor.userId, action: 'CREATE', subjectType: 'WORK_TASK', subjectId: task.id,
      summary: `Logged task: ${task.description}`,
      newValues: task,
    });
    return task;
  }

  async getTasks(
    actor: { userId: string; role: Role },
    filters: {
      userId?: string;
      vertical?: TaskVertical;
      category?: TaskCategory;
      status?: TaskStatus;
      from?: string;
      to?: string;
      page: number;
      limit: number;
    }
  ) {
    const { page, limit } = filters;
    const skip = (page - 1) * limit;

    const where: Prisma.WorkTaskWhereInput = {};

    // Staff can only ever see their own tasks - a requested userId filter is
    // honoured only when it matches themselves, otherwise ignored.
    if (this.isManager(actor.role)) {
      if (filters.userId) where.userId = filters.userId;
    } else {
      where.userId = actor.userId;
    }

    if (filters.vertical) where.vertical = filters.vertical;
    if (filters.category) where.category = filters.category;
    if (filters.status) where.status = filters.status;
    if (filters.from || filters.to) {
      where.date = {
        ...(filters.from ? { gte: new Date(filters.from) } : {}),
        ...(filters.to ? { lte: new Date(filters.to) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      this.app.prisma.workTask.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        include: { user: { select: { id: true, name: true } }, _count: { select: { attachments: true } } },
      }),
      this.app.prisma.workTask.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  private async findOwned(id: string, actor: { userId: string; role: Role }) {
    const task = await this.app.prisma.workTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundError('Task');
    if (task.userId !== actor.userId && !this.isManager(actor.role)) {
      throw new ForbiddenError('You do not have permission to access this task');
    }
    return task;
  }

  async getTaskById(id: string, actor: { userId: string; role: Role }) {
    const task = await this.findOwned(id, actor);
    return this.app.prisma.workTask.findUnique({
      where: { id: task.id },
      include: { user: { select: { id: true, name: true } }, _count: { select: { attachments: true } } },
    });
  }

  async updateTask(id: string, actor: { userId: string; role: Role }, data: UpdateTaskInput) {
    const existing = await this.findOwned(id, actor);

    const updated = await this.app.prisma.workTask.update({
      where: { id },
      data: {
        ...(data.date !== undefined ? { date: new Date(data.date) } : {}),
        ...(data.vertical !== undefined ? { vertical: data.vertical } : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.customerProject !== undefined ? { customerProject: data.customerProject } : {}),
        ...(data.startTime !== undefined ? { startTime: data.startTime } : {}),
        ...(data.endTime !== undefined ? { endTime: data.endTime } : {}),
        ...(data.hoursSpent !== undefined ? { hoursSpent: data.hoursSpent } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.percentComplete !== undefined ? { percentComplete: data.percentComplete } : {}),
        ...(data.keyDeliverable !== undefined ? { keyDeliverable: data.keyDeliverable } : {}),
        ...(data.blockersNotes !== undefined ? { blockersNotes: data.blockersNotes } : {}),
      },
      include: { user: { select: { id: true, name: true } }, _count: { select: { attachments: true } } },
    });

    this.broadcast('task:updated', updated, updated.userId);
    await this.app.auditLog.record({
      actorId: actor.userId, action: 'UPDATE', subjectType: 'WORK_TASK', subjectId: id,
      summary: `Updated task: ${updated.description}`,
      oldValues: existing,
      newValues: updated,
    });
    return updated;
  }

  async deleteTask(id: string, actor: { userId: string; role: Role }) {
    const task = await this.findOwned(id, actor);
    await this.app.prisma.workTask.delete({ where: { id } });
    this.broadcast('task:deleted', { id }, task.userId);
    await this.app.auditLog.record({
      actorId: actor.userId, action: 'DELETE', subjectType: 'WORK_TASK', subjectId: id,
      summary: `Deleted task: ${task.description}`,
      oldValues: task,
    });
  }

  // ── Reports ────────────────────────────────────────────────────────────────

  /**
   * Per-resource weekly hours breakdown (Mon-Fri), total, utilization vs a
   * 40-hour week, and completed-task count - mirrors the "Resource C & W
   * Tracker" sheet. Manager-only.
   */
  async getResourceWeeklyReport(weekStartInput?: string) {
    const monday = mondayOf(weekStartInput ? new Date(weekStartInput) : new Date());
    const weekEnd = addDays(monday, 7); // exclusive upper bound (next Monday)

    const [users, tasks] = await Promise.all([
      this.app.prisma.user.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.app.prisma.workTask.findMany({
        where: { date: { gte: monday, lt: weekEnd } },
        select: { userId: true, date: true, hoursSpent: true, status: true },
      }),
    ]);

    const dayKeys = ['mon', 'tue', 'wed', 'thu', 'fri'] as const;

    const byUser = new Map<string, { hoursByDay: Record<(typeof dayKeys)[number], number>; total: number; completed: number }>();
    for (const u of users) {
      byUser.set(u.id, {
        hoursByDay: { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0 },
        total: 0,
        completed: 0,
      });
    }

    for (const t of tasks) {
      let entry = byUser.get(t.userId);
      if (!entry) {
        // Task belongs to a user not in the active list (e.g. deactivated
        // mid-week) - still report their hours rather than silently drop them.
        entry = { hoursByDay: { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0 }, total: 0, completed: 0 };
        byUser.set(t.userId, entry);
      }
      const dayIndex = Math.floor((t.date.getTime() - monday.getTime()) / 86_400_000); // 0=Mon..6=Sun
      entry.total += t.hoursSpent;
      if (dayIndex >= 0 && dayIndex < 5) entry.hoursByDay[dayKeys[dayIndex]] += t.hoursSpent;
      if (COMPLETED_STATUSES.includes(t.status)) entry.completed += 1;
    }

    const userNames = new Map(users.map((u) => [u.id, u.name]));

    const rows = Array.from(byUser.entries()).map(([userId, entry]) => ({
      userId,
      name: userNames.get(userId) ?? 'Unknown',
      hoursByDay: entry.hoursByDay,
      totalWeeklyHours: Math.round(entry.total * 100) / 100,
      utilizationPct: Math.round((entry.total / 40) * 1000) / 1000,
      tasksCompleted: entry.completed,
    }));

    return { weekStart: monday.toISOString().slice(0, 10), rows };
  }

  /**
   * Per-vertical weekly rollup - total hours, task count, a breakdown for the
   * three headline categories, and the top-hours engineer. Mirrors the
   * "Weekly Vertical Summary" sheet. Manager-only.
   */
  async getVerticalWeeklySummary(weekStartInput?: string) {
    const monday = mondayOf(weekStartInput ? new Date(weekStartInput) : new Date());
    const weekEnd = addDays(monday, 7);

    const tasks = await this.app.prisma.workTask.findMany({
      where: { date: { gte: monday, lt: weekEnd } },
      select: {
        vertical: true,
        category: true,
        hoursSpent: true,
        userId: true,
        user: { select: { name: true } },
      },
    });

    const verticals = Object.values(TaskVertical);
    const byVertical = new Map<
      TaskVertical,
      { totalHours: number; taskCount: number; deploymentHours: number; supportHours: number; pocHours: number; hoursByUser: Map<string, { name: string; hours: number }> }
    >();
    for (const v of verticals) {
      byVertical.set(v, { totalHours: 0, taskCount: 0, deploymentHours: 0, supportHours: 0, pocHours: 0, hoursByUser: new Map() });
    }

    for (const t of tasks) {
      const entry = byVertical.get(t.vertical)!;
      entry.totalHours += t.hoursSpent;
      entry.taskCount += 1;
      if (t.category === TaskCategory.DEPLOYMENT) entry.deploymentHours += t.hoursSpent;
      if (t.category === TaskCategory.SUPPORT_BREAK_FIX) entry.supportHours += t.hoursSpent;
      if (t.category === TaskCategory.PROOF_OF_CONCEPT) entry.pocHours += t.hoursSpent;

      const u = entry.hoursByUser.get(t.userId) ?? { name: t.user.name, hours: 0 };
      u.hours += t.hoursSpent;
      entry.hoursByUser.set(t.userId, u);
    }

    const rows = verticals.map((vertical) => {
      const e = byVertical.get(vertical)!;
      let topEngineer: string | null = null;
      let topHours = -1;
      for (const u of e.hoursByUser.values()) {
        if (u.hours > topHours) { topHours = u.hours; topEngineer = u.name; }
      }
      return {
        vertical,
        totalHours: Math.round(e.totalHours * 100) / 100,
        taskCount: e.taskCount,
        deploymentHours: Math.round(e.deploymentHours * 100) / 100,
        supportHours: Math.round(e.supportHours * 100) / 100,
        pocHours: Math.round(e.pocHours * 100) / 100,
        topEngineer,
      };
    });

    return { weekStart: monday.toISOString().slice(0, 10), rows };
  }

  /**
   * Org-wide distribution snapshot for the Vertical Summary dashboard:
   * headcount by department (staff and attachees separately), this week's
   * task status mix, and a histogram of how many tasks each active staff
   * member logged this week. Manager-only.
   */
  async getOrgOverview(weekStartInput?: string) {
    const monday = mondayOf(weekStartInput ? new Date(weekStartInput) : new Date());
    const weekEnd = addDays(monday, 7);

    const [staffUsers, attacheeUsers, weekTasks] = await Promise.all([
      this.app.prisma.user.findMany({
        where: { isActive: true, role: { not: Role.ATTACHEE } },
        select: { id: true, department: true },
      }),
      this.app.prisma.user.findMany({
        where: { isActive: true, role: Role.ATTACHEE },
        select: { id: true, department: true },
      }),
      this.app.prisma.workTask.findMany({
        where: { date: { gte: monday, lt: weekEnd } },
        select: { userId: true, status: true },
      }),
    ]);

    const byDepartment = (users: { department: Department | null }[]) => {
      const counts = new Map<Department | 'UNASSIGNED', number>();
      for (const u of users) {
        const key = u.department ?? 'UNASSIGNED';
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return Array.from(counts.entries()).map(([department, count]) => ({ department, count }));
    };

    const statusCounts = new Map<TaskStatus, number>();
    for (const status of Object.values(TaskStatus)) statusCounts.set(status, 0);
    for (const t of weekTasks) statusCounts.set(t.status, (statusCounts.get(t.status) ?? 0) + 1);
    const taskStatusDistribution = Array.from(statusCounts.entries()).map(([status, count]) => ({ status, count }));

    // How many tasks did each active staff member log this week? Bucketed
    // into ranges for a histogram - members with zero tasks are included.
    const tasksPerStaffMember = new Map<string, number>();
    for (const u of staffUsers) tasksPerStaffMember.set(u.id, 0);
    for (const t of weekTasks) {
      if (tasksPerStaffMember.has(t.userId)) {
        tasksPerStaffMember.set(t.userId, (tasksPerStaffMember.get(t.userId) ?? 0) + 1);
      }
    }
    const buckets: { bucket: string; test: (n: number) => boolean }[] = [
      { bucket: '0', test: (n) => n === 0 },
      { bucket: '1-2', test: (n) => n >= 1 && n <= 2 },
      { bucket: '3-5', test: (n) => n >= 3 && n <= 5 },
      { bucket: '6-8', test: (n) => n >= 6 && n <= 8 },
      { bucket: '9+', test: (n) => n >= 9 },
    ];
    const taskLoadHistogram = buckets.map(({ bucket }) => ({ bucket, count: 0 }));
    for (const count of tasksPerStaffMember.values()) {
      const idx = buckets.findIndex((b) => b.test(count));
      if (idx >= 0) taskLoadHistogram[idx].count += 1;
    }

    return {
      weekStart: monday.toISOString().slice(0, 10),
      membersByDepartment: byDepartment(staffUsers),
      attacheesByDepartment: byDepartment(attacheeUsers),
      taskStatusDistribution,
      taskLoadHistogram,
    };
  }

  /**
   * Personal time-balance snapshot for the signed-in staff member. Powers the
   * sidebar "Intelligent Tracker" so people can see where hours concentrate
   * across verticals and categories (and get nudged to stay well-rounded).
   */
  async getMyTimeStats(userId: string, range?: { from?: string; to?: string }) {
    const to = range?.to ? new Date(range.to) : new Date();
    to.setHours(23, 59, 59, 999);
    const from = range?.from ? new Date(range.from) : addDays(to, -29);
    from.setHours(0, 0, 0, 0);

    const tasks = await this.app.prisma.workTask.findMany({
      where: { userId, date: { gte: from, lte: to } },
      select: { vertical: true, category: true, hoursSpent: true },
    });

    const round2 = (n: number) => Math.round(n * 100) / 100;

    const verticalHours = new Map<TaskVertical, number>();
    const categoryHours = new Map<TaskCategory, number>();
    for (const v of Object.values(TaskVertical)) verticalHours.set(v, 0);
    for (const c of Object.values(TaskCategory)) categoryHours.set(c, 0);

    let totalHours = 0;
    let taskCount = 0;
    for (const t of tasks) {
      totalHours += t.hoursSpent;
      taskCount += 1;
      verticalHours.set(t.vertical, (verticalHours.get(t.vertical) ?? 0) + t.hoursSpent);
      categoryHours.set(t.category, (categoryHours.get(t.category) ?? 0) + t.hoursSpent);
    }

    const toBucket = <T extends string>(map: Map<T, number>) =>
      Array.from(map.entries())
        .map(([key, hours]) => ({
          key,
          hours: round2(hours),
          sharePct: totalHours > 0 ? Math.round((hours / totalHours) * 1000) / 10 : 0,
        }))
        .sort((a, b) => b.hours - a.hours);

    const byVertical = toBucket(verticalHours);
    const byCategory = toBucket(categoryHours);

    const activeVerticals = byVertical.filter((b) => b.hours > 0);
    const activeCategories = byCategory.filter((b) => b.hours > 0);
    const topVertical = activeVerticals[0] ?? null;
    const topCategory = activeCategories[0] ?? null;

    // Herfindahl–Hirschman style concentration on vertical shares (0 = even, 1 = all in one).
    let hhi = 0;
    if (totalHours > 0) {
      for (const b of activeVerticals) {
        const share = b.hours / totalHours;
        hhi += share * share;
      }
    }
    const balanceScore = totalHours > 0 ? Math.round((1 - hhi) * 100) : 0;

    let balanceLabel: 'narrow' | 'focused' | 'balanced' | 'well_rounded' | 'none' = 'none';
    if (totalHours <= 0) balanceLabel = 'none';
    else if (balanceScore >= 70) balanceLabel = 'well_rounded';
    else if (balanceScore >= 45) balanceLabel = 'balanced';
    else if (balanceScore >= 25) balanceLabel = 'focused';
    else balanceLabel = 'narrow';

    const neglectedVerticals = byVertical.filter((b) => b.hours === 0).slice(0, 3).map((b) => b.key);
    const stretchVerticals = byVertical
      .filter((b) => b.hours > 0)
      .slice(-3)
      .reverse()
      .map((b) => b.key)
      .filter((k) => k !== topVertical?.key)
      .slice(0, 2);

    let insight = 'Log a few tasks to see where your time concentrates.';
    if (totalHours > 0 && topVertical) {
      if (balanceLabel === 'narrow' || balanceLabel === 'focused') {
        const nudge = (neglectedVerticals[0] ?? stretchVerticals[0]) ?? null;
        insight = nudge
          ? `${Math.round(topVertical.sharePct)}% of your hours sit in one vertical. Stretch into underused areas to stay well-rounded.`
          : `${Math.round(topVertical.sharePct)}% of your hours sit in one vertical. Mix in other verticals when you can.`;
      } else if (balanceLabel === 'balanced') {
        insight = `Solid spread across ${activeVerticals.length} verticals. Keep sampling categories outside your usual work.`;
      } else {
        insight = `Nice range: time logged across ${activeVerticals.length} verticals and ${activeCategories.length} categories.`;
      }
    }

    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      totalHours: round2(totalHours),
      taskCount,
      balanceScore,
      balanceLabel,
      insight,
      topVertical: topVertical
        ? { vertical: topVertical.key, hours: topVertical.hours, sharePct: topVertical.sharePct }
        : null,
      topCategory: topCategory
        ? { category: topCategory.key, hours: topCategory.hours, sharePct: topCategory.sharePct }
        : null,
      byVertical: byVertical.map(({ key, hours, sharePct }) => ({ vertical: key, hours, sharePct })),
      byCategory: byCategory.map(({ key, hours, sharePct }) => ({ category: key, hours, sharePct })),
      neglectedVerticals,
    };
  }
}
