import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layers, ChevronLeft, ChevronRight, Users, GraduationCap, PieChart as PieChartIcon, BarChart3, Crown } from 'lucide-react';
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList, ResponsiveContainer,
} from 'recharts';
import api from '@/api/client';
import { useTaskOptions } from '@/hooks/useTaskOptions';
import {
  DEPARTMENT_OPTIONS,
  DepartmentCount,
  OrgOverview,
  ResourceWeeklyReport,
  TaskStatus,
  VerticalWeeklySummary,
} from '@/types/api';

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Chart palettes ────────────────────────────────────────────────────────────
// Fixed hex, validated for colorblind-safe adjacency (dataviz skill validator)
// against this page's white card surface - not tied to the site's CSS theme
// vars, which are reused for UI chrome and can be re-themed independently.

const DEPARTMENT_COLORS: Record<string, string> = {
  TECHNICAL: '#D62828',
  BUSINESS_DEVELOPMENT: '#2563EB',
  FINANCE: '#D4A017',
  COMMERCIAL: '#0D9488',
  ADMIN: '#7C3AED',
  UNASSIGNED: '#94A099',
};

const DEPARTMENT_LABELS: Record<string, string> = {
  ...Object.fromEntries(DEPARTMENT_OPTIONS.map((d) => [d.value, d.label])),
  UNASSIGNED: 'Unassigned',
};

// Fixed display + color order, chosen for CVD-safe adjacency (validated as a
// set) - not the enum's declaration order.
const STATUS_ORDER: TaskStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED_CLOSED', 'RESOLVED', 'ESCALATED', 'BLOCKED'];
const STATUS_COLORS: Record<TaskStatus, string> = {
  NOT_STARTED: '#94A099',
  IN_PROGRESS: '#2563EB',
  COMPLETED_CLOSED: '#D4A017',
  RESOLVED: '#169A5B',
  ESCALATED: '#7C5CFC',
  BLOCKED: '#D62828',
};

const PODIUM_META = [
  { place: 1, label: '1st', crown: '#D4A017', soft: 'var(--gold-soft)', delay: '0s' },
  { place: 2, label: '2nd', crown: '#7E8A93', soft: 'var(--surface-3)', delay: '0.15s' },
  { place: 3, label: '3rd', crown: '#B87333', soft: '#F6EDE4', delay: '0.3s' },
] as const;

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center text-center" style={{ gap: 6, padding: '40px 20px', color: 'var(--muted-2)' }}>
      <p className="text-sm font-semibold" style={{ color: 'var(--muted)' }}>{label}</p>
    </div>
  );
}

function CrownedName({
  name,
  rank,
  compact = false,
}: {
  name: string;
  rank: 1 | 2 | 3;
  compact?: boolean;
}) {
  const meta = PODIUM_META[rank - 1];
  return (
    <span className={`eng-crown-wrap${compact ? ' eng-crown-wrap-sm' : ''}`}>
      <span className="eng-crown" style={{ color: meta.crown, animationDelay: meta.delay }} aria-hidden>
        <Crown size={compact ? 14 : 22} fill="currentColor" strokeWidth={1.5} />
      </span>
      <span className="eng-crown-name">{name}</span>
    </span>
  );
}

