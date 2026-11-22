import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, Pencil, Plus, Star, Trash2, X } from 'lucide-react';
import api from '@/api/client';
import AppLoader from '@/components/shared/AppLoader';
import PageLoader from '@/components/shared/PageLoader';
import { confirmDialog } from '@/lib/alert';
import { useAuthStore } from '@/stores/authStore';
import { Customer, CustomerContact, StaffContact } from '@/types/api';
import { currentValue, formatKsh, priorityPillClass, priorityLabel, stageLabel, stagePillClass } from '@/utils/opportunity';
import ContactLinks from './components/ContactLinks';
import { SectionHeading, rowCardStyle, sectionStyle, useOpportunityMutation } from './components/shared';

const ACCOUNT_FIELDS = ['name', 'shortName', 'industry', 'sector', 'website', 'email', 'phone', 'address', 'kraPin', 'notes'] as const;
type AccountDraft = Record<(typeof ACCOUNT_FIELDS)[number], string> & { accountManagerId: string };

const emptyContact = { name: '', title: '', department: '', email: '', phone: '', altPhone: '', notes: '', isPrimary: false };
type ContactDraft = typeof emptyContact;

function contactDraft(c: CustomerContact): ContactDraft {
  return {
    name: c.name, title: c.title ?? '', department: c.department ?? '', email: c.email ?? '', phone: c.phone ?? '',
    altPhone: c.altPhone ?? '', notes: c.notes ?? '', isPrimary: c.isPrimary,
  };
}

