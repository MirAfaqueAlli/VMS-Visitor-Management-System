// frontend/src/pages/visitor/VisitorSignIn.jsx
// Visitor portal sign-in, on the staff sign-in layout (AuthLayout: navy brand panel,
// white form panel, 3px controls). First the visitor's mobile number or email is checked
// (POST /identify), then the screen offers what fits:
//   account with a password → password (or a mobile OTP instead)
//   account without one, or a visitor staff registered → mobile OTP
//   nobody yet → registration (name, email, address, password; mobile + email codes)
// Registration checks the mobile and email as they're typed (POST /register/check):
// one that already has an account is sent to sign in before any code goes out.
import useDocumentTitle from "../../lib/useDocumentTitle";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  ArrowLeft, ArrowRight, Check, Eye, EyeOff, Loader2, Lock, RefreshCw, UserPlus, AlertCircle,
  UserRound, Mail, ShieldCheck, QrCode, ClipboardCheck, CalendarDays,
} from "../../components/icons";
import AuthLayout from "../../components/AuthLayout";
import apiClient from "../../api/axios";
import { Field, Note } from "../../components/ui";
import { OtpField, PhoneInput } from "../../components/PublicShell";
import PasswordStrength from "../../components/PasswordStrength";
import usePhoneOtp from "../../hooks/usePhoneOtp";
import useCountdown from "../../hooks/useCountdown";
import { validatePassword } from "../../utils/passwordValidator";
import { portalApi, portalError, phoneInToken } from "../../lib/visitorPortal";

