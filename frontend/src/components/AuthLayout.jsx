// frontend/src/components/AuthLayout.jsx
// Shared layout for the public auth pages (sign-in, first-time setup, password reset):
// a navy, government-style branding panel on the left (large screens) and a
// full-height white panel on the right. Small screens get a compact header instead.
import { Lock, ShieldCheck, QrCode, ClipboardCheck } from 'lucide-react';
import { NAVY_GRADIENT } from '../utils/authTheme';

/* -- Organisation shown on the auth pages (set per deployment in .env) ------ */
const ORG_NAME    = import.meta.env.VITE_ORG_NAME    || 'Odisha Hydro Power Corporation Ltd.';
const ORG_TAGLINE = import.meta.env.VITE_ORG_TAGLINE || 'A Government of Odisha Undertaking';

/* -- Thin saffron / white / green band used on Government of India portals -- */
export function TricolourStrip({ height = 4 }) {
  return (
    <div aria-hidden="true" style={{ display: 'flex', height }}>
      <span style={{ flex: 1, background: '#FF9933' }} />
      <span style={{ flex: 1, background: '#FFFFFF' }} />
      <span style={{ flex: 1, background: '#138808' }} />
    </div>
  );
}

const DEFAULT_DESCRIPTION = 'Secure, pre-approved and fully audited visitor access for offices, power houses and secured premises.';
const DEFAULT_FEATURES = [
  [ShieldCheck,    'Secure, role-based sign-in'],
  [QrCode,         'QR-coded gate passes'],
  [ClipboardCheck, 'Complete entry & exit audit trail'],
];

/* -- Left half (large screens only) ------------------------------------------ */
function BrandPanel({ eyebrow, title, description, features }) {
  return (
    <aside
      className="hidden lg:flex flex-col"
      style={{ width: '46%', maxWidth: '640px', flexShrink: 0, position: 'relative', overflow: 'hidden', background: NAVY_GRADIENT }}
    >
      <TricolourStrip />
      {/* faint dot texture */}
      <div aria-hidden="true" style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)', backgroundSize: '22px 22px',
      }} />

      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '40px 48px 32px' }}>
        {/* Organisation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <img src="/brand/vms-icon-white.png" alt=""
            style={{ width: '52px', height: '52px', objectFit: 'contain' }} />
          <div>
            <p style={{ fontSize: '15px', fontWeight: 700, color: '#ffffff', lineHeight: 1.25 }}>{ORG_NAME}</p>
            <p style={{ fontSize: '11.5px', color: '#9fb3d1', marginTop: '3px', letterSpacing: '0.04em' }}>{ORG_TAGLINE}</p>
          </div>
        </div>

        {/* System — the panel never scrolls; on short screens the illustration shrinks instead */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '40px 0 28px' }}>
          <p style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#f4b860' }}>
            {eyebrow}
          </p>
          <h1 style={{ fontSize: 'clamp(28px, 2.6vw, 38px)', fontWeight: 800, color: '#ffffff', lineHeight: 1.15, margin: '10px 0 12px' }}>
            {title}
          </h1>
          <p style={{ fontSize: '14px', color: '#b6c4da', lineHeight: 1.65, maxWidth: '440px' }}>
            {description}
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: '24px 0 0', display: 'grid', gap: '12px' }}>
            {features.map(([Icon, text]) => (
              <li key={text} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13.5px', color: '#dbe4f0' }}>
                <span style={{
                  width: '28px', height: '28px', borderRadius: '8px', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon size={14} color="#f4b860" strokeWidth={2} />
                </span>
                {text}
              </li>
            ))}
          </ul>
          <div style={{
            flex: '0 1 clamp(130px, 26vh, 240px)', minHeight: 0, marginTop: '32px',
            borderRadius: '14px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.14)',
          }}>
            <img src="/login-illustration.png" alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 62%', display: 'block' }} />
          </div>
        </div>

        {/* Notice */}
        <p style={{
          display: 'flex', alignItems: 'flex-start', gap: '8px', paddingTop: '18px',
          borderTop: '1px solid rgba(255,255,255,0.12)', fontSize: '11.5px', color: '#8ea3c2', lineHeight: 1.6,
        }}>
          <Lock size={12} style={{ flexShrink: 0, marginTop: '3px' }} />
          This is a restricted government system for authorised users only. All activity is logged and monitored.
        </p>
      </div>
    </aside>
  );
}

/**
 * Page shell for the auth pages.
 * @param {string}  [eyebrow, title, description] — left-panel text
 * @param {Array}   [features]  — [[Icon, text], …] for the left panel
 * @param {number}  [maxWidth]  — width of the right-hand form column (px)
 * @param {string}  [helpText]  — footer help line
 */
export default function AuthLayout({
  children,
  eyebrow     = 'Official Portal',
  title       = 'Visitor Management System',
  description = DEFAULT_DESCRIPTION,
  features    = DEFAULT_FEATURES,
  maxWidth    = 400,
  helpText    = 'Need help signing in? Contact your unit administrator.',
}) {
  return (
    // Fixed to the viewport height so only the right-hand panel scrolls
    <div className="h-dvh" style={{ display: 'flex', overflow: 'hidden', fontFamily: 'Inter, system-ui, sans-serif', background: '#ffffff' }}>
      <BrandPanel eyebrow={eyebrow} title={title} description={description} features={features} />

      {/* Right: full-height form panel (the scroll container) */}
      <main style={{ flex: 1, minWidth: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', background: '#ffffff' }}>
        {/* Compact brand header — replaces the left panel on small screens */}
        <div className="lg:hidden" style={{ background: NAVY_GRADIENT }}>
          <TricolourStrip height={3} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 16px' }}>
            <img src="/brand/vms-icon-white.png" alt=""
              style={{ width: '36px', height: '36px', objectFit: 'contain' }} />
            <div>
              <p style={{ color: '#ffffff', fontWeight: 700, fontSize: '13.5px', lineHeight: 1.2 }}>Visitor Management System</p>
              <p style={{ color: '#9fb3d1', fontSize: '11px', marginTop: '2px' }}>{ORG_NAME}</p>
            </div>
          </div>
        </div>

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'clamp(28px, 6vh, 64px) 24px' }}>
          <div style={{ width: '100%', maxWidth: `${maxWidth}px` }}>
            {/* Product wordmark above the form (small screens show the navy header instead) */}
            <img src="/brand/vms-logo-blue.png" alt="OHPC VMS" className="hidden lg:block"
              style={{ height: '34px', width: 'auto', marginBottom: '28px' }} />
            {children}
          </div>
        </div>

        <footer style={{
          padding: '14px 24px', borderTop: '1px solid #eef2f7',
          display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '6px 16px',
          fontSize: '11.5px', color: '#94a3b8',
        }}>
          <span>{helpText}</span>
          <span>&copy; {new Date().getFullYear()} Sobeit Technology Pvt. Ltd.</span>
        </footer>
      </main>
    </div>
  );
}
