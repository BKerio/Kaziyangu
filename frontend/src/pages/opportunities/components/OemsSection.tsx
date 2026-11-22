import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import api from '@/api/client';
import AppLoader from '@/components/shared/AppLoader';
import { DEAL_REG_OPTIONS, DealRegStatus, Opportunity, OpportunityOem } from '@/types/api';
import { useOems } from '@/hooks/useOpportunityOptions';
import { daysUntil, dealRegPillClass, formatKsh, optionLabel } from '@/utils/opportunity';
import ContactLinks from './ContactLinks';
import { SectionHeading, rowCardStyle, sectionStyle, useOpportunityMutation } from './shared';

interface OemDraft {
  oemName: string;
  products: string;
  value: string;
  dealRegNumber: string;
  dealRegStatus: DealRegStatus;
  dealRegExpiry: string;
  partnerManagerName: string;
  partnerManagerEmail: string;
  partnerManagerPhone: string;
  notes: string;
}

const emptyDraft: OemDraft = {
  oemName: '', products: '', value: '', dealRegNumber: '', dealRegStatus: 'NOT_REGISTERED', dealRegExpiry: '',
  partnerManagerName: '', partnerManagerEmail: '', partnerManagerPhone: '', notes: '',
};

function draftFrom(link: OpportunityOem): OemDraft {
  return {
    oemName: link.oem.name,
    products: link.products ?? '',
    value: link.value != null ? String(link.value) : '',
    dealRegNumber: link.dealRegNumber ?? '',
    dealRegStatus: link.dealRegStatus,
    dealRegExpiry: link.dealRegExpiry?.slice(0, 10) ?? '',
    partnerManagerName: link.partnerManagerName ?? '',
    partnerManagerEmail: link.partnerManagerEmail ?? '',
    partnerManagerPhone: link.partnerManagerPhone ?? '',
    notes: link.notes ?? '',
  };
}

function toPayload(d: OemDraft) {
  const { oemName, value, dealRegExpiry, ...rest } = d;
  return {
    ...rest,
    dealRegStatus: d.dealRegStatus,
    value: value === '' ? null : Number(value),
    dealRegExpiry: dealRegExpiry || null,
  };
}

