// frontend/src/pages/visitor/VisitorComplete.jsx
// Shown after sign-in while the account isn't complete: the mobile must be
// verified and an email linked + verified (walk-ins added by staff often have
// neither). Then, for accounts without a password, an optional "set a password".
import useDocumentTitle from "../../lib/useDocumentTitle";
import { useState } from "react";
import toast from "react-hot-toast";
import { AlertCircle, Check, CheckCircle2, Circle, Loader2, Lock, Mail, Phone } from "../../components/icons";
import { Field, Note } from "../../components/ui";
import { OtpField } from "../../components/PublicShell";
import PasswordStrength from "../../components/PasswordStrength";
import usePhoneOtp from "../../hooks/usePhoneOtp";
import useCountdown from "../../hooks/useCountdown";
import { validatePassword } from "../../utils/passwordValidator";
import { portalApi, portalError } from "../../lib/visitorPortal";

function StepRow({ done, current, icon: Icon, title, detail }) {
  return (
    <li className={`flex items-center gap-3 py-2 ${current ? "" : "opacity-80"}`}>
      {done ? <CheckCircle2 size={18} className="text-success shrink-0" /> : current
        ? <Icon size={18} className="text-primary-strong shrink-0" /> : <Circle size={18} className="text-muted shrink-0" />}
      <div className="min-w-0">
        <p className={`text-[13px] ${current ? "font-semibold text-ink" : "text-ink-2"}`}>{title}</p>
        {detail && <p className="text-[11.5px] text-muted truncate">{detail}</p>}
      </div>
    </li>
  );
}

