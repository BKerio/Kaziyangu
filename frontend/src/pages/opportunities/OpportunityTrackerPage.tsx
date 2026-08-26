import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Target, Plus, Search, TrendingUp, FileText, MessagesSquare,
  Trophy, XCircle, Wallet, Percent,
  CircleDollarSign,
  Navigation2,
  Paperclip,
} from 'lucide-react';
import api from '@/api/client';
import {
  Opportunity, OpportunityStats, PaginatedResponse, PRIORITY_OPTIONS, STAGE_OPTIONS, User,
} from '@/types/api';
import { formatKsh, stagePillClass, priorityPillClass, stageLabel, priorityLabel } from '@/utils/opportunity';
import OpportunityFormModal from './OpportunityFormModal';
import OpportunityDetailModal from './OpportunityDetailModal';

function OpportunityTrackerPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: stats } = useQuery({
    queryKey: ['opportunities', 'stats'],
    queryFn: async () => {
      const res = await api.get<{ data: OpportunityStats }>('/opportunities/stats');
      return res.data.data;
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ['opportunities', 'list', page, search, stageFilter, priorityFilter],
    queryFn: async () => {
      const params: Record<string, string | number> = { page, limit: 15 };
      if (search) params.search = search;
      if (stageFilter) params.stage = stageFilter;
      if (priorityFilter) params.priority = priorityFilter;
      const res = await api.get<PaginatedResponse<Opportunity>>('/opportunities', { params });
      return res.data;
    },
  });

  const { data: staffData } = useQuery({
    queryKey: ['admin', 'users', 'all'],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<User>>('/admin/users', { params: { limit: 200 } });
      return res.data.data;
    },
  });
  const staff = staffData ?? [];

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['opportunities'] });
  };

  const opportunities = data?.data ?? [];
  const meta = data?.meta ?? { total: 0, page: 1, limit: 15, totalPages: 0 };
  const icoStyle = { background: 'var(--red-soft)', color: 'var(--red)' };

  return (
    <div className="col" style={{ gap: 20 }}>
      <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <p className="eyebrow">Sales</p>
          <h2 className="text-2xl font-bold mt-1" style={{ color: 'var(--ink)' }}>Opportunity Tracker</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
            From identification through won/lost - the team's shared sales pipeline.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
          <Plus size={16} /> Add Opportunity
        </button>
      </div>

      {stats && (
        <div className="stat-grid">
          <div className="stat">
            <div className="stat-ico" style={icoStyle}><Target /></div>
            <div className="stat-label">Total Opportunities</div>
            <div className="stat-val">{stats.total}</div>
          </div>
          <div className="stat">
            <div className="stat-ico" style={icoStyle}><Navigation2 /></div>
            <div className="stat-label">New Opportunities</div>
            <div className="stat-val">{stats.new}</div>
          </div>
          <div className="stat">
            <div className="stat-ico" style={icoStyle}><TrendingUp /></div>
            <div className="stat-label">In Progress</div>
            <div className="stat-val">{stats.inProgress}</div>
          </div>
          <div className="stat">
            <div className="stat-ico" style={icoStyle}><FileText /></div>
            <div className="stat-label">Proposals</div>
            <div className="stat-val">{stats.proposals}</div>
          </div>
          <div className="stat">
            <div className="stat-ico" style={icoStyle}><MessagesSquare /></div>
            <div className="stat-label">Negotiation</div>
            <div className="stat-val">{stats.negotiation}</div>
          </div>
          <div className="stat">
            <div className="stat-ico" style={icoStyle}><Trophy /></div>
            <div className="stat-label">Won</div>
            <div className="stat-val">{stats.won}</div>
          </div>
          <div className="stat">
            <div className="stat-ico" style={icoStyle}><XCircle /></div>
            <div className="stat-label">Lost</div>
            <div className="stat-val">{stats.lost}</div>
          </div>
          <div className="stat">
            <div className="stat-ico" style={icoStyle}><Wallet /></div>
            <div className="stat-label">Pipeline Value</div>
            <div className="stat-val" style={{ fontSize: 24 }}>{formatKsh(stats.pipelineValue)}</div>
          </div>
          <div className="stat">
            <div className="stat-ico" style={icoStyle}><CircleDollarSign /></div>
            <div className="stat-label">Won Value</div>
            <div className="stat-val" style={{ fontSize: 24 }}>{formatKsh(stats.wonValue)}</div>
          </div>
          <div className="stat">
            <div className="stat-ico" style={icoStyle}><Percent /></div>
            <div className="stat-label">Win Rate</div>
            <div className="stat-val">{stats.winRate}%</div>
          </div>
        </div>
      )}

      <div className="card card-pad flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
        <div className="input-icon" style={{ maxWidth: 320, flex: 1 }}>
          <input
            className="input"
            placeholder="Search by opportunity, customer, or contact…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
          <Search size={16} style={{ color: 'var(--red)' }} />
        </div>
        <select className="eoc-select" value={stageFilter} onChange={(e) => { setStageFilter(e.target.value); setPage(1); }} style={{ maxWidth: 200 }}>
          <option value="">All stages</option>
          {STAGE_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select className="eoc-select" value={priorityFilter} onChange={(e) => { setPriorityFilter(e.target.value); setPage(1); }} style={{ maxWidth: 160 }}>
          <option value="">All priorities</option>
          {PRIORITY_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="card-pad"><div className="skel" style={{ height: 260 }} /></div>
        ) : opportunities.length === 0 ? (
          <div className="card-pad flex flex-col items-center text-center" style={{ gap: 8, padding: '48px 20px' }}>
            <Target size={32} style={{ color: 'var(--red)' }} />
            <p className="text-base font-bold" style={{ color: 'var(--ink)' }}>No opportunities found</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                  {['Opportunity', 'Customer', 'Stage', 'Priority', 'Assigned to', 'Est. Value', 'Follow-up', 'Files'].map((h) => (
                    <th key={h} style={{ padding: '10px 14px', color: 'var(--muted)', fontWeight: 650, fontSize: 12 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {opportunities.map((o) => (
                  <tr
                    key={o.id}
                    style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                    onClick={() => setSelectedId(o.id)}
                  >
                    <td style={{ padding: '10px 14px', fontWeight: 650, color: 'var(--ink)' }}>{o.name}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <div>{o.customerName}</div>
                      {o.contactPerson && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{o.contactPerson}</div>}
                    </td>
                    <td style={{ padding: '10px 14px' }}><span className={stagePillClass(o.stage)}>{stageLabel(o.stage)}</span></td>
                    <td style={{ padding: '10px 14px' }}><span className={priorityPillClass(o.priority)}>{priorityLabel(o.priority)}</span></td>
                    <td style={{ padding: '10px 14px', color: 'var(--muted)' }}>{o.assignedTo?.name ?? '-'}</td>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{formatKsh(o.estimatedValue)}</td>
                    <td style={{ padding: '10px 14px', color: 'var(--muted)' }}>{o.followUpDate?.slice(0, 10) ?? '-'}</td>
                    <td style={{ padding: '10px 14px' }}>
                      {o._count?.attachments ? (
                        <span className="pill" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Paperclip size={12} /> {o._count.attachments}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--muted-2)' }}>-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {meta.totalPages > 1 && (
          <div className="flex items-center justify-between card-pad" style={{ borderTop: '1px solid var(--border)' }}>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>Page {meta.page} of {meta.totalPages}</span>
            <div className="flex gap-2">
              <button className="btn btn-soft btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
              <button className="btn btn-soft btn-sm" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          </div>
        )}
      </div>

      {createOpen && (
        <OpportunityFormModal
          staff={staff}
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => { setCreateOpen(false); refresh(); setSelectedId(id); }}
        />
      )}

      {selectedId && (
        <OpportunityDetailModal
          id={selectedId}
          staff={staff}
          onClose={() => setSelectedId(null)}
          onChanged={refresh}
          onDeleted={() => { setSelectedId(null); refresh(); }}
        />
      )}
    </div>
  );
}

export default OpportunityTrackerPage;
