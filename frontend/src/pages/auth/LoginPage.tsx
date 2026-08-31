import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, ArrowRight, ShieldCheck, CircleAlert } from 'lucide-react';
import api from '@/api/client';
import { useAuthStore } from '@/stores/authStore';
import { useNotificationStore } from '@/stores/notificationStore';
import DotLoader from '@/components/shared/DotLoader';
import logo from '@/assets/logos/logo(black).png';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  passwordRaw: z.string().min(1, 'Password is required'),
});

type LoginForm = z.infer<typeof loginSchema>;

/** The four-pane Microsoft logo mark - kept as inline SVG since it's a fixed brand asset, not an icon-set glyph. */
function MicrosoftLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  microsoft_auth_failed: 'Could not sign in with Outlook. Please try again.',
  no_account: 'No workspace account matches that Outlook email. Contact an administrator.',
};

function LoginPage() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });
  const setAuth = useAuthStore((s) => s.setAuth);
  const addNotification = useNotificationStore((s) => s.addNotification);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [serverError, setServerError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const oauthError = searchParams.get('error');
    if (!oauthError) return;
    const email = searchParams.get('email');
    const base = OAUTH_ERROR_MESSAGES[oauthError] ?? 'Sign-in failed. Please try again.';
    setServerError(email ? `${base} (${email})` : base);
  }, [searchParams]);

  const onSubmit = async (data: LoginForm) => {
    setServerError('');
    try {
      const res = await api.post('/auth/login', { email: data.email, passwordRaw: data.passwordRaw });
      const result = res.data.data;
      setAuth(result.token, result.user);
      const firstName = result.user.name?.split(' ')[0] || result.user.name;
      addNotification({
        type: 'success',
        title: 'Signed in',
        message: firstName ? `Welcome back, ${firstName}.` : 'Welcome back to your workspace.',
      });
      const role = result.user.role;

      if (['SUPER_ADMIN', 'ADMIN'].includes(role)) navigate('/team-tasks');
      else if (role === 'ATTACHEE') navigate('/my-attendance');
      else navigate('/tasks');
    } catch (error: any) {
      const msg = error?.response?.data?.message;
      setServerError(msg || 'Invalid credentials. Please try again.');
    }
  };

  return (
    <div className="login-page">
      <div className="login-card fade-up">
        {/* Brand header */}
        <div className="login-cobrand" style={{ justifyContent: 'center', gap: 14 }}>
          <img src={logo} draggable={false} alt="Millenium Solutions" style={{ height: 52, width: 'auto' }} />
          <div className="col" style={{ alignItems: 'flex-start' }}>
            <span className="login-word-your">Your Task,</span>
            <span className="login-word-my">My Task</span>
          </div>
        </div>

        {/* Form body */}
        <div className="login-body">
          <h1 className="login-title">Sign in to your workspace</h1>
          <p className="login-sub">Log daily tasks, track hours, and see what your team is working on.</p>

          {serverError && (
            <div className="alert-error" role="alert">
              <CircleAlert size={16} />
              <span>{serverError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="col" style={{ gap: 16, marginTop: serverError ? 16 : 0 }}>
            <div className="field">
              <label className="label" htmlFor="login-email">Enter your email address</label>
              <div className="input-icon">
                <input
                  {...register('email')}
                  id="login-email"
                  className="input"
                  type="email"
                  autoComplete="username"
                  autoFocus
                  placeholder="you@example.com"
                  style={errors.email ? { borderColor: 'var(--red)' } : undefined}
                />
                <Mail size={16} />
              </div>
              {errors.email && (
                <span className="field-error">{errors.email.message}</span>
              )}
            </div>

            <div className="field">
              <label className="label" htmlFor="login-password">Enter your password</label>
              <div className="input-icon has-toggle">
                <input
                  {...register('passwordRaw')}
                  id="login-password"
                  className="input"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="************"
                  style={errors.passwordRaw ? { borderColor: 'var(--red)' } : undefined}
                />
                <Lock size={16} />
                <button
                  type="button"
                  className="field-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.passwordRaw && (
                <span className="field-error">{errors.passwordRaw.message}</span>
              )}
            </div>

            <button
              className="btn btn-primary btn-block btn-lg login-submit"
              disabled={isSubmitting}
              type="submit"
              style={{ marginTop: 4 }}
            >
              {isSubmitting ? (
                <><DotLoader size={20} /> Signing in…</>
              ) : (
                <>Sign in <ArrowRight size={16} /></>
              )}
            </button>
          </form>

          <div className="flex items-center gap-3" style={{ margin: '18px 0' }}>
            <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>OR</span>
            <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>

          <a
            href={`${import.meta.env.VITE_API_BASE_URL}/auth/microsoft/login`}
            className="btn btn-soft btn-block btn-lg"
            style={{ gap: 10 }}
          >
            <MicrosoftLogo /> Sign in with Outlook
          </a>
        </div>

        {/* Footer */}
        <div className="login-foot">
          <ShieldCheck size={15} />
            Authorized personnel only · All activity is logged and audited
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
