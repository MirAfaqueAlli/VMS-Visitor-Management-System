// frontend/src/pages/auth/ResetPassword.jsx
// Landing page for the emailed "reset your password" link (/reset-password?token=...)
import useDocumentTitle from '../../lib/useDocumentTitle';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Lock, Eye, EyeOff, AlertCircle, CheckCircle2, KeyRound, Loader2 } from '../../components/icons';
import apiClient from '../../api/axios';
import { getApiErrorMessage } from '../../utils/apiError';
import { validatePassword } from '../../utils/passwordValidator';
import PasswordStrength from '../../components/PasswordStrength';
import AuthLayout from '../../components/AuthLayout';
import { Field, Note } from '../../components/ui';

export default function ResetPassword() {
  useDocumentTitle('Reset password');
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

  const passwordInput = (id, value, onChange, autoComplete, placeholder) => (
    <div className="control-wrap">
      <Lock size={14} className="control-icon" />
      <input
        id={id}
        type={showPw ? 'text' : 'password'}
        required
        autoComplete={autoComplete}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="control pr-10"
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShowPw(p => !p)}
        className="absolute right-1 top-1/2 -translate-y-1/2 btn-icon !w-8 !min-h-0 h-8"
        aria-label={showPw ? 'Hide password' : 'Show password'}
      >
        {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );

  return (
    <AuthLayout eyebrow="Account recovery">
      <div className="mb-6">
        <span className="head-chip tone-brand !w-10 !h-10 mb-3"><KeyRound size={20} duo /></span>
        <h2 className="text-[22px] font-semibold text-ink">Set a new password</h2>
      </div>

      {!validLink ? (
        <div className="space-y-3">
          <Note tone="danger" icon={AlertCircle}>This reset link is incomplete or invalid.</Note>
          <p className="text-[12.5px] text-muted">
            Ask for a new one from the <Link to="/login" className="text-link font-medium">sign-in page</Link> (Forgot password?).
          </p>
        </div>
      ) : done ? (
        <div className="space-y-4">
          <Note tone="success" icon={CheckCircle2}>Your password has been reset. All other sessions have been signed out.</Note>
          <Link to="/login" className="btn-primary">Go to sign in</Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <Field label="New password" htmlFor="reset-pw">
              {passwordInput('reset-pw', password, setPassword, 'new-password', 'New password')}
            </Field>
            <PasswordStrength password={password} show={password.length > 0} hideWhenValid />
          </div>
          <Field label="Confirm new password" htmlFor="reset-confirm">
            {passwordInput('reset-confirm', confirm, setConfirm, 'new-password', 'Repeat the new password')}
          </Field>

          {error && <Note tone="danger" icon={AlertCircle}>{error}</Note>}

          <button type="submit" disabled={isLoading} className="btn-primary w-full !mt-5">
            {isLoading && <Loader2 size={14} className="animate-spin" />}
            {isLoading ? 'Saving…' : 'Reset password'}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
