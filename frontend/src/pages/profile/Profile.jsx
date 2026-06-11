// frontend/src/pages/profile/Profile.jsx
import { useState, useEffect } from 'react';
import { User, Lock, Hash, Building2, Mail, Phone, Eye, EyeOff } from 'lucide-react';
import { toast } from 'react-hot-toast';
import apiClient from '../../api/axios';
import useAuth from '../../hooks/useAuth';
import PasswordStrength from '../../components/PasswordStrength';
import { validatePassword } from '../../utils/passwordValidator';

const ROLE_COLORS = {
  admin:        { bg: '#fef2f2', color: '#b91c1c' },
  employee:     { bg: '#eff6ff', color: '#1d4ed8' },
  security:     { bg: '#f0fdf4', color: '#15803d' },
  receptionist: { bg: '#f5f3ff', color: '#5b21b6' },
};

const PasswordInput = ({ label, value, onChange, show, onToggle, id }) => (
  <div>
    <label className="block text-[11px] font-medium uppercase tracking-wider mb-1.5"
           style={{ color: 'var(--color-text-faint)' }}>
      {label}
    </label>
    <div className="relative">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="vms-input pr-8"
        autoComplete="new-password"
      />
      <button
        type="button"
        onClick={onToggle}
        className="absolute right-2.5 top-1/2 -translate-y-1/2"
        style={{ color: 'var(--color-text-faint)' }}
        tabIndex={-1}
      >
        {show ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
    </div>
  </div>
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
      await apiClient.put('/auth/change-password', { currentPassword, newPassword });
      toast.success('Password updated successfully.');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to update password.');
    } finally {
      setPwLoading(false);
    }
  };

  const data  = profileData ?? user ?? {};
  const initials = data.full_name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) ?? '?';
  const roleStyle = ROLE_COLORS[data.role_type] ?? { bg: 'var(--color-lightColor)', color: 'var(--color-text-muted)' };
  const mismatch  = confirmPassword && newPassword !== confirmPassword;

  if (loading) return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="w-7 h-7 rounded-full border-2 animate-spin"
        style={{ borderColor: 'var(--color-border)', borderTopColor: 'var(--color-accent)' }} />
    </div>
  );


  return (
    <div className="space-y-5 animate-fade-in">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* ── Left: avatar card ──────────────────────────────────────── */}
        <div className="vms-card p-5 flex flex-col items-center text-center">
          {/* Avatar */}
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold mb-3"
            style={{ background: 'rgba(59,130,246,0.12)', color: 'var(--color-accent)' }}
          >
            {initials}
          </div>

          <p className="font-semibold text-[15px]" style={{ color: 'var(--color-text)' }}>
            {data.full_name}
          </p>

          {/* Role badge */}
          <span
            className="mt-2 inline-flex px-2 py-0.5 text-[11px] font-semibold capitalize"
            style={{ background: roleStyle.bg, color: roleStyle.color, borderRadius: 'var(--radius-sm)' }}
          >
            {data.role_type?.replace(/_/g, ' ')}
          </span>

          <p className="mt-1 text-[12px]" style={{ color: 'var(--color-text-faint)' }}>
            {data.designation || 'No designation'}
          </p>

          {/* Employee code */}
          {data.employee_code && (
            <div
              className="mt-4 px-3 py-2 flex items-center gap-2"
              style={{
                background: 'var(--color-info-bg)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <Hash size={13} style={{ color: 'var(--color-info)' }} />
              <span className="font-mono text-[12px]" style={{ color: 'var(--color-text)' }}>
                {data.employee_code}
              </span>
            </div>
          )}
        </div>

        {/* ── Right: info + password ──────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-5">

          {/* Personal info */}
          <div className="vms-card p-5">
            <h3 className="font-semibold text-[13px] flex items-center gap-2 mb-5"
                style={{ color: 'var(--color-text)' }}>
              <User size={15} style={{ color: 'var(--color-accent)' }} />
              Personal Information
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                ['Full Name',       data.full_name,        User],
                ['Email',           data.email,            Mail],
                ['Phone',           data.phone,            Phone],
                ['Employee Code',   data.employee_code,    Hash],
                ['Department',      data.department_name,  Building2],
                ['Organization',    data.organization_name,Building2],
              ].map(([label, value, Icon]) => (
                <div key={label}>
                  <p className="text-[10px] font-medium uppercase tracking-wider mb-1"
                     style={{ color: 'var(--color-text-faint)' }}>
                    {label}
                  </p>
                  <p className="text-[13px] font-medium" style={{ color: 'var(--color-text)' }}>
                    {value || '—'}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Change password */}
          <div className="vms-card p-5">
            <h3 className="font-semibold text-[13px] flex items-center gap-2 mb-5"
                style={{ color: 'var(--color-text)' }}>
              <Lock size={15} style={{ color: 'var(--color-accent)' }} />
              Change Password
            </h3>

            <div className="space-y-4">
              <PasswordInput
                id="current-pw"
                label="Current Password"
                value={currentPassword}
                onChange={setCurrentPassword}
                show={showCurrent}
                onToggle={() => setShowCurrent(p => !p)}
              />
              <PasswordInput
                id="new-pw"
                label="New Password"
                value={newPassword}
                onChange={setNewPassword}
                show={showNew}
                onToggle={() => setShowNew(p => !p)}
              />
              <PasswordStrength password={newPassword} />
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wider mb-1.5"
                       style={{ color: 'var(--color-text-faint)' }}>
                  Confirm New Password
                </label>
                <div className="relative">
                  <input
                    id="confirm-pw"
                    type={showConfirm ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    className="vms-input pr-8"
                    style={mismatch ? { borderColor: 'var(--color-error)' } : {}}
                    autoComplete="new-password"
                  />
                  <button type="button" onClick={() => setShowConfirm(p => !p)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2"
                    style={{ color: 'var(--color-text-faint)' }} tabIndex={-1}>
                    {showConfirm ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
                {mismatch && (
                  <p className="mt-1 text-[11px]" style={{ color: 'var(--color-error)' }}>
                    Passwords do not match
                  </p>
                )}
              </div>

              <button
                id="update-password-btn"
                className="btn-primary w-full justify-center"
                onClick={handlePasswordChange}
                disabled={pwLoading}
              >
                {pwLoading ? 'Updating...' : 'Update Password'}
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