function DepartmentBarChart({ title, icon, rows }: { title: string; icon: React.ReactNode; rows: DepartmentCount[] }) {
  const chartData = rows
    .filter((r) => r.count > 0)
    .map((r) => ({ key: r.department, name: DEPARTMENT_LABELS[r.department] ?? r.department, count: r.count }));

  return (
    <div className="card card-pad">
      <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
        {icon}
        <span className="card-title">{title}</span>
      </div>
      {chartData.length === 0 ? (
        <EmptyChart label="No one assigned yet" />
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ top: 16, right: 8, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v: number) => [v, 'People']} />
            <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={64}>
              <LabelList dataKey="count" position="top" style={{ fontSize: 11, fontWeight: 700, fill: 'var(--ink)' }} />
              {chartData.map((d) => (
                <Cell key={d.key} fill={DEPARTMENT_COLORS[d.key] ?? DEPARTMENT_COLORS.UNASSIGNED} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function VerticalSummaryPage() {
  const [weekStart, setWeekStart] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const { data: options } = useTaskOptions();

  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'vertical-weekly', weekStart],
    queryFn: async () => {
      const res = await api.get('/tasks/reports/vertical-weekly', { params: { weekStart } });
      return res.data.data as VerticalWeeklySummary;
    },
  });

  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['reports', 'org-overview', weekStart],
    queryFn: async () => {
      const res = await api.get('/tasks/reports/org-overview', { params: { weekStart } });
      return res.data.data as OrgOverview;
    },
  });

  const { data: resourceWeek, isLoading: resourceLoading } = useQuery({
    queryKey: ['reports', 'resource-weekly', weekStart],
    queryFn: async () => {
      const res = await api.get('/tasks/reports/resource-weekly', { params: { weekStart } });
      return res.data.data as ResourceWeeklyReport;
    },
  });

  const verticalLabel = (v: string) => options?.verticals.find((o) => o.value === v)?.label ?? v;
  const statusLabel = (s: string) => options?.statuses.find((o) => o.value === s)?.label ?? s;

  const rows = data?.rows ?? [];
  const chartData = rows
    .filter((r) => r.totalHours > 0)
    .map((r) => ({ name: verticalLabel(r.vertical).replace(/^\d+\.\s*/, ''), hours: r.totalHours }));

  const topEngineers = useMemo(() => {
    return [...(resourceWeek?.rows ?? [])]
      .filter((r) => r.totalWeeklyHours > 0)
      .sort((a, b) => b.totalWeeklyHours - a.totalWeeklyHours)
      .slice(0, 3);
  }, [resourceWeek]);

  const topEngineerRank = useMemo(() => {
    const map = new Map<string, 1 | 2 | 3>();
    topEngineers.forEach((r, i) => map.set(r.name, (i + 1) as 1 | 2 | 3));
    return map;
  }, [topEngineers]);

  const statusData = STATUS_ORDER
    .map((status) => ({
      status,
      name: statusLabel(status),
      count: overview?.taskStatusDistribution.find((r) => r.status === status)?.count ?? 0,
    }))
    .filter((r) => r.count > 0);
  const totalTasksThisWeek = statusData.reduce((sum, r) => sum + r.count, 0);

  const histogramData = overview?.taskLoadHistogram ?? [];

  // Podium visual slots: 2nd | 1st | 3rd when we have enough people
  const podiumSlots: Array<{ eng: (typeof topEngineers)[number]; rank: 1 | 2 | 3 }> = [];
  if (topEngineers[1]) podiumSlots.push({ eng: topEngineers[1], rank: 2 });
  if (topEngineers[0]) podiumSlots.push({ eng: topEngineers[0], rank: 1 });
  if (topEngineers[2]) podiumSlots.push({ eng: topEngineers[2], rank: 3 });

  return (
    <div className="col" style={{ gap: 20 }}>
      <div className="flex items-center justify-between">
        <div>
          <p className="eyebrow">Reports</p>
          <h2 className="text-2xl font-bold mt-1" style={{ color: 'var(--ink)' }}>Vertical Summary</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Hours and tasks by organizational vertical, this week</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-soft btn-sm" onClick={() => setWeekStart((w) => addDays(w, -7))}><ChevronLeft size={14} /></button>
          <input
            className="input"
            type="date"
            value={weekStart}
            onChange={(e) => setWeekStart(e.target.value)}
            style={{ width: 160 }}
          />
          <button className="btn btn-soft btn-sm" onClick={() => setWeekStart((w) => addDays(w, 7))}><ChevronRight size={14} /></button>
        </div>
      </div>

      {/* Top 3 engineers of the week */}
      <div className="card card-pad">
        <div className="flex items-center gap-2" style={{ marginBottom: 16 }}>
          <Crown size={16} style={{ color: 'var(--red)' }} />
          <span className="card-title">Top Engineers of the Week</span>
        </div>
        {resourceLoading ? (
          <div className="skel" style={{ height: 160 }} />
        ) : topEngineers.length === 0 ? (
          <EmptyChart label="No hours logged this week yet" />
        ) : (
          <div className="eng-podium">
            {podiumSlots.map(({ eng, rank }) => {
              const meta = PODIUM_META[rank - 1];
              const height = rank === 1 ? 92 : rank === 2 ? 72 : 58;
              return (
                <div key={eng.userId} className="eng-podium-slot">
                  <CrownedName name={eng.name} rank={rank} />
                  <p className="text-xs font-semibold mt-1" style={{ color: 'var(--muted)' }}>
                    {eng.totalWeeklyHours}h · {meta.label}
                  </p>
                  <div
                    className="eng-podium-block"
                    style={{
                      height,
                      background: meta.soft,
                      borderColor: meta.crown,
                      animationDelay: meta.delay,
                    }}
                  >
                    <b style={{ color: meta.crown }}>{rank}</b>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card card-pad">
        {isLoading ? (
          <div className="skel" style={{ height: 260 }} />
        ) : chartData.length === 0 ? (
          <div className="flex flex-col items-center text-center" style={{ gap: 8, padding: '32px 20px' }}>
            <Layers size={32} style={{ color: 'var(--red)' }} />
            <p className="text-base font-bold" style={{ color: 'var(--ink)' }}>No tasks logged this week</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" angle={-30} textAnchor="end" interval={0} height={70} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => [`${v}h`, 'Hours']} />
              <Bar dataKey="hours" fill="var(--green, #169A5B)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                {['Vertical', 'Total Hours', '# Tasks', 'Deployment', 'Support', 'POC', 'Top Engineer'].map((h) => (
                  <th key={h} style={{ padding: '10px 14px', color: 'var(--muted)', fontWeight: 650, fontSize: 12 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rank = r.topEngineer ? topEngineerRank.get(r.topEngineer) : undefined;
                return (
                  <tr key={r.vertical} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{verticalLabel(r.vertical)}</td>
                    <td style={{ padding: '10px 14px' }}>{r.totalHours}h</td>
                    <td style={{ padding: '10px 14px' }}>{r.taskCount}</td>
                    <td style={{ padding: '10px 14px' }}>{r.deploymentHours}h</td>
                    <td style={{ padding: '10px 14px' }}>{r.supportHours}h</td>
                    <td style={{ padding: '10px 14px' }}>{r.pocHours}h</td>
                    <td style={{ padding: '14px 14px 10px' }}>
                      {r.topEngineer ? (
                        rank ? <CrownedName name={r.topEngineer} rank={rank} compact /> : r.topEngineer
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Organization Overview - members, attachees, task status & load distribution */}
      <div>
        <p className="eyebrow">Organization Overview</p>
        <h2 className="text-2xl font-bold mt-1" style={{ color: 'var(--ink)' }}>Distribution</h2>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Headcount by department, and this week's task mix</p>
      </div>

      {overviewLoading ? (
        <div className="card card-pad"><div className="skel" style={{ height: 220 }} /></div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
            <DepartmentBarChart
              title="Members by Department"
              icon={<Users size={16} style={{ color: 'var(--red)' }} />}
              rows={overview?.membersByDepartment ?? []}
            />
            <DepartmentBarChart
              title="Attachees by Department"
              icon={<GraduationCap size={16} style={{ color: 'var(--red)' }} />}
              rows={overview?.attacheesByDepartment ?? []}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
            <div className="card card-pad">
              <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
                <PieChartIcon size={16} style={{ color: 'var(--red)' }} />
                <span className="card-title">Task Status Distribution ({totalTasksThisWeek} this week)</span>
              </div>
              {statusData.length === 0 ? (
                <EmptyChart label="No tasks logged this week" />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={statusData}
                      dataKey="count"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      stroke="var(--surface)"
                      strokeWidth={2}
                      label={({ percent, x, y, textAnchor }) =>
                        (percent ?? 0) < 0.06 ? null : (
                          <text x={x} y={y} textAnchor={textAnchor} fill="var(--ink-2)" fontSize={12} fontWeight={700}>
                            {Math.round((percent ?? 0) * 100)}%
                          </text>
                        )
                      }
                      labelLine={{ stroke: 'var(--border-strong)' }}
                    >
                      {statusData.map((d) => <Cell key={d.status} fill={STATUS_COLORS[d.status]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number, n: string) => [v, n]} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="card card-pad">
              <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
                <BarChart3 size={16} style={{ color: 'var(--red)' }} />
                <span className="card-title">Task Load per Member (this week)</span>
              </div>
              {histogramData.every((b) => b.count === 0) ? (
                <EmptyChart label="No active staff to measure" />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={histogramData} margin={{ top: 16, right: 8, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="bucket" tick={{ fontSize: 11 }} label={{ value: 'Tasks logged', position: 'insideBottom', offset: -4, fontSize: 11, fill: 'var(--muted)' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} label={{ value: 'Members', angle: -90, position: 'insideLeft', fontSize: 11, fill: 'var(--muted)' }} />
                    <Tooltip formatter={(v: number) => [v, 'Members']} labelFormatter={(l) => `${l} tasks`} />
                    <Bar dataKey="count" fill="var(--green, #169A5B)" radius={[6, 6, 0, 0]} maxBarSize={64}>
                      <LabelList dataKey="count" position="top" style={{ fontSize: 11, fontWeight: 700, fill: 'var(--ink)' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default VerticalSummaryPage;
