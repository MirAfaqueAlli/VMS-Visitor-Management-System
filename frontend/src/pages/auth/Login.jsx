// frontend/src/pages/auth/Login.jsx
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Shield, Mail, Lock, Eye, EyeOff, Building2, ChevronDown,
  AlertCircle, CheckCircle2, ShieldCheck, Zap, Clock,
} from 'lucide-react';
import useAuth from '../../hooks/useAuth';
import apiClient from '../../api/axios';

/* ── Inline SVG Illustration ──────────────────────────────────────────────── */
function DeskIllustration() {
  return (
    <svg viewBox="0 0 420 280" fill="none" xmlns="http://www.w3.org/2000/svg"
      style={{ width: '100%', maxWidth: '380px', margin: '0 auto', display: 'block' }}>
      {/* Sky gradient area */}
      <rect width="420" height="280" fill="url(#skyGrad)" rx="12" />

      {/* Background buildings */}
      <rect x="18" y="90" width="32" height="190" fill="#c7d9f8" rx="3" />
      <rect x="28" y="70" width="18" height="210" fill="#b8cef5" rx="3" />
      <rect x="370" y="95" width="35" height="185" fill="#c7d9f8" rx="3" />
      <rect x="376" y="75" width="23" height="205" fill="#b8cef5" rx="3" />

      {/* Middle buildings */}
      <rect x="60" y="120" width="25" height="160" fill="#d0e3fb" rx="2" />
      <rect x="340" y="115" width="28" height="165" fill="#d0e3fb" rx="2" />

      {/* Building windows */}
      <rect x="22" y="100" width="6" height="6" fill="#93c5fd" rx="1" opacity="0.7" />
      <rect x="33" y="100" width="6" height="6" fill="#93c5fd" rx="1" opacity="0.7" />
      <rect x="22" y="115" width="6" height="6" fill="#93c5fd" rx="1" opacity="0.5" />
      <rect x="376" y="90" width="6" height="6" fill="#93c5fd" rx="1" opacity="0.7" />
      <rect x="388" y="90" width="6" height="6" fill="#93c5fd" rx="1" opacity="0.7" />

      {/* Security gate / turnstile */}
      <rect x="300" y="140" width="5" height="120" fill="#3b82f6" rx="2" />
      <rect x="330" y="140" width="5" height="120" fill="#3b82f6" rx="2" />
      <rect x="300" y="155" width="35" height="4" fill="#60a5fa" rx="2" />
      <rect x="300" y="200" width="35" height="4" fill="#60a5fa" rx="2" />
      <rect x="303" y="140" width="29" height="12" fill="#2563eb" rx="3" />

      {/* Gate scanner light */}
      <circle cx="312" cy="146" r="3" fill="#93c5fd" />
      <circle cx="312" cy="146" r="5" fill="#3b82f6" opacity="0.3" />

      {/* Reception Desk */}
      <rect x="110" y="195" width="190" height="65" fill="#1e3a8a" rx="8" />
      <rect x="110" y="195" width="190" height="15" fill="#2563eb" rx="8" />
      <rect x="118" y="202" width="174" height="8" fill="#3b82f6" rx="4" />

      {/* Computer monitor */}
      <rect x="175" y="145" width="70" height="50" fill="#1e40af" rx="5" />
      <rect x="180" y="150" width="60" height="40" fill="#dbeafe" rx="3" />
      {/* Screen content */}
      <rect x="185" y="155" width="35" height="4" fill="#93c5fd" rx="2" />
      <rect x="185" y="163" width="25" height="3" fill="#bfdbfe" rx="1.5" />
      <rect x="185" y="170" width="30" height="3" fill="#bfdbfe" rx="1.5" />
      {/* Monitor stand */}
      <rect x="206" y="195" width="8" height="10" fill="#1e3a8a" rx="2" />
      <rect x="200" y="204" width="20" height="3" fill="#1e3a8a" rx="1.5" />

      {/* Security Guard / Person */}
      {/* Head */}
      <circle cx="155" cy="135" r="16" fill="#fed7aa" />
      {/* Hair */}
      <path d="M140 130 Q155 115 170 130" fill="#92400e" />
      {/* Body - uniform */}
      <rect x="136" y="150" width="38" height="45" fill="#1d4ed8" rx="6" />
      {/* Uniform collar */}
      <rect x="149" y="150" width="12" height="8" fill="#eff6ff" rx="2" />
      {/* Badge on uniform */}
      <rect x="140" y="158" width="10" height="7" fill="#fbbf24" rx="1" />
      {/* Arms */}
      <rect x="126" y="152" width="12" height="35" fill="#1d4ed8" rx="5" />
      <rect x="172" y="152" width="12" height="35" fill="#1d4ed8" rx="5" />
      {/* Hands */}
      <circle cx="132" cy="187" r="6" fill="#fed7aa" />
      <circle cx="178" cy="187" r="6" fill="#fed7aa" />
      {/* Eyes */}
      <circle cx="150" cy="134" r="3" fill="white" />
      <circle cx="160" cy="134" r="3" fill="white" />
      <circle cx="151" cy="135" r="1.5" fill="#1e293b" />
      <circle cx="161" cy="135" r="1.5" fill="#1e293b" />
      {/* Smile */}
      <path d="M150 142 Q155 146 160 142" stroke="#92400e" strokeWidth="1.5" fill="none" strokeLinecap="round" />

      {/* Decorative plant */}
      <rect x="60" y="230" width="20" height="30" fill="#854d0e" rx="3" />
      <rect x="63" y="227" width="14" height="6" fill="#a16207" rx="2" />
      {/* Plant leaves */}
      <ellipse cx="70" cy="210" rx="18" ry="28" fill="#166534" />
      <ellipse cx="55" cy="215" rx="12" ry="20" fill="#15803d" transform="rotate(-20 55 215)" />
      <ellipse cx="85" cy="215" rx="12" ry="20" fill="#15803d" transform="rotate(20 85 215)" />
      <ellipse cx="70" cy="195" rx="10" ry="18" fill="#16a34a" />

      {/* VMS Logo/badge floating */}
      <rect x="350" y="155" width="45" height="35" fill="white" rx="8" opacity="0.9" />
      <rect x="356" y="161" width="14" height="14" fill="#3b82f6" rx="3" />
      <rect x="374" y="163" width="15" height="3" fill="#1e3a8a" rx="1.5" />
      <rect x="374" y="169" width="10" height="2" fill="#93c5fd" rx="1" />
      <path d="M361 165 L363 172 L359 172 Z" fill="white" />

      {/* Ground */}
      <rect x="0" y="255" width="420" height="25" fill="#dbeafe" opacity="0.5" rx="0" />

      {/* Gradients */}
      <defs>
        <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#eff6ff" />
          <stop offset="100%" stopColor="#dbeafe" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/* ── Main Login Component ─────────────────────────────────────────────────── */
export default function Login() {
  const { login }      = useAuth();
  const navigate       = useNavigate();
  const { unitCode }   = useParams();

  const [email,        setEmail]        = useState('');
  const [password,     setPassword]     = useState('');
  const [unitId,       setUnitId]       = useState('');
  const [units,        setUnits]        = useState([]);
  const [unitsLoading, setUnitsLoading] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading,    setIsLoading]    = useState(false);
  const [error,        setError]        = useState('');

  const [lockedUnit,   setLockedUnit]   = useState(null);
  const [codeStatus,   setCodeStatus]   = useState('idle');

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
      const msg = err?.response?.data?.message || 'Invalid credentials. Please try again.';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  /* ── Field styles ── */
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
      {/* ── Card ── */}
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
        {/* ══ LEFT PANEL — Branding + Illustration (hidden on mobile) ══════ */}
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
              Welcome{' '}
              <span style={{ color: '#3b82f6', fontStyle: 'italic' }}>Back!</span>
            </h1>
            <p style={{ fontSize: '13px', color: '#64748b', marginTop: '8px', lineHeight: 1.6 }}>
              Secure access to manage and monitor<br />your visitors seamlessly.
            </p>
          </div>

          {/* Illustration */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <DeskIllustration />
          </div>

          {/* Feature pills */}
          <div style={{ display: 'flex', gap: '12px', marginTop: '20px', flexWrap: 'wrap' }}>
            {[
              { icon: ShieldCheck, label: 'Secure', sub: 'Advanced encryption' },
              { icon: Zap,         label: 'Fast',   sub: 'Quick & easy access' },
              { icon: Clock,       label: 'Reliable', sub: '24/7 system uptime' },
            ].map(({ icon: Icon, label, sub }) => (
              <div key={label} style={{
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
                  <p style={{ fontSize: '11px', fontWeight: 700, color: '#1e3a8a', lineHeight: 1 }}>{label}</p>
                  <p style={{ fontSize: '9px', color: '#64748b', marginTop: '1px' }}>{sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>


        {/* ══ RIGHT PANEL — Sign In Form ════════════════════════════════════ */}
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
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  marginBottom: '16px',
                  fontSize: '12px',
                  background:   codeStatus === 'invalid' ? '#fef2f2' : '#f0fdf4',
                  border:       `1.5px solid ${codeStatus === 'invalid' ? '#fca5a5' : '#86efac'}`,
                  color:        codeStatus === 'invalid' ? '#dc2626' : '#16a34a',
                }}
              >
                {codeStatus === 'loading'  && <span className="w-3 h-3 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'currentColor', borderTopColor: 'transparent', flexShrink: 0 }} />}
                {codeStatus === 'valid'    && <CheckCircle2 size={13} style={{ flexShrink: 0 }} />}
                {codeStatus === 'invalid'  && <AlertCircle  size={13} style={{ flexShrink: 0 }} />}
                <span>
                  {codeStatus === 'loading' && `Verifying unit code "${unitCode.toUpperCase()}"…`}
                  {codeStatus === 'valid'   && `Unit: ${lockedUnit?.name}${lockedUnit?.city ? ` · ${lockedUnit.city}` : ''}`}
                  {codeStatus === 'invalid' && `Invalid unit code "${unitCode.toUpperCase()}"`}
                </span>
              </div>
            )}

            <form onSubmit={handleSubmit}>
              {/* Unit Selector */}
              <div style={fieldWrap}>
                <label style={label}>
                  {isLocked ? 'Unit / Branch' : 'Select Your Unit / Branch *'}
                </label>
                <div style={{ position: 'relative' }}>
                  <Building2 size={14} strokeWidth={1.8} style={{ ...iconStyle, top: '50%' }} />
                  {isLocked ? (
                    <div style={{
                      ...inputStyle,
                      display: 'flex', alignItems: 'center',
                      cursor: 'not-allowed',
                      border: '1.5px solid #93c5fd',
                    }}>
                      <span style={{ flex: 1, fontSize: '13px', color: '#0f172a' }}>
                        {codeStatus === 'loading' ? 'Verifying…'
                          : codeStatus === 'valid'
                            ? `${lockedUnit?.name}${lockedUnit?.city ? ` — ${lockedUnit.city}` : ''}`
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
                        <option value="">{unitsLoading ? 'Loading units…' : '— Select your unit —'}</option>
                        <option value="global">— Central / Global Context —</option>
                        {units.map(u => (
                          <option key={u.id} value={u.id}>
                            {u.name}{u.city ? ` — ${u.city}` : ''}
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
                    onFocus={e => { e.target.style.borderColor = '#3b82f6'; e.target.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.12)'; e.target.style.background = '#fff'; }}
                    onBlur={e => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none'; e.target.style.background = '#f8fafc'; }}
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
                    placeholder="••••••••"
                    style={{ ...inputStyle, paddingRight: '38px' }}
                    onFocus={e => { e.target.style.borderColor = '#3b82f6'; e.target.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.12)'; e.target.style.background = '#fff'; }}
                    onBlur={e => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none'; e.target.style.background = '#f8fafc'; }}
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

              {/* Error message */}
              {error && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '10px 14px', borderRadius: '8px', marginBottom: '16px',
                  background: '#fef2f2', border: '1.5px solid #fca5a5', color: '#dc2626',
                  fontSize: '12px',
                }}>
                  <AlertCircle size={13} style={{ flexShrink: 0 }} />
                  {error}
                </div>
              )}

              {/* Submit button */}
              <button
                id="login-submit-btn"
                type="submit"
                disabled={isLoading || codeStatus === 'loading' || codeStatus === 'invalid'}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '10px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: 700,
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  opacity: (isLoading || codeStatus === 'loading' || codeStatus === 'invalid') ? 0.7 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 14px rgba(59,130,246,0.4)',
                  transition: 'opacity 150ms, transform 150ms',
                  fontFamily: 'Inter, system-ui, sans-serif',
                  letterSpacing: '0.02em',
                  marginBottom: '16px',
                }}
                onMouseEnter={e => { if (!isLoading) e.currentTarget.style.opacity = '0.92'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
              >
                {isLoading ? (
                  <>
                    <span className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin"
                      style={{ borderColor: 'rgba(255,255,255,0.4)', borderTopColor: 'white' }} />
                    Signing in...
                  </>
                ) : (
                  <>Sign In →</>
                )}
              </button>
            </form>

            {/* Security note */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px', marginTop: '4px' }}>
              <ShieldCheck size={11} style={{ color: '#94a3b8' }} />
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>Your data is protected and secure</span>
            </div>

            {/* Unit code link */}
            {isLocked && codeStatus !== 'invalid' && (
              <p style={{ textAlign: 'center', fontSize: '11px', color: '#94a3b8', marginTop: '14px' }}>
                Wrong unit?{' '}
                <a href="/login" style={{ color: '#3b82f6', textDecoration: 'underline' }}>
                  Choose a different unit
                </a>
              </p>
            )}
          </div>

          {/* Footer */}
          <p style={{ textAlign: 'center', fontSize: '11px', color: '#cbd5e1', marginTop: '24px', letterSpacing: '0.05em' }}>
            © {new Date().getFullYear()} SOBEIT TECHNOLOGY. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
