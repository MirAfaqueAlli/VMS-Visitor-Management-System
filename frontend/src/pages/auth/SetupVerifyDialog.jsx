// frontend/src/pages/auth/SetupVerifyDialog.jsx
// Pop-up opened by "Complete setup": the super administrator's email address and
// mobile number must each be confirmed with a one-time code before setup runs.
// The codes are sent (and checked) by hooks/useSetupVerification.js.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Mail, Smartphone, X, CheckCircle2, AlertCircle, Loader2, Lock } from "../../components/icons";
import { NAVY } from "../../utils/authTheme";
import { State, Note } from "../../components/ui";

const CODE_LENGTH  = 6;
const formatMobile = (n) => `+91 ${n.slice(0, 5)} ${n.slice(5)}`;
const formatWait   = (s) => `0:${String(s).padStart(2, "0")}`;

/* -- Header artwork: phone with a code message, envelope and a verified shield */
function VerifyIllustration() {
  return (
    <svg viewBox="0 0 260 120" width="230" height="106" aria-hidden="true" style={{ display: "block", margin: "0 auto" }}>
      <circle cx="130" cy="62" r="58" fill="#ffffff" opacity="0.55" />
      <circle cx="130" cy="62" r="40" fill="#ffffff" opacity="0.7" />
      <circle cx="58"  cy="84" r="3"   fill="#f4b860" opacity="0.85" />
      <circle cx="52"  cy="26" r="2"   fill="#9fb3d1" opacity="0.7" />
      <circle cx="226" cy="94" r="2.5" fill="#9fb3d1" opacity="0.7" />
      <circle cx="214" cy="18" r="2"   fill="#f4b860" opacity="0.7" />

      {/* Floating code bubble */}
      <rect x="34" y="40" width="50" height="20" rx="10" fill="#13315c" opacity="0.12" />
      {[0, 1, 2, 3].map((i) => <circle key={i} cx={47 + i * 8} cy="50" r="2" fill="#13315c" opacity="0.55" />)}

      {/* Phone */}
      <rect x="92" y="10" width="56" height="100" rx="10" fill="#dbe5f3" />
      <rect x="97" y="20" width="46" height="80" rx="5" fill="#ffffff" />
      <rect x="112" y="14" width="16" height="2.5" rx="1.25" fill="#9fb3d1" />
      <rect x="102" y="38" width="36" height="15" rx="5" fill={NAVY} />
      {Array.from({ length: CODE_LENGTH }, (_, i) => <circle key={i} cx={107.5 + i * 5} cy="45.5" r="1.6" fill="#ffffff" />)}
      <rect x="102" y="61" width="30" height="3" rx="1.5" fill="#e2e8f0" />
      <rect x="102" y="69" width="22" height="3" rx="1.5" fill="#e2e8f0" />
      <rect x="102" y="83" width="36" height="9" rx="4.5" fill="#f4b860" />

      {/* Envelope */}
      <rect x="138" y="50" width="64" height="42" rx="6" fill="#ffffff" stroke="#c7d4e8" />
      <path d="M140 54 L170 75 L200 54" fill="none" stroke="#c7d4e8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

      {/* Verified shield */}
      <circle cx="201" cy="46" r="17" fill="#f4b860" />
      <path d="M201 34.5 l9 3.5 v7 c0 6 -4 10.5 -9 12.5 c-5 -2 -9 -6.5 -9 -12.5 v-7 z" fill="#ffffff" />
      <path d="M196.5 46 l3.2 3.2 l6 -6.2" fill="none" stroke="#e39a2d" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Six digit boxes backed by one real (invisible) input, so typing, backspace,
 * paste and SMS autofill all behave natively.
 */
function OtpBoxes({ value, onChange, disabled, invalid, autoFocus, label }) {
  const [focused, setFocused] = useState(false);
  const active = Math.min(value.length, CODE_LENGTH - 1);
  // Keep the caret at the end: digits are always entered left to right
  const caretToEnd = (e) => { const n = e.target.value.length; e.target.setSelectionRange(n, n); };

  return (
    <div className="relative grid gap-2" style={{ gridTemplateColumns: `repeat(${CODE_LENGTH}, 1fr)` }}>
      {Array.from({ length: CODE_LENGTH }, (_, i) => {
        const isActive = focused && !disabled && i === active;
        const filled   = !!value[i];
        const border = invalid ? "var(--danger)" : isActive ? "var(--primary)" : filled ? "var(--ink-2)" : "var(--line-strong)";
        return (
          <div key={i} aria-hidden="true"
            className="h-11 rounded flex items-center justify-center text-[19px] font-semibold tabular text-ink transition-colors"
            style={{
              background: disabled ? "var(--surface-alt)" : "var(--surface)",
              border: `1px solid ${border}`,
              outline: isActive ? "2px solid color-mix(in srgb, var(--primary) 25%, transparent)" : "none",
            }}>
            {value[i] || (isActive && <span className="animate-pulse w-[2px] h-5 rounded-sm bg-primary" />)}
          </div>
        );
      })}
      <input
        type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={CODE_LENGTH}
        value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))}
        onFocus={(e) => { setFocused(true); caretToEnd(e); }} onBlur={() => setFocused(false)}
        onClick={caretToEnd} onKeyUp={caretToEnd}
        disabled={disabled} autoFocus={autoFocus} aria-label={label} aria-invalid={invalid}
        className="absolute inset-0 w-full h-full opacity-0"
        style={{ fontSize: "16px", cursor: disabled ? "not-allowed" : "text" }}   // 16px stops iOS zooming in
      />
    </div>
  );
}

