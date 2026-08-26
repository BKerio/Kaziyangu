import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '@/api/client';
import { useAuthStore } from '@/stores/authStore';
import { useNotificationStore } from '@/stores/notificationStore';
import DotLoader from '@/components/shared/DotLoader';

/**
 * Lands here after GET /auth/microsoft/callback on the backend redirects the
 * browser back with a ready-to-use app JWT in the query string. Exchanges it
 * for the full user profile (the backend redirect only carries the token),
 * then signs in exactly like a normal email/password login.
 */
function MicrosoftCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const addNotification = useNotificationStore((s) => s.addNotification);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // StrictMode double-invoke guard - this exchange isn't idempotent-safe to repeat
    ran.current = true;

    const token = searchParams.get('token');
    if (!token) {
      navigate('/login?error=microsoft_auth_failed', { replace: true });
      return;
    }

    // Only ever follow a same-app relative path the backend echoed back (e.g.
    // from a "Connect Outlook" button on a specific page) - never an
    // absolute/protocol-relative URL.
    const redirectParam = searchParams.get('redirect');
    const redirectPath = redirectParam && redirectParam.startsWith('/') && !redirectParam.startsWith('//') ? redirectParam : null;

    useAuthStore.getState().setToken(token);
    api
      .get('/auth/me')
      .then((res) => {
        const user = res.data.data;
        useAuthStore.getState().setAuth(token, user);
        const firstName = user.name?.split(' ')[0] || user.name;
        addNotification({ type: 'success', title: 'Signed in', message: `Welcome, ${firstName}.` });

        if (redirectPath) navigate(redirectPath, { replace: true });
        else if (['SUPER_ADMIN', 'ADMIN'].includes(user.role)) navigate('/team-tasks', { replace: true });
        else if (user.role === 'ATTACHEE') navigate('/my-attendance', { replace: true });
        else navigate('/tasks', { replace: true });
      })
      .catch(() => {
        useAuthStore.getState().logout();
        navigate('/login?error=microsoft_auth_failed', { replace: true });
      });
  }, [searchParams, navigate, addNotification]);

  return (
    <div className="login-page">
      <div className="login-card fade-up" style={{ alignItems: 'center', textAlign: 'center', gap: 14 }}>
        <DotLoader size={28} />
        <p className="login-sub" style={{ margin: 0 }}>Signing you in…</p>
      </div>
    </div>
  );
}

export default MicrosoftCallbackPage;
