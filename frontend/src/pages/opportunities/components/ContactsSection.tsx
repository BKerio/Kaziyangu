import { useState } from 'react';
import { Plus, Star, Trash2, UserPlus, Users } from 'lucide-react';
import api from '@/api/client';
import AppLoader from '@/components/shared/AppLoader';
import { CONTACT_ROLE_OPTIONS, ContactRole, Opportunity } from '@/types/api';
import ContactLinks from './ContactLinks';
import { SectionHeading, clean, rowCardStyle, sectionStyle, useOpportunityMutation } from './shared';

const emptyContact = { name: '', title: '', department: '', phone: '', email: '' };

/** Customer-side people on this deal, each with a deal-specific role. */
function ContactsSection({ opportunity }: { opportunity: Opportunity }) {
  const id = opportunity.id;
  const links = opportunity.contacts ?? [];
  const accountContacts = opportunity.customer?.contacts ?? [];
  const available = accountContacts.filter((c) => !links.some((l) => l.contactId === c.id));

  const [mode, setMode] = useState<'closed' | 'existing' | 'new'>('closed');
  const [contactId, setContactId] = useState('');
  const [role, setRole] = useState<ContactRole>('DECISION_MAKER');
  const [draft, setDraft] = useState(emptyContact);

  const close = () => { setMode('closed'); setContactId(''); setDraft(emptyContact); setRole('DECISION_MAKER'); };

  const linkMutation = useOpportunityMutation(
    (body: object) => api.post(`/opportunities/${id}/contacts`, body),
    { success: 'Contact added to deal', error: 'Could not add contact' },
    close,
  );
  const roleMutation = useOpportunityMutation(
    (v: { contactId: string; role: ContactRole }) => api.patch(`/opportunities/${id}/contacts/${v.contactId}`, { role: v.role }),
    { success: 'Role updated', error: 'Could not update role' },
  );
  const unlinkMutation = useOpportunityMutation(
    (contactId: string) => api.delete(`/opportunities/${id}/contacts/${contactId}`),
    { success: 'Contact removed from deal', error: 'Could not remove contact' },
  );

  const submit = () => {
    if (mode === 'existing' && contactId) linkMutation.mutate({ contactId, role });
    if (mode === 'new' && draft.name.trim()) linkMutation.mutate({ role, newContact: clean(draft) });
  };

  return (
    <section className="col" style={sectionStyle}>
      <SectionHeading
        action={mode === 'closed' && (
          <div className="flex gap-1">
            {available.length > 0 && (
              <button type="button" className="btn btn-soft btn-sm" onClick={() => setMode('existing')}>
                <Users size={13} /> Link existing
              </button>
            )}
            <button type="button" className="btn btn-soft btn-sm" onClick={() => setMode('new')}>
              <UserPlus size={13} /> New contact
            </button>
          </div>
        )}
      >
        Client contacts {opportunity.customer ? `· ${opportunity.customer.shortName || opportunity.customer.name}` : ''}
      </SectionHeading>

      {links.length === 0 && mode === 'closed' && (
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          No client contacts on this deal yet.
          {opportunity.contactPerson ? ` Legacy contact: ${opportunity.contactPerson}.` : ''}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {links.map((l) => (
          <div key={l.contactId} className="col" style={{ ...rowCardStyle, gap: 6 }}>
            <div className="flex items-start justify-between gap-2">
              <div style={{ minWidth: 0 }}>
                <div className="flex items-center gap-1" style={{ fontWeight: 650, color: 'var(--ink)' }}>
                  {l.contact.name}
                  {l.contact.isPrimary && <Star size={11} style={{ color: 'var(--gold)' }} fill="currentColor" aria-label="Primary contact" />}
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 11.5 }}>
                  {[l.contact.title, l.contact.department].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
              <button
                type="button" className="icon-btn" title="Remove from deal"
                onClick={() => unlinkMutation.mutate(l.contactId)}
                disabled={unlinkMutation.isPending && unlinkMutation.variables === l.contactId}
              >
                <Trash2 size={12} />
              </button>
            </div>
            <ContactLinks phone={l.contact.phone} email={l.contact.email} />
            <select
              className="eoc-select" style={{ maxWidth: 180, fontSize: 12 }} value={l.role}
              onChange={(e) => roleMutation.mutate({ contactId: l.contactId, role: e.target.value as ContactRole })}
              aria-label={`Role of ${l.contact.name}`}
            >
              {CONTACT_ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
        ))}
      </div>

      {mode !== 'closed' && (
        <div className="col" style={{ ...rowCardStyle, gap: 10, border: '1px dashed var(--border-strong)', background: 'transparent' }}>
          {mode === 'existing' ? (
            <div className="field">
              <label className="label" htmlFor="c-existing">Contact at {opportunity.customer?.name}</label>
              <select id="c-existing" className="eoc-select" value={contactId} onChange={(e) => setContactId(e.target.value)}>
                <option value="">Select a contact…</option>
                {available.map((c) => <option key={c.id} value={c.id}>{c.name}{c.title ? ` — ${c.title}` : ''}</option>)}
              </select>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="field">
                  <label className="label" htmlFor="c-name">Full name</label>
                  <input id="c-name" className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </div>
                <div className="field">
                  <label className="label" htmlFor="c-title">Title / designation</label>
                  <input id="c-title" className="input" placeholder="e.g. ICT Manager" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="field">
                  <label className="label" htmlFor="c-dept">Department</label>
                  <input id="c-dept" className="input" value={draft.department} onChange={(e) => setDraft({ ...draft, department: e.target.value })} />
                </div>
                <div className="field">
                  <label className="label" htmlFor="c-phone">Phone</label>
                  <input id="c-phone" className="input" type="tel" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
                </div>
                <div className="field">
                  <label className="label" htmlFor="c-email">Email</label>
                  <input id="c-email" className="input" type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
                </div>
              </div>
            </>
          )}
          <div className="flex items-end gap-2" style={{ flexWrap: 'wrap' }}>
            <div className="field" style={{ minWidth: 170 }}>
              <label className="label" htmlFor="c-role">Role in this deal</label>
              <select id="c-role" className="eoc-select" value={role} onChange={(e) => setRole(e.target.value as ContactRole)}>
                {CONTACT_ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div className="flex gap-2" style={{ marginLeft: 'auto' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={close}>Cancel</button>
              <button
                type="button" className="btn btn-primary btn-sm" onClick={submit}
                disabled={linkMutation.isPending || (mode === 'existing' ? !contactId : !draft.name.trim())}
              >
                {linkMutation.isPending ? <AppLoader size={16} /> : <Plus size={13} />} Add to deal
              </button>
            </div>
          </div>
          {mode === 'new' && (
            <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
              The contact is saved on the {opportunity.customerName} account, so it's available for their other opportunities too.
            </span>
          )}
        </div>
      )}
    </section>
  );
}

export default ContactsSection;
