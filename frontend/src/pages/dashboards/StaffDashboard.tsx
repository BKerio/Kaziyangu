import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ListTodo, CheckCircle2, Server, Wrench, Bug, Target, Handshake, FileText,
  Wallet, Receipt, Scale, ClipboardList, TrendingUp, UserCog, Clock, Mail, Phone,
  Briefcase, FileSignature, Percent,
} from 'lucide-react';
import api from '@/api/client';
import { getMyProfile } from '@/api/account';
import { Department, PaginatedResponse, WorkTask } from '@/types/api';
import { fmtDate } from '@/lib/datetime';

interface FocusTile {
  icon: typeof Server;
  title: string;
  hint: string;
}

const DEPARTMENT_THEME: Record<Department, { label: string; accent: string; tiles: FocusTile[] }> = {
  TECHNICAL: {
    label: 'Technical',
    accent: '#D62828',
    tiles: [
      { icon: Server, title: 'Deployments', hint: 'Log rollout & cutover work' },
      { icon: Wrench, title: 'Break/Fix', hint: 'Capture support tickets resolved' },
      { icon: Bug, title: 'POCs', hint: 'Track proof-of-concept progress' },
    ],
  },
  BUSINESS_DEVELOPMENT: {
    label: 'Business Development',
    accent: '#2563EB',
    tiles: [
      { icon: Target, title: 'Opportunities', hint: 'Track deals through the pipeline' },
      { icon: Handshake, title: 'Client Meetings', hint: 'Log engagement touchpoints' },
      { icon: FileText, title: 'Proposals', hint: 'Prepare quotations & bids' },
    ],
  },
  FINANCE: {
    label: 'Finance',
    accent: '#D4A017',
    tiles: [
      { icon: Wallet, title: 'Receivables', hint: 'Track incoming payments' },
      { icon: Receipt, title: 'Payables', hint: 'Log outgoing invoices' },
      { icon: Scale, title: 'Reconciliations', hint: 'Match statements & ledgers' },
    ],
  },
  COMMERCIAL: {
    label: 'Commercial',
    accent: '#0D9488',
    tiles: [
      { icon: Briefcase, title: 'Client Contracts', hint: 'Manage commercial agreements & terms' },
      { icon: FileSignature, title: 'Quotations', hint: 'Prepare & send commercial quotes' },
      { icon: Percent, title: 'Pricing & Margins', hint: 'Review deal pricing and margins' },
    ],
  },
};

const FALLBACK_THEME = {
  label: 'Unassigned',
  accent: 'var(--muted)',
  tiles: [
    { icon: ClipboardList, title: 'Daily Tasks', hint: 'Log your work for today' },
    { icon: TrendingUp, title: 'Progress', hint: 'Update status & hours' },
    { icon: UserCog, title: 'Profile', hint: 'Keep your details up to date' },
  ] as FocusTile[],
};

