import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Megaphone, MessageCircle, MessageSquareText, Users, Send, Check, X, Search, UserPlus, AlertTriangle,
  ChevronLeft, ChevronRight, CircleCheck, CircleX, Clock3, Eye,
} from 'lucide-react';
import api from '@/api/client';
import AppLoader from '@/components/shared/AppLoader';
import PageLoader from '@/components/shared/PageLoader';
import VerifiedBadge from '@/components/shared/VerifiedBadge';
import { confirmDialog } from '@/lib/alert';
import { fmtDateTime } from '@/lib/datetime';
import { useNotificationStore } from '@/stores/notificationStore';
import { DEPARTMENT_OPTIONS, Department, Role } from '@/types/api';

type Channel = 'WHATSAPP' | 'SMS';

interface Person {
  id: string;
  name: string;
  role: Role;
  department: Department | null;
  hasPhone: boolean;
}

interface CampaignOptions {
  channels: Channel[];
  people: Person[];
  limits: { title: number; message: number };
}

interface Audience {
  everyone: boolean;
  roles: Role[];
  departments: Department[];
  userIds: string[];
}

interface AudiencePreview {
  count: number;
  reachable: number;
  missingPhone: string[];
  sample: string[];
}

interface Campaign {
  id: string;
  title: string;
  message: string;
  channels: Channel[];
  audience: Audience;
  status: 'SENDING' | 'SENT' | 'PARTIAL' | 'FAILED';
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  createdAt: string;
  completedAt: string | null;
  createdBy: { id: string; name: string };
}

interface CampaignDetail extends Campaign {
  recipients: Array<{ id: string; name: string; channel: Channel; status: 'PENDING' | 'SENT' | 'FAILED'; error: string | null; sentAt: string | null; readAt: string | null }>;
}

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'STAFF', label: 'Staff' },
  { value: 'ATTACHEE', label: 'Attachees' },
  { value: 'ADMIN', label: 'Admins' },
  { value: 'SUPER_ADMIN', label: 'Super Admins' },
];

const CHANNEL_META: Record<Channel, { label: string; Icon: typeof MessageCircle; hint: string }> = {
  WHATSAPP: { label: 'WhatsApp', Icon: MessageCircle, hint: 'Notice with a View Notice button' },
  SMS: { label: 'SMS', Icon: MessageSquareText, hint: 'Reaches any phone' },
};

const STATUS_META: Record<Campaign['status'], { label: string; className: string }> = {
  SENDING: { label: 'Sending', className: 'pill pill-amber' },
  SENT: { label: 'Delivered', className: 'pill cp-pill-ok' },
  PARTIAL: { label: 'Partly delivered', className: 'pill pill-gold' },
  FAILED: { label: 'Failed', className: 'pill pill-red' },
};

const DRAFT_KEY = 'campaign-draft';
const EMPTY_AUDIENCE: Audience = { everyone: true, roles: [], departments: [], userIds: [] };

function roleLabel(role: Role): string {
  return ROLE_OPTIONS.find((r) => r.value === role)?.label.replace(/s$/, '') ?? role;
}

function departmentLabel(dep: Department | null): string {
  return DEPARTMENT_OPTIONS.find((d) => d.value === dep)?.label ?? '';
}

/** SMS is billed per 160-character part (153 each once a message is split). */
function smsParts(length: number): number {
  if (length <= 160) return 1;
  return Math.ceil(length / 153);
}

function describeAudience(a: Audience, people: Person[]): string {
  if (a.everyone) return 'Everyone';
  const parts = [
    ...a.roles.map((r) => ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r),
    ...a.departments.map((d) => departmentLabel(d)),
  ];
  const named = a.userIds.length;
  if (named > 0) parts.push(named === 1 ? (people.find((p) => p.id === a.userIds[0])?.name ?? '1 person') : `${named} people`);
  return parts.join(', ') || 'No one';
}

function loadDraft(): { title: string; message: string; channels: Channel[]; audience: Audience } | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={`tf-chip${on ? ' on' : ''}`} onClick={onClick} aria-pressed={on}>
      {on && <Check size={13} strokeWidth={3} />}
      {children}
    </button>
  );
}

