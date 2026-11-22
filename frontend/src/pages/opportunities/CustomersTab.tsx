import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, Plus, Search, Star } from 'lucide-react';
import api from '@/api/client';
import AppLoader from '@/components/shared/AppLoader';
import PageLoader from '@/components/shared/PageLoader';
import { Customer, PaginatedResponse } from '@/types/api';
import { formatKsh } from '@/utils/opportunity';
import ContactLinks from './components/ContactLinks';
import { useOpportunityMutation } from './components/shared';

const th = { padding: '10px 14px', color: 'var(--muted)', fontWeight: 650, fontSize: 12 } as const;
const td = { padding: '10px 14px' } as const;

/** All customer accounts with their contacts and pipeline roll-ups. */
function CustomersTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [industry, setIndustry] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['customers', 'list', page, search],
    queryFn: async () => {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (search) params.search = search;
      return (await api.get<PaginatedResponse<Customer>>('/customers', { params })).data;
    },
  });

  const create = useOpportunityMutation(
    () => api.post<{ data: Customer }>('/customers', { name, shortName, industry }),
    { success: 'Customer added', error: 'Could not add customer' },
    () => { setAdding(false); setName(''); setShortName(''); setIndustry(''); },
  );

  const customers = data?.data ?? [];
  const meta = data?.meta ?? { total: 0, page: 1, limit: 20, totalPages: 0 };

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card card-pad flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
        <div className="input-icon" style={{ maxWidth: 320, flex: 1 }}>
          <input
            className="input" placeholder="Search customers or contacts…" value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
          <Search size={16} style={{ color: 'var(--red)' }} />
        </div>
        <button type="button" className="btn btn-soft" style={{ marginLeft: 'auto' }} onClick={() => setAdding((v) => !v)}>
          <Plus size={15} /> Add customer
        </button>
      </div>

      {adding && (
        <div className="card card-pad flex items-end gap-2" style={{ flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: 2, minWidth: 220 }}>
            <label className="label" htmlFor="nc-full">Customer name</label>
            <input id="nc-full" className="input" placeholder="e.g. Kenya Power & Lighting Company" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 120 }}>
            <label className="label" htmlFor="nc-short">Short name</label>
            <input id="nc-short" className="input" placeholder="e.g. KPLC" value={shortName} onChange={(e) => setShortName(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 140 }}>
            <label className="label" htmlFor="nc-ind">Industry</label>
            <input id="nc-ind" className="input" placeholder="e.g. Energy" value={industry} onChange={(e) => setIndustry(e.target.value)} />
          </div>
          <button type="button" className="btn btn-primary" disabled={!name.trim() || create.isPending} onClick={() => create.mutate(undefined)}>
            {create.isPending ? <AppLoader size={18} /> : null} Save
          </button>
        </div>
      )}

      <div className="card">
        {isLoading ? (
          <div className="card-pad"><PageLoader height={260} /></div>
        ) : customers.length === 0 ? (
          <div className="card-pad flex flex-col items-center text-center" style={{ gap: 8, padding: '48px 20px' }}>
            <Building2 size={32} style={{ color: 'var(--red)' }} />
            <p className="text-base font-bold" style={{ color: 'var(--ink)' }}>No customers found</p>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>Customers are also created automatically when you add an opportunity.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                  {['Customer', 'Primary contact', 'Account owner', 'Open deals', 'Open pipeline', 'Won value', 'Contacts'].map((h) => <th key={h} style={th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => onOpen(c.id)}>
                    <td style={td}>
                      <div style={{ fontWeight: 650, color: 'var(--ink)' }}>{c.shortName || c.name}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{[c.shortName ? c.name : null, c.industry].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td style={td}>
                      {c.primaryContact ? (
                        <div className="col" style={{ gap: 2 }}>
                          <span className="flex items-center gap-1">
                            <Star size={10} style={{ color: 'var(--gold)' }} fill="currentColor" aria-hidden />
                            {c.primaryContact.name}
                            {c.primaryContact.title && <span style={{ color: 'var(--muted)' }}> · {c.primaryContact.title}</span>}
                          </span>
                          <ContactLinks phone={c.primaryContact.phone} email={c.primaryContact.email} compact />
                        </div>
                      ) : <span style={{ color: 'var(--muted-2)' }}>-</span>}
                    </td>
                    <td style={{ ...td, color: 'var(--muted)' }}>{c.accountManager?.name ?? '-'}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{c.openCount ?? 0} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>/ {c._count?.opportunities ?? 0}</span></td>
                    <td style={{ ...td, fontWeight: 600 }}>{formatKsh(c.openPipeline)}</td>
                    <td style={td}>{formatKsh(c.wonValue)}</td>
                    <td style={{ ...td, color: 'var(--muted)' }}>{c._count?.contacts ?? 0}</td>
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
    </div>
  );
}

export default CustomersTab;
