// frontend/src/pages/auth/Setup.jsx
// First-time setup: registers the organisation and its super administrator.
// One-time only — once the organisation exists this page redirects to sign-in
// (and the API refuses a second setup regardless).
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Building2, User, Lock, Mail, Phone, MapPin, Hash, ChevronRight,
  CheckCircle2, Eye, EyeOff, AlertCircle, ArrowLeft, UserCog, ShieldCheck, Loader2, Check,
} from "../../components/icons";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";
import useAuth from "../../hooks/useAuth";
import AuthLayout from "../../components/AuthLayout";
import PasswordStrength from "../../components/PasswordStrength";
import { validatePassword } from "../../utils/passwordValidator";
import { getApiErrorMessage } from "../../utils/apiError";
import useSetupVerification from "../../hooks/useSetupVerification";
import SetupVerifyDialog from "./SetupVerifyDialog";

const INITIAL = {
  org_name:               "",
  org_code:               "",
  org_city:               "",
  org_state:              "",
  org_phone:              "",
  org_email:              "",
  admin_name:             "",
  admin_email:            "",
  admin_phone:            "",
  admin_password:         "",
  admin_confirm_password: "",
  admin_employee_code:    "SA-001",
};

// ── Validation — mirrors the API's setupInitSchema and the column sizes ──────
const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneDigits = (v) => v.replace(/[\s\-+()]/g, "");

const lengthRule = (label, min, max) => (v) => {
  const t = v.trim();
  if (!t)              return `${label} is required.`;
  if (t.length < min)  return `${label} must be at least ${min} characters.`;
  if (t.length > max)  return `${label} must be at most ${max} characters.`;
  return "";
};
const maxLength     = (max) => (v) => (v.trim().length > max ? `Must be at most ${max} characters.` : "");
const optionalPhone = (v) => (v.trim() && !/^\d{10,15}$/.test(phoneDigits(v)) ? "Enter 10–15 digits (spaces, + and - are fine)." : "");
const optionalEmail = (v) => (v.trim() && !EMAIL_RE.test(v.trim()) ? "Enter a valid email address." : maxLength(100)(v));

/** Indian mobile as 10 digits — accepts a +91 or 0 prefix, spaces and dashes (same as the API). */
const toMobile10 = (v) => {
  const d = v.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) return d.slice(2);
  if (d.length === 11 && d.startsWith("0"))  return d.slice(1);
  return d;
};

const RULES = {
  org_name:  lengthRule("Organisation name", 2, 100),
  org_code:  (v) => (!v ? "Short code is required."
    : /^[A-Z0-9_-]{2,20}$/.test(v) ? "" : "Use 2–20 characters: capital letters, digits, - or _."),
  org_phone: optionalPhone,
  org_email: optionalEmail,
  org_city:  maxLength(50),
  org_state: maxLength(50),
  admin_name:  lengthRule("Full name", 2, 100),
  admin_email: (v) => (!v.trim() ? "Email is required."
    : !EMAIL_RE.test(v.trim()) ? "Enter a valid email address (e.g. admin@ohpc.co.in)." : maxLength(100)(v)),
  // Verified by SMS code (Firebase, +91 numbers)
  admin_phone: (v) => (!v.trim() ? "Mobile number is required."
    : /^[6-9]\d{9}$/.test(toMobile10(v)) ? "" : "Enter a valid 10-digit Indian mobile number."),
  admin_employee_code: lengthRule("Employee code", 1, 50),
  admin_password: (v) => (!v ? "Password is required."
    : validatePassword(v).valid ? "" : "Password does not meet all the requirements yet."),
  admin_confirm_password: (v, form) => (!v ? "Please re-enter the password."
    : v !== form.admin_password ? "Passwords do not match." : ""),
};

const STEP_FIELDS = {
  1: ["org_name", "org_code", "org_phone", "org_email", "org_city", "org_state"],
  2: ["admin_name", "admin_email", "admin_phone", "admin_employee_code", "admin_password", "admin_confirm_password"],
};

const validateAll = (form) => Object.fromEntries(Object.keys(RULES).map((k) => [k, RULES[k](form[k], form)]));

