import {
  Bell,
  LogOut as SignOut,
  Menu as List,
  Sun,
  Moon,
  Search as MagnifyingGlass,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useNotificationStore } from '@/stores/notificationStore';
import NotificationDrawer from '@/components/shared/NotificationDrawer';
import { useNavigate } from 'react-router-dom';
import { confirmAndSignOut } from '@/lib/session';

interface TopBarProps {
  theme: 'light' | 'dark';
  onThemeToggle: () => void;
  onToggleSidebar: () => void;
}

function TopBar({ theme, onThemeToggle, onToggleSidebar }: TopBarProps) {
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [show, setShow] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);

  const { notifications } = useNotificationStore();
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const unreadCount = notifications.filter((n) => !n.read).length;

  

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      setShow(!(currentScrollY > lastScrollY && currentScrollY > 60));
      setLastScrollY(currentScrollY);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [lastScrollY]);

  const requestSignOut = () => confirmAndSignOut(logout, navigate);

  return (
    <>
      <header
        className="topbar"
        style={{ transform: show ? 'none' : 'translateY(-100%)', transition: 'transform .3s' }}
      >
        <button
          onClick={onToggleSidebar}
          className="icon-btn"
          style={{ border: 0, background: 'transparent' }}
          title="Toggle sidebar"
        >
          <List size={20} />
        </button>

        <div className="searchbox" style={{ display: 'flex' }}>
          <MagnifyingGlass size={16} />
          <input placeholder="Search tasks…" />
        </div>

        <div style={{ flex: 1 }} />

        
        

        <button className="icon-btn" onClick={onThemeToggle} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        <button
          className={`icon-btn notif-btn${unreadCount > 0 ? ' has-unread' : ''}`}
          style={{ position: 'relative' }}
          onClick={() => setIsNotificationOpen(true)}
          title={unreadCount > 0 ? `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}` : 'Notifications'}
        >
          <Bell size={24} />
          {unreadCount > 0 && (
            <>
              <span className="notif-ping" aria-hidden />
              <span className="notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
            </>
          )}
        </button>

        <button
          className="icon-btn"
          onClick={requestSignOut}
          title="Sign Out"
          style={{ borderColor: 'transparent' }}
        >
          <SignOut size={18} />
        </button>
      </header>

      <NotificationDrawer isOpen={isNotificationOpen} onClose={() => setIsNotificationOpen(false)} />
    </>
  );
}

export default TopBar;
