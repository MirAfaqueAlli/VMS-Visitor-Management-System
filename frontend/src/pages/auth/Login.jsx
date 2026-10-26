// frontend/src/pages/auth/Login.jsx
import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Mail, Lock, Eye, EyeOff, Building2, ChevronDown,
  AlertCircle, CheckCircle2, ShieldCheck, ArrowLeft,
} from 'lucide-react';
import useAuth from '../../hooks/useAuth';
import apiClient from '../../api/axios';
import { getApiErrorMessage } from '../../utils/apiError';
import AuthLayout from '../../components/AuthLayout';

/* -- Custom Unit Dropdown (avoids native select OS dark-mode popup) --------- */
function UnitDropdown({ value, units, loading, onChange, inputStyle }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const allOptions = [
    { value: '',       label: loading ? 'Loading units...' : '-- Select your unit --', muted: true },
    { value: 'global', label: '-- Central / Global Context --', muted: true },
    ...units.map(u => ({ value: String(u.id), label: `${u.name}${u.city ? ` - ${u.city}` : ''}`, muted: false })),
  ];

  const selected = allOptions.find(o => o.value === String(value));

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      {/* Trigger */}
      <div
        onClick={() => !loading && setOpen(o => !o)}
        style={{
          ...inputStyle,
          paddingRight: '32px',
          cursor: loading ? 'wait' : 'pointer',
          display: 'flex', alignItems: 'center',
          userSelect: 'none',
          color: selected && !selected.muted ? '#0f172a' : '#94a3b8',
        }}
      >
        <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {selected ? selected.label : '-- Select your unit --'}
        </span>
        <ChevronDown
          size={14} strokeWidth={1.8}
          style={{ position: 'absolute', right: '12px', top: '50%', transform: `translateY(-50%) rotate(${open ? 180 : 0}deg)`, pointerEvents: 'none', color: '#94a3b8', transition: 'transform 200ms' }}
        />
      </div>

      {/* Dropdown list — always light themed */}
      {open && (
        <ul style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 9999,
          background: '#ffffff', border: '1.5px solid #e2e8f0', borderRadius: '10px',
          boxShadow: '0 8px 32px rgba(15,30,80,0.14)', padding: '4px',
          margin: 0, listStyle: 'none', maxHeight: '220px', overflowY: 'auto',
        }}>
          {allOptions.map((opt) => (
            <li
              key={opt.value}
              onClick={() => { if (!loading) { onChange(opt.value); setOpen(false); } }}
              style={{
                padding: '9px 12px', borderRadius: '7px', cursor: loading ? 'wait' : 'pointer',
                fontSize: '13px', fontFamily: 'Inter, system-ui, sans-serif',
                color: opt.muted ? '#94a3b8' : '#0f172a',
                fontWeight: opt.muted ? 400 : 500,
                background: String(value) === opt.value ? '#eff6ff' : 'transparent',
                transition: 'background 100ms',
              }}
              onMouseEnter={e => { if (String(value) !== opt.value) e.currentTarget.style.background = '#f8fafc'; }}
              onMouseLeave={e => { if (String(value) !== opt.value) e.currentTarget.style.background = 'transparent'; }}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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

  /* -- Styles -- */
  const fieldWrap = { position: 'relative', marginBottom: '16px' };
  const labelStyle = {
    display: 'block', fontSize: '13px', fontWeight: 600,
    color: '#1e3a8a', marginBottom: '6px',
  };
  const inputStyle = {
    width: '100%', padding: '10px 12px 10px 38px',
    borderRadius: '8px', border: '1.5px solid #e2e8f0',
    fontSize: '13px', color: '#0f172a', background: '#f8fafc',
    outline: 'none', transition: 'border-color 150ms, box-shadow 150ms',
    fontFamily: 'Inter, system-ui, sans-serif',
  };
  const iconStyle = {
    position: 'absolute', left: '12px', top: '50%',
    transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none',
  };
  const inputFocus = (e) => {
    e.target.style.borderColor = '#3b82f6';
    e.target.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.12)';
    e.target.style.background = '#fff';
  };
  const inputBlur = (e) => {
    e.target.style.borderColor = '#e2e8f0';
    e.target.style.boxShadow = 'none';
    e.target.style.background = '#f8fafc';
  };

  // Unit selector — shared by the sign-in and forgot-password forms
  const unitSelectorField = (
    <div style={fieldWrap}>
      <label style={labelStyle}>{isLocked ? 'Unit / Branch' : 'Select Your Unit / Branch *'}</label>
      <div style={{ position: 'relative' }}>
        <Building2 size={14} strokeWidth={1.8} style={{ ...iconStyle, top: '50%' }} />
        {isLocked ? (
          <div style={{ ...inputStyle, display: 'flex', alignItems: 'center', cursor: 'not-allowed', border: '1.5px solid #93c5fd' }}>
            <span style={{ flex: 1, fontSize: '13px', color: '#0f172a' }}>
              {codeStatus === 'loading' ? 'Verifying...'
                : codeStatus === 'valid'
                  ? `${lockedUnit?.name}${lockedUnit?.city ? ` - ${lockedUnit.city}` : ''}`
                  : `Unknown: ${unitCode?.toUpperCase()}`}
            </span>
            <span style={{
              fontSize: '9px', fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.08em', padding: '2px 8px', borderRadius: '4px',
              background: 'rgba(59,130,246,0.1)', color: '#3b82f6',
            }}>{unitCode?.toUpperCase()}</span>
          </div>
        ) : (
          <UnitDropdown
            value={unitId}
            units={units}
            loading={unitsLoading}
            onChange={(val) => { setUnitId(val); setError(''); }}
            inputStyle={inputStyle}
          />
        )}
      </div>
    </div>
  );

  return (
    <AuthLayout>

        {/* STEP 1: Credentials */}
        {step === 1 && (
          <>
            <div style={{ marginBottom: '28px' }}>
              <h2 style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', margin: 0 }}>Sign In</h2>
              <p style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
                {isGlobalContext
                  ? 'Central / Global System access'
                  : selectedUnit
                    ? `Signing in to: ${selectedUnit.name}`
                    : 'Select your unit to continue'}
              </p>
            </div>

            {isLocked && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '10px 14px', borderRadius: '8px', marginBottom: '16px', fontSize: '12px',
                background: codeStatus === 'invalid' ? '#fef2f2' : '#f0fdf4',
                border: `1.5px solid ${codeStatus === 'invalid' ? '#fca5a5' : '#86efac'}`,
                color: codeStatus === 'invalid' ? '#dc2626' : '#16a34a',
              }}>
                {codeStatus === 'loading' && <span className="w-3 h-3 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'currentColor', borderTopColor: 'transparent', flexShrink: 0 }} />}
                {codeStatus === 'valid'   && <CheckCircle2 size={13} style={{ flexShrink: 0 }} />}
                {codeStatus === 'invalid' && <AlertCircle  size={13} style={{ flexShrink: 0 }} />}
                <span>
                  {codeStatus === 'loading' && `Verifying unit code "${unitCode.toUpperCase()}"...`}
                  {codeStatus === 'valid'   && `Unit: ${lockedUnit?.name}${lockedUnit?.city ? ` · ${lockedUnit.city}` : ''}`}
                  {codeStatus === 'invalid' && `Invalid unit code "${unitCode.toUpperCase()}"`}
                </span>
              </div>
            )}

            <form onSubmit={handleSubmit}>
              {/* Unit Selector */}
              {unitSelectorField}

              {/* Email */}
              <div style={fieldWrap}>
                <label style={labelStyle}>Email address</label>
                <div style={{ position: 'relative' }}>
                  <Mail size={14} strokeWidth={1.8} style={iconStyle} />
                  <input
                    id="login-email"
                    type="email"
                    required
                    autoComplete="email"
                    autoFocus={isLocked && codeStatus === 'valid'}
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    style={inputStyle}
                    onFocus={inputFocus}
                    onBlur={inputBlur}
                  />
                </div>
              </div>

              {/* Password */}
              <div style={fieldWrap}>
                <label style={labelStyle}>Password</label>
                <div style={{ position: 'relative' }}>
                  <Lock size={14} strokeWidth={1.8} style={iconStyle} />
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    style={{ ...inputStyle, paddingRight: '38px' }}
                    onFocus={inputFocus}
                    onBlur={inputBlur}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword(p => !p)}
                    style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    {showPassword ? <EyeOff size={14} strokeWidth={1.8} /> : <Eye size={14} strokeWidth={1.8} />}
                  </button>
                </div>
                <div style={{ textAlign: 'right', marginTop: '6px' }}>
                  <button
                    type="button"
                    onClick={() => { setStep(3); setError(''); setForgotSent(false); }}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#3b82f6', fontSize: '12px', fontWeight: 600, fontFamily: 'Inter, system-ui, sans-serif' }}
                  >
                    Forgot password?
                  </button>
                </div>
              </div>

              {error && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '10px 14px', borderRadius: '8px', marginBottom: '16px',
                  background: '#fef2f2', border: '1.5px solid #fca5a5', color: '#dc2626', fontSize: '12px',
                }}>
                  <AlertCircle size={13} style={{ flexShrink: 0 }} />
                  {error}
                </div>
              )}

              <button
                id="login-submit-btn"
                type="submit"
                disabled={isLoading || codeStatus === 'loading' || codeStatus === 'invalid'}
                style={{
                  width: '100%', padding: '12px', borderRadius: '10px', border: 'none',
                  background: '#13315c', color: 'white',
                  fontSize: '14px', fontWeight: 700,
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  opacity: (isLoading || codeStatus === 'loading' || codeStatus === 'invalid') ? 0.7 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  boxShadow: '0 4px 14px rgba(19,49,92,0.25)',
                  transition: 'opacity 150ms',
                  fontFamily: 'Inter, system-ui, sans-serif',
                  letterSpacing: '0.02em', marginBottom: '16px',
                }}
                onMouseEnter={e => { if (!isLoading) e.currentTarget.style.opacity = '0.92'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
              >
                {isLoading ? (
                  <>
                    <span className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin"
                      style={{ borderColor: 'rgba(255,255,255,0.4)', borderTopColor: 'white' }} />
                    Verifying...
                  </>
                ) : 'Continue'}
              </button>
            </form>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px', marginTop: '4px' }}>
              <ShieldCheck size={11} style={{ color: '#94a3b8' }} />
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>Your data is protected and secure</span>
            </div>

            {isLocked && codeStatus !== 'invalid' && (
              <p style={{ textAlign: 'center', fontSize: '11px', color: '#94a3b8', marginTop: '14px' }}>
                Wrong unit?{' '}
                <a href="/login" style={{ color: '#3b82f6', textDecoration: 'underline' }}>
                  Choose a different unit
                </a>
              </p>
            )}
          </>
        )}

        {/* STEP 3: Forgot password */}
        {step === 3 && (
          <>
            <button
              onClick={() => { setStep(1); setError(''); }}
              style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                background: 'none', border: 'none', cursor: 'pointer',
                color: '#64748b', fontSize: '12px', padding: '0 0 20px 0',
                fontFamily: 'Inter, system-ui, sans-serif',
              }}
            >
              <ArrowLeft size={13} strokeWidth={2} /> Back to sign in
            </button>

            

            {forgotSent ? (
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: '8px',
                padding: '12px 14px', borderRadius: '8px',
                background: '#f0fdf4', border: '1.5px solid #86efac', color: '#16a34a', fontSize: '13px', lineHeight: 1.5,
              }}>
                <CheckCircle2 size={15} style={{ flexShrink: 0, marginTop: '2px' }} />
                <span>If an account exists for <strong>{email}</strong>, a reset link has been sent to it. The link expires in 30 minutes.</span>
              </div>
            ) : (
              <form onSubmit={handleForgotSubmit}>
                {unitSelectorField}

                <div style={fieldWrap}>
                  <label style={labelStyle}>Email address</label>
                  <div style={{ position: 'relative' }}>
                    <Mail size={14} strokeWidth={1.8} style={iconStyle} />
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      style={inputStyle}
                      onFocus={inputFocus}
                      onBlur={inputBlur}
                    />
                  </div>
                </div>

                {error && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '10px 14px', borderRadius: '8px', marginBottom: '16px',
                    background: '#fef2f2', border: '1.5px solid #fca5a5', color: '#dc2626', fontSize: '12px',
                  }}>
                    <AlertCircle size={13} style={{ flexShrink: 0 }} />
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading || codeStatus === 'loading' || codeStatus === 'invalid'}
                  style={{
                    width: '100%', padding: '12px', borderRadius: '10px', border: 'none',
                    background: '#13315c', color: 'white',
                    fontSize: '14px', fontWeight: 700,
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                    opacity: isLoading ? 0.7 : 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    boxShadow: '0 4px 14px rgba(19,49,92,0.25)',
                    fontFamily: 'Inter, system-ui, sans-serif',
                    letterSpacing: '0.02em',
                  }}
                >
                  {isLoading ? 'Sending...' : 'Send reset link'}
                </button>
              </form>
            )}
          </>
        )}

    </AuthLayout>
  );
}
