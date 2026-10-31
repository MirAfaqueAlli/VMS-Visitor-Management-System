// frontend/src/pages/profile/Profile.jsx
// My profile (DESIGN_RULES §11/§12): details tile on the left, change-password
// form on the right with its action below a hairline.
import { useState, useEffect } from 'react';
import { User, Lock, Eye, EyeOff, Loader2 } from '../../components/icons';
import { toast } from 'react-hot-toast';
import apiClient from '../../api/axios';
import useAuth from '../../hooks/useAuth';
import PasswordStrength from '../../components/PasswordStrength';
import { validatePassword } from '../../utils/passwordValidator';
import { getApiErrorMessage } from '../../utils/apiError';
import { PageHeader, SectionTitle, KV, Tag, Field, Spinner } from '../../components/ui';
import { initials as toInitials, orDash } from '../../lib/format';

const PasswordInput = ({ label, value, onChange, show, onToggle, id, invalid, error, autoComplete = 'new-password' }) => (
  <Field label={label} htmlFor={id} error={error}>
    <div className="relative">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`control pr-9${invalid ? ' is-invalid' : ''}`}
        autoComplete={autoComplete}
      />
      <button
        type="button"
        onClick={onToggle}
        className="absolute right-1 top-1/2 -translate-y-1/2 btn-icon !w-7 !min-h-0 h-7"
        aria-label={show ? 'Hide password' : 'Show password'}
        title={show ? 'Hide password' : 'Show password'}
        tabIndex={-1}
      >
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  </Field>
);

export default function Profile() {
  const { user } = useAuth();

  const [profileData, setProfileData] = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [pwLoading, setPwLoading] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword,     setNewPassword]     = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew,     setShowNew]     = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await apiClient.get('/auth/me');
        setProfileData(res.data?.data ?? res.data);
      } catch {
        toast.error('Failed to load profile.');
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, []);

  const handlePasswordChange = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      return toast.error('Please fill in all password fields.');
    }
    if (newPassword !== confirmPassword) {
      return toast.error('New passwords do not match.');
    }
    const { valid: pwValid } = validatePassword(newPassword);
    if (!pwValid) {
      return toast.error('New password does not meet the strength requirements.');
    }
    setPwLoading(true);
    try {
      const res = await apiClient.put('/auth/change-password', { currentPassword, newPassword });
      // Changing the password signs out all older sessions — keep this one on the fresh token
      const freshToken = res.data?.data?.token;
      if (freshToken) localStorage.setItem('vms_token', freshToken);
      toast.success('Password updated successfully.');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to update password.'));
    } finally {
      setPwLoading(false);
    }
  };

  const data  = profileData ?? user ?? {};
  const roleLabel = data.role_type ? data.role_type.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()) : null;
  const mismatch  = !!confirmPassword && newPassword !== confirmPassword;

  if (loading) return <><PageHeader title="My profile" /><Spinner label="Loading your profile…" /></>;

  return (
    <div className="animate-fade-in">
      <PageHeader title="My profile" />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-10 gap-y-8 items-start max-w-[1100px]">
        {/* Details */}
        <section>
          <SectionTitle icon={User} title="Details" />
          <div className="tile">
            <div className="flex items-center gap-3 mb-4">
              <span className="avatar !w-10 !h-10 !text-[14px]">{toInitials(data.full_name) || '?'}</span>
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-ink truncate">{data.full_name}</p>
                <p className="text-[12px] text-muted truncate">{data.designation || 'No designation'}</p>
              </div>
              {roleLabel && <span className="ml-auto"><Tag tone="brand">{roleLabel}</Tag></span>}
            </div>
            <KV items={[
              ['Email', orDash(data.email)],
              ['Phone', <span key="p" className="tabular">{orDash(data.phone)}</span>],
              ['Employee code', <span key="c" className="mono">{orDash(data.employee_code)}</span>],
              ['Department', orDash(data.department_name)],
              ['Organisation', orDash(data.organization_name)],
            ]} />
          </div>
        </section>

        {/* Change password */}
        <section>
          <SectionTitle icon={Lock} title="Change password" />
          <form
            className="space-y-3 max-w-[420px]"
            onSubmit={e => { e.preventDefault(); handlePasswordChange(); }}
          >
            <PasswordInput
              id="current-pw"
              label="Current password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={setCurrentPassword}
              show={showCurrent}
              onToggle={() => setShowCurrent(p => !p)}
            />
            <div>
              <PasswordInput
                id="new-pw"
                label="New password"
                value={newPassword}
                onChange={setNewPassword}
                show={showNew}
                onToggle={() => setShowNew(p => !p)}
              />
              <PasswordStrength password={newPassword} />
            </div>
            <PasswordInput
              id="confirm-pw"
              label="Confirm new password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              show={showConfirm}
              onToggle={() => setShowConfirm(p => !p)}
              invalid={mismatch}
              error={mismatch ? 'The passwords do not match.' : ''}
            />

            <div className="pt-4 border-t border-line">
              <button
                id="update-password-btn"
                type="submit"
                className="btn-primary"
                disabled={pwLoading || !validatePassword(newPassword).valid}
              >
                {pwLoading && <Loader2 size={14} className="animate-spin" />}
                {pwLoading ? 'Updating…' : 'Update password'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
