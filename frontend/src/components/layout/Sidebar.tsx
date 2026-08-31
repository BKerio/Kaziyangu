import { useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import {
  ClipboardList as ClipboardText,
  Users,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Layers,
  TrendingUp as TrendUp,
  UserCog,
  ListChecks,
  GraduationCap,
  CalendarCheck,
  BookOpen,
  Target,
  LayoutDashboard,
  CalendarDays,
  BrainCircuit,
  Calendar,
  BellRing,
  ScrollText,
} from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { confirmAndSignOut } from '@/lib/session';
import logo from '@/assets/logos/logo(3).png';
import SidebarTimeTracker from './SidebarTimeTracker';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

type NavItem = { label: string; path: string; Icon: any; roles: string[] };

const ALL_ROLES = ['SUPER_ADMIN', 'ADMIN', 'STAFF'];
const MANAGER_ROLES = ['SUPER_ADMIN', 'ADMIN'];
const ATTACHEE_ROLE = ['ATTACHEE'];

const menuSections: { title?: string; items: NavItem[] }[] = [
  {
    items: [
      { label: 'Dashboard', path: '/dashboard', Icon: LayoutDashboard, roles: ALL_ROLES },
      { label: 'My Tasks', path: '/tasks', Icon: ClipboardText, roles: ALL_ROLES },
      { label: 'Reminders', path: '/reminders', Icon: BellRing, roles: ALL_ROLES },
      { label: 'Team Tasks', path: '/team-tasks', Icon: ListChecks, roles: MANAGER_ROLES },
      { label: 'Opportunity Tracker', path: '/opportunities', Icon: Target, roles: ALL_ROLES },
      { label: 'Team Collaboration', path: '/team-calendar', Icon: CalendarDays, roles: ALL_ROLES },
      { label: 'Time Balance', path: '/time-balance', Icon: BrainCircuit, roles: ALL_ROLES },
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
      { label: 'My Calendar', path: '/my-calendar', Icon: Calendar, roles: [...ALL_ROLES, ...ATTACHEE_ROLE] },
      { label: 'My Profile', path: '/profile', Icon: UserCog, roles: [...ALL_ROLES, ...ATTACHEE_ROLE] },
    ],
  },
];

function Sidebar({ collapsed, onToggleCollapse }: SidebarProps) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const location = useLocation();
  const navigate = useNavigate();
  // When collapsed, hovering the rail temporarily expands it as an overlay.
  const [peek, setPeek] = useState(false);

  const visibleSections = menuSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => user && item.roles.includes(user.role)),
    }))
    .filter((section) => section.items.length > 0);
  const visibleItems = visibleSections.flatMap((section) => section.items);
  const showTimeTracker = Boolean(user && ALL_ROLES.includes(user.role));

  const activePath = visibleItems
    .map((item) => item.path)
    .filter((path) => location.pathname === path || location.pathname.startsWith(`${path}/`))
    .sort((a, b) => b.length - a.length)[0];

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : user?.role?.charAt(0) ?? 'U';

  const handleLogout = () => confirmAndSignOut(logout, navigate);

  return (
    <>
      <aside
        className={`sidebar${collapsed ? ' collapsed' : ''}${collapsed && peek ? ' peek' : ''}`}
        onMouseEnter={() => collapsed && setPeek(true)}
        onMouseLeave={() => setPeek(false)}
      >
       <div className="sidebar-inner">
        {/* Brand header */}
        <div className="sidebar-head">
          <button
            onClick={onToggleCollapse}
            className="sidebar-collapse-btn"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
          <div className="brand-logo">
            <img src={logo} draggable={false} alt="Millenium Solutions" />
          </div>
          <div className="brand-text">
            <b>Your Task, My Task</b>
            <span className="brand-org">Millenium Solutions E.A Limited</span>
          </div>
        </div>

        {/* Nav scroll */}
        <nav className="nav-scroll">
          {visibleSections.map((section, idx) => (
            <div className="nav-group" key={section.title ?? `section-${idx}`}>
              {section.title && <div className="nav-group-label">{section.title}</div>}
              {section.items.map((item) => {
                const isActive = item.path === activePath;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`nav-item${isActive ? ' active' : ''}`}
                  >
                    <item.Icon size={20} />
                    <span className="nav-label">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}

          {showTimeTracker && (
            <div className="nav-group">
              <div className="nav-group-label">Intelligence</div>
              <SidebarTimeTracker />
            </div>
          )}
        </nav>

        {/* User footer */}
        <div className="sidebar-foot">
          <div className="sidebar-user">
            <div className="av av-sm" style={{ background: 'var(--green)' }}>{initials}</div>
            <div className="sidebar-user-meta">
              <b>{user?.name ?? 'User'}</b>
              <span>{user?.role?.replace('_', ' ')}</span>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="sidebar-logout-btn"
            title="Sign Out"
          >
            <LogOut size={15} />
            <span>Sign Out</span>
          </button>
        </div>
       </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="bottomnav">
        {visibleItems.slice(0, 5).map((item) => {
          const isActive = item.path === activePath;
          return (
            <Link key={item.path} to={item.path} className={`bn-item${isActive ? ' on' : ''}`}>
              <item.Icon size={22} />
              <span>{item.label.split(' ')[0]}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}

export default Sidebar;