export default function VisitorComplete({ account, pending, onUpdated, onSession, onDone }) {
  useDocumentTitle("Complete your details");
  const otp = usePhoneOtp();
  const emailTimer = useCountdown();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState(account.email || "");
  const [emailSentTo, setEmailSentTo] = useState(null);
  const [devEmailOtp, setDevEmailOtp] = useState(null);
  const [pw, setPw] = useState({ next: "", confirm: "" });

  const step = pending[0] || (account.has_password ? null : "password");

  const run = async (fn) => {
    setBusy(true);
    setError("");
    try { await fn(); } catch (err) { setError(portalError(err, "Something went wrong. Please try again.")); }
    finally { setBusy(false); }
  };

  const applyProfile = (data, message) => {
    setCode("");
    if (message) toast.success(message);
    onUpdated(data);
  };

  const sendPhone = () => run(async () => {
    await otp.send(account.phone);
    toast.success(`Code sent to +91 ${account.phone}`);
  });
  const verifyPhone = (e) => {
    e.preventDefault();
    run(async () => {
      const proof = await otp.proof(code);
      const { data } = await portalApi.post("/me/phone/verify", proof);
      applyProfile(data.data, data.message);
    });
  };

  const sendEmail = (e) => {
    e?.preventDefault();
    run(async () => {
      const { data } = await portalApi.post("/me/email/send", { email: email.trim() });
      setEmailSentTo(email.trim().toLowerCase());
      setDevEmailOtp(data.data?.dev_otp || null);
      emailTimer.start();
      toast.success(data.message);
    });
  };
  const verifyEmail = (e) => {
    e.preventDefault();
    run(async () => {
      const { data } = await portalApi.post("/me/email/verify", { email: emailSentTo, otp: code });
      setEmailSentTo(null);
      applyProfile(data.data, data.message);
    });
  };

  const savePassword = (e) => {
    e.preventDefault();
    if (!validatePassword(pw.next).valid) { setError("The password doesn't meet the requirements yet."); return; }
    if (pw.next !== pw.confirm) { setError("The passwords don't match."); return; }
    run(async () => {
      const { data } = await portalApi.post("/me/password", { new_password: pw.next });
      toast.success(data.message);
      onSession(data.data);
      onDone();
    });
  };

  const emailStepTitle = pending.includes("add_email") ? "Add your email" : "Verify your email";
  const errorNote = error && <Note tone="danger" icon={AlertCircle}>{error}</Note>;

  return (
    <div className="card w-full max-w-md mx-auto p-6 sm:p-7 animate-fade-in">
      <h2 className="text-[18px] font-semibold text-ink">Finish setting up your account</h2>
      <p className="text-[12.5px] text-muted mt-1">
        Gate passes and visit updates are sent to your verified mobile and email.
      </p>

      <ol className="mt-4 mb-5 divide-y divide-line border-y border-line">
        <StepRow done={!pending.includes("verify_phone")} current={step === "verify_phone"} icon={Phone}
          title="Verify your mobile" detail={`+91 ${account.phone}`} />
        <StepRow done={!pending.some((p) => p.endsWith("email"))} current={step === "add_email" || step === "verify_email"} icon={Mail}
          title={emailStepTitle} detail={account.email || "No email linked yet"} />
        <StepRow done={account.has_password} current={step === "password"} icon={Lock}
          title="Set a password" detail="Optional — or keep signing in with a mobile OTP" />
      </ol>

      {/* ── Mobile ── */}
      {step === "verify_phone" && (
        otp.sentTo ? (
          <form onSubmit={verifyPhone} className="space-y-3">
            <Field label={`Code sent to +91 ${account.phone}`}>
              <OtpField value={code} onChange={setCode} disabled={busy} autoFocus />
              {otp.devMode && <p className="field-hint">Dev mode: the code is in the backend log.</p>}
            </Field>
            {errorNote}
            <div className="flex items-center justify-between gap-2">
              <button type="submit" disabled={busy || code.length !== 6} className="btn-primary">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Verify mobile
              </button>
              {otp.wait > 0 ? <span className="text-[12px] text-muted tabular">Resend in {otp.wait}s</span>
                : <button type="button" className="text-link text-[12px] font-medium" onClick={sendPhone} disabled={busy}>Resend code</button>}
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            {errorNote}
            <button type="button" onClick={sendPhone} disabled={busy} className="btn-primary">
              {busy && <Loader2 size={14} className="animate-spin" />} Send code to +91 {account.phone}
            </button>
          </div>
        )
      )}

      {/* ── Email ── */}
      {(step === "add_email" || step === "verify_email") && (
        emailSentTo ? (
          <form onSubmit={verifyEmail} className="space-y-3">
            <Field label={`Code sent to ${emailSentTo}`}>
              <OtpField value={code} onChange={setCode} disabled={busy} autoFocus />
              {devEmailOtp && <p className="field-hint">Dev OTP: <span className="mono text-ink">{devEmailOtp}</span></p>}
            </Field>
            {errorNote}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button type="submit" disabled={busy || code.length !== 6} className="btn-primary">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Verify email
              </button>
              <div className="flex items-center gap-3 text-[12px]">
                <button type="button" className="text-link font-medium" onClick={() => { setEmailSentTo(null); setCode(""); }}>Change email</button>
                {emailTimer.count > 0 ? <span className="text-muted tabular">Resend in {emailTimer.count}s</span>
                  : <button type="button" className="text-link font-medium" onClick={sendEmail} disabled={busy}>Resend</button>}
              </div>
            </div>
          </form>
        ) : (
          <form onSubmit={sendEmail} className="space-y-3">
            <Field label="Email" htmlFor="vc-email" required hint="We'll send a 6-digit code to confirm it.">
              <input id="vc-email" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com" className="control" autoComplete="email" />
            </Field>
            {errorNote}
            <button type="submit" disabled={busy || !email.trim()} className="btn-primary">
              {busy && <Loader2 size={14} className="animate-spin" />} Send code
            </button>
          </form>
        )
      )}

      {/* ── Optional password ── */}
      {step === "password" && (
        <form onSubmit={savePassword} className="space-y-3">
          <div>
            <Field label="New password" htmlFor="vc-pw">
              <input id="vc-pw" type="password" autoComplete="new-password" value={pw.next}
                onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} className="control" placeholder="At least 8 characters" />
            </Field>
            <PasswordStrength password={pw.next} hideWhenValid />
          </div>
          <Field label="Confirm password" htmlFor="vc-pw2">
            <input id="vc-pw2" type="password" autoComplete="new-password" value={pw.confirm}
              onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} className="control" placeholder="Repeat the password" />
          </Field>
          {errorNote}
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="submit" disabled={busy || !pw.next} className="btn-primary">
              {busy && <Loader2 size={14} className="animate-spin" />} Save password
            </button>
            <button type="button" onClick={onDone} className="btn-outline">Skip for now</button>
          </div>
        </form>
      )}
    </div>
  );
}