function roleLabel(role: string) {
  return role.charAt(0) + role.slice(1).toLowerCase().replace('_', ' ');
}

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function StaffDashboard() {
  const todayISO = new Date().toISOString().slice(0, 10);

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['account', 'my-profile'],
    queryFn: getMyProfile,
  });

  const { data: weekTasks, isLoading: tasksLoading } = useQuery({
    queryKey: ['tasks', 'mine', 'dashboard-week'],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<WorkTask>>('/tasks', {
        params: { from: daysAgoISO(6), to: todayISO, limit: 100 },
      });
      return res.data.data;
    },
  });

  const theme = profile?.department ? DEPARTMENT_THEME[profile.department] : FALLBACK_THEME;
  const tasks = weekTasks ?? [];
  const todayTasks = tasks.filter((t) => t.date.slice(0, 10) === todayISO);
  const todayHours = Math.round(todayTasks.reduce((sum, t) => sum + t.hoursSpent, 0) * 100) / 100;
  const weekHours = Math.round(tasks.reduce((sum, t) => sum + t.hoursSpent, 0) * 100) / 100;
  const completedCount = tasks.filter((t) => ['RESOLVED', 'COMPLETED_CLOSED'].includes(t.status)).length;
  const blockedCount = tasks.filter((t) => t.status === 'BLOCKED').length;

  if (profileLoading) {
    return <div className="skel" style={{ height: 400 }} />;
  }

  return (
    <div className="col" style={{ gap: 20 }}>
      {/* Hero */}
      <div className="card card-pad" style={{ borderLeft: `4px solid ${theme.accent}` }}>
        <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div>
            <p className="eyebrow">Dashboard</p>
            <h2 className="text-2xl font-bold mt-1" style={{ color: 'var(--ink)' }}> Welcome back, {profile?.name?.split(' ').join(' ') ?? 'there'} </h2>

            <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
              {profile?.role ? roleLabel(profile.role) : ''} · {theme.label}
            </p>
          </div>
          <span className="pill" style={{ background: `${theme.accent}1A`, color: theme.accent }}>
            {theme.label}
          </span>
        </div>
      </div>

      {/* Today / week stats */}
      <div className="stat-grid">
        <div className="stat">
          <div className="stat-ico"><Clock /></div>
          <div className="stat-label">Hours Today</div>
          <div className="stat-val">{tasksLoading ? '…' : todayHours}</div>
        </div>
        <div className="stat">
          <div className="stat-ico"><ListTodo /></div>
          <div className="stat-label">Tasks Today</div>
          <div className="stat-val">{tasksLoading ? '…' : todayTasks.length}</div>
        </div>
        <div className="stat">
          <div className="stat-ico"><CheckCircle2 /></div>
          <div className="stat-label">Completed (7d)</div>
          <div className="stat-val">{tasksLoading ? '…' : completedCount}</div>
        </div>
        <div className="stat">
          <div className="stat-ico"><Bug /></div>
          <div className="stat-label">Blocked (7d)</div>
          <div className="stat-val">{tasksLoading ? '…' : blockedCount}</div>
        </div>
      </div>
      <p className="text-xs" style={{ color: 'var(--muted)', marginTop: -12 }}>{weekHours}h logged over the last 7 days</p>

      {/* Department focus tiles */}
      <div className="grid grid-cols-3 gap-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        {theme.tiles.map((tile) => (
          <div key={tile.title} className="card card-pad flex items-start gap-3">
            <div
              className="flex items-center justify-center"
              style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0, background: 'var(--red-soft)', color: 'var(--red)' }}
            >
              <tile.icon size={18} />
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{tile.title}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{tile.hint}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        {/* Profile panel */}
        <div className="card card-pad col" style={{ gap: 10 }}>
          <p className="text-xs font-bold uppercase" style={{ color: 'var(--muted)', letterSpacing: '.06em' }}>Profile</p>
          <div className="flex items-center gap-3">
            <div
              className="flex items-center justify-center font-bold"
              style={{ width: 44, height: 44, borderRadius: 12, background: theme.accent, color: '#fff', fontSize: 16 }}
            >
              {profile?.name?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() ?? '..'}
            </div>
            <div>
              <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>{profile?.name}</p>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>{profile?.role ? roleLabel(profile.role) : ''}</p>
            </div>
          </div>
          <div className="col" style={{ gap: 6, marginTop: 4 }}>
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}><Mail size={13} style={{ color: 'var(--red)' }} /> {profile?.email}</div>
            {profile?.phone && <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}><Phone size={13} style={{ color: 'var(--red)' }} /> {profile.phone}</div>}
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
              <span className="pill pill-gray">{theme.label}</span>
            </div>
          </div>
        </div>

        {/* Quick actions */}
        <div className="card card-pad col" style={{ gap: 8 }}>
          <p className="text-xs font-bold uppercase" style={{ color: 'var(--muted)', letterSpacing: '.06em' }}>Quick Actions</p>
          <Link to="/tasks" className="flex items-center gap-3" style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', textDecoration: 'none' }}>
            <div className="flex items-center justify-center" style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--red-soft)', color: 'var(--red)' }}>
              <ListTodo size={16} />
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Daily Task Log</p>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>Log delivery & support work</p>
            </div>
          </Link>
          {(profile?.department === 'BUSINESS_DEVELOPMENT' || profile?.department === 'COMMERCIAL') && (
            <Link to="/opportunities" className="flex items-center gap-3" style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', textDecoration: 'none' }}>
              <div className="flex items-center justify-center" style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--red-soft)', color: 'var(--red)' }}>
                <Target size={16} />
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Opportunity Tracker</p>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>Track deals through the pipeline</p>
              </div>
            </Link>
          )}
          <Link to="/profile" className="flex items-center gap-3" style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', textDecoration: 'none' }}>
            <div className="flex items-center justify-center" style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--red-soft)', color: 'var(--red)' }}>
              <UserCog size={16} />
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Update profile</p>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>Contact details & password</p>
            </div>
          </Link>
        </div>
      </div>

      {tasks.length > 0 && (
        <div className="card">
          <div className="card-head">
            <span className="card-title">Recent Task Entries</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                  {['Date', 'Description', 'Hours', 'Status'].map((h) => (
                    <th key={h} style={{ padding: '10px 14px', color: 'var(--muted)', fontWeight: 650, fontSize: 12 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.slice(0, 5).map((t) => (
                  <tr key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{fmtDate(t.date)}</td>
                    <td style={{ padding: '10px 14px', color: 'var(--ink-2)' }}>{t.description}</td>
                    <td style={{ padding: '10px 14px' }}>{t.hoursSpent}h</td>
                    <td style={{ padding: '10px 14px', color: 'var(--muted)' }}>{t.status.replace(/_/g, ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default StaffDashboard;