/** OEMs / vendors on the deal (HPE, Hikvision …) with deal registration and the OEM-side contact. */
function OemsSection({ opportunity }: { opportunity: Opportunity }) {
  const id = opportunity.id;
  const links = opportunity.oems ?? [];
  const { data: oems } = useOems();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<OemDraft>(emptyDraft);
  const set = (patch: Partial<OemDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const close = () => { setEditing(null); setDraft(emptyDraft); };

  const addMutation = useOpportunityMutation(
    (d: OemDraft) => api.post(`/opportunities/${id}/oems`, { ...toPayload(d), oemName: d.oemName.trim() }),
    { success: 'OEM added', error: 'Could not add OEM' }, close,
  );
  const updateMutation = useOpportunityMutation(
    (v: { linkId: string; d: OemDraft }) => api.patch(`/opportunities/${id}/oems/${v.linkId}`, toPayload(v.d)),
    { success: 'OEM details saved', error: 'Could not save OEM details' }, close,
  );
  const removeMutation = useOpportunityMutation(
    (linkId: string) => api.delete(`/opportunities/${id}/oems/${linkId}`),
    { success: 'OEM removed', error: 'Could not remove OEM' },
  );

  // Picking a known OEM pre-fills its default partner manager.
  const onOemName = (name: string) => {
    const match = oems?.find((o) => o.name.toLowerCase() === name.trim().toLowerCase());
    set({
      oemName: name,
      ...(match && !draft.partnerManagerName ? {
        partnerManagerName: match.partnerManagerName ?? '',
        partnerManagerEmail: match.partnerManagerEmail ?? '',
        partnerManagerPhone: match.partnerManagerPhone ?? '',
      } : {}),
    });
  };

  const pending = addMutation.isPending || updateMutation.isPending;
  const taken = new Set(links.map((l) => l.oem.name.toLowerCase()));

  const form = (
    <div className="col" style={{ ...rowCardStyle, gap: 10, border: '1px dashed var(--border-strong)', background: 'transparent' }}>
      <div className="grid grid-cols-2 gap-2">
        <div className="field">
          <label className="label" htmlFor="oem-name">OEM / vendor</label>
          <input
            id="oem-name" className="input" list="oem-options" placeholder="e.g. HPE, Hikvision"
            value={draft.oemName} onChange={(e) => onOemName(e.target.value)} disabled={editing !== 'new'}
          />
          <datalist id="oem-options">
            {oems?.filter((o) => !taken.has(o.name.toLowerCase())).map((o) => <option key={o.id} value={o.name} />)}
          </datalist>
        </div>
        <div className="field">
          <label className="label" htmlFor="oem-value">Value of this OEM's portion (KSh)</label>
          <input id="oem-value" className="input" type="number" min={0} step="1000" value={draft.value} onChange={(e) => set({ value: e.target.value })} />
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="oem-products">Products / solution</label>
        <input id="oem-products" className="input" placeholder="e.g. ProLiant DL380 Gen11 x4, Aruba CX 6300" value={draft.products} onChange={(e) => set({ products: e.target.value })} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="field">
          <label className="label" htmlFor="oem-reg">Deal registration no.</label>
          <input id="oem-reg" className="input" value={draft.dealRegNumber} onChange={(e) => set({ dealRegNumber: e.target.value })} />
        </div>
        <div className="field">
          <label className="label" htmlFor="oem-status">Registration status</label>
          <select id="oem-status" className="eoc-select" value={draft.dealRegStatus} onChange={(e) => set({ dealRegStatus: e.target.value as DealRegStatus })}>
            {DEAL_REG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="oem-expiry">Registration expires</label>
          <input id="oem-expiry" className="input" type="date" value={draft.dealRegExpiry} onChange={(e) => set({ dealRegExpiry: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="field">
          <label className="label" htmlFor="oem-pm">OEM partner / channel manager</label>
          <input id="oem-pm" className="input" value={draft.partnerManagerName} onChange={(e) => set({ partnerManagerName: e.target.value })} />
        </div>
        <div className="field">
          <label className="label" htmlFor="oem-pm-phone">Their phone</label>
          <input id="oem-pm-phone" className="input" type="tel" value={draft.partnerManagerPhone} onChange={(e) => set({ partnerManagerPhone: e.target.value })} />
        </div>
        <div className="field">
          <label className="label" htmlFor="oem-pm-email">Their email</label>
          <input id="oem-pm-email" className="input" type="email" value={draft.partnerManagerEmail} onChange={(e) => set({ partnerManagerEmail: e.target.value })} />
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="oem-notes">Notes</label>
        <input id="oem-notes" className="input" placeholder="Special pricing, bid support, lead times…" value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
      </div>
      <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={close}>Cancel</button>
        <button
          type="button" className="btn btn-primary btn-sm" disabled={pending || !draft.oemName.trim()}
          onClick={() => (editing === 'new' ? addMutation.mutate(draft) : updateMutation.mutate({ linkId: editing!, d: draft }))}
        >
          {pending ? <AppLoader size={16} /> : null} {editing === 'new' ? 'Add OEM' : 'Save'}
        </button>
      </div>
    </div>
  );

  return (
    <section className="col" style={sectionStyle}>
      <SectionHeading
        action={editing === null && (
          <button type="button" className="btn btn-soft btn-sm" onClick={() => { setDraft(emptyDraft); setEditing('new'); }}>
            <Plus size={13} /> Add OEM
          </button>
        )}
      >
        OEMs &amp; vendors
      </SectionHeading>

      {links.length === 0 && editing === null && (
        <p className="text-xs" style={{ color: 'var(--muted)' }}>No OEMs on this deal yet. Add the vendors you're quoting (e.g. HPE, Hikvision).</p>
      )}

      {links.map((l) => {
        if (editing === l.id) return <div key={l.id}>{form}</div>;
        const expiresIn = daysUntil(l.dealRegExpiry);
        return (
          <div key={l.id} className="col" style={{ ...rowCardStyle, gap: 6 }}>
            <div className="flex items-center justify-between gap-2" style={{ flexWrap: 'wrap' }}>
              <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                <b style={{ color: 'var(--ink)', fontSize: 13.5 }}>{l.oem.name}</b>
                <span className={dealRegPillClass(l.dealRegStatus)}>{optionLabel(DEAL_REG_OPTIONS, l.dealRegStatus)}</span>
                {l.dealRegNumber && <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>Reg #{l.dealRegNumber}</span>}
                {expiresIn != null && l.dealRegStatus === 'APPROVED' && (
                  <span className={expiresIn <= 14 ? 'pill pill-amber' : 'pill pill-gray'}>
                    {expiresIn < 0 ? 'Registration expired' : `Expires in ${expiresIn}d`}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {l.value != null && <b style={{ marginRight: 6 }}>{formatKsh(l.value)}</b>}
                <button type="button" className="icon-btn" title="Edit" onClick={() => { setDraft(draftFrom(l)); setEditing(l.id); }}>
                  <Pencil size={12} />
                </button>
                <button
                  type="button" className="icon-btn" title="Remove"
                  onClick={() => removeMutation.mutate(l.id)}
                  disabled={removeMutation.isPending && removeMutation.variables === l.id}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
            {l.products && <div style={{ color: 'var(--ink-2)' }}>{l.products}</div>}
            {l.partnerManagerName && (
              <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>OEM contact: <b style={{ color: 'var(--ink-2)' }}>{l.partnerManagerName}</b></span>
                <ContactLinks phone={l.partnerManagerPhone} email={l.partnerManagerEmail} />
              </div>
            )}
            {l.notes && <div style={{ color: 'var(--muted)', fontSize: 12 }}>{l.notes}</div>}
          </div>
        );
      })}

      {editing === 'new' && form}
    </section>
  );
}

export default OemsSection;
