// frontend/src/utils/authTheme.js
// Colours and form styles shared by the public auth pages (sign-in, first-time
// setup, password reset). Always light, whatever the app theme. The page shell
// itself is components/AuthLayout.jsx.

export const NAVY          = '#13315c';
export const NAVY_GRADIENT = 'linear-gradient(165deg, #0b2545 0%, #13315c 55%, #1b4079 100%)';

export const authStyles = {
  label:  { display: 'block', fontSize: '13px', fontWeight: 600, color: '#1e3a8a', marginBottom: '6px' },
  input:  {
    width: '100%', padding: '10px 12px 10px 38px', borderRadius: '8px', border: '1.5px solid #e2e8f0',
    fontSize: '13px', color: '#0f172a', background: '#f8fafc', outline: 'none',
    transition: 'border-color 150ms, box-shadow 150ms', fontFamily: 'Inter, system-ui, sans-serif',
  },
  icon:   { position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' },
  primaryButton: {
    width: '100%', padding: '12px', borderRadius: '10px', border: 'none', background: NAVY, color: '#ffffff',
    fontSize: '14px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
    boxShadow: '0 4px 14px rgba(19,49,92,0.25)', fontFamily: 'Inter, system-ui, sans-serif', letterSpacing: '0.02em',
  },
};
