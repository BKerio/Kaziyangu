import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, ArrowRight, ShieldCheck, CircleAlert, MessageCircle } from 'lucide-react';
import api from '@/api/client';
import { useAuthStore } from '@/stores/authStore';
import { useNotificationStore } from '@/stores/notificationStore';
import AppLoader from '@/components/shared/AppLoader';
import BrandMark from '@/components/brand/BrandMark';

const WhatsAppPhone = lazy(() => import('@/components/promo/WhatsAppFilm'));

// wa.me needs the number as bare digits with the country code, e.g. 254712345678.
const BOT_DIGITS = ((import.meta.env.VITE_WHATSAPP_NUMBER as string | undefined) ?? '').replace(/\D/g, '');
const WHATSAPP_LINK = BOT_DIGITS ? `https://wa.me/${BOT_DIGITS}?text=hi` : '';

// The film only shows beside the form on wide screens; below this it isn't loaded at all.
const FILM_QUERY = '(min-width: 1080px) and (min-height: 720px)';

function useShowFilm() {
  const [show, setShow] = useState(() => window.matchMedia(FILM_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(FILM_QUERY);
    const on = () => setShow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return show;
}

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
  const showFilm = useShowFilm();

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

      // The dashboard is staff/admin only, so attachees land on their attendance page instead.
      navigate(role === 'ATTACHEE' ? '/my-attendance' : '/dashboard');
    } catch (error: any) {
      const msg = error?.response?.data?.message;
      setServerError(msg || 'Invalid credentials. Please try again.');
    }
  };

  const focusSignIn = () => {
    const email = document.getElementById('login-email');
    email?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    email?.focus({ preventScroll: true });
  };

  return (
    <div className="lx-page">
      <header className="lx-nav">
        <div className="lx-nav-inner">
          <span className="lx-nav-brand brand-lockup">
            <BrandMark size={44} />
            <span className="brand-lockup-text">
              <b>Millenium Solutions E.A Limited</b>
              <span className="brand-tagline">Your technology partner</span>
            </span>
          </span>
          <nav className="lx-nav-links" aria-label="Site">
            {WHATSAPP_LINK && <a href={WHATSAPP_LINK} target="_blank" rel="noreferrer">WhatsApp Assistant</a>}
            <Link to="/privacy">Privacy</Link>
            <button type="button" className="lx-nav-cta" onClick={focusSignIn}>Sign in</button>
          </nav>
        </div>
      </header>

      <main className="lx-hero">
        {showFilm && (
          <div className="lx-phone fade-up">
            <Suspense fallback={null}>
              <WhatsAppPhone />
            </Suspense>
          </div>
        )}

        <section className="lx-copy fade-up">
          <div className="lx-lockup">
            <span className="lx-word-your">Your Task,</span>
            <span className="lx-word-my">My Task</span>
            <span className="lx-tagline">Task tracking · Team reporting · WhatsApp</span>
          </div>

          <h1 className="lx-title">Your work,<br />logged in seconds</h1>
          <p className="lx-sub">
            Message the <b>Task Assistant</b> on WhatsApp → tap <b>Update Task</b>. Your workspace syncs before you&rsquo;ve put your phone down.
          </p>

          <div className="lx-form">
            {serverError && (
              <div className="alert-error" role="alert">
                <CircleAlert size={16} />
                <span>{serverError}</span>
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="col" style={{ gap: 14, marginTop: serverError ? 16 : 0 }}>
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

              <button className="lx-pill lx-pill-dark" disabled={isSubmitting} type="submit" style={{ marginTop: 2 }}>
                {isSubmitting ? (
                  <><AppLoader size={22} /> Signing in…</>
                ) : (
                  <>Sign in <ArrowRight size={16} /></>
                )}
              </button>
            </form>

            <div className="lx-or"><span>or</span></div>

            <div className="lx-alt">
              <a href={`${import.meta.env.VITE_API_BASE_URL}/auth/microsoft/login`} className="lx-pill lx-pill-outline">
                <MicrosoftLogo /> Sign in with Outlook
              </a>
              {WHATSAPP_LINK && (
                <a href={WHATSAPP_LINK} target="_blank" rel="noreferrer" className="lx-pill lx-pill-outline">
                  <MessageCircle size={16} className="lx-wa-ico" /> Message the Task Assistant
                </a>
              )}
            </div>
          </div>

          <p className="lx-foot">
            <ShieldCheck size={14} /> Authorized personnel only · All activity is logged and audited
          </p>
        </section>
      </main>
    </div>
  );
}

export default LoginPage;
