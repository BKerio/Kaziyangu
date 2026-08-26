import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScrollText, ChevronLeft as CaretLeft, ChevronRight as CaretRight, X, Eye } from 'lucide-react';
import api from '@/api/client';
import { AUDIT_ACTION_OPTIONS, AUDIT_SUBJECT_OPTIONS, AuditAction, AuditLog, AuditSubjectType, PaginatedResponse } from '@/types/api';
import { fmtDateTime } from '@/lib/datetime';

function actionLabel(action: string) {
  return AUDIT_ACTION_OPTIONS.find((a) => a.value === action)?.label ?? action;
}

function subjectLabel(subjectType: string) {
  return AUDIT_SUBJECT_OPTIONS.find((s) => s.value === subjectType)?.label ?? subjectType;
}

function actionPillClass(action: string): string {
  switch (action) {
    case 'CREATE':
    case 'REGISTER':
      return 'pill pill-green';
    case 'UPDATE':
    case 'LOGIN':
      return 'pill pill-blue';
    case 'DELETE':
    case 'LOGIN_FAILED':
      return 'pill pill-red';
    default:
      return 'pill pill-gray';
  }
}

function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<AuditAction | 'ALL'>('ALL');
  const [subjectType, setSubjectType] = useState<AuditSubjectType | 'ALL'>('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [viewing, setViewing] = useState<AuditLog | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'audit-logs', page, action, subjectType, from, to],
    queryFn: async () => {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (action !== 'ALL') params.action = action;
      if (subjectType !== 'ALL') params.subjectType = subjectType;
      if (from) params.from = from;
      if (to) params.to = to;
      const res = await api.get<PaginatedResponse<AuditLog>>('/admin/audit-logs', { params });
      return res.data;
    },
  });

  const resetFilters = () => {
    setAction('ALL');
    setSubjectType('ALL');
    setFrom('');
    setTo('');
    setPage(1);
  };

  const logs = data?.data ?? [];
  const meta = data?.meta ?? { total: 0, page: 1, limit: 20, totalPages: 0 };

  return (
    <div className="col" style={{ gap: 20 }}>
      <div>
        <p className="eyebrow">Management</p>
        <h2 className="text-2xl font-bold mt-1" style={{ color: 'var(--ink)' }}>Audit Logs</h2>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Every create, update, delete and login across the system - {meta.total} entries
        </p>
      </div>

      <div className="card card-pad flex flex-wrap items-end gap-3">
        <div className="field" style={{ minWidth: 160 }}>
          <label className="label">Action</label>
          <select
            className="eoc-select"
            value={action}
            onChange={(e) => { setAction(e.target.value as AuditAction | 'ALL'); setPage(1); }}
          >
            <option value="ALL">All actions</option>
            {AUDIT_ACTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="field" style={{ minWidth: 180 }}>
          <label className="label">Subject</label>
          <select
            className="eoc-select"
            value={subjectType}
            onChange={(e) => { setSubjectType(e.target.value as AuditSubjectType | 'ALL'); setPage(1); }}
          >
            <option value="ALL">All subjects</option>
            {AUDIT_SUBJECT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label">From</label>
          <input className="input" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
        </div>
        <div className="field">
          <label className="label">To</label>
          <input className="input" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
        </div>
        <button className="btn btn-ghost btn-sm" onClick={resetFilters}>Reset</button>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="card-pad"><div className="skel" style={{ height: 260 }} /></div>
        ) : logs.length === 0 ? (
          <div className="card-pad flex flex-col items-center text-center" style={{ gap: 8, padding: '48px 20px' }}>
            <ScrollText size={32} style={{ color: 'var(--red)' }} />
            <p className="text-base font-bold" style={{ color: 'var(--ink)' }}>No activity found</p>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>Try widening your filters.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                  {['When', 'Actor', 'Action', 'Subject', 'Summary', ''].map((h) => (
                    <th key={h} style={{ padding: '10px 14px', color: 'var(--muted)', fontWeight: 650, fontSize: 12 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map((entry) => (
                  <tr key={entry.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>{fmtDateTime(entry.createdAt)}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <div className="col" style={{ gap: 1 }}>
                        <b style={{ fontSize: 13 }}>{entry.user?.name ?? 'Unknown'}</b>
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{entry.user?.email}</span>
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px' }}><span className={actionPillClass(entry.action)}>{actionLabel(entry.action)}</span></td>
                    <td style={{ padding: '10px 14px' }}>{subjectLabel(entry.subjectType)}</td>
                    <td style={{ padding: '10px 14px', maxWidth: 360 }}>{entry.summary ?? '-'}</td>
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                      <button className="icon-btn" title="View details" onClick={() => setViewing(entry)}><Eye size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {meta.totalPages > 1 && (
          <div className="flex items-center justify-between card-pad" style={{ borderTop: '1px solid var(--border)' }}>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>Page {meta.page} of {meta.totalPages} · {meta.total} entries</span>
            <div className="flex gap-2">
              <button className="btn btn-soft btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><CaretLeft size={14} /></button>
              <button className="btn btn-soft btn-sm" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}><CaretRight size={14} /></button>
            </div>
          </div>
        )}
      </div>

      {viewing && <AuditDetailModal entry={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function AuditDetailModal({ entry, onClose }: { entry: AuditLog; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(10,20,15,0.45)' }}>
      <div className="card w-full" style={{ maxWidth: 640, maxHeight: '85vh', overflowY: 'auto' }}>
        <div className="card-head" style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
          <span className="card-title">Activity Detail</span>
          <button className="icon-btn" onClick={onClose} type="button"><X size={16} /></button>
        </div>
        <div className="card-pad col" style={{ gap: 12 }}>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><b>When</b><div style={{ color: 'var(--muted)' }}>{fmtDateTime(entry.createdAt)}</div></div>
            <div><b>Actor</b><div style={{ color: 'var(--muted)' }}>{entry.user?.name} ({entry.user?.email})</div></div>
            <div><b>Action</b><div><span className={actionPillClass(entry.action)}>{actionLabel(entry.action)}</span></div></div>
            <div><b>Subject</b><div style={{ color: 'var(--muted)' }}>{subjectLabel(entry.subjectType)} · {entry.subjectId}</div></div>
          </div>
          {entry.summary && (
            <div className="field">
              <label className="label">Summary</label>
              <p className="text-sm">{entry.summary}</p>
            </div>
          )}
          {entry.oldValues != null && (
            <div className="field">
              <label className="label">Before</label>
              <pre style={{ overflowX: 'auto', background: 'var(--surface-2, #f3f6f4)', padding: 10, borderRadius: 8, fontSize: 11.5 }}>
                {JSON.stringify(entry.oldValues, null, 2)}
              </pre>
            </div>
          )}
          {entry.newValues != null && (
            <div className="field">
              <label className="label">After</label>
              <pre style={{ overflowX: 'auto', background: 'var(--surface-2, #f3f6f4)', padding: 10, borderRadius: 8, fontSize: 11.5 }}>
                {JSON.stringify(entry.newValues, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AuditLogsPage;
