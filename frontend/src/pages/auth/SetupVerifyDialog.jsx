// frontend/src/pages/auth/SetupVerifyDialog.jsx
// Pop-up opened by "Complete setup": the super administrator's email address and
// mobile number must each be confirmed with a one-time code before setup runs.
// The codes are sent (and checked) by hooks/useSetupVerification.js.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Mail, Smartphone, X, CheckCircle2, AlertCircle, Loader2, Lock } from "lucide-react";
import { TricolourStrip } from "../../components/AuthLayout";
import { authStyles, NAVY, NAVY_GRADIENT } from "../../utils/authTheme";

const CODE_LENGTH  = 6;
const formatMobile = (n) => `+91 ${n.slice(0, 5)} ${n.slice(5)}`;
const formatWait   = (s) => `0:${String(s).padStart(2, "0")}`;

/* -- Header artwork: phone with a code message, envelope and a verified shield */
function VerifyIllustration() {
  return (
    <svg viewBox="0 0 260 120" width="230" height="106" aria-hidden="true" style={{ display: "block", margin: "0 auto" }}>
      <circle cx="130" cy="62" r="58" fill="#ffffff" opacity="0.05" />
      <circle cx="130" cy="62" r="40" fill="#ffffff" opacity="0.06" />
      <circle cx="58"  cy="84" r="3"   fill="#f4b860" opacity="0.85" />
      <circle cx="52"  cy="26" r="2"   fill="#ffffff" opacity="0.45" />
      <circle cx="226" cy="94" r="2.5" fill="#ffffff" opacity="0.45" />
      <circle cx="214" cy="18" r="2"   fill="#f4b860" opacity="0.7" />

      {/* Floating code bubble */}
      <rect x="34" y="40" width="50" height="20" rx="10" fill="#ffffff" opacity="0.14" />
      {[0, 1, 2, 3].map((i) => <circle key={i} cx={47 + i * 8} cy="50" r="2" fill="#ffffff" opacity="0.8" />)}

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
      <rect x="141" y="54" width="64" height="42" rx="6" fill="#0b2545" opacity="0.25" />
      <rect x="138" y="50" width="64" height="42" rx="6" fill="#ffffff" />
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
    <div style={{ position: "relative", display: "grid", gridTemplateColumns: `repeat(${CODE_LENGTH}, 1fr)`, gap: "8px" }}>
      {Array.from({ length: CODE_LENGTH }, (_, i) => {
        const isActive = focused && !disabled && i === active;
        const filled   = !!value[i];
        return (
          <div key={i} aria-hidden="true" style={{
            height: "48px", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "20px", fontWeight: 700, color: "#0f172a", fontVariantNumeric: "tabular-nums",
            background: disabled ? "#f1f5f9" : filled || isActive ? "#ffffff" : "#f8fafc",
            border: `1.5px solid ${invalid ? "#f87171" : isActive ? "#3b82f6" : filled ? "#94a3b8" : "#e2e8f0"}`,
            boxShadow: isActive ? "0 0 0 3px rgba(59,130,246,0.15)" : "none",
            transition: "border-color 120ms, box-shadow 120ms, background 120ms",
          }}>
            {value[i] || (isActive && <span className="animate-pulse" style={{ width: "2px", height: "20px", borderRadius: "1px", background: "#3b82f6" }} />)}
          </div>
        );
      })}
      <input
        type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={CODE_LENGTH}
        value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))}
        onFocus={(e) => { setFocused(true); caretToEnd(e); }} onBlur={() => setFocused(false)}
        onClick={caretToEnd} onKeyUp={caretToEnd}
        disabled={disabled} autoFocus={autoFocus} aria-label={label} aria-invalid={invalid}
        style={{
          position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0,
          fontSize: "16px", cursor: disabled ? "not-allowed" : "text",   // 16px stops iOS zooming in
        }}
      />
    </div>
  );
}

const STATUS_CHIP = {
  sending:   { text: "Sending…",  color: "#475569", bg: "#f1f5f9" },
  sent:      { text: "Code sent", color: "#1d4ed8", bg: "#eff6ff" },
  verifying: { text: "Checking…", color: "#475569", bg: "#f1f5f9" },
  verified:  { text: "Verified",  color: "#15803d", bg: "#dcfce7" },
  idle:      { text: "Not sent",  color: "#b91c1c", bg: "#fef2f2" },
};

