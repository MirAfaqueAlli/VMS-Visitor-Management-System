// frontend/src/pages/auth/ResetPassword.jsx
// Landing page for the emailed "reset your password" link (/reset-password?token=...)
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Lock, Eye, EyeOff, AlertCircle, CheckCircle2, KeyRound } from 'lucide-react';
import apiClient from '../../api/axios';
import { getApiErrorMessage } from '../../utils/apiError';
import { validatePassword } from '../../utils/passwordValidator';
import PasswordStrength from '../../components/PasswordStrength';
import AuthLayout from '../../components/AuthLayout';
import { authStyles } from '../../utils/authTheme';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token     = searchParams.get('token') || '';
  const validLink = /^[a-f0-9]{64}$/.test(token);

  const [password,  setPassword]  = useState('');
  const [confirm,   setConfirm]   = useState('');
  const [showPw,    setShowPw]    = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error,     setError]     = useState('');
  const [done,      setDone]      = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    if (!validatePassword(password).valid) { setError('Password does not meet the requirements below.'); return; }
    setIsLoading(true);
    try {
      await apiClient.post('/auth/reset-password', { token, newPassword: password });
      setDone(true);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not reset the password. Please request a new link.'));
    } finally {
      setIsLoading(false);
    }
  };

  /* -- Styles (shared with the sign-in and setup pages) -- */
  const fieldWrap = { position: 'relative', marginBottom: '16px' };
  const linkStyle = { color: '#3b82f6', fontWeight: 600, fontSize: '13px' };

  const passwordInput = (value, onChange, autoComplete, placeholder) => (
    <div style={{ position: 'relative' }}>
      <Lock size={14} strokeWidth={1.8} style={authStyles.icon} />
      <input
        type={showPw ? 'text' : 'password'}
        required
        autoComplete={autoComplete}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ ...authStyles.input, paddingRight: '38px' }}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShowPw(p => !p)}
        style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        {showPw ? <EyeOff size={14} strokeWidth={1.8} /> : <Eye size={14} strokeWidth={1.8} />}
      </button>
    </div>
  );

  return (
    <AuthLayout eyebrow="Account recovery">
        <div style={{ marginBottom: '24px' }}>
          <div style={{
            width: '44px', height: '44px', borderRadius: '12px', background: 'rgba(59,130,246,0.10)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '14px',
          }}>
            <KeyRound size={22} style={{ color: '#3b82f6' }} strokeWidth={1.8} />
          </div>
          <h2 style={{ fontSize: '22px', fontWeight: 800, color: '#0f172a', margin: 0 }}>Set a new password</h2>
        </div>

        {!validLink ? (
          <div style={{ fontSize: '13px', color: '#64748b', lineHeight: 1.6 }}>
            <p style={{ color: '#dc2626', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
              <AlertCircle size={15} style={{ flexShrink: 0, marginTop: '2px' }} />
              This reset link is incomplete or invalid.
            </p>
            <p style={{ marginTop: '12px' }}>
              Request a new one from the <Link to="/login" style={linkStyle}>sign-in page</Link> (Forgot password?).
            </p>
          </div>
        ) : done ? (
          <div>
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '12px 14px', borderRadius: '8px',
              background: '#f0fdf4', border: '1.5px solid #86efac', color: '#16a34a', fontSize: '13px', lineHeight: 1.5,
            }}>
              <CheckCircle2 size={15} style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>Your password has been reset. All other sessions have been signed out.</span>
            </div>
            <p style={{ marginTop: '16px', textAlign: 'center' }}>
              <Link to="/login" style={linkStyle}>Go to sign in</Link>
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={fieldWrap}>
              <label style={authStyles.label}>New password</label>
              {passwordInput(password, setPassword, 'new-password', 'New password')}
            </div>
            <PasswordStrength password={password} show={password.length > 0} hideWhenValid />
            <div style={{ ...fieldWrap, marginTop: '12px' }}>
              <label style={authStyles.label}>Confirm new password</label>
              {passwordInput(confirm, setConfirm, 'new-password', 'Repeat new password')}
            </div>

            {error && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', borderRadius: '8px', marginBottom: '16px',
                background: '#fef2f2', border: '1.5px solid #fca5a5', color: '#dc2626', fontSize: '12px',
              }}>
                <AlertCircle size={13} style={{ flexShrink: 0 }} />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              style={{ ...authStyles.primaryButton, cursor: isLoading ? 'not-allowed' : 'pointer', opacity: isLoading ? 0.7 : 1 }}
            >
              {isLoading ? 'Saving...' : 'Reset password'}
            </button>
          </form>
        )}
    </AuthLayout>
  );
}
