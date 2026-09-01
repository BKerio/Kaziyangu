import { Outlet, Navigate } from 'react-router-dom';
import { Suspense, useEffect, useRef, useState } from 'react';
import Sidebar from '@/components/layout/Sidebar';
import TopBar from '@/components/layout/TopBar';
import { socket } from '@/lib/socket';
import { useNotificationStore } from '@/stores/notificationStore';
import { useAuthStore } from '@/stores/authStore';
import { celebrate } from '@/lib/alert';
import { WorkTask } from '@/types/api';

// Shared with the "reconnected" status bar's own display time below, so the
// welcome popup fired on first connect (login success) disappears in step
// with it rather than lingering after or vanishing before.
const CONNECTION_FLASH_MS = 3000;

function AppShell() {
  const { addNotification } = useNotificationStore();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === 'true');
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (localStorage.getItem('theme') as 'light' | 'dark') ?? 'light'
  );
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [reconnectedFlash, setReconnectedFlash] = useState(false);
  // First connect of this session (i.e. login success) reads "Welcome back,
  // Name!" instead of "Reconnected" - a fresh sign-in never reconnected from
  // anything. Only actual reconnects (after a real disconnect) say that.
  const [isFirstConnect, setIsFirstConnect] = useState(true);
  const hasConnectedBefore = useRef(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    if (!token || !user) return;

    socket.connect();

    socket.on('connect', () => {
      setIsConnected(true);
      setReconnectedFlash(true);

      if (!hasConnectedBefore.current) {
        hasConnectedBefore.current = true;
        setIsFirstConnect(true);
        const firstName = user.name?.split(' ')[0] || user.name;
        celebrate(`Welcome, ${firstName}!`, CONNECTION_FLASH_MS);
      } else {
        setIsFirstConnect(false);
      }
    });

    socket.on('disconnect', () => setIsConnected(false));
    socket.on('connect_error', () => setIsConnected(false));

    // Only admins/super admins get a "someone logged a task" ambient
    // notification - staff already see their own task list update live.
    const isManager = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';

    socket.on('task:created', (task: WorkTask) => {
      if (!isManager || task.userId === user.id) return;
      addNotification({
        type: 'info',
        title: 'New task logged',
        message: `${task.user?.name ?? 'Someone'} logged "${task.description.slice(0, 60)}"`,
      });
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('connect_error');
      socket.off('task:created');
    };
  }, [addNotification, token, user]);

  useEffect(() => {
    if (!reconnectedFlash) return;
    const t = setTimeout(() => setReconnectedFlash(false), CONNECTION_FLASH_MS);
    return () => clearTimeout(t);
  }, [reconnectedFlash]);

  if (!token) return <Navigate to="/login" replace />;

  return (
    <div className="app">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
      />
      <div className="main">
        <TopBar
          theme={theme}
          onThemeToggle={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          onToggleSidebar={() => setCollapsed((c) => !c)}
        />
        {!isConnected && (
          <div className="banner-warn">
            <span style={{ width: 8, height: 8, borderRadius: '99px', background: 'var(--amber)', flexShrink: 0, display: 'inline-block', animation: 'pulse 2s infinite' }} />
            Live connection lost - retrying…
          </div>
        )}
        {isConnected && reconnectedFlash && (
          <div
            className="banner-ok"
            style={{
              background: 'color-mix(in srgb, var(--color-status-success, #169A5B) 14%, transparent)',
              borderBottom: '1px solid color-mix(in srgb, var(--color-status-success, #169A5B) 22%, transparent)',
              color: 'var(--color-status-success, #169A5B)',
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '99px', background: 'var(--color-status-success, #169A5B)', flexShrink: 0, display: 'inline-block' }} />
            {isFirstConnect ? `Welcome back, ${user?.name?.split(' ')[0] || user?.name}!` : 'Reconnected'}
          </div>
        )}
        <main className="content">
          <Suspense fallback={<div className="p-10 text-center font-bold" style={{ color: 'var(--muted)' }}>Loading…</div>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}

export default AppShell;
