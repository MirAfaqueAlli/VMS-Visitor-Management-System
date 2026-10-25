// frontend/src/pages/auth/Setup.jsx
// First-time setup: registers the organisation and its super administrator.
// One-time only — once the organisation exists this page redirects to sign-in
// (and the API refuses a second setup regardless).
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Building2, User, Lock, Mail, Phone, MapPin, Hash, ChevronRight,
  CheckCircle2, Eye, EyeOff, AlertCircle, ArrowLeft, UserCog, ShieldCheck, Loader2,
} from "lucide-react";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";
import useAuth from "../../hooks/useAuth";
import AuthLayout from "../../components/AuthLayout";
import { authStyles, NAVY } from "../../utils/authTheme";
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
    <div style={{ marginBottom: "16px" }}>
      <label htmlFor={name} style={authStyles.label}>
        {label}{required && <span style={{ color: "#dc2626" }}> *</span>}
      </label>
      <div style={{ position: "relative" }}>
        <Icon size={14} strokeWidth={1.8} style={authStyles.icon} />
        <input
          id={name} name={name} type={type} value={value}
          onChange={onChange} onBlur={onBlur}
          placeholder={placeholder} autoComplete={autoComplete} autoFocus={autoFocus}
          aria-invalid={invalid} aria-describedby={invalid && !hideErrorText ? errId : undefined}
          className="focus:!border-blue-500 focus:!bg-white focus:ring-2 focus:ring-blue-500/15"
          style={{
            ...authStyles.input,
            paddingRight: "38px",
            ...(mono ? { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", letterSpacing: "0.05em" } : {}),
            borderColor: invalid ? "#f87171" : "#e2e8f0",
            background:  invalid ? "#fef2f2" : "#f8fafc",
          }}
        />
        {trailing ?? (valid && (
          <CheckCircle2 size={15} aria-hidden="true"
            style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", color: "#16a34a" }} />
        ))}
      </div>
      {invalid && !hideErrorText ? (
        <p id={errId} role="alert" style={{ display: "flex", alignItems: "center", gap: "5px", marginTop: "6px", fontSize: "11.5px", color: "#dc2626" }}>
          <AlertCircle size={12} style={{ flexShrink: 0 }} /> {error}
        </p>
      ) : hint ? (
        <p style={{ marginTop: "6px", fontSize: "11px", color: hintSuccess ? "#16a34a" : "#94a3b8", fontWeight: hintSuccess ? 600 : 400 }}>{hint}</p>
      ) : null}
    </div>
  );
}

function RevealButton({ shown, onToggle }) {
  return (
    <button
      type="button" tabIndex={-1} onClick={onToggle}
      aria-label={shown ? "Hide password" : "Show password"}
      style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", color: "#94a3b8", background: "none", border: "none", cursor: "pointer", padding: 0 }}
    >
      {shown ? <EyeOff size={14} strokeWidth={1.8} /> : <Eye size={14} strokeWidth={1.8} />}
    </button>
  );
}