/** A customer account: company details, its people, and every opportunity with them. */
function CustomerDetailModal({ id, staff, onClose, onOpenOpportunity, onNewOpportunity, onDeleted }: {
  id: string;
  staff: StaffContact[];
  onClose: () => void;
  onOpenOpportunity: (opportunityId: string) => void;
  onNewOpportunity: (customer: { id: string; name: string }) => void;
  onDeleted: () => void;
}) {
  const role = useAuthStore((s) => s.user?.role);
  const isManager = role === 'ADMIN' || role === 'SUPER_ADMIN';

  const { data: customer, isLoading } = useQuery({
    queryKey: ['customers', 'detail', id],
    queryFn: async () => (await api.get<{ data: Customer }>(`/customers/${id}`)).data.data,
  });

  const [editingAccount, setEditingAccount] = useState(false);
  const [account, setAccount] = useState<AccountDraft | null>(null);
  const [contactEditing, setContactEditing] = useState<string | 'new' | null>(null);
  const [contact, setContact] = useState<ContactDraft>(emptyContact);

  useEffect(() => {
    if (!customer) return;
    const d = { accountManagerId: customer.accountManagerId ?? '' } as AccountDraft;
    for (const f of ACCOUNT_FIELDS) d[f] = (customer[f] as string | null | undefined) ?? '';
    setAccount(d);
  }, [customer]);

  const saveAccount = useOpportunityMutation(
    (d: AccountDraft) => api.patch(`/customers/${id}`, { ...d, accountManagerId: d.accountManagerId || null }),
    { success: 'Customer updated', error: 'Could not update customer' },
    () => setEditingAccount(false),
  );
  const deleteCustomer = useOpportunityMutation(
    () => api.delete(`/customers/${id}`),
    { success: 'Customer deleted', error: 'Could not delete customer' },
    onDeleted,
  );
  const closeContact = () => { setContactEditing(null); setContact(emptyContact); };
  const saveContact = useOpportunityMutation(
    (d: ContactDraft) => {
      const body = d;
      return contactEditing === 'new'
        ? api.post(`/customers/${id}/contacts`, body)
        : api.patch(`/customers/${id}/contacts/${contactEditing}`, body);
    },
    { success: 'Contact saved', error: 'Could not save contact' },
    closeContact,
  );
  const deleteContact = useOpportunityMutation(
    (contactId: string) => api.delete(`/customers/${id}/contacts/${contactId}`),
    { success: 'Contact removed', error: 'Could not remove contact' },
  );

  const removeContact = async (c: CustomerContact) => {
    if (await confirmDialog({
      title: 'Remove contact', text: `Remove ${c.name}? They'll also be taken off any opportunities they're linked to.`,
      confirmLabel: 'Remove', danger: true,
    })) deleteContact.mutate(c.id);
  };
  const removeCustomer = async () => {
    if (customer && await confirmDialog({
      title: 'Delete customer', text: `Delete ${customer.name} and all its contacts? This can't be undone.`, confirmLabel: 'Delete', danger: true,
    })) deleteCustomer.mutate(undefined);
  };

  const opportunities = customer?.opportunities ?? [];
  const open = opportunities.filter((o) => o.stage !== 'WON' && o.stage !== 'LOST');
  const openPipeline = open.reduce((sum, o) => sum + (currentValue(o) ?? 0), 0);
  const won = opportunities.filter((o) => o.stage === 'WON');
  const wonValue = won.reduce((sum, o) => sum + (o.finalValue ?? currentValue(o) ?? 0), 0);

  const set = (patch: Partial<AccountDraft>) => setAccount((a) => (a ? { ...a, ...patch } : a));
  const accountInput = (key: (typeof ACCOUNT_FIELDS)[number], label: string, props: Record<string, unknown> = {}) => (
    <div className="field">
      <label className="label" htmlFor={`cu-${key}`}>{label}</label>
      <input id={`cu-${key}`} className="input" value={account?.[key] ?? ''} onChange={(e) => set({ [key]: e.target.value })} {...props} />
    </div>
  );

  const tile = { padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)' } as const;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(10,20,15,0.45)' }}>
      <div className="card w-full" style={{ maxWidth: 900, maxHeight: '94vh', overflowY: 'auto' }}>
        <div className="card-head" style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
          <span className="card-title flex items-center gap-2">
            <Building2 size={16} style={{ color: 'var(--red)' }} />
            {customer ? customer.name : 'Customer'}
            {customer?.shortName && <span style={{ color: 'var(--muted)', fontWeight: 500 }}>({customer.shortName})</span>}
          </span>
          <div className="flex items-center gap-1">
            {isManager && customer && (
              <button className="icon-btn" title="Delete customer" onClick={removeCustomer} disabled={deleteCustomer.isPending}>
                <Trash2 size={14} />
              </button>
            )}
            <button className="icon-btn" onClick={onClose} type="button"><X size={16} /></button>
          </div>
        </div>

        {isLoading || !customer || !account ? (
          <div className="card-pad"><PageLoader height={320} /></div>
        ) : (
          <div className="card-pad col" style={{ gap: 20 }}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div style={tile}><div style={{ fontSize: 11, color: 'var(--muted)' }}>Open opportunities</div><b style={{ fontSize: 18 }}>{open.length}</b></div>
              <div style={tile}><div style={{ fontSize: 11, color: 'var(--muted)' }}>Open pipeline</div><b style={{ fontSize: 18 }}>{formatKsh(openPipeline)}</b></div>
              <div style={tile}><div style={{ fontSize: 11, color: 'var(--muted)' }}>Won</div><b style={{ fontSize: 18 }}>{won.length} · {formatKsh(wonValue)}</b></div>
              <div style={tile}><div style={{ fontSize: 11, color: 'var(--muted)' }}>Contacts</div><b style={{ fontSize: 18 }}>{customer.contacts?.length ?? 0}</b></div>
            </div>

            {/* Account details */}
            <section className="col" style={{ gap: 10 }}>
              <SectionHeading action={!editingAccount && (
                <button type="button" className="btn btn-soft btn-sm" onClick={() => setEditingAccount(true)}><Pencil size={13} /> Edit</button>
              )}>
                Account details
              </SectionHeading>
              {editingAccount ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    {accountInput('name', 'Legal / full name')}
                    {accountInput('shortName', 'Short name', { placeholder: 'e.g. KPLC' })}
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {accountInput('industry', 'Industry', { placeholder: 'e.g. Energy' })}
                    {accountInput('sector', 'Sector', { placeholder: 'Public / Private / NGO' })}
                    {accountInput('kraPin', 'KRA PIN')}
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {accountInput('phone', 'Main phone', { type: 'tel' })}
                    {accountInput('email', 'General email', { type: 'email' })}
                    {accountInput('website', 'Website')}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {accountInput('address', 'Address')}
                    <div className="field">
                      <label className="label" htmlFor="cu-am">Account owner (internal)</label>
                      <select id="cu-am" className="eoc-select" value={account.accountManagerId} onChange={(e) => set({ accountManagerId: e.target.value })}>
                        <option value="">Not set</option>
                        {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="cu-notes">Account notes</label>
                    <textarea id="cu-notes" className="eoc-textarea" rows={2} value={account.notes} onChange={(e) => set({ notes: e.target.value })} />
                  </div>
                  <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingAccount(false)}>Cancel</button>
                    <button type="button" className="btn btn-primary btn-sm" disabled={saveAccount.isPending || !account.name.trim()} onClick={() => saveAccount.mutate(account)}>
                      {saveAccount.isPending ? <AppLoader size={16} /> : null} Save
                    </button>
                  </div>
                </>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3" style={{ fontSize: 13 }}>
                  {[
                    ['Industry', customer.industry], ['Sector', customer.sector], ['KRA PIN', customer.kraPin],
                    ['Website', customer.website], ['Address', customer.address],
                  ].map(([k, v]) => (
                    <div key={k as string}><div style={{ fontSize: 11, color: 'var(--muted)' }}>{k}</div>{v || '-'}</div>
                  ))}
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>Main line</div>
                    <ContactLinks phone={customer.phone} email={customer.email} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>Account owner</div>
                    {customer.accountManager ? (
                      <div className="col" style={{ gap: 2 }}>
                        <b>{customer.accountManager.name}</b>
                        <ContactLinks phone={customer.accountManager.phone} email={customer.accountManager.email} compact />
                      </div>
                    ) : '-'}
                  </div>
                  {customer.notes && <div className="md:col-span-3" style={{ whiteSpace: 'pre-wrap', color: 'var(--ink-2)' }}>{customer.notes}</div>}
                </div>
              )}
            </section>

            {/* Contacts */}
            <section className="col" style={sectionStyle}>
              <SectionHeading action={contactEditing === null && (
                <button type="button" className="btn btn-soft btn-sm" onClick={() => { setContact(emptyContact); setContactEditing('new'); }}>
                  <Plus size={13} /> Add contact
                </button>
              )}>
                Contact persons
              </SectionHeading>

              {contactEditing !== null && (
                <div className="col" style={{ ...rowCardStyle, gap: 10, border: '1px dashed var(--border-strong)', background: 'transparent' }}>
                  <div className="grid grid-cols-3 gap-2">
                    {(['name', 'title', 'department'] as const).map((k) => (
                      <div className="field" key={k}>
                        <label className="label" htmlFor={`cc-${k}`}>{{ name: 'Full name', title: 'Title / designation', department: 'Department' }[k]}</label>
                        <input id={`cc-${k}`} className="input" value={contact[k]} onChange={(e) => setContact({ ...contact, [k]: e.target.value })} />
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(['phone', 'altPhone', 'email'] as const).map((k) => (
                      <div className="field" key={k}>
                        <label className="label" htmlFor={`cc-${k}`}>{{ phone: 'Phone', altPhone: 'Alt. phone', email: 'Email' }[k]}</label>
                        <input
                          id={`cc-${k}`} className="input" type={k === 'email' ? 'email' : 'tel'}
                          value={contact[k]} onChange={(e) => setContact({ ...contact, [k]: e.target.value })}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="cc-notes">Notes</label>
                    <input id="cc-notes" className="input" placeholder="e.g. Prefers WhatsApp, in office Tue–Thu" value={contact.notes} onChange={(e) => setContact({ ...contact, notes: e.target.value })} />
                  </div>
                  <div className="flex items-center gap-2" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                    <label className="flex items-center gap-2" style={{ fontSize: 12.5 }}>
                      <input type="checkbox" checked={contact.isPrimary} onChange={(e) => setContact({ ...contact, isPrimary: e.target.checked })} />
                      Primary contact for this account
                    </label>
                    <div className="flex gap-2">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={closeContact}>Cancel</button>
                      <button type="button" className="btn btn-primary btn-sm" disabled={saveContact.isPending || !contact.name.trim()} onClick={() => saveContact.mutate(contact)}>
                        {saveContact.isPending ? <AppLoader size={16} /> : null} Save contact
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {(customer.contacts ?? []).length === 0 && contactEditing === null ? (
                <p className="text-xs" style={{ color: 'var(--muted)' }}>No contacts on this account yet.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {(customer.contacts ?? []).map((c) => (
                    <div key={c.id} className="col" style={{ ...rowCardStyle, gap: 5 }}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1" style={{ fontWeight: 650, color: 'var(--ink)' }}>
                            {c.name}
                            {c.isPrimary && <Star size={11} style={{ color: 'var(--gold)' }} fill="currentColor" aria-label="Primary contact" />}
                          </div>
                          <div style={{ color: 'var(--muted)', fontSize: 11.5 }}>{[c.title, c.department].filter(Boolean).join(' · ') || '—'}</div>
                        </div>
                        <div className="flex gap-1">
                          <button type="button" className="icon-btn" title="Edit" onClick={() => { setContact(contactDraft(c)); setContactEditing(c.id); }}><Pencil size={12} /></button>
                          <button type="button" className="icon-btn" title="Remove" onClick={() => removeContact(c)}><Trash2 size={12} /></button>
                        </div>
                      </div>
                      <ContactLinks phone={c.phone} email={c.email} />
                      {c.altPhone && <ContactLinks phone={c.altPhone} />}
                      {c.notes && <div style={{ color: 'var(--muted)', fontSize: 12 }}>{c.notes}</div>}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Opportunities */}
            <section className="col" style={sectionStyle}>
              <SectionHeading action={
                <button type="button" className="btn btn-primary btn-sm" onClick={() => onNewOpportunity({ id: customer.id, name: customer.name })}>
                  <Plus size={13} /> New opportunity
                </button>
              }>
                Opportunities ({opportunities.length})
              </SectionHeading>
              {opportunities.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--muted)' }}>No opportunities with {customer.shortName || customer.name} yet.</p>
              ) : (
                <div className="col" style={{ gap: 6 }}>
                  {opportunities.map((o) => (
                    <button
                      key={o.id} type="button" onClick={() => onOpenOpportunity(o.id)}
                      className="flex items-center justify-between gap-2"
                      style={{ ...rowCardStyle, border: 0, cursor: 'pointer', textAlign: 'left', font: 'inherit', flexWrap: 'wrap' }}
                    >
                      <div className="col" style={{ gap: 3, minWidth: 0 }}>
                        <b style={{ color: 'var(--ink)' }}>{o.name}</b>
                        <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>
                          {o.assignedTo?.name ?? 'Unassigned'}
                          {(o.oems ?? []).length > 0 && ` · ${o.oems!.map((x) => x.oem.name).join(', ')}`}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <b>{formatKsh(currentValue(o))}</b>
                        <span className={priorityPillClass(o.priority)}>{priorityLabel(o.priority)}</span>
                        <span className={stagePillClass(o.stage)}>{stageLabel(o.stage)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

export default CustomerDetailModal;
