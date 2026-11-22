import { ChangeEvent, DragEvent, KeyboardEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  X, Trash2, FileText, Target, UploadCloud, Check, CalendarDays, Building2, Wallet, Cpu, Users, NotebookPen,
  Briefcase, Plus, Gauge, UserPlus, Crown,
} from 'lucide-react';
import AppLoader from '@/components/shared/AppLoader';
import { useNotificationStore } from '@/stores/notificationStore';
import api from '@/api/client';
import { nairobiTodayISO } from '@/lib/datetime';
import { uploadOpportunityAttachments } from '@/lib/opportunityAttachments';
import {
  CONTACT_ROLE_OPTIONS, ContactRole, Customer, Opportunity, OpportunityPriority, OpportunityTeamRole, PRIORITY_OPTIONS,
  StaffContact, TEAM_ROLE_OPTIONS,
} from '@/types/api';
import { useCustomerOptions, useOems } from '@/hooks/useOpportunityOptions';
import { formatKsh, fromLocalInput, priorityPillClass } from '@/utils/opportunity';
import { clean } from './components/shared';

// Keep in sync with backend/src/modules/opportunities/attachment-constants.ts.
const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_ATTACHMENT_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);
const ALLOWED_ATTACHMENT_EXTS = ['.pdf', '.docx', '.doc'];
const ALLOWED_ATTACHMENT_ACCEPT = '.pdf,.docx,.doc';

const SOURCE_PRESETS = ['Tender portal', 'Existing client', 'Referral', 'OEM lead', 'Cold call', 'Website', 'Event'];
const PROBABILITY_MARKS = [0, 25, 50, 75, 100];
const QUICK_CUSTOMERS = 6;
const QUICK_OEMS = 9;

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

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A number input's value, or undefined when empty/invalid. */
function num(v: unknown): number | undefined {
  return typeof v === 'number' && !Number.isNaN(v) ? v : undefined;
}

