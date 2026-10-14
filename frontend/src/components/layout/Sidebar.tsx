import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import VerifiedBadge from '@/components/shared/VerifiedBadge';
import {
  ClipboardList as ClipboardText,
  Users,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  Layers,
  TrendingUp as TrendUp,
  CircleUserRound,
  ListChecks,
  GraduationCap,
  CalendarCheck,
  BookOpen,
  Target,
  LayoutDashboard,
  CalendarDays,
  Calendar,
  BellRing,
  ScrollText,
  ClockFading,
  Search,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { confirmAndSignOut } from '@/lib/session';
import { useIsMobile } from '@/hooks/useIsMobile';
import logo from '@/assets/logos/logo.png';
import SidebarTimeTracker from './SidebarTimeTracker';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Live socket link; drives the crest and avatar status dots. */
  connected: boolean;
  /** Phones: whether the slide-in drawer is open. */
  drawerOpen: boolean;
  onCloseDrawer: () => void;
}

type NavItem = { label: string; path: string; Icon: LucideIcon; roles: string[] };
type NavSection = { title?: string; items: NavItem[] };

const ALL_ROLES = ['SUPER_ADMIN', 'ADMIN', 'STAFF'];
const MANAGER_ROLES = ['SUPER_ADMIN', 'ADMIN'];
const ATTACHEE_ROLE = ['ATTACHEE'];

const menuSections: NavSection[] = [
  {
    items: [
      { label: 'Dashboard', path: '/dashboard', Icon: LayoutDashboard, roles: ALL_ROLES },
      { label: 'My Tasks', path: '/tasks', Icon: ClipboardText, roles: ALL_ROLES },
      { label: 'Reminders', path: '/reminders', Icon: BellRing, roles: ALL_ROLES },
      { label: 'Team Tasks', path: '/team-tasks', Icon: ListChecks, roles: MANAGER_ROLES },
      { label: 'Opportunity Tracker', path: '/opportunities', Icon: Target, roles: ALL_ROLES },
      { label: 'Team Collaboration', path: '/team-calendar', Icon: CalendarDays, roles: ALL_ROLES },
      { label: 'Time Balance', path: '/time-balance', Icon: ClockFading, roles: ALL_ROLES },
    ],
  },
  {
    title: 'Attachment',
    items: [
      { label: 'My Attendance', path: '/my-attendance', Icon: CalendarCheck, roles: ATTACHEE_ROLE },
      { label: 'My Logbook', path: '/my-logbook', Icon: BookOpen, roles: ATTACHEE_ROLE },
      { label: 'My Attachees', path: '/my-attachees', Icon: GraduationCap, roles: ['STAFF'] },
    ],
  },
  {
    title: 'Reports',
    items: [
      { label: 'Resource Tracker', path: '/reports/resource-weekly', Icon: TrendUp, roles: MANAGER_ROLES },
      { label: 'Vertical Summary', path: '/reports/vertical-weekly', Icon: Layers, roles: MANAGER_ROLES },
    ],
  },
  {
    title: 'Management',
    items: [
      { label: 'Staff Members', path: '/admin/users', Icon: Users, roles: MANAGER_ROLES },
      { label: 'Attachees', path: '/admin/attachments', Icon: GraduationCap, roles: MANAGER_ROLES },
      { label: 'Audit Logs', path: '/admin/audit-logs', Icon: ScrollText, roles: MANAGER_ROLES },
    ],
  },
  {
    title: 'Account',
    items: [
      { label: 'My Work Calendar', path: '/my-calendar', Icon: Calendar, roles: [...ALL_ROLES, ...ATTACHEE_ROLE] },
      { label: 'Profile Yangu', path: '/profile', Icon: CircleUserRound, roles: [...ALL_ROLES, ...ATTACHEE_ROLE] },
    ],
  },
];