function CampaignsPage() {
  const queryClient = useQueryClient();
  const { addNotification } = useNotificationStore();
  const draft = useMemo(loadDraft, []);

  const [title, setTitle] = useState(draft?.title ?? '');
  const [message, setMessage] = useState(draft?.message ?? '');
  const [channels, setChannels] = useState<Channel[]>(draft?.channels ?? ['WHATSAPP']);
  const [audience, setAudience] = useState<Audience>(draft?.audience ?? EMPTY_AUDIENCE);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [preview, setPreview] = useState<AudiencePreview | null>(null);

  const { data: options, isLoading: optionsLoading } = useQuery({
    queryKey: ['campaigns', 'options'],
    queryFn: async () => (await api.get<{ data: CampaignOptions }>('/campaigns/options')).data.data,
  });

  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ['campaigns', 'list', page],
    queryFn: async () => (await api.get<{ data: Campaign[]; meta: { total: number; totalPages: number } }>('/campaigns', { params: { page, limit: 8 } })).data,
    refetchInterval: (q) => (q.state.data?.data.some((c) => c.status === 'SENDING') ? 3000 : false),
  });

  const people = options?.people ?? [];
  const limits = options?.limits ?? { title: 60, message: 700 };
  const available = options?.channels ?? [];

  // Keep the draft through reloads and accidental navigation.
  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ title, message, channels, audience }));
    } catch {
      /* storage unavailable - the draft just won't survive a reload */
    }
  }, [title, message, channels, audience]);

  // Warn before closing the tab with an unsent message.
  useEffect(() => {
    if (!message.trim()) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [message]);

  // Live audience size, debounced so ticking several chips makes one request.
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        setPreview((await api.post<{ data: AudiencePreview }>('/campaigns/preview', audience)).data.data);
      } catch {
        setPreview(null);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [audience]);

  const sendMutation = useMutation({
    mutationFn: async () => (await api.post<{ data: Campaign }>('/campaigns', { title, message, channels, audience })).data.data,
    onSuccess: (campaign) => {
      addNotification({ type: 'success', title: 'Campaign on its way', message: `Sending "${campaign.title}" now.` });
      setTitle('');
      setMessage('');
      setAudience(EMPTY_AUDIENCE);
      try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      setPage(1);
      queryClient.invalidateQueries({ queryKey: ['campaigns', 'list'] });
      setOpenId(campaign.id);
    },
    onError: (err: any) =>
      addNotification({ type: 'error', title: 'Campaign not sent', message: err?.response?.data?.message || 'Please try again.' }),
  });

  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const filteredPeople = people.filter((p) => {
    const q = search.trim().toLowerCase();
    return !q || p.name.toLowerCase().includes(q) || departmentLabel(p.department).toLowerCase().includes(q);
  });

  const reach = preview?.reachable ?? 0;
  const problems = [
    !title.trim() && 'Add a title',
    !message.trim() && 'Write a message',
    channels.length === 0 && 'Choose a channel',
    preview && preview.count === 0 && 'Choose who should receive it',
  ].filter(Boolean) as string[];

  const handleSend = async () => {
    if (problems.length > 0 || !preview) return;
    const confirmed = await confirmDialog({
      title: `Send to ${preview.count} ${preview.count === 1 ? 'person' : 'people'}?`,
      text:
        `"${title.trim()}" will go out by ${channels.map((c) => CHANNEL_META[c].label).join(' and ')}. ` +
        (preview.missingPhone.length > 0 ? `${preview.missingPhone.length} without a phone number will be skipped. ` : '') +
        'Messages cannot be recalled once sent.',
      confirmLabel: 'Send campaign',
    });
    if (confirmed) sendMutation.mutate();
  };

  const sampleName = (preview?.sample[0] ?? 'Grace').split(' ')[0];
  const previewBody = (message.trim() || 'Your message will appear here.').replace(/\{name\}/gi, sampleName);

  if (optionsLoading) return <PageLoader height={420} label="Loading campaigns…" />;

  return (
    <div className="col" style={{ gap: 20 }}>
      <div>
        <p className="eyebrow">Management</p>
        <h2 className="text-2xl font-bold mt-1" style={{ color: 'var(--ink)' }}>Campaigns</h2>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Send an announcement to staff and attachees by WhatsApp or SMS, and see who received it.
        </p>
      </div>

      <div className="cp-grid">
        {/* ── Composer ── */}
        <div className="card">
          <div className="card-pad col" style={{ gap: 22 }}>
            <section className="col" style={{ gap: 12 }}>
              <div className="cp-step"><span>1</span>Message</div>
              <div className="field">
                <div className="flex items-center justify-between">
                  <label className="label" htmlFor="cp-title">Title</label>
                  <span className="cp-count">{title.length}/{limits.title}</span>
                </div>
                <input
                  id="cp-title"
                  className="input"
                  maxLength={limits.title}
                  placeholder="e.g. Staff meeting moved to Friday"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="field">
                <div className="flex items-center justify-between">
                  <label className="label" htmlFor="cp-message">Message</label>
                  <span className="cp-count" style={message.length > limits.message * 0.9 ? { color: 'var(--red)' } : undefined}>
                    {message.length}/{limits.message}
                    {channels.includes('SMS') && message.length > 0 && ` · ${smsParts(message.length + title.length + 2)} SMS part${smsParts(message.length + title.length + 2) === 1 ? '' : 's'}`}
                  </span>
                </div>
                <textarea
                  id="cp-message"
                  className="eoc-textarea"
                  rows={6}
                  maxLength={limits.message}
                  placeholder="Write your announcement. Use {name} to greet each person by first name."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 6 }}>
                  <button type="button" className="tf-chip sm" onClick={() => setMessage((m) => `${m}{name}`)}>
                    <UserPlus size={12} /> Insert first name
                  </button>
                  <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>Shown to each person as their own first name.</span>
                </div>
              </div>
            </section>

            <section className="col" style={{ gap: 12 }}>
              <div className="cp-step"><span>2</span>Channels</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(['WHATSAPP', 'SMS'] as Channel[]).map((c) => {
                  const { label, Icon, hint } = CHANNEL_META[c];
                  const enabled = available.includes(c);
                  const on = channels.includes(c);
                  return (
                    <button
                      key={c}
                      type="button"
                      disabled={!enabled}
                      aria-pressed={on}
                      className={`cp-channel${on ? ' on' : ''}`}
                      onClick={() => setChannels((prev) => toggle(prev, c))}
                    >
                      <span className="cp-channel-icon"><Icon size={17} /></span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <b>{label}</b>
                        <small>{enabled ? hint : 'Not configured on the server'}</small>
                      </span>
                      {on && <Check size={17} style={{ color: 'var(--green)' }} />}
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="col" style={{ gap: 12 }}>
              <div className="cp-step"><span>3</span>Audience</div>
              <div className="seg" role="tablist" style={{ alignSelf: 'flex-start' }}>
                <button type="button" className={audience.everyone ? 'on' : ''} onClick={() => setAudience({ ...EMPTY_AUDIENCE, everyone: true })}>
                  <Users size={14} /> Everyone
                </button>
                <button type="button" className={!audience.everyone ? 'on' : ''} onClick={() => setAudience((a) => ({ ...a, everyone: false }))}>
                  Choose groups &amp; people
                </button>
              </div>

              {!audience.everyone && (
                <div className="col" style={{ gap: 14 }}>
                  <div>
                    <p className="label">Roles</p>
                    <div className="flex flex-wrap gap-2">
                      {ROLE_OPTIONS.map((r) => (
                        <Chip key={r.value} on={audience.roles.includes(r.value)} onClick={() => setAudience((a) => ({ ...a, roles: toggle(a.roles, r.value) }))}>
                          {r.label}
                        </Chip>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="label">Departments</p>
                    <div className="flex flex-wrap gap-2">
                      {DEPARTMENT_OPTIONS.map((d) => (
                        <Chip key={d.value} on={audience.departments.includes(d.value)} onClick={() => setAudience((a) => ({ ...a, departments: toggle(a.departments, d.value) }))}>
                          {d.label}
                        </Chip>
                      ))}
                    </div>
                    {audience.roles.length > 0 && audience.departments.length > 0 && (
                      <p style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>Only people who match both a chosen role and a chosen department.</p>
                    )}
                  </div>
                  <div>
                    <p className="label">Add specific people</p>
                    <div className="input-icon">
                      <input className="input" placeholder="Search by name or department" value={search} onChange={(e) => setSearch(e.target.value)} style={{ paddingLeft: 40 }} />
                      <Search size={16} />
                    </div>
                    <div className="cp-people">
                      {filteredPeople.length === 0 && <p style={{ padding: 12, fontSize: 12.5, color: 'var(--muted)' }}>No one matches "{search}".</p>}
                      {filteredPeople.map((p) => {
                        const on = audience.userIds.includes(p.id);
                        return (
                          <label key={p.id} className={`cp-person${on ? ' on' : ''}`}>
                            <input type="checkbox" checked={on} onChange={() => setAudience((a) => ({ ...a, userIds: toggle(a.userIds, p.id) }))} />
                            <span style={{ flex: 1, minWidth: 0 }}>
                              <b>{p.name}</b><VerifiedBadge size={12} />
                              <small>{[roleLabel(p.role), departmentLabel(p.department)].filter(Boolean).join(' · ')}</small>
                            </span>
                            {!p.hasPhone && <span className="pill pill-red" style={{ fontSize: 10.5 }}>No phone</span>}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>

        {/* ── Preview & send ── */}
        <div className="col cp-side" style={{ gap: 16 }}>
          <div className="card card-pad col" style={{ gap: 12 }}>
            <p className="eyebrow">Preview</p>
            <div className="cp-phone">
              {channels.includes('WHATSAPP') && (
                <>
                  <small className="cp-phone-note">1. Arrives as a notice</small>
                  <div className="cp-bubble wa">
                    <b>New notice from management</b>
                    <p>Hello {sampleName}, there is a new notice for you: "{title.trim() || 'Your title'}".</p>
                    <p>Tap View Notice to read it.</p>
                    <small>Millenium Solutions Task Assistant</small>
                    <span className="cp-bubble-btn">View Notice</span>
                  </div>
                  <small className="cp-phone-note">2. Full message after they tap View Notice</small>
                  <div className="cp-bubble wa">
                    <b>{title.trim() || 'Your title'}</b>
                    <p>Hello {sampleName},</p>
                    <p style={{ whiteSpace: 'pre-wrap' }}>{previewBody}</p>
                    <small>Sent by Millenium Solutions management</small>
                  </div>
                </>
              )}
              {channels.includes('SMS') && (
                <div className="cp-bubble sms">
                  <small className="cp-bubble-from">SMS</small>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{title.trim() || 'Your title'}: {previewBody}</p>
                </div>
              )}
              {channels.length === 0 && <p style={{ fontSize: 12.5, color: 'var(--muted)', textAlign: 'center', padding: 20 }}>Choose a channel to preview.</p>}
            </div>
          </div>

          <div className="card card-pad col" style={{ gap: 12 }}>
            <p className="eyebrow">Reach</p>
            {preview ? (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="cp-reach">{reach}</span>
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>of {preview.count} {preview.count === 1 ? 'person' : 'people'} can be reached</span>
                </div>
                <p style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{describeAudience(audience, people)}</p>
                {preview.missingPhone.length > 0 && (
                  <div className="cp-warn">
                    <AlertTriangle size={14} />
                    <span>
                      No phone number for {preview.missingPhone.slice(0, 3).join(', ')}
                      {preview.missingPhone.length > 3 && ` and ${preview.missingPhone.length - 3} more`}. They'll be skipped. Add numbers under Staff Members.
                    </span>
                  </div>
                )}
              </>
            ) : (
              <PageLoader height={60} size={20} label="" />
            )}

            {problems.length > 0 && <p style={{ fontSize: 12, color: 'var(--muted)' }}>To send: {problems.join(' · ').toLowerCase()}.</p>}

            <button
              type="button"
              className="btn btn-primary btn-lg"
              disabled={problems.length > 0 || !preview || reach === 0 || sendMutation.isPending}
              onClick={handleSend}
            >
              {sendMutation.isPending ? <AppLoader size={20} /> : <Send size={16} />}
              {sendMutation.isPending ? 'Sending…' : `Send to ${reach} ${reach === 1 ? 'person' : 'people'}`}
            </button>
            <p style={{ fontSize: 11.5, color: 'var(--muted)', textAlign: 'center' }}>You'll be asked to confirm before anything is sent.</p>
          </div>
        </div>
      </div>

      {/* ── History ── */}
      <div className="card">
        <div className="card-head"><span className="card-title flex items-center gap-2"><Megaphone size={16} /> Sent campaigns</span></div>
        {historyLoading ? (
          <PageLoader height={200} />
        ) : (history?.data.length ?? 0) === 0 ? (
          <div className="card-pad" style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--muted)', fontSize: 13 }}>
            No campaigns yet. Your first announcement will appear here with its delivery report.
          </div>
        ) : (
          <div className="col">
            {history!.data.map((c) => {
              const done = c.sentCount + c.failedCount;
              const total = c.recipientCount * c.channels.length;
              return (
                <button key={c.id} type="button" className="cp-row" onClick={() => setOpenId(c.id)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <b>{c.title}</b>
                      <span className={STATUS_META[c.status].className}>{STATUS_META[c.status].label}</span>
                    </div>
                    <small>
                      {fmtDateTime(c.createdAt)} · {c.createdBy.name} · {describeAudience(c.audience, people)} · {c.channels.map((ch) => CHANNEL_META[ch].label).join(' + ')}
                    </small>
                  </div>
                  <div className="cp-row-stats">
                    <div className="cp-bar"><span className="ok" style={{ width: `${total ? (c.sentCount / total) * 100 : 0}%` }} /><span className="bad" style={{ width: `${total ? (c.failedCount / total) * 100 : 0}%` }} /></div>
                    <small>{c.status === 'SENDING' ? `${done} of ${total} processed` : `${c.sentCount} delivered${c.failedCount ? ` · ${c.failedCount} failed` : ''}`}</small>
                  </div>
                </button>
              );
            })}
            {(history?.meta.totalPages ?? 0) > 1 && (
              <div className="flex items-center justify-between card-pad" style={{ borderTop: '1px solid var(--border)' }}>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>Page {page} of {history!.meta.totalPages}</span>
                <div className="flex gap-2">
                  <button className="btn btn-soft btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={14} /></button>
                  <button className="btn btn-soft btn-sm" disabled={page >= history!.meta.totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight size={14} /></button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {openId && <CampaignReport id={openId} people={people} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/** Per-person delivery report; refreshes every few seconds while still sending. */
function CampaignReport({ id, people, onClose }: { id: string; people: Person[]; onClose: () => void }) {
  const [filter, setFilter] = useState<'ALL' | 'SENT' | 'FAILED'>('ALL');
  const { data: c } = useQuery({
    queryKey: ['campaigns', 'detail', id],
    queryFn: async () => (await api.get<{ data: CampaignDetail }>(`/campaigns/${id}`)).data.data,
    refetchInterval: (q) => (q.state.data?.status === 'SENDING' ? 2500 : false),
  });

  const rows = (c?.recipients ?? []).filter((r) => filter === 'ALL' || r.status === filter);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(10,20,15,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card w-full" style={{ maxWidth: 640, maxHeight: 'calc(100vh - 32px)', display: 'flex', flexDirection: 'column' }}>
        <div className="card-head">
          <span className="card-title">{c?.title ?? 'Campaign'}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        {!c ? (
          <PageLoader height={240} />
        ) : (
          <div className="card-pad col" style={{ gap: 14, overflowY: 'auto' }}>
            <div className="flex items-center gap-2 flex-wrap" style={{ fontSize: 12.5, color: 'var(--muted)' }}>
              <span className={STATUS_META[c.status].className}>{STATUS_META[c.status].label}</span>
              {fmtDateTime(c.createdAt)} · by {c.createdBy.name} · {describeAudience(c.audience, people)}
            </div>
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, background: 'var(--surface-2)', borderRadius: 10, padding: 12 }}>{c.message}</div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Delivered', value: c.sentCount, Icon: CircleCheck, color: 'var(--color-status-success, #169A5B)' },
                { label: 'Failed', value: c.failedCount, Icon: CircleX, color: 'var(--red)' },
                { label: 'Opened on WhatsApp', value: c.recipients.filter((r) => r.readAt).length, Icon: Eye, color: 'var(--blue)' },
                { label: 'Pending', value: c.recipients.filter((r) => r.status === 'PENDING').length, Icon: Clock3, color: 'var(--amber)' },
              ].map(({ label, value, Icon, color }) => (
                <div key={label} className="cp-stat">
                  <Icon size={16} style={{ color }} />
                  <b>{value}</b>
                  <small>{label}</small>
                </div>
              ))}
            </div>

            <div className="seg" style={{ alignSelf: 'flex-start' }}>
              {(['ALL', 'SENT', 'FAILED'] as const).map((f) => (
                <button key={f} type="button" className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                  {f === 'ALL' ? 'Everyone' : f === 'SENT' ? 'Delivered' : 'Failed'}
                </button>
              ))}
            </div>

            <div className="col" style={{ gap: 0, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              {rows.length === 0 && <p style={{ padding: 14, fontSize: 12.5, color: 'var(--muted)' }}>No one in this list.</p>}
              {rows.map((r) => (
                <div key={r.id} className="cp-recipient">
                  {r.status === 'SENT' ? <CircleCheck size={15} style={{ color: 'var(--color-status-success, #169A5B)' }} /> : r.status === 'FAILED' ? <CircleX size={15} style={{ color: 'var(--red)' }} /> : <AppLoader size={14} />}
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b>{r.name}</b>
                    {r.error && <small>{r.error}</small>}
                  </span>
                  {r.readAt && <span className="pill pill-blue" style={{ fontSize: 10.5 }} title={fmtDateTime(r.readAt)}>Opened</span>}
                  <span className="pill" style={{ fontSize: 10.5 }}>{CHANNEL_META[r.channel].label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default CampaignsPage;
