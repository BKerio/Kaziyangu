import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Compass,
  Layers,
  PieChart as PieChartIcon,
  Target,
  Clock3,
  ListChecks,
  ClockFading,
} from 'lucide-react';
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import api from '@/api/client';
import { useTaskOptions } from '@/hooks/useTaskOptions';
import { nairobiTodayISO } from '@/lib/datetime';
import { MyTimeStats, TimeBalanceLabel } from '@/types/api';

type RangeKey = 7 | 30 | 90;

const RANGES: { days: RangeKey; label: string }[] = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

const BALANCE_COPY: Record<
  TimeBalanceLabel,
  { title: string; blurb: string; tone: string; soft: string }
> = {
  none: {
    title: 'Blank slate',
    blurb: 'Log tasks with verticals and categories to unlock your balance portrait.',
    tone: 'var(--muted)',
    soft: 'var(--surface-3)',
  },
  narrow: {
    title: 'Too narrow',
    blurb: 'Almost all hours sit in one lane. Stretch into at least one new vertical this week.',
    tone: 'var(--red)',
    soft: 'var(--red-soft)',
  },
  focused: {
    title: 'Focused specialist',
    blurb: 'Strong depth. Now add breadth so you stay all-round across the org.',
    tone: 'var(--amber)',
    soft: 'var(--amber-soft)',
  },
  balanced: {
    title: 'Balanced operator',
    blurb: 'Healthy mix. Keep sampling categories outside your usual rhythm.',
    tone: 'var(--color-status-success, #169A5B)',
    soft: 'var(--green-light)',
  },
  well_rounded: {
    title: 'Well-rounded',
    blurb: 'Excellent spread across verticals and categories. Keep that curiosity.',
    tone: 'var(--blue)',
    soft: 'var(--blue-soft)',
  },
};

/** CVD-friendly palette for pie slices (validated adjacency on white cards). */
const PIE_COLORS = [
  '#C8202B',
  '#2563EB',
  '#D4A017',
  '#169A5B',
  '#0F2740',
  '#E63946',
  '#4FB4EF',
  '#B7791F',
  '#3D4A44',
  '#7A121A',
  '#1D4ED8',
  '#94A099',
];

function shortLabel(label: string): string {
  return label.replace(/^\d+\.\s*/, '').replace(/\s*\([^)]*\)\s*/g, ' ').trim();
}

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  return nairobiTodayISO(d);
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center text-center" style={{ gap: 8, padding: '36px 16px' }}>
      <Compass size={28} style={{ color: 'var(--red)' }} />
      <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>{title}</p>
      <p className="text-xs" style={{ color: 'var(--muted)', maxWidth: 280 }}>{body}</p>
    </div>
  );
}

function DonutTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; payload: { sharePct: number; hours: number } }>;
}) {
  if (!active || !payload?.[0]) return null;
  const row = payload[0];
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '8px 12px',
        boxShadow: 'var(--shadow-md)',
      }}
    >
      <p className="text-xs font-bold" style={{ color: 'var(--ink)' }}>{row.name}</p>
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        {row.payload.hours}h · {row.payload.sharePct}%
      </p>
    </div>
  );
}