/** GET /setup/status → "open" (not set up yet), "done", or "error" (couldn't tell). */
const loadSetupStatus = (setStatus) =>
  apiClient.get("/setup/status")
    .then((res) => setStatus(res.data?.initialized ? "done" : "open"))
    .catch(() => setStatus("error"));

// ── Form field with live validation state ─────────────────────────────────────
function TextField({
  name, label, icon: Icon, required, value, onChange, onBlur, error, touched,
  type = "text", placeholder, autoComplete, autoFocus, hint, hintSuccess, mono, trailing, hideErrorText,
}) {
  const invalid = touched && !!error;
  const valid   = !error && value.trim() !== "";
  const errId   = `${name}-error`;
  return (
    <div className="mb-3.5">
      <label htmlFor={name} className="field-label">
        {label}{required && <span className="req" aria-hidden="true">*</span>}
      </label>
      <div className="control-wrap">
        <Icon size={14} className="control-icon" />
        <input
          id={name} name={name} type={type} value={value}
          onChange={onChange} onBlur={onBlur}
          placeholder={placeholder} autoComplete={autoComplete} autoFocus={autoFocus}
          aria-invalid={invalid} aria-describedby={invalid && !hideErrorText ? errId : undefined}
          className={`control pr-9${mono ? " mono" : ""}${invalid ? " is-invalid" : ""}`}
        />
        {trailing ?? (valid && (
          <CheckCircle2 size={15} aria-hidden="true" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-success" />
        ))}
      </div>
      {invalid && !hideErrorText ? (
        <p id={errId} role="alert" className="field-error flex items-center gap-1">
          <AlertCircle size={12} className="shrink-0" /> {error}
        </p>
      ) : hint ? (
        <p className={`field-hint${hintSuccess ? " !text-success font-medium" : ""}`}>{hint}</p>
      ) : null}
    </div>
  );
}

function RevealButton({ shown, onToggle }) {
  return (
    <button
      type="button" tabIndex={-1} onClick={onToggle}
      aria-label={shown ? "Hide password" : "Show password"}
      title={shown ? "Hide password" : "Show password"}
      className="absolute right-1 top-1/2 -translate-y-1/2 btn-icon !w-8 !min-h-0 h-8"
    >
      {shown ? <EyeOff size={14} /> : <Eye size={14} />}
    </button>
  );
}

const SETUP_PANEL = {
  eyebrow:     "First-time setup",
  description: "Register the organisation and create the super administrator account. This page is available only once, before the system is set up.",
  features: [
    [Building2,   "Register the organisation"],
    [UserCog,     "Create the super administrator"],
    [ShieldCheck, "Then add units, departments and staff"],
  ],
  helpText: "This page closes permanently once setup is complete.",
};