const SETUP_PANEL = {
  eyebrow:     "First-time setup",
  description: "Register the organisation and create the super administrator account. This page is available only once  before the system is set up.",
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
      toast("Setup has already been completed. Please sign in.", { icon: "🔒" });
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", color: "#64748b", fontSize: "13px", padding: "40px 0" }}>
          <Loader2 size={16} className="animate-spin" /> Checking system status…
        </div>
      </AuthLayout>
    );
  }

  if (status === "error") {
    return (
      <AuthLayout {...SETUP_PANEL}>
        <div style={{ textAlign: "center", padding: "24px 0" }}>
          <AlertCircle size={28} style={{ color: "#dc2626", margin: "0 auto 12px" }} />
          <h2 style={{ fontSize: "18px", fontWeight: 800, color: "#0f172a", margin: 0 }}>Can't reach the server</h2>
          <p style={{ fontSize: "13px", color: "#64748b", margin: "8px 0 20px", lineHeight: 1.6 }}>
            Setup can't continue until the system status is confirmed.
          </p>
          <button type="button" style={{ ...authStyles.primaryButton, cursor: "pointer" }}
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
      {/* Heading */}
      

      {/* Stepper */}
      <ol style={{ display: "flex", alignItems: "center", listStyle: "none", padding: 0, margin: "0 0 24px" }}>
        {steps.map(({ n, label }, i) => {
          const done = step > n;
          const current = step === n;
          return (
            <li key={n} style={{ display: "flex", alignItems: "center", flex: i < steps.length - 1 ? 1 : "0 0 auto" }}>
              <button
                type="button"
                onClick={() => done && setStep(n)}
                disabled={!done}
                style={{ display: "flex", alignItems: "center", gap: "8px", background: "none", border: "none", padding: 0, cursor: done ? "pointer" : "default" }}
              >
                <span style={{
                  width: "26px", height: "26px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "12px", fontWeight: 700,
                  background: current ? NAVY : done ? "#dcfce7" : "#f1f5f9",
                  color:      current ? "#ffffff" : done ? "#15803d" : "#94a3b8",
                  border:     done ? "1px solid #86efac" : "none",
                }}>
                  {done ? <CheckCircle2 size={14} /> : n}
                </span>
                <span style={{ fontSize: "12.5px", fontWeight: current || done ? 700 : 500, color: current || done ? "#0f172a" : "#94a3b8" }}>
                  {label}
                </span>
              </button>
              {i < steps.length - 1 && (
                <span aria-hidden="true" style={{ flex: 1, height: "2px", margin: "0 12px", borderRadius: "2px", background: done ? NAVY : "#e2e8f0" }} />
              )}
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

          <button type="submit" style={{ ...authStyles.primaryButton, cursor: "pointer", marginTop: "8px" }}>
            Continue <ChevronRight size={16} />
          </button>
        </form>
      )}

      {/* ── Step 2: Super administrator ──────────────────────────────────── */}
      {step === 2 && (
        <form onSubmit={handleSubmit} noValidate>
          <TextField {...field("admin_name")} label="Full name" icon={User} required autoFocus
            autoComplete="name" placeholder="e.g. Rajesh Kumar Mohanty" />
          <TextField {...field("admin_email")} label="Email" icon={Mail} type="email" required
            autoComplete="email" placeholder="e.g. superadmin@ohpc.co.in"
            hint="A verification code will be sent to this address." />
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
          <div style={{ marginTop: "-8px", marginBottom: "16px" }}>
            <PasswordStrength password={form.admin_password} hideWhenValid />
          </div>

          <TextField {...field("admin_confirm_password")} label="Confirm password" icon={Lock} required
            type={showConfirmPwd ? "text" : "password"} autoComplete="new-password"
            placeholder="Re-enter the password"
            touched={!!touched.admin_confirm_password || (form.admin_confirm_password.length > 0 && !confirmMatches && form.admin_confirm_password.length >= form.admin_password.length)}
            hint={confirmMatches ? "✓ Passwords match" : undefined} hintSuccess
            trailing={<RevealButton shown={showConfirmPwd} onToggle={() => setShowConfirmPwd((v) => !v)} />} />

          <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
            <button
              type="button" onClick={() => setStep(1)}
              style={{
                display: "flex", alignItems: "center", gap: "6px", padding: "12px 16px", borderRadius: "10px",
                border: "1.5px solid #e2e8f0", background: "#ffffff", color: "#334155", fontSize: "14px", fontWeight: 600, cursor: "pointer",
              }}
            >
              <ArrowLeft size={15} /> Back
            </button>
            <button type="submit" disabled={loading}
              style={{ ...authStyles.primaryButton, flex: 1, width: "auto", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1 }}>
              {loading ? <><Loader2 size={16} className="animate-spin" /> Setting up…</> : <><CheckCircle2 size={16} /> Complete setup</>}
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
