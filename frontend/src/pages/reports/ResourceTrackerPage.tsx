import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp as TrendUp, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '@/api/client';
import { ResourceWeeklyReport } from '@/types/api';

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function utilizationColor(pct: number): string {
  if (pct >= 0.9) return 'var(--green)';
  if (pct >= 0.6) return 'var(--amber)';
  return 'var(--red)';
}

function ResourceTrackerPage() {
  const [weekStart, setWeekStart] = useState<string>(() => new Date().toISOString().slice(0, 10));

  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'resource-weekly', weekStart],
    queryFn: async () => {
      const res = await api.get('/tasks/reports/resource-weekly', { params: { weekStart } });
      return res.data.data as ResourceWeeklyReport;
    },
  });

  const rows = data?.rows ?? [];
  const dayLabels: Array<{ key: keyof ResourceWeeklyReport['rows'][number]['hoursByDay']; label: string }> = [
    { key: 'mon', label: 'Mon' }, { key: 'tue', label: 'Tue' }, { key: 'wed', label: 'Wed' },
    { key: 'thu', label: 'Thu' }, { key: 'fri', label: 'Fri' },
  ];

  return (
    <div className="col" style={{ gap: 20 }}>
      <div className="flex items-center justify-between">
        <div>
          <p className="eyebrow">Reports</p>
          <h2 className="text-2xl font-bold mt-1" style={{ color: 'var(--ink)' }}>Resource Tracker</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Per-person hours logged this week, Mon-Fri</p>
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

      <div className="card">
        {isLoading ? (
          <div className="card-pad"><div className="skel" style={{ height: 240 }} /></div>
        ) : rows.length === 0 ? (
          <div className="card-pad flex flex-col items-center text-center" style={{ gap: 8, padding: '48px 20px' }}>
            <TrendUp size={32} style={{ color: 'var(--red)' }} />
            <p className="text-base font-bold" style={{ color: 'var(--ink)' }}>No active users found</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                  <th style={{ padding: '10px 14px', color: 'var(--muted)', fontWeight: 650, fontSize: 12 }}>Resource</th>
                  {dayLabels.map((d) => (
                    <th key={d.key} style={{ padding: '10px 14px', color: 'var(--muted)', fontWeight: 650, fontSize: 12, textAlign: 'right' }}>{d.label}</th>
                  ))}
                  <th style={{ padding: '10px 14px', color: 'var(--muted)', fontWeight: 650, fontSize: 12, textAlign: 'right' }}>Total</th>
                  <th style={{ padding: '10px 14px', color: 'var(--muted)', fontWeight: 650, fontSize: 12, textAlign: 'right' }}>Utilization</th>
                  <th style={{ padding: '10px 14px', color: 'var(--muted)', fontWeight: 650, fontSize: 12, textAlign: 'right' }}>Completed</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.userId} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{r.name}</td>
                    {dayLabels.map((d) => (
                      <td key={d.key} style={{ padding: '10px 14px', textAlign: 'right' }}>{r.hoursByDay[d.key] || '-'}</td>
                    ))}
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700 }}>{r.totalWeeklyHours}h</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: utilizationColor(r.utilizationPct) }}>
                      {Math.round(r.utilizationPct * 100)}%
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>{r.tasksCompleted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default ResourceTrackerPage;
