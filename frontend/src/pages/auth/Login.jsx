// frontend/src/pages/auth/Login.jsx
import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Shield, Mail, Lock, Eye, EyeOff, Building2, ChevronDown,
  AlertCircle, CheckCircle2, ShieldCheck, Zap, Clock, ArrowLeft,
  KeyRound, RefreshCw,
} from 'lucide-react';
import useAuth from '../../hooks/useAuth';
import apiClient from '../../api/axios';



/* â”€â”€ Main Login Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export default function Login() {
  const { login, verifyLoginOtp } = useAuth();
  const navigate       = useNavigate();
  const { unitCode }   = useParams();

  // â”€â”€ Step 1 state
  const [email,        setEmail]        = useState('');
  const [password,     setPassword]     = useState('');
  const [unitId,       setUnitId]       = useState('');
  const [units,        setUnits]        = useState([]);
  const [unitsLoading, setUnitsLoading] = useState(true);
  const [showPassword, setShowPassword] = useState(false);

  const [lockedUnit,   setLockedUnit]   = useState(null);
  const [codeStatus,   setCodeStatus]   = useState('idle');

  // â”€â”€ Step 2 (OTP) state
  const [step,         setStep]         = useState(1); // 1 = credentials, 2 = OTP
  const [loginToken,   setLoginToken]   = useState('');
  const [maskedEmail,  setMaskedEmail]  = useState('');
  const [otp,          setOtp]          = useState(['', '', '', '', '', '']);
  const [resendTimer,  setResendTimer]  = useState(0);
  const otpRefs = useRef([]);

  // â”€â”€ Shared state
  const [isLoading,    setIsLoading]    = useState(false);
  const [error,        setError]        = useState('');

  // Resend countdown
  useEffect(() => {
    if (resendTimer <= 0) return;
    const t = setTimeout(() => setResendTimer(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendTimer]);

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

  // â”€â”€ Step 1 submit: verify credentials, get loginToken
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (codeStatus === 'invalid') { setError('Invalid unit code in URL.'); return; }
    if (!isGlobalContext && !unitId) { setError('Please select your unit / branch first.'); return; }
    setIsLoading(true);
    try {
      const data = await login(email, password, isGlobalContext ? '' : unitId);
      // data = { loginToken, email, requires_otp: true }
      setLoginToken(data.loginToken);
      setMaskedEmail(data.email);
      setOtp(['', '', '', '', '', '']);
      setResendTimer(60);
      setStep(2);
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    } catch (err) {
      const msg = err?.response?.data?.message || 'Invalid credentials. Please try again.';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // â”€â”€ OTP input handling â€” auto-advance on digit, backspace goes back
  const handleOtpChange = (index, value) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...otp];
    next[index] = digit;
    setOtp(next);
    if (digit && index < 5) otpRefs.current[index + 1]?.focus();
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace') {
      if (otp[index]) {
        const next = [...otp]; next[index] = ''; setOtp(next);
      } else if (index > 0) {
        otpRefs.current[index - 1]?.focus();
      }
    }
  };

  const handleOtpPaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    const next = [...otp];
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setOtp(next);
    const focusIdx = Math.min(pasted.length, 5);
    otpRefs.current[focusIdx]?.focus();
  };

  // â”€â”€ Step 2 submit: verify OTP
  const handleOtpSubmit = async (e) => {
    e.preventDefault();
    const code = otp.join('');
    if (code.length < 6) { setError('Please enter all 6 digits of the OTP.'); return; }
    setError('');
    setIsLoading(true);
    try {
      await verifyLoginOtp(loginToken, code);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      const msg = err?.response?.data?.message || 'Invalid OTP. Please try again.';
      setError(msg);
      setOtp(['', '', '', '', '', '']);
      setTimeout(() => otpRefs.current[0]?.focus(), 50);
    } finally {
      setIsLoading(false);
    }
  };

  // â”€â”€ Resend OTP: re-call step-1 with same credentials
  const handleResend = async () => {
    if (resendTimer > 0) return;
    setError('');
    setIsLoading(true);
    try {
      const data = await login(email, password, isGlobalContext ? '' : unitId);
      setLoginToken(data.loginToken);
      setOtp(['', '', '', '', '', '']);
      setResendTimer(60);
      setTimeout(() => otpRefs.current[0]?.focus(), 50);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to resend OTP.');
    } finally {
      setIsLoading(false);
    }
  };

  /* â”€â”€ Field styles â”€â”€ */
  const fieldWrap = { position: 'relative', marginBottom: '16px' };
  const label = {
    display: 'block',
    fontSize: '13px',
    fontWeight: 600,
    color: '#1e3a8a',
    marginBottom: '6px',
  };
  const inputStyle = {
    width: '100%',
    padding: '10px 12px 10px 38px',
    borderRadius: '8px',
    border: '1.5px solid #e2e8f0',
    fontSize: '13px',
    color: '#0f172a',
    background: '#f8fafc',
    outline: 'none',
    transition: 'border-color 150ms, box-shadow 150ms',
    fontFamily: 'Inter, system-ui, sans-serif',
  };
  const iconStyle = {
    position: 'absolute',
    left: '12px',
    top: '50%',
    transform: 'translateY(-50%)',
    color: '#94a3b8',
    pointerEvents: 'none',
  };

  const inputFocus = (e) => { e.target.style.borderColor = '#3b82f6'; e.target.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.12)'; e.target.style.background = '#fff'; };
  const inputBlur  = (e) => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none'; e.target.style.background = '#f8fafc'; };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #eff6ff 0%, #f0f4ff 50%, #e8eeff 100%)',
        padding: '16px',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      {/* â”€â”€ Card â”€â”€ */}
      <div
        style={{
          display: 'flex',
          width: '100%',
          maxWidth: '900px',
          minHeight: '560px',
          borderRadius: '20px',
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(15,30,80,0.12)',
          background: 'white',
        }}
      >
        {/* â•â• LEFT PANEL â€” Branding + Illustration (hidden on mobile) â•â•â•â•â•â• */}
        <div
          style={{
            flex: '0 0 45%',
            background: 'linear-gradient(160deg, #eff6ff 0%, #dbeafe 60%, #bfdbfe 100%)',
            padding: '36px 32px',
            position: 'relative',
            overflow: 'hidden',
          }}
          className="hidden md:flex flex-col"
        >
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '28px' }}>
            <img
              src="/logo.png"
              alt="VMS Logo"
              style={{ width: '38px', height: '38px', objectFit: 'contain', borderRadius: '8px' }}
            />
            <div>
              <p style={{ fontWeight: 800, fontSize: '16px', color: '#1e3a8a', lineHeight: 1 }}>VMS</p>
              <p style={{ fontSize: '10px', color: '#60a5fa', marginTop: '2px', lineHeight: 1 }}>Visitor Management System</p>
            </div>
          </div>

          {/* Heading */}
          <div style={{ marginBottom: '24px' }}>
            <h1 style={{ fontSize: '28px', fontWeight: 800, color: '#1e3a8a', lineHeight: 1.2, margin: 0 }}>
              {step === 2 ? 'Verify Your' : 'Welcome'}{' '}
              <span style={{ color: '#3b82f6', fontStyle: 'italic' }}>
                {step === 2 ? 'Identity' : 'Back!'}
              </span>
            </h1>
            <p style={{ fontSize: '13px', color: '#64748b', marginTop: '8px', lineHeight: 1.6 }}>
              {step === 2
                ? 'An OTP has been sent to your email.\nEnter it to complete sign-in.'
                : 'Secure access to manage and monitor\nyour visitors seamlessly.'}
            </p>
          </div>

          {/* Illustration */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 0' }}>
            <img
              src="/login-illustration.png"
              alt="VMS â€” Visitor Management System"
              style={{
                width: '100%',
                maxWidth: '360px',
                height: 'auto',
                objectFit: 'contain',
                borderRadius: '12px',
                filter: 'drop-shadow(0 8px 24px rgba(30,58,138,0.18))',
              }}
            />
          </div>

          {/* Feature pills */}
          <div style={{ display: 'flex', gap: '12px', marginTop: '20px', flexWrap: 'wrap' }}>
            {[
              { icon: ShieldCheck, label: 'Secure', sub: 'Advanced encryption' },
              { icon: Zap,         label: 'Fast',   sub: 'Quick & easy access' },
              { icon: Clock,       label: 'Reliable', sub: '24/7 system uptime' },
            ].map(({ icon: Icon, label: lbl, sub }) => (
              <div key={lbl} style={{
                display: 'flex', alignItems: 'center', gap: '7px',
                background: 'rgba(255,255,255,0.6)',
                padding: '7px 11px',
                borderRadius: '10px',
                backdropFilter: 'blur(4px)',
                border: '1px solid rgba(255,255,255,0.8)',
              }}>
                <div style={{
                  width: '24px', height: '24px',
                  background: 'rgba(59,130,246,0.12)',
                  borderRadius: '6px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon size={12} style={{ color: '#3b82f6' }} strokeWidth={2} />
                </div>
                <div>
                  <p style={{ fontSize: '11px', fontWeight: 700, color: '#1e3a8a', lineHeight: 1 }}>{lbl}</p>
                  <p style={{ fontSize: '9px', color: '#64748b', marginTop: '1px' }}>{sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>


        {/* â•â• RIGHT PANEL â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
        <div style={{
          flex: 1,
          minWidth: 0,
          padding: 'clamp(24px, 5vw, 44px) clamp(20px, 5vw, 40px) 36px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: 'white',
          overflowY: 'auto',
        }}>
          <div>
            {/* Mobile logo */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}
              className="flex md:hidden">
              <img
                src="/logo.png"
                alt="VMS Logo"
                style={{ width: '32px', height: '32px', objectFit: 'contain', borderRadius: '6px' }}
              />
              <p style={{ fontWeight: 800, fontSize: '14px', color: '#1e3a8a' }}>VMS</p>
            </div>

            {/* â•â• STEP 1: Credentials â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
            {step === 1 && (
              <>
                {/* Form heading */}
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

                {/* Unit code banner (locked mode) */}
                {isLocked && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '10px 14px', borderRadius: '8px', marginBottom: '16px',
                    fontSize: '12px',
                    background:   codeStatus === 'invalid' ? '#fef2f2' : '#f0fdf4',
                    border:       `1.5px solid ${codeStatus === 'invalid' ? '#fca5a5' : '#86efac'}`,
                    color:        codeStatus === 'invalid' ? '#dc2626' : '#16a34a',
                  }}>
                    {codeStatus === 'loading' && <span className="w-3 h-3 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'currentColor', borderTopColor: 'transparent', flexShrink: 0 }} />}
                    {codeStatus === 'valid'   && <CheckCircle2 size={13} style={{ flexShrink: 0 }} />}
                    {codeStatus === 'invalid' && <AlertCircle  size={13} style={{ flexShrink: 0 }} />}
                    <span>
                      {codeStatus === 'loading' && `Verifying unit code "${unitCode.toUpperCase()}"â€¦`}
                      {codeStatus === 'valid'   && `Unit: ${lockedUnit?.name}${lockedUnit?.city ? ` Â· ${lockedUnit.city}` : ''}`}
                      {codeStatus === 'invalid' && `Invalid unit code "${unitCode.toUpperCase()}"`}
                    </span>
                  </div>
                )}

                <form onSubmit={handleSubmit}>
                  {/* Unit Selector */}
                  <div style={fieldWrap}>
                    <label style={label}>{isLocked ? 'Unit / Branch' : 'Select Your Unit / Branch *'}</label>
                    <div style={{ position: 'relative' }}>
                      <Building2 size={14} strokeWidth={1.8} style={{ ...iconStyle, top: '50%' }} />
                      {isLocked ? (
                        <div style={{ ...inputStyle, display: 'flex', alignItems: 'center', cursor: 'not-allowed', border: '1.5px solid #93c5fd' }}>
                          <span style={{ flex: 1, fontSize: '13px', color: '#0f172a' }}>
                            {codeStatus === 'loading' ? 'Verifyingâ€¦'
                              : codeStatus === 'valid'
                                ? `${lockedUnit?.name}${lockedUnit?.city ? ` â€” ${lockedUnit.city}` : ''}`
                                : `Unknown: ${unitCode?.toUpperCase()}`}
                          </span>
                          <span style={{
                            fontSize: '9px', fontWeight: 700, textTransform: 'uppercase',
                            letterSpacing: '0.08em', padding: '2px 8px', borderRadius: '4px',
                            background: 'rgba(59,130,246,0.1)', color: '#3b82f6',
                          }}>
                            {unitCode?.toUpperCase()}
                          </span>
                        </div>
                      ) : (
                        <>
                          <select
                            id="login-unit-select"
                            value={unitId}
                            onChange={e => { setUnitId(e.target.value); setError(''); }}
                            disabled={unitsLoading}
                            style={{ ...inputStyle, paddingRight: '32px', appearance: 'none', cursor: unitsLoading ? 'wait' : 'pointer' }}
                          >
                            <option value="">{unitsLoading ? 'Loading unitsâ€¦' : 'â€” Select your unit â€”'}</option>
                            <option value="global">â€” Central / Global Context â€”</option>
                            {units.map(u => (
                              <option key={u.id} value={u.id}>
                                {u.name}{u.city ? ` â€” ${u.city}` : ''}
                              </option>
                            ))}
                          </select>
                          <ChevronDown size={14} strokeWidth={1.8} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#94a3b8' }} />
                        </>
                      )}
                    </div>
                  </div>

                  {/* Email */}
                  <div style={fieldWrap}>
                    <label style={label}>Email address</label>
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
                    <label style={label}>Password</label>
                    <div style={{ position: 'relative' }}>
                      <Lock size={14} strokeWidth={1.8} style={iconStyle} />
                      <input
                        id="login-password"
                        type={showPassword ? 'text' : 'password'}
                        required
                        autoComplete="current-password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢"
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
                      background: 'linear-gradient(135deg, #3b82f6, #2563eb)', color: 'white',
                      fontSize: '14px', fontWeight: 700,
                      cursor: isLoading ? 'not-allowed' : 'pointer',
                      opacity: (isLoading || codeStatus === 'loading' || codeStatus === 'invalid') ? 0.7 : 1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                      boxShadow: '0 4px 14px rgba(59,130,246,0.4)',
                      transition: 'opacity 150ms, transform 150ms',
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
                    ) : (
                      <>Continue â†’</>
                    )}
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

            {/* â•â• STEP 2: OTP Verification â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
            {step === 2 && (
              <>
                {/* Back button */}
                <button
                  onClick={() => { setStep(1); setError(''); setOtp(['','','','','','']); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '5px',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: '#64748b', fontSize: '12px', padding: '0 0 20px 0',
                    fontFamily: 'Inter, system-ui, sans-serif',
                  }}
                >
                  <ArrowLeft size={13} strokeWidth={2} /> Back to sign in
                </button>

                {/* OTP heading */}
                <div style={{ marginBottom: '24px' }}>
                  <div style={{
                    width: '44px', height: '44px', borderRadius: '12px',
                    background: 'rgba(59,130,246,0.10)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    marginBottom: '14px',
                  }}>
                    <KeyRound size={22} style={{ color: '#3b82f6' }} strokeWidth={1.8} />
                  </div>
                  <h2 style={{ fontSize: '22px', fontWeight: 800, color: '#0f172a', margin: 0 }}>
                    Check your email
                  </h2>
                  <p style={{ fontSize: '13px', color: '#64748b', marginTop: '6px', lineHeight: 1.6 }}>
                    We sent a 6-digit verification code to
                  </p>
                  <p style={{ fontSize: '13px', fontWeight: 700, color: '#1e3a8a', marginTop: '2px' }}>
                    {maskedEmail}
                  </p>
                </div>

                {/* OTP boxes */}
                <form onSubmit={handleOtpSubmit}>
                  <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                    {otp.map((digit, i) => (
                      <input
                        key={i}
                        ref={el => { otpRefs.current[i] = el; }}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={digit}
                        onChange={e => handleOtpChange(i, e.target.value)}
                        onKeyDown={e => handleOtpKeyDown(i, e)}
                        onPaste={i === 0 ? handleOtpPaste : undefined}
                        style={{
                          flex: 1, height: '52px', textAlign: 'center',
                          fontSize: '22px', fontWeight: 700, color: '#0f172a',
                          border: `2px solid ${digit ? '#3b82f6' : '#e2e8f0'}`,
                          borderRadius: '10px',
                          background: digit ? 'rgba(59,130,246,0.04)' : '#f8fafc',
                          outline: 'none',
                          transition: 'border-color 150ms, box-shadow 150ms',
                          fontFamily: 'Inter, system-ui, sans-serif',
                        }}
                        onFocus={e => { e.target.style.borderColor = '#3b82f6'; e.target.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.12)'; }}
                        onBlur={e => { e.target.style.boxShadow = 'none'; if (!e.target.value) e.target.style.borderColor = '#e2e8f0'; }}
                      />
                    ))}
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
                    id="otp-verify-btn"
                    type="submit"
                    disabled={isLoading || otp.join('').length < 6}
                    style={{
                      width: '100%', padding: '12px', borderRadius: '10px', border: 'none',
                      background: 'linear-gradient(135deg, #3b82f6, #2563eb)', color: 'white',
                      fontSize: '14px', fontWeight: 700,
                      cursor: (isLoading || otp.join('').length < 6) ? 'not-allowed' : 'pointer',
                      opacity: (isLoading || otp.join('').length < 6) ? 0.6 : 1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                      boxShadow: '0 4px 14px rgba(59,130,246,0.4)',
                      transition: 'opacity 150ms',
                      fontFamily: 'Inter, system-ui, sans-serif',
                      letterSpacing: '0.02em', marginBottom: '14px',
                    }}
                  >
                    {isLoading ? (
                      <>
                        <span className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin"
                          style={{ borderColor: 'rgba(255,255,255,0.4)', borderTopColor: 'white' }} />
                        Verifying...
                      </>
                    ) : (
                      <>Verify & Sign In â†’</>
                    )}
                  </button>
                </form>

                {/* Resend */}
                <div style={{ textAlign: 'center', marginTop: '4px' }}>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>Didn't receive it? </span>
                  {resendTimer > 0 ? (
                    <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                      Resend in {resendTimer}s
                    </span>
                  ) : (
                    <button
                      onClick={handleResend}
                      disabled={isLoading}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: '#3b82f6', fontSize: '12px', fontWeight: 600,
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        fontFamily: 'Inter, system-ui, sans-serif',
                        textDecoration: 'underline',
                      }}
                    >
                      <RefreshCw size={11} strokeWidth={2} /> Resend OTP
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px', marginTop: '16px' }}>
                  <ShieldCheck size={11} style={{ color: '#94a3b8' }} />
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>Code expires in 10 minutes</span>
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <p style={{ textAlign: 'center', fontSize: '11px', color: '#cbd5e1', marginTop: '24px', letterSpacing: '0.05em' }}>
            Â© {new Date().getFullYear()} SOBEIT TECHNOLOGY. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
