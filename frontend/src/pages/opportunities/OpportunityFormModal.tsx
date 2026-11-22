import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ChangeEvent, KeyboardEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Paperclip, Trash2, FileText, Plus, Building2 } from 'lucide-react';
import AppLoader from '@/components/shared/AppLoader';
import { useNotificationStore } from '@/stores/notificationStore';
import api from '@/api/client';
import { uploadOpportunityAttachments } from '@/lib/opportunityAttachments';
import {
  CONTACT_ROLE_OPTIONS, ContactRole, Customer, Opportunity, OpportunityTeamRole, PRIORITY_OPTIONS, StaffContact, TEAM_ROLE_OPTIONS,
} from '@/types/api';
import { useCustomerOptions, useOems } from '@/hooks/useOpportunityOptions';
import { fromLocalInput } from '@/utils/opportunity';
import { clean } from './components/shared';

const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_ATTACHMENT_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);
const ALLOWED_ATTACHMENT_EXTS = ['.pdf', '.docx', '.doc'];
const ALLOWED_ATTACHMENT_ACCEPT = '.pdf,.docx,.doc';

function isAllowedFile(file: File): boolean {
  if (ALLOWED_ATTACHMENT_MIMES.has(file.type)) return true;
  const name = file.name.toLowerCase();
  return ALLOWED_ATTACHMENT_EXTS.some((ext) => name.endsWith(ext));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

const optionalNumber = z.preprocess(
  (v) => (v === '' || v === null || v === undefined || Number.isNaN(v) ? undefined : v),
  z.coerce.number().min(0).optional(),
);

const createSchema = z.object({
  name: z.string().min(2, 'Opportunity name is required'),
  customerName: z.string().trim().min(1, 'Customer / organization is required'),
  source: z.string().optional(),
  dateIdentified: z.string().min(1, 'Date is required'),
  estimatedValue: optionalNumber,
  clientBudget: optionalNumber,
  tenderReference: z.string().optional(),
  submissionDeadline: z.string().optional(),
  description: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  assignedToId: z.string().optional(),
  followUpDate: z.string().optional(),
  initialNote: z.string().optional(),
});
type CreateForm = z.infer<typeof createSchema>;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

const emptyContact = { name: '', title: '', phone: '', email: '' };

function OpportunityFormModal({ staff, onClose, onCreated, defaultCustomer }: {
  staff: StaffContact[];
  onClose: () => void;
  onCreated: (id: string) => void;
  /** Pre-select a customer, e.g. "New opportunity" from a customer's page. */
  defaultCustomer?: { id: string; name: string };
}) {
  const { addNotification } = useNotificationStore();
  const queryClient = useQueryClient();
  const { data: customerOptions } = useCustomerOptions();
  const { data: oems } = useOems();

  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [oemNames, setOemNames] = useState<string[]>([]);
  const [oemInput, setOemInput] = useState('');
  const [extraTeam, setExtraTeam] = useState<{ userId: string; role: OpportunityTeamRole }[]>([]);
  const [teamPick, setTeamPick] = useState('');
  const [teamRole, setTeamRole] = useState<OpportunityTeamRole>('PRESALES');
  const [contactChoice, setContactChoice] = useState<string>(''); // '' none, 'new', or contact id
  const [contactRole, setContactRole] = useState<ContactRole>('DECISION_MAKER');
  const [newContact, setNewContact] = useState(emptyContact);

  const { register, handleSubmit, watch, formState: { errors } } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { dateIdentified: todayISO(), priority: 'MEDIUM', customerName: defaultCustomer?.name ?? '' },
  });

  // Match the typed customer to an existing account (by name or short name).
  const typedCustomer = watch('customerName');
  const matchedCustomer = useMemo(() => {
    const t = typedCustomer?.trim().toLowerCase();
    if (!t) return undefined;
    return customerOptions?.find((c) => c.name.toLowerCase() === t || c.shortName?.toLowerCase() === t);
  }, [typedCustomer, customerOptions]);

  const { data: customerDetail } = useQuery({
    queryKey: ['customers', 'detail', matchedCustomer?.id],
    enabled: !!matchedCustomer,
    queryFn: async () => (await api.get<{ data: Customer }>(`/customers/${matchedCustomer!.id}`)).data.data,
  });
  const existingContacts = matchedCustomer ? customerDetail?.contacts ?? [] : [];
  const openDeals = matchedCustomer ? (customerDetail?.opportunities ?? []).filter((o) => o.stage !== 'WON' && o.stage !== 'LOST') : [];

  const leadId = watch('assignedToId');

  const addOem = (raw: string) => {
    const name = raw.trim();
    if (!name) return;
    const canonical = oems?.find((o) => o.name.toLowerCase() === name.toLowerCase())?.name ?? name;
    setOemNames((prev) => (prev.some((n) => n.toLowerCase() === canonical.toLowerCase()) ? prev : [...prev, canonical]));
    setOemInput('');
  };
  const onOemKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addOem(oemInput); }
  };

  const handleFilesSelected = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (picked.length === 0) return;

    const room = MAX_ATTACHMENTS - files.length;
    let error: string | null = null;
    const accepted: File[] = [];

    for (const file of picked) {
      if (!isAllowedFile(file)) {
        error = `"${file.name}" isn't a supported type. Attach a PDF or Word document (.docx).`;
        continue;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        error = `"${file.name}" is larger than 10MB.`;
        continue;
      }
      if (accepted.length >= room) {
        error = `An opportunity can have at most ${MAX_ATTACHMENTS} files.`;
        break;
      }
      accepted.push(file);
    }

    setFiles((prev) => [...prev, ...accepted]);
    setFileError(error);
  };

  const createMutation = useMutation({
    mutationFn: async (values: CreateForm) => {
      const contacts =
        contactChoice === 'new' && newContact.name.trim()
          ? [{ role: contactRole, newContact: clean(newContact) }]
          // Ignore a contact picked from a customer the user then switched away from.
          : contactChoice && existingContacts.some((c) => c.id === contactChoice)
            ? [{ role: contactRole, contactId: contactChoice }]
            : [];
      // Pick up an OEM that was typed but not yet added as a chip.
      const allOems = oemInput.trim() ? [...oemNames, oemInput.trim()] : oemNames;

      const res = await api.post<{ data: Opportunity }>('/opportunities', {
        ...values,
        ...(matchedCustomer ? { customerId: matchedCustomer.id, customerName: undefined } : {}),
        assignedToId: values.assignedToId || undefined,
        submissionDeadline: fromLocalInput(values.submissionDeadline) || undefined,
        followUpDate: values.followUpDate || undefined,
        initialNote: values.initialNote?.trim() || undefined,
        oemNames: allOems,
        team: extraTeam.filter((m) => m.userId !== values.assignedToId),
        contacts,
      });
      await uploadOpportunityAttachments(res.data.data.id, files);
      return res.data;
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['opportunities'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['oems'] });
      addNotification({ type: 'success', title: 'Opportunity added', message: 'It has entered the pipeline.' });
      onCreated(res.data.id);
    },
    onError: (err: any) => addNotification({ type: 'error', title: 'Failed to add opportunity', message: err?.response?.data?.message || 'Please try again.' }),
  });

  const sectionLabel = { fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.06em', textTransform: 'uppercase' } as const;
  const teamCandidates = staff.filter((s) => s.id !== leadId && !extraTeam.some((m) => m.userId === s.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(10,20,15,0.45)' }}>
      <div className="card w-full" style={{ maxWidth: 720, maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="card-head" style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
          <span className="card-title">Add Opportunity</span>
          <button className="icon-btn" onClick={onClose} type="button"><X size={16} /></button>
        </div>
        <form className="card-pad col" style={{ gap: 14 }} onSubmit={handleSubmit((v) => createMutation.mutate(v))}>
          {/* ── Customer & deal ─────────────────────────────────────────── */}
          <span style={sectionLabel}>Customer &amp; deal</span>
          <div className="grid grid-cols-2 gap-3">
            <div className="field">
              <label className="label" htmlFor="op-customer">Customer / organization</label>
              <input id="op-customer" className="input" list="op-customer-options" placeholder="e.g. KPLC" autoComplete="off" {...register('customerName')} />
              <datalist id="op-customer-options">
                {customerOptions?.map((c) => <option key={c.id} value={c.name}>{c.shortName ?? ''}</option>)}
              </datalist>
              {errors.customerName ? (
                <span className="field-error">{errors.customerName.message}</span>
              ) : typedCustomer?.trim() ? (
                <span style={{ fontSize: 11.5, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Building2 size={11} />
                  {matchedCustomer
                    ? `Existing account${openDeals.length ? ` · ${openDeals.length} open opportunit${openDeals.length === 1 ? 'y' : 'ies'}` : ''}`
                    : 'New customer, created when you save'}
                </span>
              ) : null}
            </div>
            <div className="field">
              <label className="label" htmlFor="op-name">Opportunity name</label>
              <input id="op-name" className="input" placeholder="e.g. Data Centre Refresh 2026" {...register('name')} />
              {errors.name && <span className="field-error">{errors.name.message}</span>}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="field">
              <label className="label" htmlFor="op-budget">Client budget (KSh)</label>
              <input id="op-budget" className="input" type="number" min={0} step="1000" {...register('clientBudget')} />
            </div>
            <div className="field">
              <label className="label" htmlFor="op-value">Estimated value (KSh)</label>
              <input id="op-value" className="input" type="number" min={0} step="1000" {...register('estimatedValue')} />
            </div>
            <div className="field">
              <label className="label" htmlFor="op-priority">Priority</label>
              <select id="op-priority" className="eoc-select" {...register('priority')}>
                {PRIORITY_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="field">
              <label className="label" htmlFor="op-tender">Tender / RFQ ref (optional)</label>
              <input id="op-tender" className="input" placeholder="e.g. KPLC/1TD/OT/045/2026" {...register('tenderReference')} />
            </div>
            <div className="field">
              <label className="label" htmlFor="op-deadline">Submission deadline</label>
              <input id="op-deadline" className="input" type="datetime-local" {...register('submissionDeadline')} />
            </div>
            <div className="field">
              <label className="label" htmlFor="op-date">Date identified</label>
              <input id="op-date" className="input" type="date" {...register('dateIdentified')} />
              {errors.dateIdentified && <span className="field-error">{errors.dateIdentified.message}</span>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="field">
              <label className="label" htmlFor="op-source">Source</label>
              <input id="op-source" className="input" placeholder="e.g. Tender portal, Referral, OEM lead" {...register('source')} />
            </div>
            <div className="field">
              <label className="label" htmlFor="op-followup">Follow-up date (optional)</label>
              <input id="op-followup" className="input" type="date" {...register('followUpDate')} />
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="op-desc">Description / scope</label>
            <textarea id="op-desc" className="eoc-textarea" rows={2} {...register('description')} />
          </div>

          {/* ── OEMs ──────────────────────────────────────────────────── */}
          <div className="field">
            <label className="label" htmlFor="op-oem">OEMs / vendors</label>
            <div className="flex gap-2">
              <input
                id="op-oem" className="input" list="op-oem-options" placeholder="Type or pick, e.g. HPE, Hikvision — Enter to add"
                value={oemInput} onChange={(e) => setOemInput(e.target.value)} onKeyDown={onOemKey}
              />
              <button type="button" className="btn btn-soft btn-sm" onClick={() => addOem(oemInput)} disabled={!oemInput.trim()}>
                <Plus size={13} /> Add
              </button>
            </div>
            <datalist id="op-oem-options">
              {oems?.filter((o) => !oemNames.includes(o.name)).map((o) => <option key={o.id} value={o.name}>{o.category ?? ''}</option>)}
            </datalist>
            {oemNames.length > 0 && (
              <div className="flex flex-wrap gap-1" style={{ marginTop: 6 }}>
                {oemNames.map((n) => (
                  <span key={n} className="pill pill-blue" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {n}
                    <button
                      type="button" aria-label={`Remove ${n}`} onClick={() => setOemNames((p) => p.filter((x) => x !== n))}
                      style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: 'inherit', display: 'inline-flex' }}
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>Deal registration and OEM contacts can be added after saving.</span>
          </div>

          {/* ── Client contact ────────────────────────────────────────── */}
          <span style={{ ...sectionLabel, marginTop: 4 }}>Client contact</span>
          <div className="grid grid-cols-2 gap-3">
            <div className="field">
              <label className="label" htmlFor="op-contact">Contact person</label>
              <select id="op-contact" className="eoc-select" value={contactChoice} onChange={(e) => setContactChoice(e.target.value)}>
                <option value="">None for now</option>
                {existingContacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.title ? ` — ${c.title}` : ''}</option>)}
                <option value="new">+ New contact…</option>
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="op-contact-role">Their role in this deal</label>
              <select id="op-contact-role" className="eoc-select" value={contactRole} onChange={(e) => setContactRole(e.target.value as ContactRole)} disabled={!contactChoice}>
                {CONTACT_ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>
          {contactChoice === 'new' && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="field">
                <label className="label" htmlFor="nc-name">Full name</label>
                <input id="nc-name" className="input" value={newContact.name} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })} />
              </div>
              <div className="field">
                <label className="label" htmlFor="nc-title">Title</label>
                <input id="nc-title" className="input" placeholder="e.g. ICT Manager" value={newContact.title} onChange={(e) => setNewContact({ ...newContact, title: e.target.value })} />
              </div>
              <div className="field">
                <label className="label" htmlFor="nc-phone">Phone</label>
                <input id="nc-phone" className="input" type="tel" value={newContact.phone} onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })} />
              </div>
              <div className="field">
                <label className="label" htmlFor="nc-email">Email</label>
                <input id="nc-email" className="input" type="email" value={newContact.email} onChange={(e) => setNewContact({ ...newContact, email: e.target.value })} />
              </div>
            </div>
          )}

          {/* ── Internal team ─────────────────────────────────────────── */}
          <span style={{ ...sectionLabel, marginTop: 4 }}>Internal account team</span>
          <div className="field">
            <label className="label" htmlFor="op-assignee">Lead account manager</label>
            <select id="op-assignee" className="eoc-select" {...register('assignedToId')}>
              <option value="">Unassigned</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          {extraTeam.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {extraTeam.map((m) => (
                <span key={m.userId} className="pill pill-gray" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {staff.find((s) => s.id === m.userId)?.name} · {TEAM_ROLE_OPTIONS.find((r) => r.value === m.role)?.label}
                  <button
                    type="button" aria-label="Remove" onClick={() => setExtraTeam((p) => p.filter((x) => x.userId !== m.userId))}
                    style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: 'inherit', display: 'inline-flex' }}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          {teamCandidates.length > 0 && (
            <div className="flex items-end gap-2" style={{ flexWrap: 'wrap' }}>
              <div className="field" style={{ flex: 1, minWidth: 180 }}>
                <label className="label" htmlFor="op-team">Also on the deal</label>
                <select id="op-team" className="eoc-select" value={teamPick} onChange={(e) => setTeamPick(e.target.value)}>
                  <option value="">Select staff…</option>
                  {teamCandidates.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="field" style={{ minWidth: 160 }}>
                <label className="label" htmlFor="op-team-role">Role</label>
                <select id="op-team-role" className="eoc-select" value={teamRole} onChange={(e) => setTeamRole(e.target.value as OpportunityTeamRole)}>
                  {TEAM_ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <button
                type="button" className="btn btn-soft btn-sm" disabled={!teamPick}
                onClick={() => { setExtraTeam((p) => [...p, { userId: teamPick, role: teamRole }]); setTeamPick(''); }}
              >
                <Plus size={13} /> Add
              </button>
            </div>
          )}

          {/* ── Notes & documents ─────────────────────────────────────── */}
          <span style={{ ...sectionLabel, marginTop: 4 }}>Notes &amp; documents</span>
          <div className="field">
            <label className="label" htmlFor="op-note">First note (optional)</label>
            <textarea id="op-note" className="eoc-textarea" rows={2} placeholder="How we heard about it, what the client said, next steps…" {...register('initialNote')} />
          </div>

          <div className="field">
            <label className="label" htmlFor="op-files">Documents</label>
            <input
              id="op-files"
              className="input"
              type="file"
              accept={ALLOWED_ATTACHMENT_ACCEPT}
              multiple
              onChange={handleFilesSelected}
            />
            <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
              <Paperclip size={11} style={{ verticalAlign: -1, marginRight: 3 }} />
              PDF or Word (.docx), up to {MAX_ATTACHMENTS} files, 10MB each.
            </span>
            {fileError && <span className="field-error">{fileError}</span>}
            {files.length > 0 && (
              <div className="flex flex-wrap gap-2" style={{ marginTop: 8 }}>
                {files.map((f, i) => (
                  <div
                    key={`${f.name}-${f.size}-${i}`}
                    className="flex items-center gap-2"
                    style={{ padding: '5px 8px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 12, maxWidth: 240 }}
                  >
                    <FileText size={14} style={{ color: 'var(--red)', flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.name} ({formatBytes(f.size)})
                    </span>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      title="Remove"
                      style={{ marginLeft: 'auto', flexShrink: 0 }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2" style={{ marginTop: 4 }}>
            <button type="button" className="btn btn-ghost flex-1" onClick={onClose} disabled={createMutation.isPending}>Cancel</button>
            <button type="submit" className="btn btn-primary flex-1" disabled={createMutation.isPending}>
              {createMutation.isPending ? <AppLoader size={20} /> : null}
              {createMutation.isPending ? 'Adding…' : 'Add opportunity'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default OpportunityFormModal;
