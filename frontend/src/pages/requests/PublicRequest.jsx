// frontend/src/pages/requests/PublicRequest.jsx
import { useState, useEffect, useRef } from "react";
import {
  Shield, Building2, User, FileText, CheckCircle2, ChevronDown,
  Briefcase, UserCircle, Lock, Phone, Mail, MapPin,
  ArrowRight, RefreshCw, Loader2, Check,
} from "lucide-react";
import { RecaptchaVerifier, signInWithPhoneNumber } from "firebase/auth";
import { auth } from "../../utils/firebase";
import useCountdown from "../../hooks/useCountdown";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";

const getISTDateString = (d = new Date()) => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
};

/* ── Style constants ──────────────────────────────────────────────────────── */
const selectCls = "w-full bg-bg-primary text-loud text-sm px-3 py-2.5 rounded-lg border border-subtle focus:outline-none focus:border-accent transition-colors appearance-none cursor-pointer";
const inputCls  = "w-full bg-bg-primary text-loud text-sm px-3 py-2.5 rounded-lg border border-subtle focus:outline-none focus:border-accent transition-colors placeholder:text-faint";
const lockedCls = "w-full bg-bg-secondary text-loud text-sm px-3 py-2.5 rounded-lg border border-subtle opacity-80 cursor-not-allowed flex items-center gap-2";
const labelCls  = "block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1.5";

const VISIT_TYPES = [
  { id: "INDIVIDUAL", label: "Individual", desc: "Personal / private visit", icon: UserCircle },
  { id: "BUSINESS",   label: "Business",   desc: "Official / company visit", icon: Briefcase  },
];

/* ── Masking helpers ────────────────────────────────────────── */
function maskPhone(phone) {
  if (!phone || phone.length < 6) return phone;
  return phone.slice(0, 2) + '•'.repeat(Math.max(phone.length - 5, 3)) + phone.slice(-3);
}
function maskEmail(email) {
  if (!email || !email.includes('@')) return email;
  const [local, domain] = email.split('@');
  const visible = local.length > 1 ? local[0] : local;
  return `${visible}${'•'.repeat(Math.min(local.length - 1, 4))}@${domain}`;
}

/* ── OTP Input component ────────────────────────────────────── */
function OtpInput({ value, onChange, disabled }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      maxLength={6}
      value={value}
      onChange={e => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      disabled={disabled}
      placeholder="• • • • • •"
      className={`${inputCls} text-center text-xl tracking-[0.5em] font-bold`}
    />
  );
}