/** Light-theme twin of the sidebar tracker: same structure, page color system. */
function BalanceSnapshotCard({
  data,
  range,
  isLoading,
  verticalLabel,
  categoryLabel,
}: {
  data?: MyTimeStats;
  range: RangeKey;
  isLoading: boolean;
  verticalLabel: (key: string) => string;
  categoryLabel: (key: string) => string;
}) {
  const balance = data ? BALANCE_COPY[data.balanceLabel] : BALANCE_COPY.none;
  const topVerticals = (data?.byVertical ?? []).filter((v) => v.hours > 0).slice(0, 3);
  const topCategories = (data?.byCategory ?? []).filter((c) => c.hours > 0).slice(0, 3);
  const stretch = (data?.neglectedVerticals ?? []).slice(0, 2);

  return (
    <div
      className="card"
      style={{
        overflow: 'hidden',
        borderColor: 'transparent',
        background: balance.soft,
        boxShadow: 'var(--shadow)',
      }}
    >
      <div className="card-pad col" style={{ gap: 14 }}>
        <div className="flex items-center justify-between" style={{ gap: 8 }}>
          <div className="flex items-center gap-2">
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                display: 'grid',
                placeItems: 'center',
                background: 'var(--red-soft)',
                color: 'var(--red)',
              }}
            >
              <ClockFading size={15} />
            </span>
            <span className="card-title">Time balance</span>
          </div>
          <span
            className="text-xs font-bold"
            style={{
              color: balance.tone,
              background: balance.soft,
              border: `1px solid color-mix(in srgb, ${balance.tone} 22%, transparent)`,
              padding: '3px 9px',
              borderRadius: 99,
            }}
          >
            {balance.title}
          </span>
        </div>

        {isLoading || !data ? (
          <div className="skel" style={{ height: 160 }} />
        ) : (
          <>
            <div className="flex items-center gap-3">
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 99,
                  flexShrink: 0,
                  display: 'grid',
                  placeItems: 'center',
                  background: `
                    radial-gradient(circle at center, var(--surface) 58%, transparent 59%),
                    conic-gradient(${balance.tone} ${data.balanceScore}%, var(--border) 0)
                  `,
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                <b style={{ fontSize: 14, color: 'var(--ink)' }}>{data.balanceScore}</b>
              </div>
              <div style={{ minWidth: 0 }}>
                <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>
                  {data.totalHours}h logged
                </p>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  Last {range} days · {data.taskCount} task{data.taskCount === 1 ? '' : 's'}
                </p>
              </div>
            </div>

            <p className="text-sm" style={{ color: 'var(--ink-2)', lineHeight: 1.45, margin: 0 }}>
              {data.insight}
            </p>

            {topVerticals.length > 0 && (
              <div className="col" style={{ gap: 8 }}>
                <div
                  className="text-xs font-bold"
                  style={{ color: 'var(--muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}
                >
                  Verticals
                </div>
                {topVerticals.map((row) => (
                  <div key={row.vertical} className="col" style={{ gap: 4 }}>
                    <div className="flex items-center justify-between" style={{ gap: 8 }}>
                      <span className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }} title={verticalLabel(row.vertical)}>
                        {verticalLabel(row.vertical)}
                      </span>
                      <b className="text-xs" style={{ color: 'var(--ink)' }}>{row.sharePct}%</b>
                    </div>
                    <div
                      style={{
                        height: 6,
                        borderRadius: 99,
                        background: 'var(--surface-3)',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.max(row.sharePct, 4)}%`,
                          height: '100%',
                          borderRadius: 99,
                          background: '#C8202B',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {topCategories.length > 0 && (
              <div className="col" style={{ gap: 8 }}>
                <div
                  className="text-xs font-bold"
                  style={{ color: 'var(--muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}
                >
                  Categories
                </div>
                {topCategories.map((row) => (
                  <div key={row.category} className="col" style={{ gap: 4 }}>
                    <div className="flex items-center justify-between" style={{ gap: 8 }}>
                      <span className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }} title={categoryLabel(row.category)}>
                        {categoryLabel(row.category)}
                      </span>
                      <b className="text-xs" style={{ color: 'var(--ink)' }}>{row.sharePct}%</b>
                    </div>
                    <div
                      style={{
                        height: 6,
                        borderRadius: 99,
                        background: 'var(--surface-3)',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.max(row.sharePct, 4)}%`,
                          height: '100%',
                          borderRadius: 99,
                          background: '#2563EB',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {stretch.length > 0 && data.totalHours > 0 && (
              <div className="col" style={{ gap: 8 }}>
                <div
                  className="text-xs font-bold"
                  style={{ color: 'var(--muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}
                >
                  Try next
                </div>
                <div className="flex" style={{ flexWrap: 'wrap', gap: 6 }}>
                  {stretch.map((v) => (
                    <span
                      key={v}
                      className="text-xs font-semibold"
                      style={{
                        padding: '5px 10px',
                        borderRadius: 99,
                        background: 'var(--blue-soft)',
                        border: '1px solid color-mix(in srgb, var(--blue) 22%, transparent)',
                        color: 'var(--blue)',
                      }}
                    >
                      {verticalLabel(v)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TimeBalancePage() {
  const [range, setRange] = useState<RangeKey>(30);
  const { data: options } = useTaskOptions();

  const from = daysAgoISO(range);
  const to = nairobiTodayISO();

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', 'my-stats', from, to],
    queryFn: async () => {
      const res = await api.get<{ data: MyTimeStats }>('/tasks/my-stats', { params: { from, to } });
      return res.data.data;
    },
  });

  const verticalLabel = useMemo(() => {
    const map = new Map(options?.verticals.map((v) => [v.value, shortLabel(v.label)]) ?? []);
    return (key: string) => map.get(key as never) ?? key;
  }, [options]);

  const categoryLabel = useMemo(() => {
    const map = new Map(options?.categories.map((c) => [c.value, shortLabel(c.label)]) ?? []);
    return (key: string) => map.get(key as never) ?? key;
  }, [options]);

  const balance = data ? BALANCE_COPY[data.balanceLabel] : BALANCE_COPY.none;

  const verticalPie = useMemo(
    () =>
      (data?.byVertical ?? [])
        .filter((r) => r.hours > 0)
        .map((r) => ({
          key: r.vertical,
          name: verticalLabel(r.vertical),
          hours: r.hours,
          sharePct: r.sharePct,
          value: r.hours,
        })),
    [data, verticalLabel],
  );

  const categoryPie = useMemo(
    () =>
      (data?.byCategory ?? [])
        .filter((r) => r.hours > 0)
        .map((r) => ({
          key: r.category,
          name: categoryLabel(r.category),
          hours: r.hours,
          sharePct: r.sharePct,
          value: r.hours,
        })),
    [data, categoryLabel],
  );

  const verticalBars = useMemo(
    () =>
      verticalPie.slice(0, 8).map((r) => ({
        name: r.name.length > 18 ? `${r.name.slice(0, 16)}…` : r.name,
        fullName: r.name,
        hours: r.hours,
      })),
    [verticalPie],
  );

  const activeVerticalCount = verticalPie.length;
  const coveragePct = data
    ? Math.round((activeVerticalCount / Math.max(data.byVertical.length, 1)) * 100)
    : 0;

  const focusSplit = useMemo(() => {
    if (!data || !data.topVertical || data.totalHours <= 0) return null;
    const top = data.topVertical.hours;
    const rest = Math.max(data.totalHours - top, 0);
    return [
      { name: verticalLabel(data.topVertical.vertical), value: top, fill: '#C8202B' },
      { name: 'Everything else', value: rest, fill: '#94A099' },
    ];
  }, [data, verticalLabel]);

  return (
    <div className="col fade-up" style={{ gap: 20 }}>
      <div className="flex items-end justify-between" style={{ gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p className="eyebrow">Intelligence</p>
          <h2 className="text-2xl font-bold mt-1" style={{ color: 'var(--ink)' }}>Time Balance</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)', maxWidth: 520 }}>
            See where your hours concentrate across verticals and categories, and stretch toward a well-rounded profile.
          </p>
        </div>
        <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              className={`btn btn-sm ${range === r.days ? 'btn-primary' : 'btn-soft'}`}
              onClick={() => setRange(r.days)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Snapshot twin of the sidebar tracker: light page palette */}
      <div className="time-balance-snapshot-grid">
        <BalanceSnapshotCard
          data={data}
          range={range}
          isLoading={isLoading}
          verticalLabel={verticalLabel}
          categoryLabel={categoryLabel}
        />

        {/* Hero portrait */}
        <div
          className="card time-balance-hero"
          style={{
            overflow: 'hidden',
            background: 'var(--surface)',
          }}
        >
          <div className="time-balance-hero-grid time-balance-hero-grid-compact">
            <div
              className="col items-center justify-center text-center card-pad time-balance-hero-score"
              style={{
                gap: 12,
                background: balance.soft,
                minHeight: 200,
              }}
            >
              {isLoading ? (
                <div className="skel" style={{ width: 100, height: 100, borderRadius: 99 }} />
              ) : (
                <>
                  <div
                    style={{
                      width: 112,
                      height: 112,
                      borderRadius: 99,
                      display: 'grid',
                      placeItems: 'center',
                      background: `
                        radial-gradient(circle at center, var(--surface) 56%, transparent 57%),
                        conic-gradient(${balance.tone} ${data?.balanceScore ?? 0}%, rgba(20,33,26,.08) 0)
                      `,
                      boxShadow: 'var(--shadow-md)',
                    }}
                  >
                    <div>
                      <div className="text-3xl font-bold" style={{ color: 'var(--ink)', lineHeight: 1 }}>
                        {data?.balanceScore ?? 0}
                      </div>
                      <div className="text-xs font-bold" style={{ color: 'var(--muted)', letterSpacing: '0.06em' }}>
                        SCORE
                      </div>
                    </div>
                  </div>
                  <div>
                    <p className="text-base font-bold" style={{ color: balance.tone }}>{balance.title}</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--muted)', maxWidth: 200, margin: '6px auto 0' }}>
                      {balance.blurb}
                    </p>
                  </div>
                </>
              )}
            </div>

            <div className="card-pad col" style={{ gap: 16 }}>
              <div className="flex items-center gap-2">
                <ClockFading size={18} style={{ color: 'var(--red)' }} />
                <span className="card-title">Your orbit · last {range} days</span>
              </div>

              {isLoading ? (
                <div className="skel" style={{ height: 88 }} />
              ) : (
                <>
                  <p className="text-sm" style={{ color: 'var(--ink-2)', lineHeight: 1.5, maxWidth: 560 }}>
                    {data?.insight}
                  </p>

                  <div className="time-balance-stats time-balance-stats-compact">
                    {[
                      { icon: <Clock3 size={16} />, label: 'Hours logged', value: `${data?.totalHours ?? 0}h` },
                      { icon: <ListChecks size={16} />, label: 'Tasks', value: String(data?.taskCount ?? 0) },
                      { icon: <Layers size={16} />, label: 'Verticals touched', value: String(activeVerticalCount) },
                      { icon: <Target size={16} />, label: 'Org coverage', value: `${coveragePct}%` },
                    ].map((stat) => (
                      <div
                        key={stat.label}
                        style={{
                          padding: '12px 12px',
                          borderRadius: 'var(--radius-sm)',
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                        }}
                      >
                        <div className="flex items-center gap-2" style={{ color: 'var(--red)', marginBottom: 6 }}>
                          {stat.icon}
                          <span className="text-xs font-semibold">{stat.label}</span>
                        </div>
                        <p className="text-xl font-bold" style={{ color: 'var(--ink)' }}>{stat.value}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Dual pies */}
      <div className="time-balance-dual">
        <div className="card card-pad">
          <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
            <PieChartIcon size={16} style={{ color: 'var(--red)' }} />
            <span className="card-title">Hours by vertical</span>
          </div>
          {isLoading ? (
            <div className="skel" style={{ height: 280 }} />
          ) : verticalPie.length === 0 ? (
            <EmptyState title="No vertical mix yet" body="When you log tasks, this pie shows where time lands." />
          ) : (
            <div className="time-balance-pie">
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={verticalPie}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={58}
                    outerRadius={92}
                    paddingAngle={2}
                    stroke="var(--surface)"
                    strokeWidth={2}
                  >
                    {verticalPie.map((entry, i) => (
                      <Cell key={entry.key} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<DonutTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="col" style={{ gap: 8, maxHeight: 260, overflowY: 'auto', paddingRight: 4 }}>
                {verticalPie.map((row, i) => (
                  <div key={row.key} className="flex items-center gap-2">
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 99,
                        background: PIE_COLORS[i % PIE_COLORS.length],
                        flexShrink: 0,
                      }}
                    />
                    <span className="text-xs" style={{ color: 'var(--ink-2)', flex: 1, minWidth: 0 }} title={row.name}>
                      {row.name}
                    </span>
                    <b className="text-xs" style={{ color: 'var(--ink)' }}>{row.sharePct}%</b>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="card card-pad">
          <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
            <PieChartIcon size={16} style={{ color: 'var(--red)' }} />
            <span className="card-title">Hours by category</span>
          </div>
          {isLoading ? (
            <div className="skel" style={{ height: 280 }} />
          ) : categoryPie.length === 0 ? (
            <EmptyState title="No category mix yet" body="Categories reveal how you work: deployment, support, bids, and more." />
          ) : (
            <div className="time-balance-pie">
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={categoryPie}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={58}
                    outerRadius={92}
                    paddingAngle={2}
                    stroke="var(--surface)"
                    strokeWidth={2}
                  >
                    {categoryPie.map((entry, i) => (
                      <Cell key={entry.key} fill={PIE_COLORS[(i + 3) % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<DonutTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="col" style={{ gap: 8, maxHeight: 260, overflowY: 'auto', paddingRight: 4 }}>
                {categoryPie.map((row, i) => (
                  <div key={row.key} className="flex items-center gap-2">
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 99,
                        background: PIE_COLORS[(i + 3) % PIE_COLORS.length],
                        flexShrink: 0,
                      }}
                    />
                    <span className="text-xs" style={{ color: 'var(--ink-2)', flex: 1, minWidth: 0 }} title={row.name}>
                      {row.name}
                    </span>
                    <b className="text-xs" style={{ color: 'var(--ink)' }}>{row.sharePct}%</b>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Focus split + ranking bars */}
      <div className="time-balance-dual">
        <div className="card card-pad">
          <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
            <ClockFading size={16} style={{ color: 'var(--red)' }} />
            <span className="card-title">Focus vs the rest</span>
          </div>
          {isLoading ? (
            <div className="skel" style={{ height: 220 }} />
          ) : !focusSplit || focusSplit[0].value <= 0 ? (
            <EmptyState title="No focus signal" body="Your top vertical share will appear here." />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={focusSplit}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={78}
                    paddingAngle={3}
                    stroke="var(--surface)"
                    strokeWidth={2}
                  >
                    {focusSplit.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number, name: string) => [`${v}h`, name]} />
                </PieChart>
              </ResponsiveContainer>
              <p className="text-xs text-center" style={{ color: 'var(--muted)' }}>
                <b style={{ color: 'var(--ink)' }}>{data?.topVertical?.sharePct}%</b> in{' '}
                {data?.topVertical ? verticalLabel(data.topVertical.vertical) : '-'}
                {data?.topCategory ? (
                  <>
                    {' '}· top category <b style={{ color: 'var(--ink)' }}>{categoryLabel(data.topCategory.category)}</b>
                  </>
                ) : null}
              </p>
            </>
          )}
        </div>

        <div className="card card-pad">
          <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
            <Layers size={16} style={{ color: 'var(--red)' }} />
            <span className="card-title">Vertical ranking</span>
          </div>
          {isLoading ? (
            <div className="skel" style={{ height: 220 }} />
          ) : verticalBars.length === 0 ? (
            <EmptyState title="Nothing ranked yet" body="Hours by vertical will sort here." />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={verticalBars} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} unit="h" />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(v: number) => [`${v}h`, 'Hours']}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ''}
                />
                <Bar dataKey="hours" fill="#C8202B" radius={[0, 6, 6, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Coverage constellation */}
      <div className="card card-pad">
        <div className="flex items-center justify-between" style={{ gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          <div className="flex items-center gap-2">
            <Compass size={16} style={{ color: 'var(--red)' }} />
            <span className="card-title">Vertical coverage map</span>
          </div>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Brighter tiles = more hours. Grey tiles are stretch opportunities.
          </p>
        </div>

        {isLoading ? (
          <div className="skel" style={{ height: 140 }} />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: 10,
            }}
          >
            {(data?.byVertical ?? []).map((row) => {
              const intensity = data && data.totalHours > 0 ? row.hours / data.totalHours : 0;
              const active = row.hours > 0;
              return (
                <div
                  key={row.vertical}
                  style={{
                    padding: '12px 12px',
                    borderRadius: 'var(--radius)',
                    border: `1px solid ${active ? 'transparent' : 'var(--border)'}`,
                    background: active
                      ? `color-mix(in srgb, #C8202B ${Math.max(intensity * 100, 12)}%, var(--surface))`
                      : 'var(--surface-2)',
                    color: active && intensity > 0.35 ? '#fff' : 'var(--ink)',
                    minHeight: 84,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <span className="text-xs font-semibold" style={{ lineHeight: 1.35 }}>
                    {verticalLabel(row.vertical)}
                  </span>
                  <div className="flex items-end justify-between">
                    <b className="text-sm">{active ? `${row.hours}h` : '-'}</b>
                    <span className="text-xs" style={{ opacity: 0.85 }}>
                      {active ? `${row.sharePct}%` : 'untouched'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Stretch quests */}
      {!isLoading && data && data.neglectedVerticals.length > 0 && data.totalHours > 0 && (
        <div className="card card-pad">
          <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
            <Target size={16} style={{ color: 'var(--red)' }} />
            <span className="card-title">Stretch quests</span>
          </div>
          <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>
            Log at least one task in these untouched verticals to lift your balance score.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {data.neglectedVerticals.slice(0, 6).map((v, idx) => (
              <div
                key={v}
                style={{
                  padding: '14px 14px',
                  borderRadius: 'var(--radius)',
                  border: '1px dashed var(--border-strong)',
                  background: 'var(--surface-2)',
                }}
              >
                <span className="text-xs font-bold" style={{ color: 'var(--muted)', letterSpacing: '0.06em' }}>
                  QUEST {idx + 1}
                </span>
                <p className="text-sm font-bold mt-1" style={{ color: 'var(--ink)' }}>
                  {verticalLabel(v)}
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                  0 hours in this range. A short log counts.
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default TimeBalancePage;