const EMPTY_REG = { full_name: "", phone: "", email: "", address: "", password: "", confirm: "" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Left-panel text: the staff sign-in layout, worded for visitors. */
const PORTAL_LAYOUT = {
  eyebrow:     "Visitor portal",
  title:       "Your visits to OHPC, in one place",
  description: "Request a visit, follow its approval and keep your gate pass ready for the gate.",
  features: [
    [CalendarDays,   "Request a visit to any OHPC unit"],
    [QrCode,         "Your QR gate pass, on your phone"],
    [ClipboardCheck, "Approval and visit status as it happens"],
  ],
  notice:   "Your details are used only to manage your visits to OHPC premises. Gate entries are logged.",
  product:  "Visitor portal",
  helpText: "Need help? Contact the reception of the unit you're visiting.",
};

function PasswordInput({ id, value, onChange, autoFocus, autoComplete = "current-password", placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <div className="control-wrap">
      <Lock size={14} className="control-icon" />
      <input
        id={id} type={show ? "text" : "password"} required autoFocus={autoFocus} autoComplete={autoComplete}
        value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="control pr-10"
      />
      <button type="button" tabIndex={-1} onClick={() => setShow((s) => !s)}
        className="absolute right-1 top-1/2 -translate-y-1/2 btn-icon !w-8 !min-h-0 h-8"
        aria-label={show ? "Hide password" : "Show password"}>
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

export default function VisitorSignIn({ onSignedIn }) {
  useDocumentTitle("Visitor sign in");
  const otp = usePhoneOtp();
  const emailTimer = useCountdown();

  // identify | password | otp | register | register-verify
  const [mode, setMode] = useState("identify");
  const [identifier, setIdentifier] = useState("");
  const [info, setInfo] = useState(null);           // POST /identify result
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [reg, setReg] = useState(EMPTY_REG);
  const [phoneToken, setPhoneToken] = useState(null);
  const [regPhoneCode, setRegPhoneCode] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [devEmailOtp, setDevEmailOtp] = useState(null);

  const go = (next) => { setError(""); setCode(""); setMode(next); };
  const run = async (fn) => {
    setBusy(true);
    setError("");
    try { await fn(); } catch (err) { setError(portalError(err, "Something went wrong. Please try again.")); }
    finally { setBusy(false); }
  };

  const sendLoginOtp = (phone) => run(async () => {
    await otp.send(phone);
    toast.success(`Code sent to +91 ${phone}`);
    go("otp");
  });

  // ── Step 1: who is this? (also "Sign in instead" on the registration form) ──
  const identifyAs = (value) => {
    setIdentifier(value);
    run(async () => {
      const { data } = await portalApi.post("/identify", { identifier: value });
      const r = data.data;
      setInfo(r);
      if (r.kind === "email") {
        if (!r.account) {
          setError("No visitor account uses this email. Sign in with your mobile number, or create an account.");
          return;
        }
        if (!r.has_password) {
          setError("This account has no password yet. Sign in with your mobile number and an SMS code.");
          return;
        }
        go("password");
        return;
      }
      if (r.account && r.has_password) { go("password"); return; }
      if (r.account || r.known_visitor) {
        await otp.send(r.phone);
        toast.success(`Code sent to +91 ${r.phone}`);
        go("otp");
        return;
      }
      setReg({ ...EMPTY_REG, phone: r.phone });
      setPhoneToken(null);
      go("register");
    });
  };
  const handleIdentify = (e) => {
    e.preventDefault();
    identifyAs(identifier.trim());
  };

  // ── Password sign-in ──
  const handlePassword = (e) => {
    e.preventDefault();
    run(async () => {
      const { data } = await portalApi.post("/login", { identifier: identifier.trim(), password });
      onSignedIn(data.data, data.message);
    });
  };

  // ── Mobile OTP sign-in ──
  const handleOtp = (e) => {
    e.preventDefault();
    if (code.length !== 6) { setError("Enter the 6-digit code."); return; }
    run(async () => {
      const proof = await otp.proof(code);
      const { data } = await portalApi.post("/login/otp", { phone: otp.sentTo, ...proof });
      if (data.data?.session_token) { onSignedIn(data.data, data.message); return; }
      // A new number: its mobile is verified — continue to registration
      setPhoneToken(data.data.phone_token);
      setReg({ ...EMPTY_REG, phone: data.data.phone });
      toast.success("Mobile verified. Create your account to continue.");
      go("register");
    });
  };

  // ── Registration: details → codes ──
  const phoneAlreadyVerified = phoneToken && phoneInToken(phoneToken) === reg.phone;
  const setRegField = (k) => (e) => setReg((r) => ({ ...r, [k]: e.target.value }));

  // Is the mobile / email already used? Checked shortly after typing stops; the
  // result keeps the values it was for, so an edit clears a stale warning at once.
  const [checked, setChecked] = useState({});
  const checkSeq = useRef(0);
  const regPhone = mode === "register" && /^\d{10}$/.test(reg.phone) ? reg.phone : "";
  const regEmail = mode === "register" && EMAIL_RE.test(reg.email.trim()) ? reg.email.trim().toLowerCase() : "";
  useEffect(() => {
    if (!regPhone && !regEmail) return undefined;
    const t = setTimeout(() => {
      const n = ++checkSeq.current;
      portalApi.post("/register/check", { phone: regPhone || undefined, email: regEmail || undefined })
        .then(({ data }) => { if (n === checkSeq.current) setChecked({ ...data.data, phone: regPhone, email: regEmail }); })
        .catch(() => { /* Continue checks again */ });
    }, 400);
    return () => clearTimeout(t);
  }, [regPhone, regEmail]);
  const phoneHasAccount = !!regPhone && checked.phone === regPhone && checked.phone_account;
  const knownVisitor    = !!regPhone && checked.phone === regPhone && checked.known_visitor;
  const emailHasAccount = !!regEmail && checked.email === regEmail && checked.email_account;

  const handleRegister = (e) => {
    e.preventDefault();
    if (reg.full_name.trim().length < 2) { setError("Enter your full name."); return; }
    if (!/^\d{10}$/.test(reg.phone)) { setError("Enter a valid 10-digit mobile number."); return; }
    if (!EMAIL_RE.test(reg.email.trim())) { setError("Enter a valid email address."); return; }
    if (reg.address.trim().length < 5) { setError("Enter your full address."); return; }
    if (!validatePassword(reg.password).valid) { setError("The password doesn't meet the requirements yet."); return; }
    if (reg.password !== reg.confirm) { setError("The passwords don't match."); return; }
    run(async () => {
      // Check again before any code is sent (the typing check may not have finished)
      const email = reg.email.trim().toLowerCase();
      const { data } = await portalApi.post("/register/check", { phone: reg.phone, email });
      setChecked({ ...data.data, phone: reg.phone, email });
      if (data.data.phone_account || data.data.email_account) return;
      if (!phoneAlreadyVerified) {
        setPhoneToken(null);
        await otp.send(reg.phone);
      }
      const res = await apiClient.post("/public-auth/send-email-otp", { email: reg.email.trim() });
      setDevEmailOtp(res.data?.data?.dev_otp || null);
      emailTimer.start();
      setRegPhoneCode("");
      setEmailCode("");
      go("register-verify");
    });
  };

  const handleRegisterVerify = (e) => {
    e.preventDefault();
    if (!phoneAlreadyVerified && regPhoneCode.length !== 6) { setError("Enter the 6-digit code sent to your mobile."); return; }
    if (emailCode.length !== 6) { setError("Enter the 6-digit code sent to your email."); return; }
    run(async () => {
      let token = phoneAlreadyVerified ? phoneToken : null;
      if (!token) {
        const proof = await otp.proof(regPhoneCode);
        const r = await apiClient.post("/public-auth/verify-firebase-phone", { phone: reg.phone, ...proof });
        token = r.data?.data?.phone_token;
        setPhoneToken(token);
      }
      const { data } = await portalApi.post("/register", {
        full_name: reg.full_name.trim(), phone: reg.phone, email: reg.email.trim(),
        address: reg.address.trim(), password: reg.password, phone_token: token, email_otp: emailCode,
      });
      onSignedIn(data.data, data.message);
    });
  };

  const resendEmail = () => run(async () => {
    const res = await apiClient.post("/public-auth/send-email-otp", { email: reg.email.trim() });
    setDevEmailOtp(res.data?.data?.dev_otp || null);
    emailTimer.start();
    toast.success("New code sent to your email.");
  });

  const errorNote = error && <Note tone="danger" icon={AlertCircle}>{error}</Note>;
  const heading = (title, sub) => (
    <div className="mb-6">
      <h2 className="text-[22px] font-semibold text-ink">{title}</h2>
      {sub && <p className="text-[12.5px] text-muted mt-1">{sub}</p>}
    </div>
  );
  const back = (to = "identify") => (
    <button type="button" onClick={() => go(to)} className="btn-ghost btn-sm !px-0 mb-4">
      <ArrowLeft size={13} /> Back
    </button>
  );
  const resendRow = (onResend, wait) => (
    <p className="text-[12px] text-muted">
      No code?{" "}
      {wait > 0 ? <span className="tabular">Resend in {wait}s</span> : (
        <button type="button" onClick={onResend} disabled={busy} className="text-link font-medium">
          <RefreshCw size={11} className="inline -mt-0.5" /> Resend
        </button>
      )}
    </p>
  );
  const secureLine = (
    <p className="mt-4 flex items-center justify-center gap-1.5 text-[11.5px] text-muted">
      <ShieldCheck size={12} /> Your details are encrypted and used only for your visits.
    </p>
  );
  const sendCodesLabel = phoneAlreadyVerified ? "Send email code" : "Send verification codes";
  const alreadyRegistered = phoneHasAccount || emailHasAccount;

  return (
    <AuthLayout {...PORTAL_LAYOUT} maxWidth={mode === "register" ? 460 : 400}>
      {/* Firebase's invisible reCAPTCHA mounts here (hooks/usePhoneOtp) */}
      <div id="recaptcha-container" style={{ position: "absolute", bottom: 0, left: 0 }} />

      {/* ── Identify ── */}
      {mode === "identify" && (
        <>
          {heading("Sign in", "See your visit requests and gate passes, or request a new visit.")}
          <form onSubmit={handleIdentify} className="space-y-3.5">
            <Field label="Mobile number or email" htmlFor="vp-id" hint="Visited before through the gate? Use the mobile number you gave.">
              <div className="control-wrap">
                <UserRound size={14} className="control-icon" />
                <input id="vp-id" type="text" autoFocus required value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)} placeholder="98765 43210 or name@example.com"
                  autoComplete="username" className="control" />
              </div>
            </Field>
            {errorNote}
            <button type="submit" disabled={busy || identifier.trim().length < 3} className="btn-primary w-full !mt-5">
              {busy && <Loader2 size={14} className="animate-spin" />}
              Continue {!busy && <ArrowRight size={14} />}
            </button>
          </form>
          <div className="mt-6 pt-5 border-t border-line">
            <p className="text-[12px] text-muted mb-2">New visitor?</p>
            <button type="button" className="btn-outline w-full"
              onClick={() => { setReg(EMPTY_REG); setPhoneToken(null); go("register"); }}>
              <UserPlus size={14} /> Create an account
            </button>
          </div>
          {secureLine}
        </>
      )}

      {/* ── Password ── */}
      {mode === "password" && (
        <>
          {back()}
          {heading("Enter your password", (
            <>Signing in as <span className="text-ink font-medium tabular break-all">{info?.kind === "phone" ? `+91 ${info.phone}` : identifier.trim()}</span></>
          ))}
          <form onSubmit={handlePassword} className="space-y-3.5">
            <div>
              <div className="flex items-baseline justify-between">
                <label htmlFor="vp-pw" className="field-label">Password</label>
                {info?.kind === "phone" && (
                  <button type="button" className="text-link text-[12px] font-medium" onClick={() => sendLoginOtp(info.phone)} disabled={busy}>
                    Use an SMS code instead
                  </button>
                )}
              </div>
              <PasswordInput id="vp-pw" value={password} onChange={setPassword} autoFocus placeholder="••••••••" />
            </div>
            {errorNote}
            <button type="submit" disabled={busy || !password} className="btn-primary w-full !mt-5">
              {busy && <Loader2 size={14} className="animate-spin" />} {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
          {info?.kind !== "phone" && (
            <p className="text-center text-[12px] text-muted mt-4">
              Forgot it? Sign in with your{" "}
              <button type="button" className="text-link font-medium" onClick={() => { setIdentifier(""); go("identify"); }}>mobile number</button> instead.
            </p>
          )}
          {secureLine}
        </>
      )}

      {/* ── Mobile OTP ── */}
      {mode === "otp" && (
        <>
          {back()}
          {heading("Enter the SMS code", (
            <>
              Sent to <span className="tabular text-ink font-medium">+91 {otp.sentTo}</span>.
              {info && !info.account && info.known_visitor && " You've visited before — verifying your mobile opens your account."}
            </>
          ))}
          <form onSubmit={handleOtp} className="space-y-3.5">
            {otp.devMode && <Note tone="info" icon={AlertCircle}><b>Dev mode.</b> The SMS code is printed in the backend log.</Note>}
            <Field label="6-digit code">
              <OtpField value={code} onChange={setCode} disabled={busy} autoFocus />
              <div className="mt-1.5">{resendRow(() => sendLoginOtp(otp.sentTo), otp.wait)}</div>
            </Field>
            {errorNote}
            <button type="submit" disabled={busy || code.length !== 6} className="btn-primary w-full !mt-5">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Verify and sign in
            </button>
          </form>
        </>
      )}

      {/* ── Register: details ── */}
      {mode === "register" && (
        <>
          {back()}
          {heading("Create your visitor account",
            phoneAlreadyVerified ? "Your mobile is verified. Add your details." : "We'll verify your mobile and email with a code.")}
          <form onSubmit={handleRegister} className="space-y-3.5">
            <Field label="Full name" htmlFor="vr-name" required hint="As on your government ID">
              <div className="control-wrap">
                <UserRound size={14} className="control-icon" />
                <input id="vr-name" className="control" required value={reg.full_name} onChange={setRegField("full_name")}
                  autoComplete="name" placeholder="e.g. Rajesh Kumar Mohapatra" />
              </div>
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3.5">
              <Field label="Mobile number" htmlFor="vr-phone" required
                error={phoneHasAccount ? "This mobile number already has an account." : ""}
                hint={knownVisitor ? "You've visited before — those visits will show in your account." : ""}>
                <PhoneInput id="vr-phone" value={reg.phone} onChange={(v) => setReg((r) => ({ ...r, phone: v }))} />
              </Field>
              <Field label="Email" htmlFor="vr-email" required
                error={emailHasAccount ? "This email already has an account." : ""}>
                <div className="control-wrap">
                  <Mail size={14} className="control-icon" />
                  <input id="vr-email" type="email" className="control" required value={reg.email} onChange={setRegField("email")}
                    autoComplete="email" placeholder="name@example.com" aria-invalid={emailHasAccount || undefined} />
                </div>
              </Field>
            </div>
            {alreadyRegistered && (
              <Note tone="warning" icon={AlertCircle}>
                You're already registered.{" "}
                <button type="button" className="text-link font-medium" disabled={busy}
                  onClick={() => identifyAs(phoneHasAccount ? reg.phone : reg.email.trim())}>
                  Sign in with {phoneHasAccount ? `+91 ${reg.phone}` : reg.email.trim()}
                </button>
                {!phoneHasAccount && " or use a different email."}
              </Note>
            )}
            <Field label="Address" htmlFor="vr-address" required>
              <textarea id="vr-address" rows={2} className="control resize-none" required value={reg.address}
                onChange={setRegField("address")} maxLength={255} placeholder="House, street, city, district, PIN" />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3.5">
              <Field label="Password" htmlFor="vr-pw" required>
                <PasswordInput id="vr-pw" value={reg.password} onChange={(v) => setReg((r) => ({ ...r, password: v }))}
                  autoComplete="new-password" placeholder="At least 8 characters" />
              </Field>
              <Field label="Confirm password" htmlFor="vr-pw2" required
                error={reg.confirm && reg.confirm !== reg.password ? "The passwords don't match." : ""}>
                <PasswordInput id="vr-pw2" value={reg.confirm} onChange={(v) => setReg((r) => ({ ...r, confirm: v }))}
                  autoComplete="new-password" placeholder="Repeat the password" />
              </Field>
            </div>
            <PasswordStrength password={reg.password} hideWhenValid />
            {errorNote}
            <button type="submit" disabled={busy || alreadyRegistered} className="btn-primary w-full !mt-5"
              title={alreadyRegistered ? "This mobile or email is already registered — sign in instead" : undefined}>
              {busy && <Loader2 size={14} className="animate-spin" />} {sendCodesLabel} {!busy && <ArrowRight size={14} />}
            </button>
          </form>
          <p className="text-center text-[12px] text-muted mt-4">
            Already registered? <button type="button" className="text-link font-medium" onClick={() => go("identify")}>Sign in</button>
          </p>
        </>
      )}

      {/* ── Register: codes ── */}
      {mode === "register-verify" && (
        <>
          {back("register")}
          {heading(phoneAlreadyVerified ? "Verify your email" : "Verify your mobile and email",
            phoneAlreadyVerified ? "Enter the 6-digit code we sent to your email." : "Enter the 6-digit codes we sent.")}
          <form onSubmit={handleRegisterVerify} className="space-y-3.5">
            {!phoneAlreadyVerified && (
              <Field label={`Mobile code · +91 ${reg.phone}`}>
                <OtpField value={regPhoneCode} onChange={setRegPhoneCode} disabled={busy} autoFocus label="Mobile code" />
                {otp.devMode && <p className="field-hint">Dev mode: the code is in the backend log.</p>}
                <div className="mt-1.5">{resendRow(() => run(() => otp.send(reg.phone)), otp.wait)}</div>
              </Field>
            )}
            <Field label={`Email code · ${reg.email.trim()}`}>
              <OtpField value={emailCode} onChange={setEmailCode} disabled={busy} autoFocus={phoneAlreadyVerified} label="Email code" />
              {devEmailOtp && <p className="field-hint">Dev OTP: <span className="mono text-ink">{devEmailOtp}</span></p>}
              <div className="mt-1.5">{resendRow(resendEmail, emailTimer.count)}</div>
            </Field>
            {errorNote}
            <button type="submit" disabled={busy} className="btn-primary w-full !mt-5">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Create account
            </button>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
