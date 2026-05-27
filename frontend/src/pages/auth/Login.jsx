// frontend/src/pages/auth/Login.jsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Mail, Lock, Eye, EyeOff, Building2, ChevronDown } from 'lucide-react';
import useAuth from '../../hooks/useAuth';
import apiClient from '../../api/axios';

export default function Login() {
  const { login }  = useAuth();
  const navigate   = useNavigate();

  const [email,        setEmail]        = useState('');
  const [password,     setPassword]     = useState('');
  const [unitId,       setUnitId]       = useState('');     // selected unit ID from dropdown
  const [units,        setUnits]        = useState([]);      // dropdown options
  const [unitsLoading, setUnitsLoading] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading,    setIsLoading]    = useState(false);
  const [error,        setError]        = useState('');

  // Check if system needs first-time setup — redirect if not initialized
  useEffect(() => {
    apiClient.get('/setup/status')
      .then(res => { if (!res.data?.initialized) navigate('/setup', { replace: true }); })
      .catch(() => {}); // ignore errors — stay on login
  }, []);

  // Fetch all active units on mount
  useEffect(() => {
    apiClient.get('/units/public')
      .then(res => setUnits(res.data?.data ?? []))
      .catch(() => setUnits([]))
      .finally(() => setUnitsLoading(false));
  }, []);

  const selectedUnit = units.find(u => String(u.id) === String(unitId));
  const isGlobalContext = unitId === 'global';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!isGlobalContext && !unitId) {
      setError('Please select your unit / branch first.');
      return;
    }

    setIsLoading(true);
    try {
      // Pass unit_id for unit login, or nothing for Central / Global Context
      await login(email, password, isGlobalContext ? '' : unitId);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      const msg = err?.response?.data?.message || 'Invalid credentials. Please try again.';
      // If global context is chosen but backend can't find the account in central DB
      if (isGlobalContext && msg.toLowerCase().includes('select your unit')) {
        setError('This account does not have Central / Global access. Please sign in using your regular unit.');
      } else {
        setError(msg);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const inputBase = {
    background:   'var(--color-bg-primary)',
    border:       '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    color:        'var(--color-text)',
    fontSize:     '13px',
    padding:      '0.5rem 0.75rem 0.5rem 2rem',
    width:        '100%',
    outline:      'none',
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'var(--color-bg-primary)' }}
    >
      <div
        className="w-full max-w-sm"
        style={{
          background:   'var(--color-bg-secondary)',
          border:       '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          boxShadow:    'var(--shadow-card)',
          padding:      '1.75rem',
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 mb-6">
          <div
            className="w-8 h-8 flex items-center justify-center"
            style={{ background: 'var(--color-accent)', borderRadius: 'var(--radius-sm)' }}
          >
            <Shield size={16} style={{ color: '#0f172a' }} strokeWidth={2.2} />
          </div>
          <div>
            <p className="font-bold text-[14px] leading-none" style={{ color: 'var(--color-text)' }}>VMS</p>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-faint)' }}>Visitor Management System</p>
          </div>
        </div>

        {/* Header */}
        <div className="mb-5">
          <h2 className="text-[15px] font-semibold" style={{ color: 'var(--color-text)' }}>
            Sign In
          </h2>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--color-text-faint)' }}>
            {isGlobalContext
              ? 'Central / Global System access'
              : selectedUnit
                ? `Signing in to: ${selectedUnit.name}`
                : 'Select your unit to continue'}
          </p>
        </div>

        <form className="space-y-3.5" onSubmit={handleSubmit}>

          {/* ── Unit Selector ────────────────────────────────────────────────── */}
          <div>
            <label
              className="block text-[11px] font-medium mb-1.5"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Select Your Unit / Branch *
            </label>
            <div className="relative">
              <Building2
                size={13} strokeWidth={1.8}
                className="absolute left-2.5 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--color-text-faint)' }}
              />
              <select
                id="login-unit-select"
                value={unitId}
                onChange={e => { setUnitId(e.target.value); setError(''); }}
                disabled={unitsLoading}
                style={{
                  ...inputBase,
                  paddingRight: '2rem',
                  appearance: 'none',
                  cursor: unitsLoading ? 'wait' : 'pointer',
                }}
              >
                <option value="">
                  {unitsLoading ? 'Loading units…' : '— Select your unit —'}
                </option>
                <option value="global">— Central / Global Context —</option>
                {units.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.name}{u.city ? ` — ${u.city}` : ''}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={13} strokeWidth={1.8}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'var(--color-text-faint)' }}
              />
            </div>
            {isGlobalContext && (
              <div
                className="px-3 py-2 text-[11px] rounded flex items-center gap-2 mt-2 animate-fade-in"
                style={{
                  background:   'var(--color-info-bg)',
                  border:       '1px solid var(--color-info)',
                  color:        'var(--color-info)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                <Shield size={12} />
                <span>Access Central / Global account (Super Admins & Global Auditors)</span>
              </div>
            )}
          </div>

          {/* Email */}
          <div>
            <label
              className="block text-[11px] font-medium mb-1.5"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Email address
            </label>
            <div className="relative">
              <Mail size={13} strokeWidth={1.8} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-faint)' }} />
              <input
                id="login-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="vms-input pl-8"
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label
              className="block text-[11px] font-medium mb-1.5"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Password
            </label>
            <div className="relative">
              <Lock size={13} strokeWidth={1.8} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-faint)' }} />
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="vms-input pl-8 pr-8"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword(p => !p)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-colors"
                style={{ color: 'var(--color-text-faint)' }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--color-text)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-faint)'}
              >
                {showPassword ? <EyeOff size={13} strokeWidth={1.8} /> : <Eye size={13} strokeWidth={1.8} />}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div
              className="px-3 py-2 text-[12px]"
              style={{
                background:   'var(--color-danger-bg, #fef2f2)',
                border:       '1px solid #fecaca',
                borderRadius: 'var(--radius-sm)',
                color:        'var(--color-error, #dc2626)',
              }}
            >
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            id="login-submit-btn"
            type="submit"
            disabled={isLoading}
            className="btn-primary w-full justify-center"
            style={{ marginTop: '0.25rem' }}
          >
            {isLoading ? (
              <span className="flex items-center gap-1.5">
                <span
                  className="w-3.5 h-3.5 rounded-full border-2 border-t-transparent animate-spin"
                  style={{ borderColor: 'rgba(15,23,42,0.2)', borderTopColor: '#0f172a' }}
                />
                Signing in...
              </span>
            ) : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-[10px] uppercase tracking-widest mt-5" style={{ color: 'var(--color-text-faint)' }}>
          © {new Date().getFullYear()} SOBEIT Technology
        </p>
      </div>
    </div>
  );
}
