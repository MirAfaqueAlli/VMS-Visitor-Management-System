// frontend/src/pages/auth/Login.jsx
// Sign in / forgot password (DESIGN_RULES auth: flat, split layout, OHPC identity).
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Mail, Lock, Eye, EyeOff, Building2,
  AlertCircle, CheckCircle2, ShieldCheck, ArrowLeft, Loader2,
} from '../../components/icons';
import useAuth from '../../hooks/useAuth';
import apiClient from '../../api/axios';
import { getApiErrorMessage } from '../../utils/apiError';
import AuthLayout from '../../components/AuthLayout';
import Select from '../../components/Select';
import { Field, Note } from '../../components/ui';

/* -- Main Login Component -------------------------------------------------- */
export default function Login() {
  const { login } = useAuth();
  const navigate     = useNavigate();
  const { unitCode } = useParams();

  // -- Step 1 state
  const [email,        setEmail]        = useState('');
  const [password,     setPassword]     = useState('');
  const [unitId,       setUnitId]       = useState('');
  const [units,        setUnits]        = useState([]);
  const [unitsLoading, setUnitsLoading] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [lockedUnit,   setLockedUnit]   = useState(null);
  const [codeStatus,   setCodeStatus]   = useState('idle');

  // -- Step: 1 = sign in, 3 = forgot password
  const [step,        setStep]        = useState(1);

  // -- Step 3 (forgot password) state
  const [forgotSent, setForgotSent] = useState(false);

  // -- Shared state
  const [isLoading, setIsLoading] = useState(false);
  const [error,     setError]     = useState('');

  useEffect(() => {
    if (!unitCode) return;
    setCodeStatus('loading');
    apiClient.get(`/units/by-code/${encodeURIComponent(unitCode.toUpperCase())}`)
      .then(res => {
        const u = res.data?.data;
        setLockedUnit(u);
        setUnitId(String(u.id));
        setCodeStatus('valid');
      })
      .catch(() => {
        setCodeStatus('invalid');
        setError(`No active unit found with code "${unitCode.toUpperCase()}".`);
      });
  }, [unitCode]);

  useEffect(() => {
    apiClient.get('/setup/status')
      .then(res => { if (!res.data?.initialized) navigate('/setup', { replace: true }); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (unitCode) { setUnitsLoading(false); return; }
    apiClient.get('/units/public')
      .then(res => setUnits(res.data?.data ?? []))
      .catch(() => setUnits([]))
      .finally(() => setUnitsLoading(false));
  }, [unitCode]);

  const selectedUnit    = lockedUnit ?? units.find(u => String(u.id) === String(unitId));
  const isGlobalContext = unitId === 'global';
  const isLocked        = !!unitCode;

  // -- Step 1 submit
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (codeStatus === 'invalid') { setError('Invalid unit code in URL.'); return; }
    if (!isGlobalContext && !unitId) { setError('Please select your unit / branch first.'); return; }
    setIsLoading(true);
    try {
      await login(email, password, isGlobalContext ? '' : unitId);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(getApiErrorMessage(err, 'Invalid credentials. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  // -- Step 3: forgot password — emails a reset link. The API answers the same
  //    whether or not the account exists, so we always show the same message.
  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (codeStatus === 'invalid') { setError('Invalid unit code in URL.'); return; }
    if (!isGlobalContext && !unitId) { setError('Please select your unit / branch first.'); return; }
    setIsLoading(true);
    try {
      const body = { email };
      if (!isGlobalContext) body.unit_id = parseInt(unitId, 10);
      await apiClient.post('/auth/forgot-password', body);
      setForgotSent(true);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not send the reset link. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  const busy = isLoading || codeStatus === 'loading' || codeStatus === 'invalid';

  // Unit selector — shared by the sign-in and forgot-password forms
  const unitSelectorField = (
    <Field label="Unit / branch" required={!isLocked}>
      {isLocked ? (
        <div className="control flex items-center gap-2 bg-surface-alt cursor-not-allowed">
          <Building2 size={14} className="text-muted shrink-0" />
          <span className="flex-1 truncate">
            {codeStatus === 'loading' ? 'Checking…'
              : codeStatus === 'valid'
                ? `${lockedUnit?.name}${lockedUnit?.city ? ` · ${lockedUnit.city}` : ''}`
                : `Unknown: ${unitCode?.toUpperCase()}`}
          </span>
          <span className="mono text-[11px] text-ink-2">{unitCode?.toUpperCase()}</span>
        </div>
      ) : (
        <Select searchable
          value={unitId}
          onChange={(e) => { setUnitId(e.target.value); setError(''); }}
          disabled={unitsLoading}
          aria-label="Unit / branch"
          searchable
        >
          <option value="">{unitsLoading ? 'Loading units…' : 'Select your unit'}</option>
          <option value="global">Central / global</option>
          {units.map(u => (
            <option key={u.id} value={String(u.id)}>{u.name}{u.city ? ` · ${u.city}` : ''}</option>
          ))}
        </Select>
      )}
    </Field>
  );

  const errorNote = error && <Note tone="danger" icon={AlertCircle}>{error}</Note>;

  return (
    <AuthLayout>
      {/* STEP 1: Credentials */}
      {step === 1 && (
        <>
          <div className="mb-6">
            <h2 className="text-[22px] font-semibold text-ink">Sign in</h2>
            <p className="text-[12.5px] text-muted mt-1">
              {isGlobalContext
                ? 'Central / global access'
                : selectedUnit
                  ? `Signing in to ${selectedUnit.name}`
                  : 'Choose your unit to continue'}
            </p>
          </div>

          {isLocked && (
            <div className="mb-4">
              {codeStatus === 'loading' && (
                <p className="text-[12px] text-muted flex items-center gap-1.5">
                  <Loader2 size={13} className="animate-spin" /> Checking unit code “{unitCode.toUpperCase()}”…
                </p>
              )}
              {codeStatus === 'valid' && (
                <Note tone="success" icon={CheckCircle2}>Unit: {lockedUnit?.name}{lockedUnit?.city ? ` · ${lockedUnit.city}` : ''}</Note>
              )}
              {codeStatus === 'invalid' && (
                <Note tone="danger" icon={AlertCircle}>Unit code “{unitCode.toUpperCase()}” is not valid.</Note>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {unitSelectorField}

            <Field label="Email" htmlFor="login-email">
              <div className="control-wrap">
                <Mail size={14} className="control-icon" />
                <input
                  id="login-email"
                  type="email"
                  required
                  autoComplete="email"
                  autoFocus={isLocked && codeStatus === 'valid'}
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@ohpc.co.in"
                  className="control"
                />
              </div>
            </Field>

            <div>
              <div className="flex items-baseline justify-between">
                <label htmlFor="login-password" className="field-label">Password</label>
                <button
                  type="button"
                  onClick={() => { setStep(3); setError(''); setForgotSent(false); }}
                  className="text-link text-[12px] font-medium"
                >
                  Forgot password?
                </button>
              </div>
              <div className="control-wrap">
                <Lock size={14} className="control-icon" />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="control pr-10"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword(p => !p)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 btn-icon !w-8 !min-h-0 h-8"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {errorNote}

            <button id="login-submit-btn" type="submit" disabled={busy} className="btn-primary w-full !mt-5">
              {isLoading && <Loader2 size={14} className="animate-spin" />}
              {isLoading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="mt-4 flex items-center justify-center gap-1.5 text-[11.5px] text-muted">
            <ShieldCheck size={12} /> Your sign-in is encrypted and logged.
          </p>

          {isLocked && codeStatus !== 'invalid' && (
            <p className="text-center text-[12px] text-muted mt-3">
              Wrong unit? <a href="/login" className="text-link font-medium">Choose another unit</a>
            </p>
          )}
        </>
      )}

      {/* STEP 3: Forgot password */}
      {step === 3 && (
        <>
          <button type="button" onClick={() => { setStep(1); setError(''); }} className="btn-ghost btn-sm !px-0 mb-4">
            <ArrowLeft size={13} /> Back to sign in
          </button>

          <div className="mb-6">
            <h2 className="text-[22px] font-semibold text-ink">Reset your password</h2>
            <p className="text-[12.5px] text-muted mt-1">We will email you a link to set a new one.</p>
          </div>

          {forgotSent ? (
            <Note tone="success" icon={CheckCircle2}>
              If an account exists for <b>{email}</b>, a reset link has been sent to it. The link expires in 30 minutes.
            </Note>
          ) : (
            <form onSubmit={handleForgotSubmit} className="space-y-3.5">
              {unitSelectorField}

              <Field label="Email" htmlFor="forgot-email">
                <div className="control-wrap">
                  <Mail size={14} className="control-icon" />
                  <input
                    id="forgot-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@ohpc.co.in"
                    className="control"
                  />
                </div>
              </Field>

              {errorNote}

              <button type="submit" disabled={busy} className="btn-primary w-full !mt-5">
                {isLoading && <Loader2 size={14} className="animate-spin" />}
                {isLoading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          )}
        </>
      )}
    </AuthLayout>
  );
}
