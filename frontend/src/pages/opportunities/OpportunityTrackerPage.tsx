import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Target, Plus, Search, TrendingUp, FileText, MessagesSquare,
  Trophy, XCircle, Wallet, Percent,
  CircleDollarSign,
  Navigation2,
  Paperclip,
  Scale,
  PiggyBank,
  Building2,
  Cpu,
  StickyNote,
  CalendarClock,
} from 'lucide-react';
import api from '@/api/client';
import {
  Opportunity, OpportunityStats, PaginatedResponse, PRIORITY_OPTIONS, STAGE_OPTIONS,
} from '@/types/api';
import {
  formatKsh, stagePillClass, priorityPillClass, stageLabel, priorityLabel, currentValue, daysUntil,
} from '@/utils/opportunity';
import { useCustomerOptions, useOems, useTeamDirectory } from '@/hooks/useOpportunityOptions';
import OpportunityFormModal from './OpportunityFormModal';
import OpportunityDetailModal from './OpportunityDetailModal';
import CustomerDetailModal from './CustomerDetailModal';
import CustomersTab from './CustomersTab';
import OemsTab from './OemsTab';
import PageLoader from '@/components/shared/PageLoader';

type Tab = 'opportunities' | 'customers' | 'oems';

const th = { padding: '10px 14px', color: 'var(--muted)', fontWeight: 650, fontSize: 12, whiteSpace: 'nowrap' } as const;
const td = { padding: '10px 14px' } as const;

