// frontend/src/components/PublicShell.jsx
// Page frame for the public visitor pages (visitor portal, visit request form):
// OHPC letterhead with the tricolour band, canvas background, footer. Also the
// small inputs those pages share (OTP code, +91 mobile number).
import BrandLogo from "./BrandLogo";
import { ShieldCheck, LogOut } from "./icons";

/* ── Tricolour top band (government identity) ─────────────────────────────── */
function TricolourBand() {
  return (
    <div aria-hidden="true" className="w-full flex h-[3px]">
      <span className="flex-1 bg-[#FF9933]" />
      <span className="flex-1 bg-white" />
      <span className="flex-1 bg-[#138808]" />
    </div>
  );
}

/* ── Header: brand on the left; the signed-in visitor (or a security note) on the right ── */
function HeaderBar({ account, onSignOut }) {
  return (
    <header className="w-full bg-surface border-b border-line sticky top-0 z-30">
      <TricolourBand />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <BrandLogo height={30} />
          <div className="h-6 w-px bg-line hidden sm:block" />
          <div className="hidden sm:block min-w-0">
            <p className="text-[13px] font-semibold text-ink leading-tight">Visitor portal</p>
            <p className="text-[11.5px] text-muted truncate">Odisha Hydro Power Corporation Ltd.</p>
          </div>
        </div>
        {account ? (
          <div className="flex items-center gap-2 min-w-0">
            <div className="text-right min-w-0 hidden sm:block">
              <p className="text-[12.5px] font-medium text-ink truncate">{account.full_name}</p>
              <p className="text-[11px] text-muted tabular">+91 {account.phone}</p>
            </div>
            <button type="button" onClick={onSignOut} className="btn-ghost btn-sm" title="Sign out">
              <LogOut size={14} /> <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-[12px] text-muted">
            <ShieldCheck size={15} className="text-success" />
            <span className="hidden sm:inline">Secure connection</span>
          </div>
        )}
      </div>
    </header>
  );
}

/** Whole page: header, content column, footer. */
export default function PublicShell({ children, account, onSignOut }) {
  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col">

      <HeaderBar account={account} onSignOut={onSignOut} />

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {children}
      </main>

      <footer className="w-full border-t border-line py-4 px-4 text-center text-[11.5px] text-muted">
        © {new Date().getFullYear()} Odisha Hydro Power Corporation Ltd. · Visitor Management System
      </footer>
    </div>
  );
}

/* ── 6-digit code input ──────────────────────────────────────────────────── */
export function OtpField({ value, onChange, disabled, placeholder = "• • • • • •", label = "6-digit code", autoFocus }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={label}
      className="control !h-11 text-center text-[20px] tracking-[0.5em] mono font-semibold"
    />
  );
}

/* ── +91 mobile number input ─────────────────────────────────────────────── */
export function PhoneInput({ id, value, onChange, autoFocus, placeholder = "98765 43210", disabled }) {
  return (
    <div className="relative">
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-muted pointer-events-none">+91</span>
      <input
        id={id}
        type="tel"
        required
        autoFocus={autoFocus}
        disabled={disabled}
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 10))}
        placeholder={placeholder}
        maxLength={10}
        className="control tabular pl-10"
      />
    </div>
  );
}
