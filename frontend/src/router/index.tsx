import { createBrowserRouter, Navigate } from 'react-router-dom';
import { lazy } from 'react';
import RoleGuard from '@/components/shared/RoleGuard';
import AppShell from '@/components/layout/AppShell';
import LoginPage from '@/pages/auth/LoginPage';
import MicrosoftCallbackPage from '@/pages/auth/MicrosoftCallbackPage';
import { useAuthStore } from '@/stores/authStore';

// Heavy authenticated pages are code-split so they load on demand (keeps the
// initial bundle small). The Suspense boundary lives in AppShell.
const MyTasksPage = lazy(() => import('@/pages/tasks/MyTasksPage'));
const MyRemindersPage = lazy(() => import('@/pages/reminders/MyRemindersPage'));
const TeamTasksPage = lazy(() => import('@/pages/tasks/TeamTasksPage'));
const ResourceTrackerPage = lazy(() => import('@/pages/reports/ResourceTrackerPage'));
const VerticalSummaryPage = lazy(() => import('@/pages/reports/VerticalSummaryPage'));
const UserManagementPage = lazy(() => import('@/pages/admin/UserManagementPage'));
const AttachmentAdminPage = lazy(() => import('@/pages/admin/AttachmentAdminPage'));
const AuditLogsPage = lazy(() => import('@/pages/admin/AuditLogsPage'));
const MyAttendancePage = lazy(() => import('@/pages/attachee/MyAttendancePage'));
const MyLogbookPage = lazy(() => import('@/pages/attachee/MyLogbookPage'));
const MyAttacheesPage = lazy(() => import('@/pages/staff/MyAttacheesPage'));
const OpportunityTrackerPage = lazy(() => import('@/pages/opportunities/OpportunityTrackerPage'));
const StaffDashboard = lazy(() => import('@/pages/dashboards/StaffDashboard'));
const TeamCalendarPage = lazy(() => import('@/pages/team/TeamCalendarPage'));
const TimeBalancePage = lazy(() => import('@/pages/intelligence/TimeBalancePage'));
const ProfilePage = lazy(() => import('@/pages/shared/ProfilePage'));
const MyCalendarPage = lazy(() => import('@/pages/shared/MyCalendarPage'));

const Unauthorized = () => <div className="p-10 font-sans font-bold text-status-danger text-center">Unauthorized Access</div>;

/** Lands each role on the page that makes sense for them. */
function HomeRedirect() {
  const role = useAuthStore((s) => s.user?.role);
  if (role === 'ATTACHEE') return <Navigate to="/my-attendance" replace />;
  return <Navigate to="/tasks" replace />;
}

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/auth/callback',
    element: <MicrosoftCallbackPage />,
  },
  {
    path: '/unauthorized',
    element: <Unauthorized />,
  },
  {
    path: '/',
    element: <AppShell />,
    children: [
      {
        index: true,
        element: <HomeRedirect />,
      },
      {
        path: 'dashboard',
        element: (
          <RoleGuard allowed={['STAFF', 'ADMIN', 'SUPER_ADMIN']}>
            <StaffDashboard />
          </RoleGuard>
        ),
      },
      {
        path: 'tasks',
        element: <MyTasksPage />,
      },
      {
        path: 'reminders',
        element: <MyRemindersPage />,
      },
      {
        path: 'team-tasks',
        element: (
          <RoleGuard allowed={['SUPER_ADMIN', 'ADMIN']}>
            <TeamTasksPage />
          </RoleGuard>
        ),
      },
      {
        path: 'reports/resource-weekly',
        element: (
          <RoleGuard allowed={['SUPER_ADMIN', 'ADMIN']}>
            <ResourceTrackerPage />
          </RoleGuard>
        ),
      },
      {
        path: 'reports/vertical-weekly',
        element: (
          <RoleGuard allowed={['SUPER_ADMIN', 'ADMIN']}>
            <VerticalSummaryPage />
          </RoleGuard>
        ),
      },
      {
        path: 'admin/users',
        element: (
          <RoleGuard allowed={['SUPER_ADMIN', 'ADMIN']}>
            <UserManagementPage />
          </RoleGuard>
        ),
      },
      {
        path: 'admin/attachments',
        element: (
          <RoleGuard allowed={['SUPER_ADMIN', 'ADMIN']}>
            <AttachmentAdminPage />
          </RoleGuard>
        ),
      },
      {
        path: 'admin/audit-logs',
        element: (
          <RoleGuard allowed={['SUPER_ADMIN', 'ADMIN']}>
            <AuditLogsPage />
          </RoleGuard>
        ),
      },
      {
        path: 'my-attendance',
        element: (
          <RoleGuard allowed={['ATTACHEE']}>
            <MyAttendancePage />
          </RoleGuard>
        ),
      },
      {
        path: 'my-logbook',
        element: (
          <RoleGuard allowed={['ATTACHEE']}>
            <MyLogbookPage />
          </RoleGuard>
        ),
      },
      {
        path: 'my-attachees',
        element: (
          <RoleGuard allowed={['STAFF', 'ADMIN', 'SUPER_ADMIN']}>
            <MyAttacheesPage />
          </RoleGuard>
        ),
      },
      {
        path: 'opportunities',
        element: (
          <RoleGuard allowed={['STAFF', 'ADMIN', 'SUPER_ADMIN']}>
            <OpportunityTrackerPage />
          </RoleGuard>
        ),
      },
      {
        path: 'team-calendar',
        element: (
          <RoleGuard allowed={['STAFF', 'ADMIN', 'SUPER_ADMIN']}>
            <TeamCalendarPage />
          </RoleGuard>
        ),
      },
      {
        path: 'time-balance',
        element: (
          <RoleGuard allowed={['STAFF', 'ADMIN', 'SUPER_ADMIN']}>
            <TimeBalancePage />
          </RoleGuard>
        ),
      },
      {
        // Self-service account page - available to every signed-in role (AppShell
        // already requires a token), not gated by RoleGuard like the role-scoped pages above.
        path: 'profile',
        element: <ProfilePage />,
      },
      {
        // Self-service, same access pattern as /profile above.
        path: 'my-calendar',
        element: <MyCalendarPage />,
      },
      {
        path: '*',
        element: <div className="p-10 font-sans font-bold text-slate-text text-center">Page Not Found</div>,
      },
    ],
  },
]);

export default router;