function OpportunityTrackerPage() {
  const [tab, setTab] = useState<Tab>('opportunities');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [oemFilter, setOemFilter] = useState('');
  const [managerFilter, setManagerFilter] = useState('');
  const [createFor, setCreateFor] = useState<{ id: string; name: string } | null | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: staffData } = useTeamDirectory();
  const staff = staffData ?? [];
  const { data: customerOptions } = useCustomerOptions();
  const { data: oems } = useOems();

  const { data: stats } = useQuery({
    queryKey: ['opportunities', 'stats'],
    queryFn: async () => {
      const res = await api.get<{ data: OpportunityStats }>('/opportunities/stats');
      return res.data.data;
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ['opportunities', 'list', page, search, stageFilter, priorityFilter, customerFilter, oemFilter, managerFilter],
    queryFn: async () => {
      const params: Record<string, string | number> = { page, limit: 15 };
      if (search) params.search = search;
      if (stageFilter === 'OPEN') params.open = 'true';
      else if (stageFilter) params.stage = stageFilter;
      if (priorityFilter) params.priority = priorityFilter;
      if (customerFilter) params.customerId = customerFilter;
      if (oemFilter) params.oemId = oemFilter;
      if (managerFilter) params.assignedToId = managerFilter;
      const res = await api.get<PaginatedResponse<Opportunity>>('/opportunities', { params });
      return res.data;
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['opportunities'] });
    queryClient.invalidateQueries({ queryKey: ['customers'] });
  };
  const filterChange = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPage(1); };

  const opportunities = data?.data ?? [];
  const meta = data?.meta ?? { total: 0, page: 1, limit: 15, totalPages: 0 };
  const icoStyle = { background: 'var(--red-soft)', color: 'var(--red)' };
  const hasFilters = !!(search || stageFilter || priorityFilter || customerFilter || oemFilter || managerFilter);

  const statTiles = stats ? [
    { Icon: Target, label: 'Total Opportunities', value: stats.total },
    { Icon: Navigation2, label: 'New', value: stats.new },
    { Icon: TrendingUp, label: 'In Progress', value: stats.inProgress },
    { Icon: FileText, label: 'Proposals', value: stats.proposals },
    { Icon: MessagesSquare, label: 'Negotiation', value: stats.negotiation },
    { Icon: Trophy, label: 'Won', value: stats.won },
    { Icon: XCircle, label: 'Lost', value: stats.lost },
    { Icon: Percent, label: 'Win Rate', value: `${stats.winRate}%` },
    { Icon: Wallet, label: 'Pipeline Value', value: formatKsh(stats.pipelineValue), money: true },
    { Icon: Scale, label: 'Weighted Pipeline', value: formatKsh(stats.weightedPipeline), money: true, hint: 'Value × probability of winning' },
    { Icon: PiggyBank, label: 'Open Client Budgets', value: formatKsh(stats.openClientBudget), money: true },
    { Icon: CircleDollarSign, label: 'Won Value', value: formatKsh(stats.wonValue), money: true },
    { Icon: Building2, label: 'Active Customers', value: stats.activeCustomers },
  ] : [];
  const topOems = (stats?.byOem ?? []).filter((o) => o.openCount > 0).slice(0, 8);
  const maxOemValue = Math.max(1, ...topOems.map((o) => o.openValue));

  return (
    <div className="col" style={{ gap: 20 }}>
      <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <p className="eyebrow">Sales</p>
          <h2 className="text-2xl font-bold mt-1" style={{ color: 'var(--ink)' }}>Opportunity Tracker</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
            Customers, contacts, OEMs and the account team for every deal - from identification through won/lost.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreateFor(null)}>
          <Plus size={16} /> Add Opportunity
        </button>
      </div>

      {stats && (
        <div className="stat-grid">
          {statTiles.map(({ Icon, label, value, money, hint }) => (
            <div className="stat" key={label} title={hint}>
              <div className="stat-ico" style={icoStyle}><Icon /></div>
              <div className="stat-label">{label}</div>
              <div className="stat-val" style={money ? { fontSize: 24 } : undefined}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {topOems.length > 0 && (
        <div className="card card-pad col" style={{ gap: 10 }}>
          <span className="card-title flex items-center gap-2"><Cpu size={15} style={{ color: 'var(--red)' }} /> Open pipeline by OEM</span>
          <div className="col" style={{ gap: 6 }}>
            {topOems.map((o) => (
              <button
                key={o.oemId} type="button"
                onClick={() => { setTab('opportunities'); setOemFilter(o.oemId); setStageFilter('OPEN'); setPage(1); }}
                className="flex items-center gap-3"
                style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left' }}
                title={`Show open ${o.name} opportunities`}
              >
                <span style={{ width: 110, fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', flexShrink: 0 }}>{o.name}</span>
                <span style={{ flex: 1, height: 10, borderRadius: 999, background: 'var(--surface-3)', overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: '100%', width: `${(o.openValue / maxOemValue) * 100}%`, background: 'var(--red)', borderRadius: 999 }} />
                </span>
                <span style={{ width: 150, fontSize: 12, color: 'var(--muted)', textAlign: 'right', flexShrink: 0 }}>
                  <b style={{ color: 'var(--ink)' }}>{formatKsh(o.openValue)}</b> · {o.openCount} deal{o.openCount === 1 ? '' : 's'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="tabs" role="tablist">
        {([
          ['opportunities', 'Opportunities', Target],
          ['customers', 'Customers', Building2],
          ['oems', 'OEMs', Cpu],
        ] as const).map(([key, label, Icon]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={`tab${tab === key ? ' on' : ''}`} onClick={() => setTab(key)}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === 'customers' && <CustomersTab onOpen={setCustomerId} />}
      {tab === 'oems' && <OemsTab onFilter={(id) => { setOemFilter(id); setStageFilter('OPEN'); setPage(1); setTab('opportunities'); }} />}

      {tab === 'opportunities' && (
        <>
          <div className="card card-pad flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
            <div className="input-icon" style={{ maxWidth: 320, flex: 1, minWidth: 200 }}>
              <input
                className="input"
                placeholder="Search opportunity, customer, contact, OEM, tender ref…"
                value={search}
                onChange={(e) => filterChange(setSearch)(e.target.value)}
              />
              <Search size={16} style={{ color: 'var(--red)' }} />
            </div>
            <select className="eoc-select" value={customerFilter} onChange={(e) => filterChange(setCustomerFilter)(e.target.value)} style={{ maxWidth: 200 }} aria-label="Customer">
              <option value="">All customers</option>
              {customerOptions?.map((c) => <option key={c.id} value={c.id}>{c.shortName || c.name}</option>)}
            </select>
            <select className="eoc-select" value={oemFilter} onChange={(e) => filterChange(setOemFilter)(e.target.value)} style={{ maxWidth: 160 }} aria-label="OEM">
              <option value="">All OEMs</option>
              {oems?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <select className="eoc-select" value={managerFilter} onChange={(e) => filterChange(setManagerFilter)(e.target.value)} style={{ maxWidth: 190 }} aria-label="Account manager">
              <option value="">All account managers</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select className="eoc-select" value={stageFilter} onChange={(e) => filterChange(setStageFilter)(e.target.value)} style={{ maxWidth: 180 }} aria-label="Stage">
              <option value="">All stages</option>
              <option value="OPEN">Open (not won/lost)</option>
              {STAGE_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <select className="eoc-select" value={priorityFilter} onChange={(e) => filterChange(setPriorityFilter)(e.target.value)} style={{ maxWidth: 150 }} aria-label="Priority">
              <option value="">All priorities</option>
              {PRIORITY_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            {hasFilters && (
              <button
                type="button" className="btn btn-ghost btn-sm"
                onClick={() => { setSearch(''); setStageFilter(''); setPriorityFilter(''); setCustomerFilter(''); setOemFilter(''); setManagerFilter(''); setPage(1); }}
              >
                Clear
              </button>
            )}
          </div>

          <div className="card">
            {isLoading ? (
              <div className="card-pad"><PageLoader height={260} /></div>
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
                      {['Opportunity', 'Customer', 'OEMs', 'Stage', 'Priority', 'Account manager', 'Client budget', 'Value', 'Deadline / follow-up', ''].map((h, i) => (
                        <th key={i} style={th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {opportunities.map((o) => {
                      const deadline = o.submissionDeadline ?? o.followUpDate;
                      const dueIn = daysUntil(deadline);
                      const open = o.stage !== 'WON' && o.stage !== 'LOST';
                      const urgent = open && dueIn != null && dueIn <= 3;
                      return (
                        <tr key={o.id} style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => setSelectedId(o.id)}>
                          <td style={td}>
                            <div style={{ fontWeight: 650, color: 'var(--ink)' }}>{o.name}</div>
                            {o.tenderReference && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{o.tenderReference}</div>}
                          </td>
                          <td style={td}>
                            {o.customerId ? (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setCustomerId(o.customerId!); }}
                                style={{ border: 0, background: 'none', padding: 0, font: 'inherit', color: 'var(--ink)', cursor: 'pointer', textAlign: 'left' }}
                                title="Open customer"
                              >
                                {o.customer?.shortName || o.customerName}
                              </button>
                            ) : o.customerName}
                          </td>
                          <td style={td}>
                            <div className="flex flex-wrap gap-1">
                              {(o.oems ?? []).length === 0
                                ? <span style={{ color: 'var(--muted-2)' }}>-</span>
                                : o.oems!.map((x) => <span key={x.id} className="pill pill-blue" style={{ fontSize: 11 }}>{x.oem.name}</span>)}
                            </div>
                          </td>
                          <td style={td}><span className={stagePillClass(o.stage)}>{stageLabel(o.stage)}</span></td>
                          <td style={td}><span className={priorityPillClass(o.priority)}>{priorityLabel(o.priority)}</span></td>
                          <td style={{ ...td, color: 'var(--muted)' }}>
                            {o.assignedTo?.name ?? '-'}
                            {(o._count?.team ?? 0) > 1 && <span style={{ fontSize: 11.5 }}> +{o._count!.team! - 1}</span>}
                          </td>
                          <td style={{ ...td, whiteSpace: 'nowrap' }}>{formatKsh(o.clientBudget)}</td>
                          <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>{formatKsh(currentValue(o))}</td>
                          <td style={{ ...td, whiteSpace: 'nowrap', color: urgent ? 'var(--red)' : 'var(--muted)', fontWeight: urgent ? 650 : 400 }}>
                            {deadline ? (
                              <span className="flex items-center gap-1" title={o.submissionDeadline ? 'Submission deadline' : 'Follow-up date'}>
                                {o.submissionDeadline && <CalendarClock size={12} />}
                                {deadline.slice(0, 10)}
                              </span>
                            ) : '-'}
                          </td>
                          <td style={{ ...td, whiteSpace: 'nowrap' }}>
                            <span className="flex items-center gap-2" style={{ color: 'var(--muted)', fontSize: 12 }}>
                              {(o._count?.notes ?? 0) > 0 && <span title="Notes" className="flex items-center gap-1"><StickyNote size={12} /> {o._count!.notes}</span>}
                              {(o._count?.attachments ?? 0) > 0 && <span title="Files" className="flex items-center gap-1"><Paperclip size={12} /> {o._count!.attachments}</span>}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
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
        </>
      )}

      {customerId && (
        <CustomerDetailModal
          id={customerId}
          staff={staff}
          onClose={() => setCustomerId(null)}
          onOpenOpportunity={(id) => { setCustomerId(null); setSelectedId(id); }}
          onNewOpportunity={(c) => { setCustomerId(null); setCreateFor(c); }}
          onDeleted={() => { setCustomerId(null); refresh(); }}
        />
      )}

      {createFor !== undefined && (
        <OpportunityFormModal
          staff={staff}
          defaultCustomer={createFor ?? undefined}
          onClose={() => setCreateFor(undefined)}
          onCreated={(id) => { setCreateFor(undefined); refresh(); setSelectedId(id); }}
        />
      )}

      {selectedId && (
        <OpportunityDetailModal
          id={selectedId}
          staff={staff}
          onClose={() => setSelectedId(null)}
          onChanged={refresh}
          onDeleted={() => { setSelectedId(null); refresh(); }}
          onOpenCustomer={(id) => { setSelectedId(null); setCustomerId(id); }}
        />
      )}
    </div>
  );
}

export default OpportunityTrackerPage;