export default function Setup() {
  const navigate = useNavigate();
  const { loginDirect } = useAuth();

  const [status,  setStatus]  = useState("checking"); // checking | open | done | error
  const [form,    setForm]    = useState(INITIAL);
  const [touched, setTouched] = useState({});
  const [step,    setStep]    = useState(1);          // 1 = organisation, 2 = super admin
  const [loading, setLoading] = useState(false);
  const [showPwd,        setShowPwd]        = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);
  const [verifyOpen,     setVerifyOpen]     = useState(false);
  const verification = useSetupVerification();

  // One-time page: ask the API whether the organisation already exists
  useEffect(() => { loadSetupStatus(setStatus); }, []);

  useEffect(() => {
    if (status === "done") {
      toast("Setup is already complete. Please sign in.");
      navigate("/login", { replace: true });
    }
  }, [status, navigate]);

  const errors = validateAll(form);

  const set = (k) => (e) => {
    let v = e.target.value;
    if (k === "org_code") v = v.toUpperCase().replace(/[^A-Z0-9_-]/g, "");
    setForm((f) => ({ ...f, [k]: v }));
  };
  // Errors appear once a field has been left, then update live while typing
  const touch = (k) => () => setTouched((t) => (t[k] ? t : { ...t, [k]: true }));

  /** Marks the step's fields as touched; returns true if they are all valid. */
  const checkStep = (n) => {
    setTouched((t) => ({ ...t, ...Object.fromEntries(STEP_FIELDS[n].map((k) => [k, true])) }));
    const firstInvalid = STEP_FIELDS[n].find((k) => errors[k]);
    if (firstInvalid) document.getElementById(firstInvalid)?.focus();
    return !firstInvalid;
  };

  const goNext = (e) => {
    e.preventDefault();
    if (checkStep(1)) setStep(2);
  };

  const adminEmail  = form.admin_email.trim().toLowerCase();
  const adminMobile = toMobile10(form.admin_phone);

  // "Complete setup": check the form, then confirm the admin's email and mobile
  // by OTP in a pop-up (codes are sent from here, not from an effect)
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!STEP_FIELDS[1].every((k) => !errors[k])) { setStep(1); return; }
    if (!checkStep(2)) return;
    verification.start(adminEmail, adminMobile);
    setVerifyOpen(true);
  };

  // Called by the pop-up once both details are verified
  const completeSetup = async ({ emailToken, phoneToken }) => {
    setLoading(true);
    try {
      const payload = Object.fromEntries(
        Object.entries(form).filter(([k]) => k !== "admin_confirm_password").map(([k, v]) => [k, k === "admin_password" ? v : v.trim()])
      );
      payload.admin_email = adminEmail;
      payload.admin_phone = adminMobile;
      payload.email_token = emailToken;
      payload.phone_token = phoneToken;
      const response = await apiClient.post("/setup", payload);
      const { token, user } = response.data?.data ?? {};

      if (token && user) {
        // Store session and sync context — same as regular login
        loginDirect(token, user);
        toast.success(`Welcome, ${user.full_name}! System initialized.`);
        navigate("/dashboard", { replace: true });
      } else {
        toast.success("System initialized! Please sign in.");
        navigate("/login", { replace: true });
      }
    } catch (err) {
      if (err?.response?.status === 409) {
        // Someone completed setup in the meantime
        setVerifyOpen(false);
        setStatus("done");
        return;
      }
      toast.error(getApiErrorMessage(err, "Setup failed. Please try again."));
      const reverify = err?.response?.data?.reverify;   // "email" | "phone": its proof expired
      if (reverify) verification.resend(reverify);
      else setVerifyOpen(false);                         // something in the form needs fixing
    } finally {
      setLoading(false);
    }
  };

  const field = (name) => ({
    name, value: form[name], onChange: set(name), onBlur: touch(name),
    error: errors[name], touched: !!touched[name],
  });

  // ── Status screens ────────────────────────────────────────────────────────
  if (status === "checking" || status === "done") {
    return (
      <AuthLayout {...SETUP_PANEL}>
        <p className="flex items-center justify-center gap-2 py-10 text-[12.5px] text-muted">
          <Loader2 size={16} className="animate-spin" /> Checking the system status…
        </p>
      </AuthLayout>
    );
  }

  if (status === "error") {
    return (
      <AuthLayout {...SETUP_PANEL}>
        <div className="py-6">
          <span className="head-chip tone-danger !w-10 !h-10 mb-3"><AlertCircle size={20} duo /></span>
          <h2 className="text-[18px] font-semibold text-ink">Can&apos;t reach the server</h2>
          <p className="text-[12.5px] text-muted mt-1 mb-5">
            Setup can&apos;t continue until the system status is confirmed.
          </p>
          <button type="button" className="btn-primary"
            onClick={() => { setStatus("checking"); loadSetupStatus(setStatus); }}>
            Try again
          </button>
        </div>
      </AuthLayout>
    );
  }

  // ── Setup form ────────────────────────────────────────────────────────────
  const steps = [{ n: 1, label: "Organisation" }, { n: 2, label: "Super administrator" }];
  const confirmMatches = form.admin_confirm_password && form.admin_confirm_password === form.admin_password;

  return (
    <AuthLayout {...SETUP_PANEL} maxWidth={520}>
      <div className="mb-5">
        <h2 className="text-[22px] font-semibold text-ink">Set up the system</h2>
        <p className="text-[12.5px] text-muted mt-1">Two short steps. You can go back before you finish.</p>
      </div>

      {/* Stepper: two segments */}
      <ol className="grid grid-cols-2 gap-2 mb-6" aria-label="Progress">
        {steps.map(({ n, label }) => {
          const done = step > n;
          const current = step === n;
          return (
            <li key={n} aria-current={current ? "step" : undefined}>
              <button
                type="button"
                onClick={() => done && setStep(n)}
                disabled={!done}
                className={`w-full text-left ${done ? "cursor-pointer" : "cursor-default"}`}
              >
                <span className={`block h-1 rounded-full ${done || current ? "bg-primary" : "bg-line"}`} />
                <span className={`mt-1.5 flex items-center gap-1 text-[12px] ${current ? "text-ink font-semibold" : done ? "text-ink-2" : "text-muted"}`}>
                  {done && <Check size={12} weight="bold" className="text-primary-strong" />}
                  {n} · {label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* ── Step 1: Organisation ─────────────────────────────────────────── */}
      {step === 1 && (
        <form onSubmit={goNext} noValidate>
          <TextField {...field("org_name")} label="Organisation name" icon={Building2} required autoFocus
            placeholder="e.g. Odisha Hydro Power Corporation Ltd." />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            <TextField {...field("org_code")} label="Short code" icon={Hash} required mono
              placeholder="e.g. OHPC" hint="2–20 capital letters, digits, - or _" />
            <TextField {...field("org_phone")} label="Phone" icon={Phone} type="tel" placeholder="e.g. 0674 2542983" />
          </div>
          <TextField {...field("org_email")} label="Email" icon={Mail} type="email" placeholder="e.g. info@ohpc.co.in" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            <TextField {...field("org_city")}  label="City"  icon={MapPin} placeholder="e.g. Bhubaneswar" />
            <TextField {...field("org_state")} label="State" icon={MapPin} placeholder="e.g. Odisha" />
          </div>

          <div className="mt-2 pt-4 border-t border-line">
            <button type="submit" className="btn-primary">
              Continue <ChevronRight size={14} />
            </button>
          </div>
        </form>
      )}

      {/* ── Step 2: Super administrator ──────────────────────────────────── */}
      {step === 2 && (
        <form onSubmit={handleSubmit} noValidate>
          <TextField {...field("admin_name")} label="Full name" icon={User} required autoFocus
            autoComplete="name" placeholder="e.g. Rajesh Kumar Mohanty" />
          <TextField {...field("admin_email")} label="Email" icon={Mail} type="email" required
            autoComplete="email" placeholder="e.g. superadmin@ohpc.co.in"
            hint="We will send a verification code to this address." />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            <TextField {...field("admin_phone")} label="Mobile number" icon={Phone} type="tel" required
              autoComplete="tel" placeholder="e.g. 98765 43210"
              hint="Verified by SMS code." />
            <TextField {...field("admin_employee_code")} label="Employee code" icon={Hash} required mono placeholder="SA-001" />
          </div>

          <TextField {...field("admin_password")} label="Password" icon={Lock} required
            type={showPwd ? "text" : "password"} autoComplete="new-password"
            placeholder="Create a strong password"
            hideErrorText={!!form.admin_password}   // the checklist below explains what's missing
            trailing={<RevealButton shown={showPwd} onToggle={() => setShowPwd((v) => !v)} />} />
          <div className="-mt-2 mb-3.5">
            <PasswordStrength password={form.admin_password} hideWhenValid />
          </div>

          <TextField {...field("admin_confirm_password")} label="Confirm password" icon={Lock} required
            type={showConfirmPwd ? "text" : "password"} autoComplete="new-password"
            placeholder="Re-enter the password"
            touched={!!touched.admin_confirm_password || (form.admin_confirm_password.length > 0 && !confirmMatches && form.admin_confirm_password.length >= form.admin_password.length)}
            hint={confirmMatches ? "Passwords match" : undefined} hintSuccess
            trailing={<RevealButton shown={showConfirmPwd} onToggle={() => setShowConfirmPwd((v) => !v)} />} />

          <div className="mt-2 pt-4 border-t border-line flex flex-wrap gap-2">
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              {loading ? "Setting up…" : "Complete setup"}
            </button>
            <button type="button" onClick={() => setStep(1)} className="btn-outline">
              <ArrowLeft size={14} /> Back
            </button>
          </div>
        </form>
      )}

      {verifyOpen && (
        <SetupVerifyDialog
          email={adminEmail}
          mobile={adminMobile}
          verification={verification}
          submitting={loading}
          onComplete={completeSetup}
          onClose={() => setVerifyOpen(false)}
        />
      )}
    </AuthLayout>
  );
}