const STATUS_CHIP = {
  sending:   { text: "Sending…",  tone: "neutral" },
  sent:      { text: "Code sent", tone: "brand" },
  verifying: { text: "Checking…", tone: "neutral" },
  verified:  { text: "Verified",  tone: "success" },
  idle:      { text: "Not sent",  tone: "danger" },
};

/* -- One detail to verify (email or mobile) ---------------------------------- */
function ContactSection({ icon: Icon, title, target, state, code, onCode, onResend, error, autoFocus }) {
  const verified = state.status === "verified";
  const working  = state.status === "sending" || state.status === "verifying";
  const waiting  = state.wait > 0 && state.status !== "idle";   // after a failed send there's nothing to wait for
  const chip     = STATUS_CHIP[state.status];

  return (
    <section>
      <div className={`flex items-center gap-3 ${verified ? "" : "mb-2.5"}`}>
        <Icon size={18} className="text-muted shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="group-heading">{title}</p>
          <p className="text-[13px] font-medium text-ink truncate">{target}</p>
        </div>
        <span className="shrink-0 inline-flex items-center gap-1.5">
          {working && <Loader2 size={12} className="animate-spin text-muted" />}
          <State tone={chip.tone}>{chip.text}</State>
        </span>
      </div>

      {!verified && (
        <>
          <OtpBoxes
            value={code} onChange={onCode} disabled={working} invalid={!!error}
            autoFocus={autoFocus} label={`${title} verification code`}
          />
          {error && (
            <p role="alert" className="field-error flex items-start gap-1.5 !text-[12px]">
              <AlertCircle size={13} className="shrink-0 mt-px" /> {error}
            </p>
          )}
          {state.devCode && (
            <Note tone="warning" className="mt-2">
              Development only: the email could not be sent. Code <span className="mono font-semibold">{state.devCode}</span>
            </Note>
          )}
          {state.devNote && (
            <Note tone="warning" className="mt-2">Development mode: no SMS is sent. The code is in the backend console.</Note>
          )}
          <p className="mt-2 text-[12px] text-muted">
            No code?{" "}
            {waiting ? (
              <span className="tabular">Resend in {formatWait(state.wait)}</span>
            ) : (
              <button type="button" onClick={onResend} disabled={working} className="text-link font-medium disabled:text-muted">
                Resend code
              </button>
            )}
          </p>
        </>
      )}
    </section>
  );
}

/**
 * @param {string}   email, mobile   — the details being verified (mobile = 10 digits)
 * @param {object}   verification    — useSetupVerification()
 * @param {boolean}  submitting      — setup request in flight
 * @param {Function} onComplete      — ({ emailToken, phoneToken }) once both are verified
 * @param {Function} onClose
 */