/* ── Step indicator ────────────────────────────────────────────────────────── */
function StepBar({ step }) {
  const steps = ["Identity", "Verify OTP", "Visit Request"];
  return (
    <div className="flex items-center justify-center gap-0 mb-10">
      {steps.map((label, i) => {
        const idx  = i + 1;
        const done = step > idx;
        const active = step === idx;
        return (
          <div key={label} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all"
                style={{
                  background: done ? "var(--color-accent)" : active ? "var(--color-accent)" : "var(--color-bg-secondary)",
                  color: done || active ? "#fff" : "var(--color-text-muted)",
                  border: "2px solid " + (done || active ? "var(--color-accent)" : "var(--color-border)"),
                }}
              >
                {done ? <Check size={14} /> : idx}
              </div>
              <span className="text-[10px] mt-1 font-medium" style={{ color: active ? "var(--color-accent)" : "var(--color-text-faint)" }}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className="w-12 h-px mb-5 mx-1" style={{ background: step > idx ? "var(--color-accent)" : "var(--color-border)" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Page shell (must be OUTSIDE main component to prevent remount on re-render) ── */
function Shell({ step, children }) {
  return (
    <div className="min-h-screen bg-bg-primary py-12 px-4 sm:px-6">
      <div className="fixed inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(59,130,246,0.07) 0%, transparent 70%)" }} />
      {/*
        recaptcha-container MUST always be in the DOM while this page is mounted.
        Firebase's RecaptchaVerifier anchors to this element when size='invisible'.
        Keeping it here (outside the conditional step renders) means it survives
        all step transitions without causing a "element not found" error.
      */}
      <div id="recaptcha-container" style={{ position: 'absolute', bottom: 0, left: 0 }} />
      <div className="max-w-xl mx-auto relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4 overflow-hidden">
            <img src="/logo.png" alt="VMS Logo" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-3xl font-bold text-loud">
            Visitor <em className="italic text-accent">Pre-Registration</em>
          </h1>
          <p className="text-muted mt-1 text-sm">Request approval to visit a unit or branch.</p>
        </div>
        {step < 4 && <StepBar step={step} />}
        {children}
      </div>
    </div>
  );
}


/* ── Locked field ───────────────────────────────────────────────────────────── */
function LockedField({ label, value }) {
  return (
    <div className="space-y-1.5">
      <label className={labelCls}>{label}</label>
      <div className={lockedCls} style={{ background: "var(--color-bg-secondary)" }}>
        <Lock size={12} style={{ color: "var(--color-accent)", flexShrink: 0 }} />
        <span className="truncate">{value}</span>
      </div>
    </div>
  );
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   MAIN COMPONENT
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
export default function PublicRequest() {
  // ── Step state ──────────────────────────────────────────────────────────────
  const [step, setStep] = useState(1); // 1 = identity, 2 = OTP, 3 = request form, 4 = success

  // ── Step 1 ─ Identity ─────────────────────────────────────────────────────
  // Tender 1.1.1: outside visitors provide name, address, email and mobile number
  const [identity, setIdentity] = useState({
    visitor_name: "", visitor_email: "", visitor_phone: "", visitor_address: "",
  });
  const [step1Busy, setStep1Busy] = useState(false);

  // ── Step 2 ─ OTP ──────────────────────────────────────────────────────────
  // Phone OTP — Firebase sends and checks the SMS code.
  // confirmationResult: the object returned by signInWithPhoneNumber()
  // phoneToken: short-lived proof from /verify-firebase-phone (after the backend
  //             verifies Firebase's idToken), required by /verify-email-otp
  const [confirmationResult, setConfirmationResult] = useState(null);
  const [phoneOtp,       setPhoneOtp]       = useState("");
  const [phoneToken,     setPhoneToken]     = useState(null);
  const [phoneVerified,  setPhoneVerified]  = useState(false);
  const [phoneVerifying, setPhoneVerifying] = useState(false);
  const [phoneResending, setPhoneResending] = useState(false);

  // Email OTP
  const [emailOtp,      setEmailOtp]      = useState("");
  const [emailVerified, setEmailVerified] = useState(false);
  const [emailVerifying, setEmailVerifying] = useState(false);
  const [emailResending, setEmailResending] = useState(false);
  const [devEmailOtp,    setDevEmailOtp]   = useState(null);

  const phoneTimer = useCountdown();
  const emailTimer = useCountdown();

  // ── Step 2 → 3 transition token ───────────────────────────────────────────
  const [visitorToken, setVisitorToken] = useState(null);

  // ── reCAPTCHA ref — keeps the verifier instance between renders ───────────
  const recaptchaVerifierRef = useRef(null);

  const clearRecaptcha = () => {
    if (recaptchaVerifierRef.current) {
      try { recaptchaVerifierRef.current.clear(); } catch { /* already cleared */ }
      recaptchaVerifierRef.current = null;
    }
  };

  // Clear the reCAPTCHA verifier when the page unmounts
  useEffect(() => clearRecaptcha, []);

  /** Sends the SMS code through Firebase. A fresh verifier each time — a stale one causes invalid-app-credential. */
  const sendFirebaseSms = async (phone) => {
    clearRecaptcha();
    recaptchaVerifierRef.current = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
    try {
      const confirmation = await signInWithPhoneNumber(auth, `+91${phone}`, recaptchaVerifierRef.current);
      setConfirmationResult(confirmation);
    } catch (err) {
      clearRecaptcha();
      throw err;
    }
  };

  // ── Step 3 ─ Request form ──────────────────────────────────────────────────
  const [formData, setFormData] = useState({
    visit_type: "INDIVIDUAL", unit_id: "", department_id: "",
    host_user_id: "", purpose: "", visit_date: "",
    visit_start_time: "", visit_end_time: "", company_name: "",
  });
  const [units,       setUnits]       = useState([]);
  const [departments, setDepartments] = useState([]);
  const [hosts,       setHosts]       = useState([]);
  const [loadingDepts, setLoadingDepts] = useState(false);
  const [loadingHosts, setLoadingHosts] = useState(false);
  const [submitting, setSubmitting]   = useState(false);

  // ── Load units on mount ────────────────────────────────────────────────────
  useEffect(() => {
    apiClient.get("/units/public")
      .then(res => setUnits(res.data?.data ?? []))
      .catch(() => toast.error("Could not load units."));
  }, []);

  // ── Departments cascade ────────────────────────────────────────────────────
  useEffect(() => {
    if (!formData.unit_id) { setDepartments([]); setHosts([]); setFormData(p => ({ ...p, department_id: "", host_user_id: "" })); return; }
    setLoadingDepts(true);
    setDepartments([]); setHosts([]);
    setFormData(p => ({ ...p, department_id: "", host_user_id: "" }));
    apiClient.get("/departments/public", { params: { unit_id: formData.unit_id } })
      .then(res => setDepartments(res.data?.data ?? []))
      .catch(() => toast.error("Failed to load departments."))
      .finally(() => setLoadingDepts(false));
  }, [formData.unit_id]);

  // ── Hosts cascade ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!formData.department_id) { setHosts([]); setFormData(p => ({ ...p, host_user_id: "" })); return; }
    setLoadingHosts(true);
    setHosts([]); setFormData(p => ({ ...p, host_user_id: "" }));
    apiClient.get("/users/hosts", { params: { department_id: formData.department_id, unit_id: formData.unit_id } })
      .then(res => setHosts(res.data?.data ?? []))
      .catch(() => toast.error("Failed to load hosts."))
      .finally(() => setLoadingHosts(false));
  }, [formData.department_id]);

  /* ==============================================================================
   STEP 1 ─ Send OTPs
============================================================================== */
  const handleSendOtps = async (e) => {
    e.preventDefault();
    const { visitor_name, visitor_email, visitor_phone, visitor_address } = identity;
    if (!visitor_name.trim())    { toast.error("Full name is required."); return; }
    if (!/^\d{10}$/.test(visitor_phone.trim())) { toast.error("Valid 10-digit mobile number is required."); return; }
    if (!visitor_email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(visitor_email.trim())) { toast.error("Valid email address is required."); return; }
    if (visitor_address.trim().length < 5) { toast.error("Please enter your full address."); return; }

    setStep1Busy(true);
    try {
      // ── Phone OTP (Firebase sends the SMS) ────────────────────────────────
      // When VITE_FIREBASE_TEST_MODE=true, firebase.js skips reCAPTCHA for the
      // test phone numbers registered in the Firebase Console.
      await sendFirebaseSms(visitor_phone.trim());
      phoneTimer.start();

      // ── Email OTP ─────────────────────────────────────────────────────────
      const emailRes = await apiClient.post("/public-auth/send-email-otp", { email: visitor_email.trim() });
      if (emailRes.data?.data?.dev_otp) setDevEmailOtp(emailRes.data.data.dev_otp);
      emailTimer.start();

      toast.success("OTP sent to your phone via SMS and to your email!");
      setStep(2);
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || "Failed to send OTPs. Please try again.";
      toast.error(msg);
    } finally {
      setStep1Busy(false);
    }
  };

  /* ==============================================================================
   STEP 2 ─ Verify OTPs
============================================================================== */
  // ── Phone: Firebase checks the code; our backend verifies Firebase's idToken ──
  //    and returns a short-lived phone_token
  const verifyPhone = async () => {
    if (phoneOtp.length !== 6) { toast.error("Enter the 6-digit phone OTP."); return; }
    if (!confirmationResult)   { toast.error("No active phone OTP session. Please go back and try again."); return; }
    setPhoneVerifying(true);
    try {
      const userCredential = await confirmationResult.confirm(phoneOtp);
      const idToken        = await userCredential.user.getIdToken();
      const res = await apiClient.post("/public-auth/verify-firebase-phone", {
        phone: identity.visitor_phone.trim(),
        idToken,
      });
      setPhoneToken(res.data?.data?.phone_token ?? null);
      setPhoneVerified(true);
      toast.success("Phone verified! ✓");
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || "Invalid phone OTP.";
      toast.error(msg);
    } finally {
      setPhoneVerifying(false);
    }
  };

  const verifyEmail = async () => {
    if (emailOtp.length !== 6) { toast.error("Enter the 6-digit email OTP."); return; }
    // The backend requires the phone proof before issuing the visitor token
    if (!phoneVerified || !phoneToken) { toast.error("Please verify your phone number first."); return; }
    setEmailVerifying(true);
    try {
      const res = await apiClient.post("/public-auth/verify-email-otp", {
        email:           identity.visitor_email.trim(),
        otp:             emailOtp,
        visitor_name:    identity.visitor_name.trim(),
        visitor_phone:   identity.visitor_phone.trim(),
        visitor_address: identity.visitor_address.trim(),
        phone_token:     phoneToken,
      });
      setVisitorToken(res.data?.data?.visitor_token);
      setEmailVerified(true);
      toast.success("Email verified! ✓");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Invalid email OTP.");
    } finally {
      setEmailVerifying(false);
    }
  };

  // ── Phone: resend via Firebase ──────────────────────────────────────────
  const resendPhone = async () => {
    setPhoneResending(true);
    try {
      await sendFirebaseSms(identity.visitor_phone.trim());
      phoneTimer.start();
      setPhoneOtp("");
      setPhoneVerified(false);
      setPhoneToken(null);
      toast.success("Phone OTP resent.");
    } catch (err) {
      toast.error(err?.message || "Failed to resend phone OTP.");
    } finally {
      setPhoneResending(false);
    }
  };

  const resendEmail = async () => {
    setEmailResending(true);
    try {
      const res = await apiClient.post("/public-auth/send-email-otp", { email: identity.visitor_email.trim() });
      if (res.data?.data?.dev_otp) setDevEmailOtp(res.data.data.dev_otp);
      emailTimer.start();
      setEmailOtp(""); setEmailVerified(false);
      toast.success("Email OTP resent.");
    } catch { toast.error("Failed to resend email OTP."); }
    finally { setEmailResending(false); }
  };

  const proceedToForm = () => {
    if (!phoneVerified || !emailVerified) { toast.error("Please verify both phone and email."); return; }
    // Store token in sessionStorage (tab-scoped, auto-cleared on tab close)
    sessionStorage.setItem("vms_visitor_token", visitorToken);
    setStep(3);
  };

  /* ==============================================================================
   STEP 3 ─ Submit Request
============================================================================== */
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.unit_id)       { toast.error("Please select a unit."); return; }
    if (!formData.department_id) { toast.error("Please select a department."); return; }
    if (!formData.host_user_id)  { toast.error("Please select a host."); return; }
    if (formData.visit_type === "BUSINESS" && !formData.company_name.trim()) { toast.error("Company name is required for business visits."); return; }

    const token = visitorToken || sessionStorage.getItem("vms_visitor_token");
    if (!token) { toast.error("Session expired. Please verify your identity again."); setStep(1); return; }

    setSubmitting(true);
    try {
      await apiClient.post(
        "/visit-requests/public",
        {
          unit_id:          parseInt(formData.unit_id),
          department_id:    parseInt(formData.department_id),
          host_user_id:     parseInt(formData.host_user_id),
          visit_category:   formData.visit_type,
          purpose:          formData.purpose.trim(),
          visit_date:       formData.visit_date,
          visit_start_time: formData.visit_start_time || undefined,
          visit_end_time:   formData.visit_end_time   || undefined,
          company_name:     formData.company_name.trim() || undefined,
        },
        { headers: { "X-Visitor-Token": token } }
      );
      sessionStorage.removeItem("vms_visitor_token");
      setStep(4);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to submit request.");
    } finally {
      setSubmitting(false);
    }
  };

  /* ==============================================================================
     RENDER
  ============================================================================== */

  /* Step 4: Success */
  if (step === 4) {
    return (
      <Shell step={step}>
        <div className="vms-card rounded-2xl p-10 text-center shadow-card animate-fade-in">
          <div className="w-16 h-16 rounded-full bg-mixed-bg flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 size={32} className="text-accent" />
          </div>
          <h2 className="text-2xl font-bold text-loud mb-2">Request Submitted!</h2>
          <p className="text-muted text-sm mb-6 leading-relaxed">
            Your visit request has been sent to the host for approval.<br />You will be notified once it is confirmed.
          </p>
          <button
            onClick={() => { setStep(1); setIdentity({ visitor_name: "", visitor_email: "", visitor_phone: "", visitor_address: "" }); setPhoneVerified(false); setPhoneToken(null); setConfirmationResult(null); setDevEmailOtp(null); setEmailVerified(false); setPhoneOtp(""); setEmailOtp(""); setFormData({ visit_type: "INDIVIDUAL", unit_id: "", department_id: "", host_user_id: "", purpose: "", visit_date: "", visit_start_time: "", visit_end_time: "", company_name: "" }); }}
            className="btn-primary w-full"
          >
            Submit Another Request
          </button>
        </div>
      </Shell>
    );
  }

  /* ── Step 1: Identity Form ────────────────────────────────────────────────── */
  if (step === 1) {
    return (
      <Shell step={step}>
        <form onSubmit={handleSendOtps} className="vms-card rounded-2xl p-8 shadow-card space-y-5 animate-fade-in">
          <div>
            <h3 className="text-base font-semibold text-loud flex items-center gap-2 mb-4">
              <User size={16} className="text-accent" /> Your Identity
            </h3>
            <p className="text-xs text-faint mb-5 leading-relaxed">
              Enter your details below. Your phone and email will be verified via OTP before you can submit a request.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2 space-y-1.5">
                <label className={labelCls}>Full Name *</label>
                <input type="text" required value={identity.visitor_name}
                  onChange={e => setIdentity(p => ({ ...p, visitor_name: e.target.value }))}
                  placeholder="As on your government ID"
                  className={inputCls} />
              </div>

              <div className="space-y-1.5">
                <label className={labelCls}>Mobile Number *</label>
                <input type="tel" required value={identity.visitor_phone}
                  onChange={e => setIdentity(p => ({ ...p, visitor_phone: e.target.value.replace(/\D/g, "").slice(0, 10) }))}
                  placeholder="10-digit mobile number"
                  maxLength={10}
                  className={inputCls} />
              </div>

              <div className="space-y-1.5">
                <label className={labelCls}>Email Address *</label>
                <input type="email" required value={identity.visitor_email}
                  onChange={e => setIdentity(p => ({ ...p, visitor_email: e.target.value }))}
                  placeholder="you@email.com"
                  className={inputCls} />
              </div>

              <div className="sm:col-span-2 space-y-1.5">
                <label className={labelCls}>Address *</label>
                <textarea required rows={2} value={identity.visitor_address}
                  onChange={e => setIdentity(p => ({ ...p, visitor_address: e.target.value.slice(0, 255) }))}
                  placeholder="House / street, city, district, PIN code"
                  maxLength={255}
                  className={inputCls} />
              </div>
            </div>
          </div>

          <button type="submit" disabled={step1Busy} className="btn-primary w-full py-3 flex items-center justify-center gap-2">
            {step1Busy
              ? <><Loader2 size={16} className="animate-spin" /> Sending OTPs...</>
              : <><ArrowRight size={16} /> Verify & Continue</>
            }
          </button>

          <p className="text-[11px] text-faint text-center">
            OTPs will be sent to your phone and email for verification.
          </p>
        </form>
      </Shell>
    );
  }

  /* ── Step 2: OTP Verification ────────────────────────────────────────────── */
  if (step === 2) {
    const bothVerified = phoneVerified && emailVerified;
    return (
      <Shell step={step}>
        <div className="vms-card rounded-2xl p-8 shadow-card space-y-6 animate-fade-in">
          <div>
            <h3 className="text-base font-semibold text-loud flex items-center gap-2 mb-1">
              <Shield size={16} className="text-accent" /> Verify Your Identity
            </h3>
            <p className="text-xs text-faint">Enter the 6-digit codes sent to your phone and email.</p>
          </div>

          {/* Phone OTP — SMS gateway */}
          <div className="space-y-3 p-4 rounded-xl border" style={{ borderColor: phoneVerified ? "var(--color-accent)" : "var(--color-border)", background: phoneVerified ? "rgba(59,130,246,0.05)" : "var(--color-bg-secondary)" }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Phone size={14} className="text-accent" />
                <span className="text-sm font-semibold text-loud">Phone OTP</span>
              </div>
              {phoneVerified
                ? <span className="text-xs font-bold text-accent flex items-center gap-1"><Check size={12} /> Verified</span>
                : <span className="text-xs text-faint">{maskPhone(identity.visitor_phone)}</span>
              }
            </div>

            {!phoneVerified && (
              <>
                <p className="text-[11px] text-faint leading-relaxed">
                  We sent an SMS to <strong>+91 {maskPhone(identity.visitor_phone)}</strong>. Enter the 6-digit code below.
                </p>
                <OtpInput value={phoneOtp} onChange={setPhoneOtp} disabled={phoneVerifying} />
                <div className="flex items-center gap-2">
                  <button type="button" onClick={verifyPhone} disabled={phoneVerifying || phoneOtp.length < 6}
                    className="btn-primary flex-1 py-2 text-sm flex items-center justify-center gap-1.5">
                    {phoneVerifying ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    {phoneVerifying ? "Verifying..." : "Verify Phone"}
                  </button>
                  <button type="button" onClick={resendPhone} disabled={phoneTimer.count > 0 || phoneResending}
                    className="text-xs text-accent disabled:text-faint disabled:cursor-not-allowed flex items-center gap-1 whitespace-nowrap">
                    {phoneResending ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    {phoneTimer.count > 0 ? `Resend (${phoneTimer.count}s)` : "Resend"}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Email OTP */}
          <div className="space-y-3 p-4 rounded-xl border" style={{ borderColor: emailVerified ? "var(--color-accent)" : "var(--color-border)", background: emailVerified ? "rgba(59,130,246,0.05)" : "var(--color-bg-secondary)" }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mail size={14} className="text-accent" />
                <span className="text-sm font-semibold text-loud">Email OTP</span>
              </div>
              {emailVerified
                ? <span className="text-xs font-bold text-accent flex items-center gap-1"><Check size={12} /> Verified</span>
                : <span className="text-xs text-faint">{maskEmail(identity.visitor_email)}</span>
              }
            </div>

            {devEmailOtp && !emailVerified && (
              <div className="text-[11px] text-accent bg-mixed-bg rounded px-2 py-1">
                {"\uD83D\uDD27 Dev mode \u2014 OTP: "}<strong>{devEmailOtp}</strong>
              </div>
            )}

            {!emailVerified && (
              <>
                <OtpInput value={emailOtp} onChange={setEmailOtp} disabled={emailVerifying} />
                <div className="flex items-center gap-2">
                  <button type="button" onClick={verifyEmail} disabled={emailVerifying || emailOtp.length < 6 || !phoneVerified}
                    className="btn-primary flex-1 py-2 text-sm flex items-center justify-center gap-1.5">
                    {emailVerifying ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    {emailVerifying ? "Verifying..." : phoneVerified ? "Verify Email" : "Verify phone first"}
                  </button>
                  <button type="button" onClick={resendEmail} disabled={emailTimer.count > 0 || emailResending}
                    className="text-xs text-accent disabled:text-faint disabled:cursor-not-allowed flex items-center gap-1 whitespace-nowrap">
                    {emailResending ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    {emailTimer.count > 0 ? `Resend (${emailTimer.count}s)` : "Resend"}
                  </button>
                </div>
              </>
            )}
          </div>

          <button type="button" onClick={proceedToForm} disabled={!bothVerified}
            className="btn-primary w-full py-3 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed">
            <ArrowRight size={16} />
            Continue to Request Form
          </button>

          <button type="button" onClick={() => setStep(1)} className="w-full text-xs text-faint hover:text-muted text-center transition-colors">
            {"\u2190 Edit my details"}
          </button>
        </div>
      </Shell>
    );
  }

  /* ── Step 3: Request Form ─────────────────────────────────────────────────── */
  return (
    <Shell>
      <form onSubmit={handleSubmit} className="vms-card rounded-2xl p-8 shadow-card space-y-8 animate-fade-in">

        {/* Section 1: Verified Identity (locked) */}
        <div>
          <h3 className="text-base font-semibold text-loud flex items-center gap-2 mb-1">
            <Lock size={15} className="text-accent" /> Your Verified Identity
          </h3>
          <p className="text-[11px] text-faint mb-4">These details were verified via OTP and cannot be changed.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <LockedField label="Full Name" value={identity.visitor_name} icon={User} />
            </div>
            <LockedField label="Mobile Number" value={identity.visitor_phone} icon={Phone} />
            <LockedField label="Email Address" value={identity.visitor_email} icon={Mail} />
            <div className="sm:col-span-2">
              <LockedField label="Address" value={identity.visitor_address} icon={MapPin} />
            </div>
          </div>
        </div>

        <div className="h-px bg-border w-full" />

        {/* Section 2: Visit Type */}
        <div>
          <h3 className="text-base font-semibold text-loud flex items-center gap-2 mb-4">
            <FileText size={16} className="text-accent" /> Type of Visit
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {VISIT_TYPES.map(({ id, label, desc, icon: Icon }) => (
              <button key={id} type="button"
                onClick={() => setFormData(p => ({ ...p, visit_type: id, company_name: "" }))}
                className={`p-4 rounded-xl border text-left transition-all duration-200 ${formData.visit_type === id ? "border-accent bg-mixed-bg" : "border-subtle hover:border-border"}`}>
                <Icon size={20} className={`mb-2 ${formData.visit_type === id ? "text-accent" : "text-muted"}`} />
                <div className={`font-semibold text-sm ${formData.visit_type === id ? "text-accent" : "text-loud"}`}>{label}</div>
                <div className="text-[11px] text-faint mt-0.5 leading-snug">{desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="h-px bg-border w-full" />

        {/* Section 3: Where are you visiting? */}
        <div>
          <h3 className="text-base font-semibold text-loud flex items-center gap-2 mb-4">
            <Building2 size={16} className="text-accent" /> Where are you visiting?
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">

            <div className="sm:col-span-2 space-y-1.5">
              <label className={labelCls}>Select Unit / Branch *</label>
              <div className="relative">
                <select name="unit_id" required value={formData.unit_id}
                  onChange={e => setFormData(p => ({ ...p, unit_id: e.target.value }))}
                  className={selectCls}>
                  <option value="">{"\u2014 Select the unit you're visiting \u2014"}</option>
                  {units.map(u => <option key={u.id} value={u.id}>{u.name}{u.city ? ` \u2014 ${u.city}` : ""}</option>)}
                </select>
                <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className={labelCls}>Department *</label>
              <div className="relative">
                <select name="department_id" required value={formData.department_id}
                  onChange={e => setFormData(p => ({ ...p, department_id: e.target.value }))}
                  disabled={!formData.unit_id || loadingDepts}
                  className={`${selectCls} disabled:opacity-50 disabled:cursor-not-allowed`}>
                  <option value="">{!formData.unit_id ? "\u2014 Select Unit First \u2014" : loadingDepts ? "Loading..." : "\u2014 Select Department \u2014"}</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className={labelCls}>Host / Contact Person *</label>
              <div className="relative">
                <select name="host_user_id" required value={formData.host_user_id}
                  onChange={e => setFormData(p => ({ ...p, host_user_id: e.target.value }))}
                  disabled={!formData.department_id || loadingHosts}
                  className={`${selectCls} disabled:opacity-50 disabled:cursor-not-allowed`}>
                  <option value="">{!formData.department_id ? "\u2014 Select Department First \u2014" : loadingHosts ? "Loading..." : "\u2014 Select Host \u2014"}</option>
                  {hosts.map(h => <option key={h.id} value={h.id}>{h.full_name}{h.designation_name ? ` \u2014 ${h.designation_name}` : ""}</option>)}
                </select>
                <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className={labelCls}>Date of Visit *</label>
              <input type="date" name="visit_date" required value={formData.visit_date}
                onChange={e => setFormData(p => ({ ...p, visit_date: e.target.value }))}
                min={getISTDateString()}
                className={inputCls} />
            </div>

            <div className="space-y-1.5">
              <label className={labelCls}>Time Window (Optional)</label>
              <div className="flex items-center gap-2">
                <input type="time" value={formData.visit_start_time}
                  onChange={e => {
                    const val = e.target.value;
                    setFormData(p => {
                      const next = { ...p, visit_start_time: val };
                      if (val) {
                        const [h, m] = val.split(':').map(Number);
                        const total = h * 60 + m + 30;
                        const auto30 = `${String(Math.floor(total / 60) % 24).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`;
                        
                        const noEnd          = !p.visit_end_time;
                        const endBeforeStart = p.visit_end_time && p.visit_end_time <= val;
                        const endWithinAuto  = p.visit_end_time && p.visit_end_time <= auto30;
                        
                        if (noEnd || endBeforeStart || endWithinAuto) {
                          next.visit_end_time = auto30;
                        }
                      }
                      return next;
                    });
                  }}
                  className={inputCls} />
                <span className="text-faint text-xs shrink-0">to</span>
                <input type="time" value={formData.visit_end_time}
                  onChange={e => setFormData(p => ({ ...p, visit_end_time: e.target.value }))}
                  className={inputCls} />
              </div>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <label className={labelCls}>Purpose of Visit *</label>
              <input type="text" name="purpose" required minLength={5} value={formData.purpose}
                onChange={e => setFormData(p => ({ ...p, purpose: e.target.value }))}
                placeholder="e.g. Product demo, Project review, Official discussion"
                className={inputCls} />
            </div>

            {formData.visit_type === "BUSINESS" && (
              <div className="space-y-1.5 sm:col-span-2 animate-fade-in">
                <label className={labelCls}>Company / Organisation Name *</label>
                <input type="text" required value={formData.company_name}
                  onChange={e => setFormData(p => ({ ...p, company_name: e.target.value }))}
                  placeholder="Your company or organisation name"
                  className={inputCls} />
              </div>
            )}
          </div>
        </div>

        <button type="submit" disabled={submitting}
          className="btn-primary w-full py-3.5 text-sm font-semibold flex items-center justify-center gap-2">
          {submitting
            ? <><Loader2 size={16} className="animate-spin" /> Submitting...</>
            : <><FileText size={16} /> Submit Visit Request</>
          }
        </button>

        <p className="text-[11px] text-faint text-center leading-relaxed">
          By submitting, you agree that your details may be shared with the host for security verification.
        </p>
      </form>
    </Shell>
  );
}
