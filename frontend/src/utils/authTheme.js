// frontend/src/utils/authTheme.js
// Colours and form styles shared by the public auth pages (sign-in, first-time
// setup, password reset). Always light: AuthLayout sets data-theme="light", so
// the design tokens below resolve to their light values. Flat — no gradients,
// no shadows (DESIGN_RULES). The page shell itself is components/AuthLayout.jsx.

export const NAVY          = '#13315c';
/** Kept for older imports — the brand panel is now a flat navy fill. */
export const NAVY_GRADIENT = NAVY;

export const authStyles = {
  label:  { display: 'block', fontSize: '12px', fontWeight: 560, color: 'var(--ink-2)', marginBottom: '4px' },
  input:  {
    width: '100%', height: '36px', padding: '0 10px 0 34px', borderRadius: 'var(--radius)',
    border: '1px solid var(--line-strong)', fontSize: '13px', color: 'var(--ink)', background: 'var(--surface)',
    outline: 'none', transition: 'border-color 150ms', fontFamily: 'var(--font-ui)',
  },
  icon:   { position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' },
  primaryButton: {
    width: '100%', height: '36px', padding: '0 14px', borderRadius: 'var(--radius)', border: 'none',
    background: 'var(--primary-strong)', color: '#ffffff', fontSize: '13px', fontWeight: 560,
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontFamily: 'var(--font-ui)',
  },
};
