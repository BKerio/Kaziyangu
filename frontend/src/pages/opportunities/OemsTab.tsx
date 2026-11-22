import { useState } from 'react';
import { Cpu, Pencil, Plus, Trash2 } from 'lucide-react';
import api from '@/api/client';
import AppLoader from '@/components/shared/AppLoader';
import PageLoader from '@/components/shared/PageLoader';
import { confirmDialog } from '@/lib/alert';
import { useAuthStore } from '@/stores/authStore';
import { Oem } from '@/types/api';
import { useOems } from '@/hooks/useOpportunityOptions';
import { formatKsh } from '@/utils/opportunity';
import ContactLinks from './components/ContactLinks';
import { useOpportunityMutation } from './components/shared';

const emptyDraft = { name: '', category: '', website: '', partnerManagerName: '', partnerManagerPhone: '', partnerManagerEmail: '', notes: '' };
type Draft = typeof emptyDraft;

const th = { padding: '10px 14px', color: 'var(--muted)', fontWeight: 650, fontSize: 12 } as const;
const td = { padding: '10px 14px' } as const;

/** The OEM / vendor catalogue with default partner managers and pipeline per OEM. */
function OemsTab({ onFilter }: { onFilter: (oemId: string) => void }) {
  const isManager = ['ADMIN', 'SUPER_ADMIN'].includes(useAuthStore((s) => s.user?.role) ?? '');
  const { data: oems, isLoading } = useOems();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const close = () => { setEditing(null); setDraft(emptyDraft); };

  const save = useOpportunityMutation(
    (d: Draft) => (editing === 'new' ? api.post('/oems', d) : api.patch(`/oems/${editing}`, d)),
    { success: 'OEM saved', error: 'Could not save OEM' },
    close,
  );
  const remove = useOpportunityMutation(
    (id: string) => api.delete(`/oems/${id}`),
    { success: 'OEM deleted', error: 'Could not delete OEM' },
  );

  const startEdit = (o: Oem) => {
    setDraft({
      name: o.name, category: o.category ?? '', website: o.website ?? '', partnerManagerName: o.partnerManagerName ?? '',
      partnerManagerPhone: o.partnerManagerPhone ?? '', partnerManagerEmail: o.partnerManagerEmail ?? '', notes: o.notes ?? '',
    });
    setEditing(o.id);
  };

  const field = (key: keyof Draft, label: string, props: Record<string, unknown> = {}) => (
    <div className="field" style={{ flex: 1, minWidth: 160 }}>
      <label className="label" htmlFor={`oemf-${key}`}>{label}</label>
      <input id={`oemf-${key}`} className="input" value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} {...props} />
    </div>
  );

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card card-pad flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          OEMs you resell (HPE, Hikvision …). Set a default partner manager here and it's pre-filled when the OEM is added to a deal.
        </p>
        <button type="button" className="btn btn-soft" style={{ marginLeft: 'auto' }} onClick={() => { setDraft(emptyDraft); setEditing('new'); }}>
          <Plus size={15} /> Add OEM
        </button>
      </div>

      {editing !== null && (
        <div className="card card-pad col" style={{ gap: 10 }}>
          <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
            {field('name', 'OEM name', { placeholder: 'e.g. HPE' })}
            {field('category', 'Category', { placeholder: 'e.g. Servers & Storage' })}
            {field('website', 'Website')}
          </div>
          <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
            {field('partnerManagerName', 'Partner / channel manager')}
            {field('partnerManagerPhone', 'Phone', { type: 'tel' })}
            {field('partnerManagerEmail', 'Email', { type: 'email' })}
          </div>
          {field('notes', 'Notes', { placeholder: 'Partner tier, portal link, distributor…' })}
          <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={close}>Cancel</button>
            <button type="button" className="btn btn-primary btn-sm" disabled={!draft.name.trim() || save.isPending} onClick={() => save.mutate(draft)}>
              {save.isPending ? <AppLoader size={16} /> : null} Save
            </button>
          </div>
        </div>
      )}

      <div className="card">
        {isLoading ? (
          <div className="card-pad"><PageLoader height={220} /></div>
        ) : (oems ?? []).length === 0 ? (
          <div className="card-pad flex flex-col items-center text-center" style={{ gap: 8, padding: '48px 20px' }}>
            <Cpu size={32} style={{ color: 'var(--red)' }} />
            <p className="text-base font-bold" style={{ color: 'var(--ink)' }}>No OEMs yet</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                  {['OEM', 'Partner manager', 'Open deals', 'Open value', 'Won', ''].map((h, i) => <th key={i} style={th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {oems!.map((o) => (
                  <tr key={o.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={td}>
                      <div style={{ fontWeight: 650, color: 'var(--ink)' }}>{o.name}</div>
                      {o.category && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{o.category}</div>}
                    </td>
                    <td style={td}>
                      {o.partnerManagerName ? (
                        <div className="col" style={{ gap: 2 }}>
                          {o.partnerManagerName}
                          <ContactLinks phone={o.partnerManagerPhone} email={o.partnerManagerEmail} compact />
                        </div>
                      ) : <span style={{ color: 'var(--muted-2)' }}>-</span>}
                    </td>
                    <td style={td}>
                      {(o.openCount ?? 0) > 0 ? (
                        <button
                          type="button" className="btn btn-ghost btn-sm" onClick={() => onFilter(o.id)}
                          title={`Show opportunities with ${o.name}`}
                        >
                          {o.openCount}
                        </button>
                      ) : 0}
                    </td>
                    <td style={{ ...td, fontWeight: 600 }}>{formatKsh(o.openValue)}</td>
                    <td style={td}>{o.wonCount ?? 0}</td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button type="button" className="icon-btn" title="Edit" onClick={() => startEdit(o)}><Pencil size={13} /></button>
                      {isManager && (
                        <button
                          type="button" className="icon-btn" title="Delete"
                          onClick={async () => {
                            if (await confirmDialog({ title: 'Delete OEM', text: `Delete ${o.name}?`, confirmLabel: 'Delete', danger: true })) remove.mutate(o.id);
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </td>
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

export default OemsTab;