function Sidebar({ collapsed: collapsedPref, onToggleCollapse, connected, drawerOpen, onCloseDrawer }: SidebarProps) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const location = useLocation();
  const navigate = useNavigate();
  // When collapsed, hovering the rail temporarily expands it as an overlay.
  const [peek, setPeek] = useState(false);
  const [query, setQuery] = useState('');
  const isMobile = useIsMobile();
  // The drawer is always the full menu; the icon rail is a desktop-only mode.
  const collapsed = collapsedPref && !isMobile;
  const drawer = isMobile && drawerOpen;

  useEffect(() => { onCloseDrawer(); }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseDrawer();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [drawer, onCloseDrawer]);
  useEffect(() => { if (!isMobile && drawerOpen) onCloseDrawer(); }, [isMobile]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleSections = menuSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => user && item.roles.includes(user.role)),
    }))
    .filter((section) => section.items.length > 0);
  const visibleItems = visibleSections.flatMap((section) => section.items);
  const showTimeTracker = Boolean(user && ALL_ROLES.includes(user.role));

  const q = query.trim().toLowerCase();
  const shownSections = q
    ? visibleSections
        .map((section) => ({
          ...section,
          items: section.items.filter((i) => i.label.toLowerCase().includes(q) || section.title?.toLowerCase().includes(q)),
        }))
        .filter((section) => section.items.length > 0)
    : visibleSections;

  // Paths can share a prefix, so only the longest match is marked active.
  const activePath = visibleItems
    .map((item) => item.path)
    .filter((path) => location.pathname === path || location.pathname.startsWith(`${path}/`))
    .sort((a, b) => b.length - a.length)[0];

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : user?.role?.charAt(0) ?? 'U';
  const roleLabel = user?.role?.replace(/_/g, ' ').toLowerCase();

  const handleLogout = () => confirmAndSignOut(logout, navigate);

  return (
    <>
      {isMobile && (
        <div className={`sidebar-backdrop${drawer ? ' open' : ''}`} onClick={onCloseDrawer} aria-hidden="true" />
      )}
      <aside
        className={`sidebar${collapsed ? ' collapsed' : ''}${collapsed && peek ? ' peek' : ''}${drawer ? ' drawer-open' : ''}`}
        aria-hidden={isMobile && !drawer ? true : undefined}
        {...(isMobile && !drawer ? { inert: true } : {})}
        // Close as soon as a link is tapped, not when a lazy page finishes loading.
        onClickCapture={(e) => { if (drawer && (e.target as HTMLElement).closest('a')) onCloseDrawer(); }}
        onMouseEnter={() => collapsed && setPeek(true)}
        onMouseLeave={() => setPeek(false)}
      >
        <div className="sidebar-inner">
          <div className="sidebar-head">
            <div className="brand-crest">
              <div className="brand-logo">
                <img src={logo} draggable={false} alt="Millenium Solutions" />
              </div>
              <span
                className={`brand-crest-dot${connected ? ' on' : ''}`}
                title={connected ? 'Live' : 'Offline - reconnecting'}
                aria-hidden="true"
              />
            </div>

            <div className="brand-text">
              <span className="brand-title">Your Task, My Task</span>
              <span className="brand-org">Millenium Solutions E.A Limited</span>
            </div>

            <button
              onClick={isMobile ? onCloseDrawer : onToggleCollapse}
              className="sidebar-collapse-btn"
              title={isMobile ? 'Close menu' : collapsed ? 'Pin sidebar open' : 'Collapse sidebar'}
              aria-label={isMobile ? 'Close menu' : collapsed ? 'Pin sidebar open' : 'Collapse sidebar'}
            >
              {isMobile ? <X size={18} /> : collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
          </div>

          <div className="sidebar-search">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              placeholder="Search"
              aria-label="Search the menu"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('');
                if (e.key === 'Enter') {
                  const first = shownSections[0]?.items[0];
                  if (first) { navigate(first.path); setQuery(''); }
                }
              }}
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear search">
                <X size={13} />
              </button>
            )}
          </div>

          <nav className="nav-scroll" aria-label="Main">
            {shownSections.length === 0 && <p className="nav-empty">No pages match “{query}”.</p>}
            {shownSections.map((section, idx) => (
              <div className="nav-group" key={section.title ?? `section-${idx}`}>
                {section.title && <div className="nav-group-label">{section.title}</div>}
                {section.items.map((item) => {
                  const isActive = item.path === activePath;
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setQuery('')}
                      className={`nav-item${isActive ? ' active' : ''}`}
                      aria-current={isActive ? 'page' : undefined}
                      title={collapsed && !peek ? item.label : undefined}
                    >
                      <item.Icon className="nav-icon" size={20} aria-hidden="true" />
                      <span className="nav-label">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            ))}

            {showTimeTracker && !q && (
              <div className="nav-group">
                <div className="nav-group-label">Intelligence</div>
                <SidebarTimeTracker />
              </div>
            )}
          </nav>

          <div className="sidebar-foot">
            <Link to="/profile" className="sidebar-user" title="My profile">
              <span className="sidebar-av">
                {initials}
                <span className={`sidebar-av-dot${connected ? ' on' : ''}`} aria-hidden="true" />
              </span>
              <span className="sidebar-user-meta">
                <b style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.name ?? 'User'}</span>
                  {user && <VerifiedBadge size={15} />}
                </b>
                <span className="sidebar-role">{roleLabel}</span>
              </span>
            </Link>
            <button onClick={handleLogout} className="sidebar-logout-btn" title="Sign out" aria-label="Sign out">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

export default Sidebar;