/* -- One detail to verify (email or mobile) ---------------------------------- */
function ContactSection({ icon: Icon, title, target, state, code, onCode, onResend, error, autoFocus }) {
  const verified = state.status === "verified";
  const working  = state.status === "sending" || state.status === "verifying";
  const waiting  = state.wait > 0 && state.status !== "idle";   // after a failed send there's nothing to wait for
  const chip     = STATUS_CHIP[state.status];

  return (
    <section>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: verified ? 0 : "12px" }}>
      
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#64748b", margin: 0 }}>
            {title}
          </p>
          <p style={{ fontSize: "13.5px", fontWeight: 600, color: "#0f172a", margin: "2px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {target}
          </p>
        </div>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: "4px", flexShrink: 0,
          padding: "3px 9px", borderRadius: "999px", fontSize: "11px", fontWeight: 700,
          color: chip.color,
        }}>
          {working  && <Loader2 size={11} className="animate-spin" />}
          {verified && <CheckCircle2 size={12} />}
          {chip.text}
        </span>
      </div>

      {!verified && (
        <>
          <OtpBoxes
            value={code} onChange={onCode} disabled={working} invalid={!!error}
            autoFocus={autoFocus} label={`${title} verification code`}
          />
          {error && (
            <p role="alert" style={{ display: "flex", alignItems: "flex-start", gap: "5px", margin: "8px 0 0", fontSize: "12px", color: "#dc2626", lineHeight: 1.45 }}>
              <AlertCircle size={13} style={{ flexShrink: 0, marginTop: "1px" }} /> {error}
            </p>
          )}
          {state.devCode && (
            <p style={{ margin: "8px 0 0", fontSize: "11.5px", color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "6px", padding: "6px 8px" }}>
              Development only — the email could not be sent. Code: <strong style={{ letterSpacing: "0.15em" }}>{state.devCode}</strong>
            </p>
          )}
          {state.devNote && (
            <p style={{ margin: "8px 0 0", fontSize: "11.5px", color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "6px", padding: "6px 8px" }}>
              Development mode — no SMS is sent. The code is printed in the backend console.
            </p>
          )}
          <p style={{ margin: "8px 0 0", fontSize: "12px", color: "#64748b" }}>
            Didn&apos;t get the code?{" "}
            {waiting ? (
              <span style={{ color: "#94a3b8" }}>Resend in {formatWait(state.wait)}</span>
            ) : (
              <button
                type="button" onClick={onResend} disabled={working}
                style={{ background: "none", border: "none", padding: 0, fontSize: "12px", fontWeight: 700, color: working ? "#94a3b8" : "#2563eb", cursor: working ? "not-allowed" : "pointer" }}
              >
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
    <div
      role="presentation"
      style={{
        position: "fixed", inset: 0, zIndex: 1000, padding: "16px",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(8,24,46,0.62)", backdropFilter: "blur(3px)",
      }}
    >
      <form
        role="dialog" aria-modal="true" aria-labelledby="setup-verify-title" aria-describedby="setup-verify-desc"
        onSubmit={handleSubmit} noValidate className="animate-fade-in"
        style={{
          width: "100%", maxWidth: "500px", maxHeight: "100%", overflowY: "auto",
          background: "#ffffff", borderRadius: "2px", overflowX: "hidden",
          boxShadow: "0 30px 80px rgba(8,24,46,0.45)", fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        {/* ── Upper part: artwork and title on the navy brand band ── */}
        <div style={{ position: "relative",  color: "#000000" }}>
          <div aria-hidden="true" style={{
            position: "absolute", inset: 0, pointerEvents: "none",
            backgroundImage: "radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)", backgroundSize: "18px 18px",
          }} />
          <button
            type="button" onClick={onClose} disabled={busy} aria-label="Close"
            style={{
              position: "absolute", top: "14px", right: "14px", width: "30px", height: "30px", borderRadius: "2px",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.15)",
              color:  busy ? "gray" :"black", cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            <X size={16} />
          </button>

          <div style={{ position: "relative", padding: "26px 28px 22px", textAlign: "center" }}>
            <VerifyIllustration />
            <p style={{ fontSize: "10.5px", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "gray", margin: "14px 0 0" }}>
              Final step · Verification
            </p>
          </div>
        </div>

        {/* ── Lower part: the codes ── */}
        <div style={{ padding: "22px 28px 4px" }}>
          <ContactSection
            icon={Mail} title="Email address" target={email} state={emailState}
            code={codes.email} onCode={setCode("email")} onResend={resend("email")}
            error={codeErrors.email || emailState.error}
            autoFocus={emailState.status !== "verified"}
          />
          <div aria-hidden="true" style={{ height: "1px", background: "#eef2f7", margin: "20px 0" }} />
          <ContactSection
            icon={Smartphone} title="Mobile number" target={formatMobile(mobile)} state={phoneState}
            code={codes.phone} onCode={setCode("phone")} onResend={resend("phone")}
            error={codeErrors.phone || phoneState.error}
            autoFocus={emailState.status === "verified" && phoneState.status !== "verified"}
          />
        </div>

        <div style={{ padding: "20px 28px 24px" }}>
          <button
            type="submit" disabled={busy}
            style={{ ...authStyles.primaryButton, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.75 : 1 }}
          >
            {submitting ? <><Loader2 size={16} className="animate-spin" /> Setting up…</>
              : verifying ? <><Loader2 size={16} className="animate-spin" /> Verifying…</>
              : <><CheckCircle2 size={16} /> {bothDone ? "Complete setup" : "Verify & complete setup"}</>}
          </button>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "8px", marginTop: "14px", fontSize: "11.5px", color: "#94a3b8" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
              <Lock size={11} /> Codes expire in 10 minutes. Never share them.
            </span>
            <button
              type="button" onClick={onClose} disabled={busy}
              style={{ background: "none", border: "none", padding: 0, color: "#2563eb", fontWeight: 600, fontSize: "12px", cursor: busy ? "not-allowed" : "pointer" }}
            >
              Edit details
            </button>
          </div>
        </div>
      </form>
    </div>,
    document.body,
  );
}
