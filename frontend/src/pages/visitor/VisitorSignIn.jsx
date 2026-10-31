// frontend/src/pages/visitor/VisitorSignIn.jsx
// Visitor portal sign-in. First the visitor's mobile number or email is checked
// (POST /identify), then the screen offers what fits:
//   account with a password → password (or a mobile OTP instead)
//   account without one, or a visitor staff registered → mobile OTP
//   nobody yet → registration (name, email, address, password; mobile + email codes)
import { useState } from "react";
import toast from "react-hot-toast";
import {
  ArrowLeft, ArrowRight, Check, Eye, EyeOff, KeyRound, Loader2, Lock, Phone, RefreshCw, UserPlus, AlertCircle,
} from "../../components/icons";
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

  // ── Step 1: who is this? ──
  const handleIdentify = (e) => {
    e.preventDefault();
    run(async () => {
      const { data } = await portalApi.post("/identify", { identifier: identifier.trim() });
      const r = data.data;
      setInfo(r);
      if (r.kind === "email") {
        if (!r.account) {
          setError("No visitor account uses this email. Sign in with your mobile number, or create an account.");
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

  const handleRegister = (e) => {
    e.preventDefault();
    if (reg.full_name.trim().length < 2) { setError("Enter your full name."); return; }
    if (!/^\d{10}$/.test(reg.phone)) { setError("Enter a valid 10-digit mobile number."); return; }
    if (!EMAIL_RE.test(reg.email.trim())) { setError("Enter a valid email address."); return; }
    if (reg.address.trim().length < 5) { setError("Enter your full address."); return; }
    if (!validatePassword(reg.password).valid) { setError("The password doesn't meet the requirements yet."); return; }
    if (reg.password !== reg.confirm) { setError("The passwords don't match."); return; }
    run(async () => {
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

  return (
    <div className="card w-full max-w-md mx-auto p-6 sm:p-7 animate-fade-in">
      {/* ── Identify ── */}
      {mode === "identify" && (
        <form onSubmit={handleIdentify} className="space-y-4">
          <div>
            <h2 className="text-[18px] font-semibold text-ink">Sign in to the visitor portal</h2>
            <p className="text-[12.5px] text-muted mt-1">
              See your visit requests and gate passes, and request a new visit.
            </p>
          </div>
          <Field label="Mobile number or email" htmlFor="vp-id" hint="Visited before through the gate? Use the mobile number you gave.">
            <input id="vp-id" type="text" autoFocus required value={identifier}
              onChange={(e) => setIdentifier(e.target.value)} placeholder="98765 43210 or name@example.com"
              autoComplete="username" className="control" />
          </Field>
          {errorNote}
          <button type="submit" disabled={busy || identifier.trim().length < 3} className="btn-primary w-full">
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
            Continue {!busy && <ArrowRight size={14} />}
          </button>
          <p className="text-center text-[12px] text-muted">
            New visitor?{" "}
            <button type="button" className="text-link font-medium" onClick={() => { setReg(EMPTY_REG); setPhoneToken(null); go("register"); }}>
              Create an account
            </button>
          </p>
        </form>
      )}

      {/* ── Password ── */}
      {mode === "password" && (
        <form onSubmit={handlePassword} className="space-y-4">
          {back()}
          <div>
            <span className="head-chip tone-brand !w-10 !h-10 mb-3"><KeyRound size={20} duo /></span>
            <h2 className="text-[18px] font-semibold text-ink">Enter your password</h2>
            <p className="text-[12.5px] text-muted mt-1 break-all">{info?.kind === "phone" ? `+91 ${info.phone}` : identifier.trim()}</p>
          </div>
          <Field label="Password" htmlFor="vp-pw">
            <PasswordInput id="vp-pw" value={password} onChange={setPassword} autoFocus placeholder="Your password" />
          </Field>
          {errorNote}
          <button type="submit" disabled={busy || !password} className="btn-primary w-full">
            {busy && <Loader2 size={14} className="animate-spin" />} Sign in
          </button>
          <p className="text-center text-[12px] text-muted">
            {info?.kind === "phone" ? (
              <>Forgot it?{" "}
                <button type="button" className="text-link font-medium" onClick={() => sendLoginOtp(info.phone)} disabled={busy}>
                  Sign in with a mobile OTP
                </button>
              </>
            ) : (
              <>Forgot it? Sign in with your <button type="button" className="text-link font-medium" onClick={() => { setIdentifier(""); go("identify"); }}>mobile number</button> instead.</>
            )}
          </p>
        </form>
      )}

      {/* ── Mobile OTP ── */}
      {mode === "otp" && (
        <form onSubmit={handleOtp} className="space-y-4">
          {back()}
          <div>
            <span className="head-chip tone-brand !w-10 !h-10 mb-3"><Phone size={20} duo /></span>
            <h2 className="text-[18px] font-semibold text-ink">Enter the SMS code</h2>
            <p className="text-[12.5px] text-muted mt-1">
              Sent to <span className="tabular text-ink font-medium">+91 {otp.sentTo}</span>.
              {info && !info.account && info.known_visitor && " You've visited before — verifying your mobile opens your account."}
            </p>
          </div>
          {otp.devMode && <Note tone="info" icon={AlertCircle}><b>Dev mode.</b> The SMS code is printed in the backend log.</Note>}
          <OtpField value={code} onChange={setCode} disabled={busy} autoFocus />
          {resendRow(() => sendLoginOtp(otp.sentTo), otp.wait)}
          {errorNote}
          <button type="submit" disabled={busy || code.length !== 6} className="btn-primary w-full">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Verify and sign in
          </button>
        </form>
      )}

      {/* ── Register: details ── */}
      {mode === "register" && (
        <form onSubmit={handleRegister} className="space-y-3">
          {back()}
          <div className="mb-1">
            <span className="head-chip tone-brand !w-10 !h-10 mb-3"><UserPlus size={20} duo /></span>
            <h2 className="text-[18px] font-semibold text-ink">Create your visitor account</h2>
            <p className="text-[12.5px] text-muted mt-1">
              {phoneAlreadyVerified ? "Your mobile is verified. Add your details." : "We'll verify your mobile and email with a code."}
            </p>
          </div>
          <Field label="Full name" htmlFor="vr-name" required hint="As on your government ID">
            <input id="vr-name" className="control" required value={reg.full_name} onChange={setRegField("full_name")}
              autoComplete="name" placeholder="e.g. Rajesh Kumar Mohapatra" />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Mobile number" htmlFor="vr-phone" required>
              <PhoneInput id="vr-phone" value={reg.phone} onChange={(v) => setReg((r) => ({ ...r, phone: v }))} />
            </Field>
            <Field label="Email" htmlFor="vr-email" required>
              <input id="vr-email" type="email" className="control" required value={reg.email} onChange={setRegField("email")}
                autoComplete="email" placeholder="name@example.com" />
            </Field>
          </div>
          <Field label="Address" htmlFor="vr-address" required>
            <textarea id="vr-address" rows={2} className="control resize-none" required value={reg.address}
              onChange={setRegField("address")} maxLength={255} placeholder="House, street, city, district, PIN" />
          </Field>
          <div>
            <Field label="Password" htmlFor="vr-pw" required>
              <PasswordInput id="vr-pw" value={reg.password} onChange={(v) => setReg((r) => ({ ...r, password: v }))}
                autoComplete="new-password" placeholder="At least 8 characters" />
            </Field>
            <PasswordStrength password={reg.password} hideWhenValid />
          </div>
          <Field label="Confirm password" htmlFor="vr-pw2" required
            error={reg.confirm && reg.confirm !== reg.password ? "The passwords don't match." : ""}>
            <PasswordInput id="vr-pw2" value={reg.confirm} onChange={(v) => setReg((r) => ({ ...r, confirm: v }))}
              autoComplete="new-password" placeholder="Repeat the password" />
          </Field>
          {errorNote}
          <button type="submit" disabled={busy} className="btn-primary w-full !mt-4">
            {busy && <Loader2 size={14} className="animate-spin" />} Continue {!busy && <ArrowRight size={14} />}
          </button>
          <p className="text-center text-[12px] text-muted">
            Have an account? <button type="button" className="text-link font-medium" onClick={() => go("identify")}>Sign in</button>
          </p>
        </form>
      )}

      {/* ── Register: codes ── */}
      {mode === "register-verify" && (
        <form onSubmit={handleRegisterVerify} className="space-y-4">
          {back("register")}
          <div>
            <h2 className="text-[18px] font-semibold text-ink">Verify your mobile and email</h2>
            <p className="text-[12.5px] text-muted mt-1">Enter the 6-digit codes we sent.</p>
          </div>
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
          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Create account
          </button>
        </form>
      )}
    </div>
  );
}
