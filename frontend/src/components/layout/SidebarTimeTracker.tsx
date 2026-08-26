import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BrainCircuit, ChevronDown, ChevronUp, ArrowUpRight } from 'lucide-react';
import api from '@/api/client';
import { useTaskOptions } from '@/hooks/useTaskOptions';
import { MyTimeStats, TimeBalanceLabel } from '@/types/api';

const BALANCE_COPY: Record<TimeBalanceLabel, { title: string; tone: string }> = {
  none: { title: 'No data yet', tone: 'var(--nav-muted)' },
  narrow: { title: 'Too narrow', tone: '#FF8A80' },
  focused: { title: 'Focused', tone: '#FFB74D' },
  balanced: { title: 'Balanced', tone: '#81C784' },
  well_rounded: { title: 'Well-rounded', tone: '#4FC3F7' },
};

function shortLabel(label: string): string {
  return label.replace(/^\d+\.\s*/, '').replace(/\s*\([^)]*\)\s*/g, ' ').trim();
}

function SidebarTimeTracker() {
  const [open, setOpen] = useState(true);
  const { data: options } = useTaskOptions();

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', 'my-stats'],
    queryFn: async () => {
      const res = await api.get<{ data: MyTimeStats }>('/tasks/my-stats');
      return res.data.data;
    },
    staleTime: 60_000,
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
  const topVerticals = (data?.byVertical ?? []).filter((v) => v.hours > 0).slice(0, 3);
  const topCategories = (data?.byCategory ?? []).filter((c) => c.hours > 0).slice(0, 3);
  const stretch = (data?.neglectedVerticals ?? []).slice(0, 2);

  return (
    <div className="sidebar-tracker">
      <button type="button" className="sidebar-tracker-toggle" onClick={() => setOpen((v) => !v)}>
        <BrainCircuit size={15} />
        <span className="sidebar-tracker-title">Time balance</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <div className="sidebar-tracker-body">
          {isLoading || !data ? (
            <div className="sidebar-tracker-skel" />
          ) : (
            <>
              <div className="sidebar-tracker-score">
                <div className="sidebar-tracker-ring" style={{ ['--score' as string]: `${data.balanceScore}` }}>
                  <b>{data.balanceScore}</b>
                </div>
                <div className="sidebar-tracker-score-meta">
                  <span style={{ color: balance.tone }}>{balance.title}</span>
                  <small>{data.totalHours}h · last 30 days</small>
                </div>
              </div>

              <p className="sidebar-tracker-insight">{data.insight}</p>

              {topVerticals.length > 0 && (
                <div className="sidebar-tracker-block">
                  <div className="sidebar-tracker-label">Verticals</div>
                  {topVerticals.map((row) => (
                    <div key={row.vertical} className="sidebar-tracker-row">
                      <div className="sidebar-tracker-row-head">
                        <span title={verticalLabel(row.vertical)}>{verticalLabel(row.vertical)}</span>
                        <b>{row.sharePct}%</b>
                      </div>
                      <div className="sidebar-tracker-bar">
                        <i style={{ width: `${Math.max(row.sharePct, 4)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {topCategories.length > 0 && (
                <div className="sidebar-tracker-block">
                  <div className="sidebar-tracker-label">Categories</div>
                  {topCategories.map((row) => (
                    <div key={row.category} className="sidebar-tracker-row">
                      <div className="sidebar-tracker-row-head">
                        <span title={categoryLabel(row.category)}>{categoryLabel(row.category)}</span>
                        <b>{row.sharePct}%</b>
                      </div>
                      <div className="sidebar-tracker-bar sidebar-tracker-bar-alt">
                        <i style={{ width: `${Math.max(row.sharePct, 4)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {stretch.length > 0 && data.totalHours > 0 && (
                <div className="sidebar-tracker-nudge">
                  <span>Try next</span>
                  <div className="sidebar-tracker-chips">
                    {stretch.map((v) => (
                      <em key={v}>{verticalLabel(v)}</em>
                    ))}
                  </div>
                </div>
              )}

              <Link to="/time-balance" className="sidebar-tracker-more">
                Full portrait
                <ArrowUpRight size={13} />
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default SidebarTimeTracker;
