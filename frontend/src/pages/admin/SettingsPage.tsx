import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Settings, MessageCircle, Building2, KeyRound, Gauge, FileText, RefreshCw, CircleCheck, CircleAlert, Copy, Check,
} from 'lucide-react';
import api from '@/api/client';
import PageLoader from '@/components/shared/PageLoader';
import { fmtDateTime } from '@/lib/datetime';

interface WhatsAppOverview {
  configured: { token: boolean; phoneNumberId: string | null; businessAccountId: string | null; tokenHint: string | null };
  error?: string;
  fetchedAt?: string;
  phone?: { error?: string; number?: string; verifiedName?: string; status?: string; qualityRating?: string; nameStatus?: string; verification?: string; platform?: string; throughput?: string | null };
  businessAccount?: { error?: string; id?: string; name?: string; reviewStatus?: string; businessVerification?: string; currency?: string };
  token?: { error?: string; valid?: boolean; type?: string | null; app?: string | null; expiresAt?: string | null; scopes?: string[] };
  messaging?: { tier: string | null; limit: number | null; usedLast24h: number; remaining: number | null; sent30d: number | null; delivered30d: number | null };
  templates?: { error?: string } | Array<{ name: string; status: string; category: string; language: string }>;
}

const QUALITY: Record<string, { label: string; tone: string; hint: string }> = {
  GREEN: { label: 'High', tone: 'ok', hint: 'Recipients rarely block or report your messages.' },
  YELLOW: { label: 'Medium', tone: 'warn', hint: 'Some recipients are blocking or reporting messages - review recent campaigns.' },
  RED: { label: 'Low', tone: 'bad', hint: 'Meta may restrict sending soon. Pause bulk messages and review content.' },
  UNKNOWN: { label: 'Not rated yet', tone: 'muted', hint: 'Rated once enough messages have been sent.' },
};

const TEMPLATE_PURPOSE: Record<string, string> = {
  task_reminder: 'Task reminders',
  staff_notice: 'Campaign notices',
  hello_world: "Meta's sample - not used",
};

function humanize(value?: string | null): string {
  if (!value) return '-';
  return value.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function StatusDot({ tone }: { tone: string }) {
  return <span className={`st-dot ${tone}`} />;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="st-row">
      <span>{label}</span>
      <span>{children}</span>
    </div>
  );
}

function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="flex items-center gap-1 mono" style={{ fontSize: 12.5 }}>
      {value}
      <button
        type="button"
        className="icon-btn"
        style={{ width: 26, height: 26 }}
        aria-label="Copy"
        onClick={() => {
          navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
        }}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </span>
  );
}