function initials(label: string): string {
  return label.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

const optionalNumber = z.preprocess(
  (v) => (v === '' || v === null || v === undefined || Number.isNaN(v) ? undefined : v),
  z.coerce.number().min(0).optional(),
);

const createSchema = z.object({
  customerName: z.string().trim().min(1, 'Pick or type the customer'),
  name: z.string().trim().min(2, 'Give the opportunity a name'),
  description: z.string().optional(),
  source: z.string().optional(),
  dateIdentified: z.string().min(1, 'Date is required'),
  tenderReference: z.string().optional(),
  submissionDeadline: z.string().optional(),
  followUpDate: z.string().optional(),
  clientBudget: optionalNumber,
  estimatedValue: optionalNumber,
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  probability: z.coerce.number().int().min(0).max(100),
  assignedToId: z.string().optional(),
  initialNote: z.string().optional(),
});
type CreateForm = z.infer<typeof createSchema>;

type SectionId = 'customer' | 'deal' | 'value' | 'oems' | 'people' | 'notes';

const SECTIONS: Array<{ id: SectionId; label: string; Icon: typeof Target }> = [
  { id: 'customer', label: 'Customer', Icon: Building2 },
  { id: 'deal', label: 'Deal', Icon: Briefcase },
  { id: 'value', label: 'Value', Icon: Wallet },
  { id: 'oems', label: 'OEMs', Icon: Cpu },
  { id: 'people', label: 'People', Icon: Users },
  { id: 'notes', label: 'Notes & files', Icon: NotebookPen },
];

function Section({
  id, title, hint, Icon, children, sectionRef,
}: {
  id: SectionId;
  title: string;
  hint?: string;
  Icon: typeof Target;
  children: ReactNode;
  sectionRef: (el: HTMLElement | null) => void;
}) {
  return (
    <section id={`of-${id}`} ref={sectionRef} className="tf-section">
      <header className="tf-section-head">
        <span className="tf-section-icon"><Icon size={15} /></span>
        <span className="tf-section-title">{title}</span>
        {hint && <span className="tf-section-hint">{hint}</span>}
      </header>
      <div className="col" style={{ gap: 14 }}>{children}</div>
    </section>
  );
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
  const today = nairobiTodayISO();

  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [oemNames, setOemNames] = useState<string[]>([]);
  const [oemInput, setOemInput] = useState('');
  const [extraTeam, setExtraTeam] = useState<{ userId: string; role: OpportunityTeamRole }[]>([]);
  const [teamPick, setTeamPick] = useState('');
  const [teamRole, setTeamRole] = useState<OpportunityTeamRole>('PRESALES');
  const [contactChoice, setContactChoice] = useState<string>(''); // '' none, 'new', or a contact id
  const [contactRole, setContactRole] = useState<ContactRole>('DECISION_MAKER');
  const [newContact, setNewContact] = useState(emptyContact);
  const [activeSection, setActiveSection] = useState<SectionId>('customer');
  const sectionEls = useRef<Partial<Record<SectionId, HTMLElement | null>>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      customerName: defaultCustomer?.name ?? '',
      name: '',
      dateIdentified: today,
      priority: 'MEDIUM',
      probability: 25,
    },
  });
  const values = watch();
  const probability = Number(values.probability) || 0;

  // Match the typed customer to an existing account (by name or short name).
  const matchedCustomer = useMemo(() => {
    const t = values.customerName?.trim().toLowerCase();
    if (!t) return undefined;
    return customerOptions?.find((c) => c.name.toLowerCase() === t || c.shortName?.toLowerCase() === t);
  }, [values.customerName, customerOptions]);

  const { data: customerDetail } = useQuery({
    queryKey: ['customers', 'detail', matchedCustomer?.id],
    enabled: !!matchedCustomer,
    queryFn: async () => (await api.get<{ data: Customer }>(`/customers/${matchedCustomer!.id}`)).data.data,
  });
  const existingContacts = matchedCustomer ? customerDetail?.contacts ?? [] : [];
  const openDeals = matchedCustomer ? (customerDetail?.opportunities ?? []).filter((o) => o.stage !== 'WON' && o.stage !== 'LOST') : [];

  // Highlight the section currently in view in the header tracker.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActiveSection(top.target.id.replace('of-', '') as SectionId);
      },
      { root, rootMargin: '0px 0px -60% 0px' },
    );
    Object.values(sectionEls.current).forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const contactDone = contactChoice === 'new' ? newContact.name.trim().length > 0 : !!contactChoice;
  const complete: Record<SectionId, boolean> = {
    customer: !!values.customerName?.trim(),
    deal: (values.name ?? '').trim().length >= 2 && !!values.dateIdentified,
    value: num(values.clientBudget) != null || num(values.estimatedValue) != null,
    oems: oemNames.length > 0,
    people: !!values.assignedToId || contactDone,
    notes: !!values.initialNote?.trim() || files.length > 0,
  };
  const doneCount = SECTIONS.filter((s) => complete[s.id]).length;
  const jumpTo = (id: SectionId) => sectionEls.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const pickCustomer = (name: string) => {
    setValue('customerName', values.customerName === name ? '' : name, { shouldValidate: true, shouldDirty: true });
    setContactChoice('');
  };

  // ── OEMs ──────────────────────────────────────────────────────────────────
  const hasOem = (name: string) => oemNames.some((n) => n.toLowerCase() === name.toLowerCase());
  const toggleOem = (name: string) =>
    setOemNames((prev) => (hasOem(name) ? prev.filter((n) => n.toLowerCase() !== name.toLowerCase()) : [...prev, name]));
  const addTypedOem = () => {
    const name = oemInput.trim();
    if (!name) return;
    const canonical = oems?.find((o) => o.name.toLowerCase() === name.toLowerCase())?.name ?? name;
    if (!hasOem(canonical)) setOemNames((prev) => [...prev, canonical]);
    setOemInput('');
  };
  const onOemKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTypedOem(); }
  };
  const quickOems = (oems ?? []).slice(0, QUICK_OEMS);
  const customOems = oemNames.filter((n) => !quickOems.some((o) => o.name.toLowerCase() === n.toLowerCase()));

  // ── Files ─────────────────────────────────────────────────────────────────
  const addFiles = (picked: File[]) => {
    if (picked.length === 0) return;
    const room = MAX_ATTACHMENTS - files.length;
    let error: string | null = null;
    const accepted: File[] = [];
    for (const file of picked) {
      if (!isAllowedFile(file)) { error = `"${file.name}" isn't a supported type. Attach a PDF or Word document (.docx).`; continue; }
      if (file.size > MAX_ATTACHMENT_BYTES) { error = `"${file.name}" is larger than 10MB.`; continue; }
      if (accepted.length >= room) { error = `An opportunity can have at most ${MAX_ATTACHMENTS} files.`; break; }
      accepted.push(file);
    }
    setFiles((prev) => [...prev, ...accepted]);
    setFileError(error);
  };
  const handleFilesSelected = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';
    addFiles(picked);
  };
  const handleDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: async (v: CreateForm) => {
      const contacts =
        contactChoice === 'new' && newContact.name.trim()
          ? [{ role: contactRole, newContact: clean(newContact) }]
          // Ignore a contact picked from a customer the user then switched away from.
          : contactChoice && existingContacts.some((c) => c.id === contactChoice)
            ? [{ role: contactRole, contactId: contactChoice }]
            : [];
      // Pick up an OEM that was typed but not yet added.
      const allOems = oemInput.trim() && !hasOem(oemInput.trim()) ? [...oemNames, oemInput.trim()] : oemNames;

      const res = await api.post<{ data: Opportunity }>('/opportunities', {
        ...v,
        ...(matchedCustomer ? { customerId: matchedCustomer.id, customerName: undefined } : {}),
        assignedToId: v.assignedToId || undefined,
        submissionDeadline: fromLocalInput(v.submissionDeadline) || undefined,
        followUpDate: v.followUpDate || undefined,
        initialNote: v.initialNote?.trim() || undefined,
        oemNames: allOems,
        team: extraTeam.filter((m) => m.userId !== v.assignedToId),
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
  const submitting = createMutation.isPending;

  const onInvalid = () => {
    if (errors.customerName) jumpTo('customer');
    else if (errors.name || errors.dateIdentified) jumpTo('deal');
  };

  const value = num(values.estimatedValue);
  const budget = num(values.clientBudget);
  const overBudget = value != null && budget != null && value > budget;
  const teamCandidates = staff.filter((s) => s.id !== values.assignedToId && !extraTeam.some((m) => m.userId === s.id));
  const leadName = staff.find((s) => s.id === values.assignedToId)?.name;
  const quickCustomers = (customerOptions ?? []).slice(0, QUICK_CUSTOMERS);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(10,20,15,0.45)' }}
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
    >
      <form className="card w-full tf-modal" onSubmit={handleSubmit((v) => createMutation.mutate(v), onInvalid)}>
        {/* Header */}
        <div className="tf-head">
          <div className="flex items-start gap-3" style={{ minWidth: 0 }}>
            <span className="tf-head-icon"><Target size={19} /></span>
            <div style={{ minWidth: 0 }}>
              <h2 className="tf-head-title">Add opportunity</h2>
              <p className="tf-head-sub">Capture a new deal for the pipeline. Fields marked <b>*</b> are required.</p>
            </div>
            <button className="icon-btn" onClick={onClose} type="button" aria-label="Close" style={{ marginLeft: 'auto' }}><X size={16} /></button>
          </div>

          <nav className="tf-steps" aria-label="Form sections">
            {SECTIONS.map(({ id, label }, i) => (
              <button
                key={id}
                type="button"
                className={`tf-step${activeSection === id ? ' active' : ''}${complete[id] ? ' done' : ''}`}
                onClick={() => jumpTo(id)}
              >
                <span className="tf-step-dot">{complete[id] ? <Check size={14} strokeWidth={3} /> : i + 1}</span>
                {label}
              </button>
            ))}
          </nav>
          <div className="tf-progress">
            <div
              className="tf-progress-track" role="progressbar" aria-label="Form completion"
              aria-valuemin={0} aria-valuemax={SECTIONS.length} aria-valuenow={doneCount}
            >
              <div className="tf-progress-fill" style={{ width: `${(doneCount / SECTIONS.length) * 100}%` }} />
            </div>
            <span className={`tf-progress-label${doneCount === SECTIONS.length ? ' all' : ''}`}>
              {doneCount} of {SECTIONS.length} complete
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="tf-body" ref={scrollRef}>
          {/* 1. Customer */}
          <Section id="customer" title="Customer" Icon={Building2} sectionRef={(el) => { sectionEls.current.customer = el; }}>
            {quickCustomers.length > 0 && (
              <div className="field">
                <span className="label">Pick a customer</span>
                <div className="tf-org-grid" role="radiogroup" aria-label="Customer">
                  {quickCustomers.map((c) => {
                    const on = matchedCustomer?.id === c.id;
                    const label = c.shortName || c.name;
                    return (
                      <button
                        key={c.id} type="button" role="radio" aria-checked={on} title={c.name}
                        className={`tf-org${on ? ' on' : ''}`} onClick={() => pickCustomer(c.name)}
                      >
                        <span className="tf-org-mark">{on ? <Check size={14} strokeWidth={3} /> : initials(label)}</span>
                        <span className="tf-org-name">{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="field">
              <label className="label" htmlFor="op-customer">
                {quickCustomers.length > 0 ? 'Or search / type a new one *' : 'Customer / organization *'}
              </label>
              <div className="input-icon">
                <input
                  id="op-customer" className="input" list="op-customer-options" placeholder="e.g. KPLC" autoComplete="off"
                  {...register('customerName', { onChange: () => setContactChoice('') })}
                  style={{ paddingLeft: 40, ...(errors.customerName ? { borderColor: 'var(--red)' } : {}) }}
                />
                <Building2 size={16} />
              </div>
              <datalist id="op-customer-options">
                {customerOptions?.map((c) => <option key={c.id} value={c.name}>{c.shortName ?? ''}</option>)}
              </datalist>
              {errors.customerName ? (
                <span className="field-error">{errors.customerName.message}</span>
              ) : values.customerName?.trim() ? (
                <span className="tf-meter-hint" style={{ margin: 0 }}>
                  {matchedCustomer
                    ? `Existing account${openDeals.length ? ` · ${openDeals.length} open opportunit${openDeals.length === 1 ? 'y' : 'ies'} already` : ''}${existingContacts.length ? ` · ${existingContacts.length} contact${existingContacts.length === 1 ? '' : 's'}` : ''}`
                    : 'New customer, created when you save.'}
                </span>
              ) : null}
            </div>
          </Section>

          {/* 2. Deal */}
          <Section id="deal" title="Deal" Icon={Briefcase} sectionRef={(el) => { sectionEls.current.deal = el; }}>
            <div className="field">
              <label className="label" htmlFor="op-name">Opportunity name *</label>
              <input
                id="op-name" className="input" placeholder="e.g. Data Centre Refresh 2026" {...register('name')}
                style={errors.name ? { borderColor: 'var(--red)' } : undefined}
              />
              {errors.name && <span className="field-error">{errors.name.message}</span>}
            </div>

            <div className="field">
              <div className="flex items-center justify-between">
                <label className="label" htmlFor="op-desc">Scope / description</label>
                <span style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>{(values.description ?? '').length} characters</span>
              </div>
              <textarea id="op-desc" className="eoc-textarea" rows={3} placeholder="What does the client need? Sites, quantities, timelines…" {...register('description')} />
            </div>

            <div className="field">
              <span className="label">Source</span>
              <input type="hidden" {...register('source')} />
              <div className="flex flex-wrap gap-2">
                {SOURCE_PRESETS.map((s) => (
                  <button
                    key={s} type="button" className={`tf-chip${values.source === s ? ' on' : ''}`}
                    onClick={() => setValue('source', values.source === s ? '' : s, { shouldDirty: true })}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label className="label" htmlFor="op-date">Date identified *</label>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="input-icon" style={{ flex: '1 1 180px' }}>
                  <input id="op-date" className="input" type="date" {...register('dateIdentified')} style={{ paddingLeft: 40 }} />
                  <CalendarDays size={16} />
                </div>
                {[
                  { label: 'Yesterday', value: shiftDate(today, -1) },
                  { label: 'Today', value: today },
                ].map((d) => (
                  <button
                    key={d.label} type="button" className={`tf-chip${values.dateIdentified === d.value ? ' on' : ''}`}
                    onClick={() => setValue('dateIdentified', d.value, { shouldValidate: true })}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              {errors.dateIdentified && <span className="field-error">{errors.dateIdentified.message}</span>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="field">
                <label className="label" htmlFor="op-tender">Tender / RFQ reference</label>
                <input id="op-tender" className="input" placeholder="e.g. KPLC/1TD/OT/045/2026" {...register('tenderReference')} />
              </div>
              <div className="field">
                <label className="label" htmlFor="op-deadline">Submission deadline</label>
                <input id="op-deadline" className="input" type="datetime-local" {...register('submissionDeadline')} />
              </div>
            </div>

            <div className="field">
              <label className="label" htmlFor="op-followup">Next follow-up</label>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="input-icon" style={{ flex: '1 1 180px' }}>
                  <input id="op-followup" className="input" type="date" {...register('followUpDate')} style={{ paddingLeft: 40 }} />
                  <CalendarDays size={16} />
                </div>
                {[
                  { label: 'Tomorrow', value: shiftDate(today, 1) },
                  { label: 'In 3 days', value: shiftDate(today, 3) },
                  { label: 'Next week', value: shiftDate(today, 7) },
                ].map((d) => (
                  <button
                    key={d.label} type="button" className={`tf-chip${values.followUpDate === d.value ? ' on' : ''}`}
                    onClick={() => setValue('followUpDate', values.followUpDate === d.value ? '' : d.value, { shouldDirty: true })}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          </Section>

          {/* 3. Value */}
          <Section id="value" title="Value" Icon={Wallet} sectionRef={(el) => { sectionEls.current.value = el; }}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="field">
                <label className="label" htmlFor="op-budget">Client budget (KSh)</label>
                <input id="op-budget" className="input" type="number" min={0} step="1000" placeholder="What the client has set aside" {...register('clientBudget', { valueAsNumber: true })} />
                {budget != null && <span className="tf-meter-hint" style={{ margin: 0 }}>{formatKsh(budget)}</span>}
              </div>
              <div className="field">
                <label className="label" htmlFor="op-value">Our estimated value (KSh)</label>
                <input
                  id="op-value" className="input" type="number" min={0} step="1000" placeholder="What we expect to quote"
                  {...register('estimatedValue', { valueAsNumber: true })} style={overBudget ? { borderColor: 'var(--amber)' } : undefined}
                />
                {value != null && (
                  <span className="tf-meter-hint" style={{ margin: 0, color: overBudget ? 'var(--amber)' : undefined }}>
                    {formatKsh(value)}{overBudget && ' · above the client budget'}
                  </span>
                )}
              </div>
            </div>

            <div className="field">
              <span className="label">Priority</span>
              <input type="hidden" {...register('priority')} />
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Priority">
                {PRIORITY_OPTIONS.map((p) => {
                  const on = values.priority === p.value;
                  return (
                    <button
                      key={p.value} type="button" role="radio" aria-checked={on}
                      className={on ? `${priorityPillClass(p.value as OpportunityPriority)} tf-status on` : 'tf-status'}
                      onClick={() => setValue('priority', p.value, { shouldDirty: true })}
                    >
                      <span className="tf-status-dot" />
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="tf-meter">
              <div className="flex items-baseline justify-between gap-2">
                <label className="label" htmlFor="op-probability" style={{ margin: 0 }}>Probability of winning</label>
                <span className="tf-meter-value">{probability}%</span>
              </div>
              <input
                id="op-probability" className="range-slider" type="range" min={0} max={100} step={5}
                style={{ ['--range-fill' as string]: `${probability}%` }}
                {...register('probability')}
              />
              <div className="tf-marks">
                {PROBABILITY_MARKS.map((m) => (
                  <button
                    key={m} type="button" className={`tf-mark${probability === m ? ' on' : ''}`}
                    onClick={() => setValue('probability', m, { shouldDirty: true })}
                  >
                    {m}%
                  </button>
                ))}
              </div>
              <p className="tf-meter-hint">
                {value ? `Weighted value: ${formatKsh(value * (probability / 100))}. ` : ''}Used for the weighted pipeline on the dashboard.
              </p>
            </div>
          </Section>

          {/* 4. OEMs */}
          <Section id="oems" title="OEMs & vendors" hint={oemNames.length ? `${oemNames.length} selected` : 'Optional'} Icon={Cpu} sectionRef={(el) => { sectionEls.current.oems = el; }}>
            {quickOems.length > 0 && (
              <div className="tf-org-grid" role="group" aria-label="OEMs">
                {quickOems.map((o) => {
                  const on = hasOem(o.name);
                  return (
                    <button
                      key={o.id} type="button" aria-pressed={on} title={o.category ?? o.name}
                      className={`tf-org${on ? ' on' : ''}`} onClick={() => toggleOem(o.name)}
                    >
                      <span className="tf-org-mark">{on ? <Check size={14} strokeWidth={3} /> : initials(o.name)}</span>
                      <span className="tf-org-name">{o.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="field">
              <label className="label" htmlFor="op-oem">{quickOems.length ? 'Another OEM' : 'OEM'}</label>
              <div className="flex gap-2">
                <input
                  id="op-oem" className="input" list="op-oem-options" placeholder="Type a vendor, e.g. Stages — Enter to add"
                  value={oemInput} onChange={(e) => setOemInput(e.target.value)} onKeyDown={onOemKey}
                />
                <button type="button" className="btn btn-soft" onClick={addTypedOem} disabled={!oemInput.trim()}>
                  <Plus size={14} /> Add
                </button>
              </div>
              <datalist id="op-oem-options">
                {oems?.filter((o) => !hasOem(o.name)).map((o) => <option key={o.id} value={o.name}>{o.category ?? ''}</option>)}
              </datalist>
              {customOems.length > 0 && (
                <div className="flex flex-wrap gap-2" style={{ marginTop: 6 }}>
                  {customOems.map((n) => (
                    <button key={n} type="button" className="tf-chip on" onClick={() => toggleOem(n)} aria-label={`Remove ${n}`}>
                      {n} <X size={12} />
                    </button>
                  ))}
                </div>
              )}
              <span className="tf-meter-hint" style={{ margin: 0 }}>Deal registration numbers and OEM contacts can be added after saving.</span>
            </div>
          </Section>

          {/* 5. People */}
          <Section id="people" title="People" Icon={Users} sectionRef={(el) => { sectionEls.current.people = el; }}>
            <div className="field">
              <label className="label" htmlFor="op-assignee">
                <Crown size={12} style={{ verticalAlign: -1, marginRight: 4, color: 'var(--gold)' }} />
                Lead account manager
              </label>
              <select id="op-assignee" className="eoc-select" {...register('assignedToId')}>
                <option value="">Unassigned</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            <div className="field">
              <span className="label">Also on the deal</span>
              {extraTeam.length > 0 && (
                <div className="flex flex-wrap gap-2" style={{ marginBottom: 4 }}>
                  {extraTeam.map((m) => (
                    <button
                      key={m.userId} type="button" className="tf-chip on"
                      onClick={() => setExtraTeam((p) => p.filter((x) => x.userId !== m.userId))}
                      aria-label="Remove team member"
                    >
                      {staff.find((s) => s.id === m.userId)?.name} · {TEAM_ROLE_OPTIONS.find((r) => r.value === m.role)?.label} <X size={12} />
                    </button>
                  ))}
                </div>
              )}
              {teamCandidates.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_170px_auto] gap-2">
                  <select className="eoc-select" value={teamPick} onChange={(e) => setTeamPick(e.target.value)} aria-label="Team member">
                    <option value="">Select staff…</option>
                    {teamCandidates.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <select className="eoc-select" value={teamRole} onChange={(e) => setTeamRole(e.target.value as OpportunityTeamRole)} aria-label="Role">
                    {TEAM_ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  <button
                    type="button" className="btn btn-soft" disabled={!teamPick}
                    onClick={() => { setExtraTeam((p) => [...p, { userId: teamPick, role: teamRole }]); setTeamPick(''); }}
                  >
                    <Plus size={14} /> Add
                  </button>
                </div>
              )}
            </div>

            <div className="field">
              <span className="label">Client contact person</span>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={`tf-chip${contactChoice === '' ? ' on' : ''}`} onClick={() => setContactChoice('')}>
                  None for now
                </button>
                {existingContacts.map((c) => (
                  <button
                    key={c.id} type="button" className={`tf-chip${contactChoice === c.id ? ' on' : ''}`}
                    onClick={() => setContactChoice(c.id)} title={c.title ?? undefined}
                  >
                    {c.name}{c.title ? ` · ${c.title}` : ''}
                  </button>
                ))}
                <button type="button" className={`tf-chip${contactChoice === 'new' ? ' on' : ''}`} onClick={() => setContactChoice('new')}>
                  <UserPlus size={13} /> New contact
                </button>
              </div>
            </div>

            {contactChoice === 'new' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="field">
                  <label className="label" htmlFor="nc-name">Full name</label>
                  <input id="nc-name" className="input" value={newContact.name} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })} />
                </div>
                <div className="field">
                  <label className="label" htmlFor="nc-title">Title / designation</label>
                  <input id="nc-title" className="input" placeholder="e.g. ICT Manager" value={newContact.title} onChange={(e) => setNewContact({ ...newContact, title: e.target.value })} />
                </div>
                <div className="field">
                  <label className="label" htmlFor="nc-phone">Phone</label>
                  <input id="nc-phone" className="input" type="tel" placeholder="07…" value={newContact.phone} onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })} />
                </div>
                <div className="field">
                  <label className="label" htmlFor="nc-email">Email</label>
                  <input id="nc-email" className="input" type="email" value={newContact.email} onChange={(e) => setNewContact({ ...newContact, email: e.target.value })} />
                </div>
              </div>
            )}

            {contactChoice && (
              <div className="field">
                <span className="label">Their role in this deal</span>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Contact role">
                  {CONTACT_ROLE_OPTIONS.map((r) => (
                    <button
                      key={r.value} type="button" role="radio" aria-checked={contactRole === r.value}
                      className={`tf-chip sm${contactRole === r.value ? ' on' : ''}`} onClick={() => setContactRole(r.value)}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Section>

          {/* 6. Notes & files */}
          <Section id="notes" title="Notes & files" hint={`${files.length} of ${MAX_ATTACHMENTS} files`} Icon={NotebookPen} sectionRef={(el) => { sectionEls.current.notes = el; }}>
            <div className="field">
              <label className="label" htmlFor="op-note">First note</label>
              <textarea
                id="op-note" className="eoc-textarea" rows={3}
                placeholder="How we heard about it, what the client said, next steps…" {...register('initialNote')}
              />
            </div>

            <div className="field">
              <label
                htmlFor="op-files"
                className={`file-dropzone tf-drop${dragging ? ' dragging' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
              >
                <UploadCloud size={24} />
                <span>{dragging ? 'Drop to attach' : 'Drag the RFQ, BOQ or proposal here, or click to browse'}</span>
                <span className="file-dropzone-hint">PDF or Word (.docx) · up to {MAX_ATTACHMENTS} files, 10MB each</span>
              </label>
              <input id="op-files" className="sr-only" type="file" accept={ALLOWED_ATTACHMENT_ACCEPT} multiple onChange={handleFilesSelected} />
              {fileError && <span className="field-error">{fileError}</span>}

              {files.length > 0 && (
                <div className="tf-tiles">
                  {files.map((f, i) => (
                    <div className="tf-tile" title={f.name} key={`${f.name}-${f.size}-${i}`}>
                      <div className="tf-tile-thumb"><FileText size={22} /></div>
                      <div className="tf-tile-meta">
                        <span className="tf-tile-name">{f.name}</span>
                        <span className="tf-tile-detail">{formatBytes(f.size)} · new</span>
                      </div>
                      <button
                        type="button" className="tf-tile-remove" aria-label={`Remove ${f.name}`}
                        onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Section>
        </div>

        {/* Footer */}
        <div className="tf-foot">
          <div className="tf-summary">
            <Gauge size={15} style={{ color: 'var(--red)', flexShrink: 0 }} />
            <span>
              <b>{values.customerName?.trim() || 'New opportunity'}</b>
              {values.name?.trim() && ` · ${values.name.trim()}`}
              {value ? ` · ${formatKsh(value)}` : ''}
              {` · ${probability}%`}
              {oemNames.length > 0 && ` · ${oemNames.join(', ')}`}
              {leadName && ` · ${leadName}`}
            </span>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting} style={{ minWidth: 160 }}>
              {submitting ? <AppLoader size={20} /> : <Check size={16} />}
              {submitting ? 'Saving…' : 'Add opportunity'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export default OpportunityFormModal;