export default function SetupVerifyDialog({ email, mobile, verification, submitting, onComplete, onClose }) {
  const [codes,      setCodes]      = useState({ email: "", phone: "" });
  const [codeErrors, setCodeErrors] = useState({});
  const { email: emailState, phone: phoneState } = verification;

  const verifying = emailState.status === "verifying" || phoneState.status === "verifying";
  const busy      = submitting || verifying;
  const bothDone  = emailState.status === "verified" && phoneState.status === "verified";

  // Escape closes (but not while a request is in flight)
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const setCode = (channel) => (value) => {
    setCodes((c) => ({ ...c, [channel]: value }));
    setCodeErrors((e) => ({ ...e, [channel]: "" }));
  };

  const resend = (channel) => () => {
    setCode(channel)("");
    verification.resend(channel);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const missing = {};
    if (emailState.status !== "verified" && codes.email.length !== CODE_LENGTH) missing.email = "Enter the 6-digit code from the email.";
    if (phoneState.status !== "verified" && codes.phone.length !== CODE_LENGTH) missing.phone = "Enter the 6-digit code from the SMS.";
    setCodeErrors(missing);
    if (missing.email || missing.phone) return;

    // Check both (even if the first is wrong) so each shows its own result
    const emailToken = emailState.token ?? await verification.verifyEmail(codes.email);
    const phoneToken = phoneState.token ?? await verification.verifyPhone(codes.phone);
    if (emailToken && phoneToken) onComplete({ emailToken, phoneToken });
  };

  return createPortal(
    <div data-theme="light" style={{ '--control-h': '36px' }}>
      <div className="overlay" aria-hidden="true" />
      <form
        role="dialog" aria-modal="true" aria-labelledby="setup-verify-title"
        onSubmit={handleSubmit} noValidate
        className="modal text-ink !p-0" style={{ "--modal-w": "480px" }}
      >
        {/* ── Upper part: artwork and title ── */}
        <div className="relative bg-tile px-6 pt-6 pb-5 text-center">
          <button
            type="button" onClick={onClose} disabled={busy} aria-label="Close" title="Close"
            className="btn-icon absolute top-3 right-3"
          >
            <X size={16} />
          </button>
          <VerifyIllustration />
          <p className="group-heading mt-3">Final step</p>
          <h2 id="setup-verify-title" className="text-[16px] font-semibold text-ink mt-0.5">Confirm your email and mobile</h2>
          <p className="text-[12.5px] text-muted mt-0.5">Enter the 6-digit codes we sent to each.</p>
        </div>

        {/* ── Lower part: the codes ── */}
        <div className="px-6 pt-5">
          <ContactSection
            icon={Mail} title="Email address" target={email} state={emailState}
            code={codes.email} onCode={setCode("email")} onResend={resend("email")}
            error={codeErrors.email || emailState.error}
            autoFocus={emailState.status !== "verified"}
          />
          <hr className="divider my-5" />
          <ContactSection
            icon={Smartphone} title="Mobile number" target={formatMobile(mobile)} state={phoneState}
            code={codes.phone} onCode={setCode("phone")} onResend={resend("phone")}
            error={codeErrors.phone || phoneState.error}
            autoFocus={emailState.status === "verified" && phoneState.status !== "verified"}
          />
        </div>

        <div className="px-6 pt-5 pb-6">
          <button type="submit" disabled={busy} className="btn-primary w-full">
            {submitting ? <><Loader2 size={14} className="animate-spin" /> Setting up…</>
              : verifying ? <><Loader2 size={14} className="animate-spin" /> Verifying…</>
              : <><CheckCircle2 size={14} /> {bothDone ? "Complete setup" : "Verify and complete setup"}</>}
          </button>
          <div className="flex flex-wrap items-center justify-between gap-2 mt-3 text-[11.5px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <Lock size={11} /> Codes expire in 10 minutes. Never share them.
            </span>
            <button type="button" onClick={onClose} disabled={busy} className="text-link font-medium text-[12px]">
              Edit details
            </button>
          </div>
        </div>
      </form>
    </div>,
    document.body,
  );
}