function Card({ Icon, title, children, error }: { Icon: typeof Settings; title: string; children: ReactNode; error?: string }) {
  return (
    <div className="card">
      <div className="card-head"><span className="card-title flex items-center gap-2"><Icon size={16} /> {title}</span></div>
      <div className="card-pad">
        {error ? (
          <div className="cp-warn"><CircleAlert size={14} /><span>Meta returned an error: {error}</span></div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function SettingsPage() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'whatsapp'],
    queryFn: async () => (await api.get<{ data: WhatsAppOverview }>('/settings/whatsapp')).data.data,
  });

  const refresh = async () => {
    setRefreshing(true);
    try {
      const fresh = (await api.get<{ data: WhatsAppOverview }>('/settings/whatsapp', { params: { refresh: 1 } })).data.data;
      queryClient.setQueryData(['settings', 'whatsapp'], fresh);
    } finally {
      setRefreshing(false);
    }
  };

  if (isLoading || !data) return <PageLoader height={420} label="Checking WhatsApp account…" />;

  const m = data.messaging;
  const quality = QUALITY[data.phone?.qualityRating ?? 'UNKNOWN'] ?? QUALITY.UNKNOWN;
  const templates = Array.isArray(data.templates) ? data.templates : [];
  const usedPct = m?.limit ? Math.min(100, (m.usedLast24h / m.limit) * 100) : 0;

  return (
    <div className="col" style={{ gap: 20 }}>
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="eyebrow">Management</p>
          <h2 className="text-2xl font-bold mt-1" style={{ color: 'var(--ink)' }}>Settings</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
            WhatsApp Business connection, read live from Meta{data.fetchedAt ? ` · updated ${fmtDateTime(data.fetchedAt)}` : ''}.
          </p>
        </div>
        <button className="btn btn-soft" onClick={refresh} disabled={refreshing}>
          <RefreshCw size={15} className={refreshing ? 'spin' : undefined} /> Refresh
        </button>
      </div>

      {data.error && <div className="cp-warn"><CircleAlert size={14} /><span>{data.error}</span></div>}

      {/* Capacity hero */}
      {m && (
        <div className="card card-pad st-hero">
          <div style={{ flex: 1, minWidth: 220 }}>
            <p className="eyebrow flex items-center gap-1"><Gauge size={13} /> Conversations available today</p>
            <div className="flex items-baseline gap-2" style={{ marginTop: 6 }}>
              <span className="cp-reach" style={{ fontSize: 40 }}>{m.remaining ?? 'Unlimited'}</span>
              {m.limit != null && <span style={{ color: 'var(--muted)', fontSize: 14 }}>of {m.limit.toLocaleString()} per 24 hours</span>}
            </div>
            {m.limit != null && (
              <div className="cp-bar" style={{ height: 9, marginTop: 12 }}>
                <span className="ok" style={{ width: `${usedPct}%`, background: usedPct > 80 ? 'var(--red)' : undefined }} />
              </div>
            )}
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
              {m.usedLast24h} {m.usedLast24h === 1 ? 'person' : 'people'} messaged first by reminders and campaigns in the last 24 hours.
              Replies to people who message the bot don't count.
            </p>
          </div>
          <div className="st-hero-side">
            <Row label="Messaging tier">{humanize(m.tier)}</Row>
            <Row label="Quality"><StatusDot tone={quality.tone} /> {quality.label}</Row>
            <Row label="Throughput">{humanize(data.phone?.throughput)}</Row>
            {m.sent30d != null && <Row label="Sent, last 30 days">{m.sent30d.toLocaleString()} ({m.delivered30d?.toLocaleString()} delivered)</Row>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card Icon={MessageCircle} title="Phone number" error={data.phone?.error}>
          <div className="st-number">{data.phone?.number ?? '-'}</div>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>Shown to staff as <b style={{ color: 'var(--ink)' }}>{data.phone?.verifiedName}</b></p>
          <Row label="Connection"><StatusDot tone={data.phone?.status === 'CONNECTED' ? 'ok' : 'bad'} /> {humanize(data.phone?.status)}</Row>
          <Row label="Number verification">{humanize(data.phone?.verification)}</Row>
          <Row label="Display name">{humanize(data.phone?.nameStatus)}</Row>
          <Row label="Platform">{humanize(data.phone?.platform)}</Row>
          <Row label="Phone number ID">{data.configured.phoneNumberId && <CopyValue value={data.configured.phoneNumberId} />}</Row>
          <p style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 10 }}>{quality.hint}</p>
        </Card>

        <Card Icon={Building2} title="Business account" error={data.businessAccount?.error}>
          <div className="st-number" style={{ fontSize: 22 }}>{data.businessAccount?.name ?? '-'}</div>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>WhatsApp Business Account (WABA)</p>
          <Row label="Account review"><StatusDot tone={data.businessAccount?.reviewStatus === 'APPROVED' ? 'ok' : 'warn'} /> {humanize(data.businessAccount?.reviewStatus)}</Row>
          <Row label="Business verification"><StatusDot tone={data.businessAccount?.businessVerification === 'verified' ? 'ok' : 'warn'} /> {humanize(data.businessAccount?.businessVerification)}</Row>
          <Row label="Billing currency">{data.businessAccount?.currency ?? '-'}</Row>
          <Row label="WABA ID">{data.configured.businessAccountId && <CopyValue value={data.configured.businessAccountId} />}</Row>
        </Card>

        <Card Icon={KeyRound} title="Access token" error={data.token?.error}>
          <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
            {data.token?.valid ? <CircleCheck size={20} style={{ color: 'var(--color-status-success, #169A5B)' }} /> : <CircleAlert size={20} style={{ color: 'var(--red)' }} />}
            <b style={{ fontSize: 15, color: 'var(--ink)' }}>{data.token?.valid ? 'Valid' : 'Invalid - the bot cannot send'}</b>
          </div>
          <Row label="Token">{data.configured.tokenHint ? <span className="mono">{data.configured.tokenHint}</span> : 'Not set'}</Row>
          <Row label="Type">{humanize(data.token?.type)}</Row>
          <Row label="App">{data.token?.app ?? '-'}</Row>
          <Row label="Expires">{data.token?.expiresAt ? fmtDateTime(data.token.expiresAt) : 'Never'}</Row>
          <Row label="Permissions">{data.token?.scopes?.map(humanize).join(', ') || '-'}</Row>
          <p style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 10 }}>
            The token is never sent to the browser - only its last characters are shown. To change it, update WHATSAPP_TOKEN in the server's .env and restart the backend.
          </p>
        </Card>

        <Card Icon={FileText} title="Message templates" error={Array.isArray(data.templates) ? undefined : data.templates?.error}>
          {templates.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>No templates yet.</p>
          ) : (
            <div className="col" style={{ gap: 0 }}>
              {templates.map((t) => {
                const tone = t.status === 'APPROVED' ? 'ok' : t.status === 'PENDING' ? 'warn' : 'bad';
                return (
                  <div key={`${t.name}-${t.language}`} className="st-template">
                    <div style={{ minWidth: 0 }}>
                      <b className="mono">{t.name}</b>
                      <small>{TEMPLATE_PURPOSE[t.name] ?? 'Not used by this system'} · {humanize(t.category)} · {t.language}</small>
                    </div>
                    <span className={`pill ${tone === 'ok' ? 'cp-pill-ok' : tone === 'warn' ? 'pill-amber' : 'pill-red'}`}>
                      {t.status === 'PENDING' ? 'In review' : humanize(t.status)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

export default SettingsPage;
