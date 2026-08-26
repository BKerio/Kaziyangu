import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  User as UserIcon, Phone, Mail, Lock, Eye, EyeOff, KeyRound,
} from 'lucide-react';
import DotLoader from '@/components/shared/DotLoader';
import { getMyProfile, updateMyProfile, getErrorMessage } from '@/api/account';
import { useAuthStore } from '@/stores/authStore';
import { useNotificationStore } from '@/stores/notificationStore';

const profileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  phone: z.string().optional(),
});
type ProfileForm = z.infer<typeof profileSchema>;

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Confirm your new password'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "New passwords don't match",
    path: ['confirmPassword'],
  });
type PasswordForm = z.infer<typeof passwordSchema>;

function roleLabel(role: string) {
  return role.charAt(0) + role.slice(1).toLowerCase().replace('_', ' ');
}

/** Self-service account page - every signed-in role lands here via the "My Profile" nav link. */
function ProfilePage() {
  const authUser = useAuthStore((s) => s.user);
  const updateAuthUser = useAuthStore((s) => s.updateUser);
  const { addNotification } = useNotificationStore();
  const queryClient = useQueryClient();
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const { data: profile, isLoading } = useQuery({
    queryKey: ['account', 'my-profile'],
    queryFn: getMyProfile,
    initialData: authUser ?? undefined,
  });

  const {
    register: registerProfile,
    handleSubmit: handleProfileSubmit,
    formState: { errors: profileErrors, isDirty: profileDirty },
  } = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    values: profile ? { name: profile.name, phone: profile.phone ?? '' } : undefined,
  });

  const {
    register: registerPassword,
    handleSubmit: handlePasswordSubmit,
    reset: resetPassword,
    formState: { errors: passwordErrors },
  } = useForm<PasswordForm>({ resolver: zodResolver(passwordSchema) });

  const profileMutation = useMutation({
    mutationFn: (data: ProfileForm) => updateMyProfile({ name: data.name, phone: data.phone || undefined }),
    onSuccess: (user) => {
      updateAuthUser(user);
      queryClient.setQueryData(['account', 'my-profile'], user);
      addNotification({ type: 'success', title: 'Profile updated', message: 'Your details have been saved.' });
    },
    onError: (err) => addNotification({ type: 'error', title: 'Update failed', message: getErrorMessage(err) }),
  });

  const passwordMutation = useMutation({
    mutationFn: (data: PasswordForm) =>
      updateMyProfile({ currentPassword: data.currentPassword, newPassword: data.newPassword }),
    onSuccess: () => {
      resetPassword();
      setShowPasswordForm(false);
      addNotification({ type: 'success', title: 'Password changed', message: 'Use your new password next time you sign in.' });
    },
    onError: (err) => addNotification({ type: 'error', title: 'Password change failed', message: getErrorMessage(err) }),
  });

  const initials = profile?.name
    ? profile.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : '..';

  return (
    <div className="col" style={{ gap: 20, maxWidth: 640 }}>
      <div>
        <p className="eyebrow">Account</p>
        <h2 className="text-2xl font-bold mt-1" style={{ color: 'var(--ink)' }}>My Profile</h2>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Update your contact details and password</p>
      </div>

      <div className="card card-pad">
        <div className="flex items-center gap-4 pb-4 mb-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 text-lg font-bold"
            style={{ background: 'var(--green)', color: '#fff' }}
          >
            {initials}
          </div>
          <div>
            <p className="text-lg font-bold" style={{ color: 'var(--ink)' }}>{profile?.name}</p>
            <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
              {profile?.role ? roleLabel(profile.role) : ''}
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="skel" style={{ height: 140 }} />
        ) : (
          <form className="col" style={{ gap: 16 }} onSubmit={handleProfileSubmit((data) => profileMutation.mutate(data))}>
            <div className="field">
              <label className="label" htmlFor="profile-name">Full name</label>
              <div className="input-icon">
                <input
                  {...registerProfile('name')}
                  id="profile-name"
                  className="input"
                  type="text"
                  placeholder="Your full name"
                  style={profileErrors.name ? { borderColor: 'var(--red)' } : undefined}
                />
                <UserIcon size={16} />
              </div>
              {profileErrors.name && <span className="field-error">{profileErrors.name.message}</span>}
            </div>

            <div className="field">
              <label className="label" htmlFor="profile-phone">Phone number</label>
              <div className="input-icon">
                <input
                  {...registerProfile('phone')}
                  id="profile-phone"
                  className="input"
                  type="tel"
                  placeholder="+254…"
                />
                <Phone size={16} />
              </div>
            </div>

            <div className="field">
              <label className="label" htmlFor="profile-email">Email address</label>
              <div className="input-icon">
                <input id="profile-email" className="input" type="email" value={profile?.email ?? ''} disabled />
                <Mail size={16} />
              </div>
              <span className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Contact an admin to change your email.</span>
            </div>

            <button type="submit" className="btn btn-primary btn-block" disabled={profileMutation.isPending || !profileDirty}>
              {profileMutation.isPending ? <DotLoader size={16} /> : null}
              {profileMutation.isPending ? 'Saving…' : 'Save changes'}
            </button>
          </form>
        )}
      </div>

      <div className="card card-pad">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--surface-2)' }}>
              <KeyRound size={18} style={{ color: 'var(--red)' }} />
            </div>
            <div>
              <p className="text-base font-bold" style={{ color: 'var(--ink)' }}>Password</p>
              <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>Change your sign-in password</p>
            </div>
          </div>
          {!showPasswordForm && (
            <button className="btn btn-soft btn-sm" onClick={() => setShowPasswordForm(true)}>Change</button>
          )}
        </div>

        {showPasswordForm && (
          <form
            className="col mt-4 pt-4 border-t"
            style={{ gap: 14, borderColor: 'var(--border)' }}
            onSubmit={handlePasswordSubmit((data) => passwordMutation.mutate(data))}
          >
            <div className="field">
              <label className="label" htmlFor="current-password">Current password</label>
              <div className="input-icon has-toggle">
                <input
                  {...registerPassword('currentPassword')}
                  id="current-password"
                  className="input"
                  type={showCurrent ? 'text' : 'password'}
                  autoComplete="current-password"
                  style={passwordErrors.currentPassword ? { borderColor: 'var(--red)' } : undefined}
                />
                <Lock size={16} />
                <button type="button" className="field-toggle" tabIndex={-1} onClick={() => setShowCurrent((v) => !v)}>
                  {showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {passwordErrors.currentPassword && <span className="field-error">{passwordErrors.currentPassword.message}</span>}
            </div>

            <div className="field">
              <label className="label" htmlFor="new-password">New password</label>
              <div className="input-icon has-toggle">
                <input
                  {...registerPassword('newPassword')}
                  id="new-password"
                  className="input"
                  type={showNew ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Minimum 8 characters"
                  style={passwordErrors.newPassword ? { borderColor: 'var(--red)' } : undefined}
                />
                <Lock size={16} />
                <button type="button" className="field-toggle" tabIndex={-1} onClick={() => setShowNew((v) => !v)}>
                  {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {passwordErrors.newPassword && <span className="field-error">{passwordErrors.newPassword.message}</span>}
            </div>

            <div className="field">
              <label className="label" htmlFor="confirm-password">Confirm new password</label>
              <div className="input-icon">
                <input
                  {...registerPassword('confirmPassword')}
                  id="confirm-password"
                  className="input"
                  type={showNew ? 'text' : 'password'}
                  autoComplete="new-password"
                  style={passwordErrors.confirmPassword ? { borderColor: 'var(--red)' } : undefined}
                />
                <Lock size={16} />
              </div>
              {passwordErrors.confirmPassword && <span className="field-error">{passwordErrors.confirmPassword.message}</span>}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-ghost flex-1"
                onClick={() => { setShowPasswordForm(false); resetPassword(); }}
                disabled={passwordMutation.isPending}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary flex-1" disabled={passwordMutation.isPending}>
                {passwordMutation.isPending ? <DotLoader size={16} /> : null}
                {passwordMutation.isPending ? 'Updating…' : 'Update password'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default ProfilePage;
