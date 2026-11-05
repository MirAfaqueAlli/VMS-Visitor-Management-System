// frontend/src/components/AuthLayout.jsx
// Shared layout for the public auth pages (sign-in, first-time setup, password reset):
// a flat navy, government-style branding panel on the left (large screens) and a
// full-height white panel on the right. Small screens get a compact header instead.
// Always light (data-theme="light"), flat — no gradients or shadows.
import { Lock, ShieldCheck, QrCode, ClipboardCheck } from './icons';
import { NAVY } from '../utils/authTheme';
import BrandLogo from './BrandLogo';

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
const DEFAULT_NOTICE = 'This is a restricted government system for authorised users only. All activity is logged and monitored.';
const DEFAULT_FEATURES = [
  [ShieldCheck,    'Secure, role-based sign-in'],
  [QrCode,         'QR-coded gate passes'],
  [ClipboardCheck, 'Complete entry and exit audit trail'],
];

/* -- Left half (large screens only) ------------------------------------------ */
function BrandPanel({ eyebrow, title, description, features, notice }) {
  return (
    <aside className="hidden lg:flex flex-col relative overflow-hidden shrink-0"
      style={{ width: '46%', maxWidth: 640, background: NAVY }}>
      <TricolourStrip />

      <div className="relative flex-1 min-h-0 flex flex-col px-12 pt-10 pb-8">
        {/* Organisation */}
        <div className="flex items-center gap-3.5">
          <img src="/brand/ohpc-emblem-white.svg" alt="OHPC" className="h-12 w-auto" />
          <div>
            <p className="text-[15px] font-semibold text-white leading-tight">{ORG_NAME}</p>
            <p className="text-[11.5px] mt-0.5 tracking-[0.03em]" style={{ color: '#a9bad3' }}>{ORG_TAGLINE}</p>
          </div>
        </div>

        {/* System — the panel never scrolls; on short screens the illustration shrinks instead */}
        <div className="flex-1 min-h-0 flex flex-col justify-center pt-10 pb-7">
          <p className="text-[11px] font-semibold tracking-[0.16em] uppercase" style={{ color: '#f4b860' }}>
            {eyebrow}
          </p>
          <h1 className="text-white font-semibold leading-[1.15] mt-2.5 mb-3" style={{ fontSize: 'clamp(26px, 2.4vw, 34px)' }}>
            {title}
          </h1>
          <p className="text-[13.5px] leading-relaxed max-w-[440px]" style={{ color: '#c3cfe0' }}>
            {description}
          </p>
          <ul className="mt-6 grid gap-2.5">
            {features.map(([Icon, text]) => (
              <li key={text} className="flex items-center gap-2.5 text-[13px]" style={{ color: '#dbe4f0' }}>
                <Icon size={16} color="#f4b860" />
                {text}
              </li>
            ))}
          </ul>
          <div className="mt-8 min-h-0 rounded-[14px] overflow-hidden border"
            style={{ flex: '0 1 clamp(130px, 26vh, 240px)', borderColor: 'rgba(255,255,255,0.14)' }}>
            <img src="/login-illustration.png" alt=""
              className="w-full h-full object-cover block" style={{ objectPosition: 'center 62%' }} />
          </div>
        </div>

        {/* Notice */}
        <p className="flex items-start gap-2 pt-4 text-[11.5px] leading-relaxed border-t"
          style={{ borderColor: 'rgba(255,255,255,0.12)', color: '#9db0cb' }}>
          <Lock size={12} className="shrink-0 mt-[3px]" />
          {notice}
        </p>
      </div>
    </aside>
  );
}

/**
 * Page shell for the auth pages.
 * @param {string}  [eyebrow, title, description] — left-panel text
 * @param {Array}   [features]  — [[Icon, text], …] for the left panel
 * @param {string}  [notice]    — the line at the foot of the left panel
 * @param {string}  [product]   — product name in the small-screen header
 * @param {number}  [maxWidth]  — width of the right-hand form column (px)
 * @param {string}  [helpText]  — footer help line
 */
export default function AuthLayout({
  children,
  eyebrow     = 'Official portal',
  title       = 'Visitor Management System',
  description = DEFAULT_DESCRIPTION,
  features    = DEFAULT_FEATURES,
  notice      = DEFAULT_NOTICE,
  product     = 'Visitor Management System',
  maxWidth    = 400,
  helpText    = 'Need help signing in? Contact your unit administrator.',
}) {
  return (
    // Fixed to the viewport height so only the right-hand panel scrolls
    // Controls are a touch taller here (36px) — a sign-in form, not a dense table page
    <div data-theme="light" className="h-dvh flex overflow-hidden bg-surface text-ink" style={{ '--control-h': '36px' }}>
      <BrandPanel eyebrow={eyebrow} title={title} description={description} features={features} notice={notice} />

      {/* Right: full-height form panel (the scroll container) */}
      <main className="flex-1 min-w-0 overflow-y-auto flex flex-col bg-surface">
        {/* Compact brand header — replaces the left panel on small screens: the original
            (light) OHPC logo on white, with the product name beside it */}
        <div className="lg:hidden bg-surface border-b border-line">
          <TricolourStrip height={3} />
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <img src="/brand/ohpc-logo.svg" alt={ORG_NAME} className="h-8 sm:h-9 w-auto max-w-[66%] object-contain object-left" />
            <span className="min-w-0 max-w-[34%] text-[10.5px] font-semibold uppercase tracking-[0.08em] text-right leading-snug" style={{ color: NAVY }}>
              {product}
            </span>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center px-6" style={{ paddingTop: 'clamp(28px, 6vh, 64px)', paddingBottom: 'clamp(28px, 6vh, 64px)' }}>
          <div className="w-full" style={{ maxWidth }}>
            {/* Product wordmark above the form (small screens show the navy header instead) */}
            <div className="hidden lg:block mb-7"><BrandLogo height={36} /></div>
            {children}
          </div>
        </div>

        <footer className="px-6 py-3.5 border-t border-line flex flex-wrap justify-between gap-x-4 gap-y-1.5 text-[11.5px] text-muted">
          <span>{helpText}</span>
          <span>&copy; {new Date().getFullYear()} Sobeit Technology Pvt. Ltd.</span>
        </footer>
      </main>
    </div>
  );
}
