// frontend/src/pages/requests/PublicRequest.jsx
import { useState, useEffect, useRef } from "react";
import {
  Building2, User, FileText, CheckCircle2, ChevronDown,
  Briefcase, UserCircle, Lock, Phone, Mail, MapPin,
  ArrowRight, RefreshCw, Loader2, Check, ArrowLeft,
  UserPlus, Calendar, ShieldCheck, LogOut, KeyRound,
  Shield, HelpCircle,
} from "lucide-react";
import { RecaptchaVerifier, signInWithPhoneNumber } from "firebase/auth";
import { auth, DEV_PHONE_OTP } from "../../utils/firebase";
import useCountdown from "../../hooks/useCountdown";

/** The phone number a phone_token was issued for (the server still verifies the token). */
const phoneInToken = (token) => {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(part)).phone ?? null;
  } catch {
    return null;
  }
};
import BrandLogo from "../../components/BrandLogo";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";

const getISTDateString = (d = new Date()) => {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
};

/* ── Style constants ───────────────────────────────────────────────────────── */
const selectCls =
  "w-full bg-bg-primary text-loud text-sm px-3.5 py-2.5 rounded-xl border border-subtle focus:outline-none focus:border-accent transition-colors appearance-none cursor-pointer";
const inputCls =
  "w-full bg-bg-primary text-loud text-sm px-3.5 py-2.5 rounded-xl border border-subtle focus:outline-none focus:border-accent transition-colors placeholder:text-faint";
const labelCls =
  "block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5";

const VISIT_TYPES = [
  {
    id: "INDIVIDUAL",
    label: "Individual Visit",
    desc: "Personal or private visitor meeting staff",
    icon: UserCircle,
  },
  {
    id: "BUSINESS",
    label: "Official / Business",
    desc: "Vendor, contractor, audit, or corporate meeting",
    icon: Briefcase,
  },
];

/* ── Masking helpers ───────────────────────────────────────────────────────── */
function maskEmail(email) {
  if (!email || !email.includes("@")) return email;
  const [local, domain] = email.split("@");
  const visible = local.length > 1 ? local[0] : local;
  return `${visible}${"•".repeat(Math.min(local.length - 1, 4))}@${domain}`;
}

/* ── Tricolour top band ────────────────────────────────────────────────────── */
function TricolourBand() {
  return (
    <div aria-hidden="true" className="w-full flex h-1">
      <span className="flex-1 bg-[#FF9933]" />
      <span className="flex-1 bg-white" />
      <span className="flex-1 bg-[#138808]" />
    </div>
  );
}

/* ── Clean Header Bar ──────────────────────────────────────────────────────── */
function HeaderBar() {
  return (
    <header className="w-full bg-bg-secondary border-b border-border sticky top-0 z-30 shadow-sm">
      <TricolourBand />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand identity */}
        <div className="flex items-center gap-3.5">
          <BrandLogo height={34} />
          <div className="h-6 w-px bg-border hidden sm:block" />
          <div className="hidden sm:block">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-loud tracking-tight">Visitor Portal</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-mixed-bg text-accent">
                Pre-Registration
              </span>
            </div>
            <p className="text-[11px] text-faint">Odisha Hydro Power Corporation Ltd.</p>
          </div>
        </div>

        {/* Security badge only (staff login button removed) */}
        <div className="flex items-center gap-2 text-xs text-faint">
          <ShieldCheck size={16} className="text-accent" />
          <span className="hidden sm:inline">256-bit Encrypted Access</span>
        </div>
      </div>
    </header>
  );
}

/* ── Sleek Minimal Step Tracker ────────────────────────────────────────────── */
function StepTracker({ currentStep }) {
  const steps = [
    { num: 1, title: "Identity" },
    { num: 2, title: "Verification" },
    { num: 3, title: "Visit Details" },
    { num: 4, title: "Confirmation" },
  ];

  return (
    <div className="w-full max-w-xl mx-auto mb-8 px-4">
      <div className="flex items-center justify-between relative">
        {/* Connecting line */}
        <div className="absolute left-6 right-6 top-3.5 -translate-y-1/2 h-0.5 bg-border -z-0" />
        <div
          className="absolute left-6 top-3.5 -translate-y-1/2 h-0.5 bg-accent transition-all duration-300 -z-0"
          style={{ width: `${((currentStep - 1) / (steps.length - 1)) * 100}%` }}
        />

        {steps.map(({ num, title }) => {
          const isDone = currentStep > num;
          const isActive = currentStep === num;
          return (
            <div key={num} className="flex flex-col items-center relative z-10">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  isDone
                    ? "bg-accent text-white shadow-sm ring-4 ring-bg-primary"
                    : isActive
                    ? "bg-accent text-white shadow-md ring-4 ring-accent/20"
                    : "bg-bg-secondary text-faint border-2 border-border ring-4 ring-bg-primary"
                }`}
              >
                {isDone ? <Check size={13} strokeWidth={2.5} /> : num}
              </div>
              <span
                className={`text-[11px] mt-1 font-medium transition-colors ${
                  isActive ? "text-accent font-semibold" : isDone ? "text-loud" : "text-faint"
                }`}
              >
                {title}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── OTP Input component ───────────────────────────────────────────────────── */
function OtpField({ value, onChange, disabled, placeholder = "• • • • • •" }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      disabled={disabled}
      placeholder={placeholder}
      className="w-full bg-bg-primary text-loud text-center text-2xl tracking-[0.6em] font-mono font-bold py-3 px-4 rounded-xl border border-subtle focus:outline-none focus:border-accent transition-all shadow-inner disabled:opacity-50"
    />
  );
}

/* ── Page Shell ────────────────────────────────────────────────────────────── */
function Shell({ step, children }) {
  return (
    <div className="min-h-screen bg-bg-primary text-text flex flex-col">
      <div id="recaptcha-container" style={{ position: "absolute", bottom: 0, left: 0 }} />

      <HeaderBar />

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
        {step < 4 && <StepTracker currentStep={step} />}
        {children}
      </main>

      <footer className="w-full border-t border-border bg-bg-secondary py-5 px-4 text-center text-xs text-faint">
        <p>© {new Date().getFullYear()} Odisha Hydro Power Corporation Ltd. Visitor Management System.</p>
      </footer>
    </div>
  );
}

/* ==============================================================================
   MAIN COMPONENT
============================================================================== */
export default function PublicRequest() {
  const [step, setStep] = useState(1);
  const [authMode, setAuthMode] = useState("login"); // "login" | "register"

  const [identity, setIdentity] = useState({
    visitor_name: "",
    visitor_email: "",
    visitor_phone: "",
    visitor_address: "",
  });
  const [isExistingProfile, setIsExistingProfile] = useState(false);
  const [step1Busy, setStep1Busy] = useState(false);

  // Phone OTP
  const [confirmationResult, setConfirmationResult] = useState(null);
  const [phoneOtp, setPhoneOtp] = useState("");
  const [phoneToken, setPhoneToken] = useState(null);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [phoneVerifying, setPhoneVerifying] = useState(false);
  const [phoneResending, setPhoneResending] = useState(false);

  // Email OTP
  const [emailOtp, setEmailOtp] = useState("");
  const [emailVerified, setEmailVerified] = useState(false);
  const [emailVerifying, setEmailVerifying] = useState(false);
  const [emailResending, setEmailResending] = useState(false);
  const [devEmailOtp, setDevEmailOtp] = useState(null);

  const phoneTimer = useCountdown();
  const emailTimer = useCountdown();

  const [visitorToken, setVisitorToken] = useState(null);
  const recaptchaVerifierRef = useRef(null);

  const clearRecaptcha = () => {
    if (recaptchaVerifierRef.current) {
      try { recaptchaVerifierRef.current.clear(); } catch { /* ignore */ }
      recaptchaVerifierRef.current = null;
    }
  };

  useEffect(() => clearRecaptcha, []);

  const sendFirebaseSms = async (phone) => {
    if (DEV_PHONE_OTP) {
      await apiClient.post("/public-auth/send-phone-otp", { phone });
      return;
    }
    clearRecaptcha();
    recaptchaVerifierRef.current = new RecaptchaVerifier(auth, "recaptcha-container", {
      size: "invisible",
    });
    try {
      const confirmation = await signInWithPhoneNumber(auth, `+91${phone}`, recaptchaVerifierRef.current);
      setConfirmationResult(confirmation);
    } catch (err) {
      clearRecaptcha();
      throw err;
    }
  };

  // Visit Request Form state
  const [formData, setFormData] = useState({
    visit_type: "INDIVIDUAL",
    unit_id: "",
    department_id: "",
    host_user_id: "",
    purpose: "",
    visit_date: "",
    visit_start_time: "",
    visit_end_time: "",
    company_name: "",
  });

  const [units, setUnits] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [hosts, setHosts] = useState([]);
  const [loadingDepts, setLoadingDepts] = useState(false);
  const [loadingHosts, setLoadingHosts] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiClient
      .get("/units/public")
      .then((res) => setUnits(res.data?.data ?? []))
      .catch(() => toast.error("Could not load units."));
  }, []);

  useEffect(() => {
    if (!formData.unit_id) {
      setDepartments([]);
      setHosts([]);
      setFormData((p) => ({ ...p, department_id: "", host_user_id: "" }));
      return;
    }
    setLoadingDepts(true);
    setDepartments([]);
    setHosts([]);
    setFormData((p) => ({ ...p, department_id: "", host_user_id: "" }));
    apiClient
      .get("/departments/public", { params: { unit_id: formData.unit_id } })
      .then((res) => setDepartments(res.data?.data ?? []))
      .catch(() => toast.error("Failed to load departments."))
      .finally(() => setLoadingDepts(false));
  }, [formData.unit_id]);

  useEffect(() => {
    if (!formData.department_id) {
      setHosts([]);
      setFormData((p) => ({ ...p, host_user_id: "" }));
      return;
    }
    setLoadingHosts(true);
    setHosts([]);
    setFormData((p) => ({ ...p, host_user_id: "" }));
    apiClient
      .get("/users/hosts", {
        params: { department_id: formData.department_id, unit_id: formData.unit_id },
      })
      .then((res) => setHosts(res.data?.data ?? []))
      .catch(() => toast.error("Failed to load hosts."))
      .finally(() => setLoadingHosts(false));
  }, [formData.department_id, formData.unit_id]);

  /* ── Step 1: Send OTPs ────────────────────────────────────────────────────── */
  const handleExistingVisitorLogin = async (e) => {
    e.preventDefault();
    const phone = identity.visitor_phone.trim();
    if (!/^\d{10}$/.test(phone)) {
      toast.error("Please enter a valid 10-digit mobile number.");
      return;
    }

    setStep1Busy(true);
    try {
      // Whether the number has visited before is known only after the OTP is
      // verified (existing-visitor-verify), so numbers can't be probed here.
      // A new number is sent on to registration with its phone already verified.
      await sendFirebaseSms(phone);
      phoneTimer.start();
      setPhoneOtp("");
      setPhoneVerified(false);
      toast.success("Verification code sent to +91 " + phone);
      setStep(2);
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || "Failed to verify mobile number.");
    } finally {
      setStep1Busy(false);
    }
  };

  const handleNewVisitorRegister = async (e) => {
    e.preventDefault();
    const { visitor_name, visitor_email, visitor_phone, visitor_address } = identity;
    if (!visitor_name.trim()) { toast.error("Full name is required."); return; }
    if (!/^\d{10}$/.test(visitor_phone.trim())) { toast.error("Valid 10-digit mobile number is required."); return; }
    if (!visitor_email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(visitor_email.trim())) {
      toast.error("Valid email address is required."); return;
    }
    if (visitor_address.trim().length < 5) { toast.error("Please enter your complete address."); return; }

    setStep1Busy(true);
    try {
      // A phone verified moments ago (sign-in with a new number) is reused — but
      // only for that same number. A changed number needs its own OTP, or the
      // email step would be refused for a proof that belongs to the old number.
      const phone = visitor_phone.trim();
      if (!(phoneVerified && phoneToken && phoneInToken(phoneToken) === phone)) {
        setPhoneVerified(false);
        setPhoneToken(null);
        await sendFirebaseSms(phone);
        phoneTimer.start();
      }

      const emailRes = await apiClient.post("/public-auth/send-email-otp", {
        email: visitor_email.trim(),
      });
      if (emailRes.data?.data?.dev_otp) setDevEmailOtp(emailRes.data.data.dev_otp);
      emailTimer.start();

      toast.success("Verification codes sent to your phone and email!");
      setStep(2);
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || "Failed to send verification codes.");
    } finally {
      setStep1Busy(false);
    }
  };

  /* ── Step 2: Verify OTPs ──────────────────────────────────────────────────── */
  const handleVerifyExistingVisitor = async () => {
    if (phoneOtp.length !== 6) { toast.error("Please enter the 6-digit OTP."); return; }
    if (!DEV_PHONE_OTP && !confirmationResult) {
      toast.error("No active OTP session. Please request a new code."); return;
    }

    setPhoneVerifying(true);
    try {
      const proof = DEV_PHONE_OTP
        ? { otp: phoneOtp }
        : { idToken: await (await confirmationResult.confirm(phoneOtp)).user.getIdToken() };

      const res = await apiClient.post("/public-auth/existing-visitor-verify", {
        phone: identity.visitor_phone.trim(),
        ...proof,
      });

      const data = res.data?.data || {};

      if (data.found && data.visitor_token) {
        toast.success(`Welcome back, ${data.visitor.visitor_name}!`);
        setIdentity({
          visitor_name: data.visitor.visitor_name || "",
          visitor_email: data.visitor.visitor_email || "",
          visitor_phone: data.visitor.visitor_phone || identity.visitor_phone,
          visitor_address: data.visitor.visitor_address || "",
        });
        if (data.visitor.company_name) {
          setFormData((p) => ({ ...p, company_name: data.visitor.company_name, visit_type: "BUSINESS" }));
        }
        setIsExistingProfile(true);
        setVisitorToken(data.visitor_token);
        sessionStorage.setItem("vms_visitor_token", data.visitor_token);
        setPhoneVerified(true);
        setEmailVerified(true);
        setStep(3);
      } else {
        toast("Phone verified! No previous visits found. Please complete your registration.", {
          icon: "ℹ️",
          duration: 5000,
        });
        setPhoneVerified(true);
        setPhoneToken(data.phone_token);
        setAuthMode("register");
        setStep(1);
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || "Invalid OTP code.");
    } finally {
      setPhoneVerifying(false);
    }
  };

  const verifyNewVisitorPhone = async () => {
    if (phoneOtp.length !== 6) { toast.error("Please enter the 6-digit phone OTP."); return; }
    if (!DEV_PHONE_OTP && !confirmationResult) { toast.error("No active phone verification session."); return; }

    setPhoneVerifying(true);
    try {
      const proof = DEV_PHONE_OTP
        ? { otp: phoneOtp }
        : { idToken: await (await confirmationResult.confirm(phoneOtp)).user.getIdToken() };

      const res = await apiClient.post("/public-auth/verify-firebase-phone", {
        phone: identity.visitor_phone.trim(),
        ...proof,
      });
      setPhoneToken(res.data?.data?.phone_token ?? null);
      setPhoneVerified(true);
      toast.success("Mobile number verified! ✓");
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || "Invalid phone OTP.");
    } finally {
      setPhoneVerifying(false);
    }
  };

  const verifyNewVisitorEmail = async () => {
    if (emailOtp.length !== 6) { toast.error("Please enter the 6-digit email OTP."); return; }
    if (!phoneVerified || !phoneToken) { toast.error("Please verify your phone number first."); return; }

    setEmailVerifying(true);
    try {
      const res = await apiClient.post("/public-auth/verify-email-otp", {
        email: identity.visitor_email.trim(),
        otp: emailOtp,
        visitor_name: identity.visitor_name.trim(),
        visitor_phone: identity.visitor_phone.trim(),
        visitor_address: identity.visitor_address.trim(),
        phone_token: phoneToken,
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

  const resendPhone = async () => {
    setPhoneResending(true);
    try {
      await sendFirebaseSms(identity.visitor_phone.trim());
      phoneTimer.start();
      setPhoneOtp("");
      toast.success("New code sent to your mobile.");
    } catch (err) {
      toast.error(err?.message || "Failed to resend mobile OTP.");
    } finally {
      setPhoneResending(false);
    }
  };

  const resendEmail = async () => {
    setEmailResending(true);
    try {
      const res = await apiClient.post("/public-auth/send-email-otp", {
        email: identity.visitor_email.trim(),
      });
      if (res.data?.data?.dev_otp) setDevEmailOtp(res.data.data.dev_otp);
      emailTimer.start();
      setEmailOtp("");
      toast.success("New code sent to your email.");
    } catch {
      toast.error("Failed to resend email OTP.");
    } finally {
      setEmailResending(false);
    }
  };

  const proceedToForm = () => {
    if (!phoneVerified || !emailVerified) { toast.error("Please verify both phone and email."); return; }
    sessionStorage.setItem("vms_visitor_token", visitorToken);
    setStep(3);
  };

  /* ── Step 3: Submit Request ───────────────────────────────────────────────── */
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.unit_id) { toast.error("Please select a unit or office."); return; }
    if (!formData.department_id) { toast.error("Please select a department."); return; }
    if (!formData.host_user_id) { toast.error("Please select a host contact person."); return; }
    if (formData.visit_type === "BUSINESS" && !formData.company_name.trim()) {
      toast.error("Company name is required for business visits."); return;
    }

    const token = visitorToken || sessionStorage.getItem("vms_visitor_token");
    if (!token) {
      toast.error("Session expired. Please verify your identity again.");
      setStep(1);
      return;
    }

    setSubmitting(true);
    try {
      await apiClient.post(
        "/visit-requests/public",
        {
          unit_id: parseInt(formData.unit_id),
          department_id: parseInt(formData.department_id),
          host_user_id: parseInt(formData.host_user_id),
          visit_category: formData.visit_type,
          purpose: formData.purpose.trim(),
          visit_date: formData.visit_date,
          visit_start_time: formData.visit_start_time || undefined,
          visit_end_time: formData.visit_end_time || undefined,
          company_name: formData.company_name.trim() || undefined,
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

  const handleReset = () => {
    setStep(1);
    setAuthMode("login");
    setIdentity({ visitor_name: "", visitor_email: "", visitor_phone: "", visitor_address: "" });
    setIsExistingProfile(false);
    setPhoneVerified(false);
    setPhoneToken(null);
    setConfirmationResult(null);
    setDevEmailOtp(null);
    setEmailVerified(false);
    setPhoneOtp("");
    setEmailOtp("");
    setVisitorToken(null);
    sessionStorage.removeItem("vms_visitor_token");
    setFormData({
      visit_type: "INDIVIDUAL",
      unit_id: "",
      department_id: "",
      host_user_id: "",
      purpose: "",
      visit_date: "",
      visit_start_time: "",
      visit_end_time: "",
      company_name: "",
    });
  };

  /* ==============================================================================
     VIEW: Step 4 - Confirmation
  ============================================================================== */
  if (step === 4) {
    const selectedUnit = units.find((u) => String(u.id) === String(formData.unit_id));
    const selectedHost = hosts.find((h) => String(h.id) === String(formData.host_user_id));

    return (
      <Shell step={step}>
        <div className="w-full max-w-xl mx-auto bg-bg-secondary border border-border rounded-2xl p-8 sm:p-10 text-center shadow-card animate-fade-in">
          <div className="w-16 h-16 rounded-2xl bg-success/10 text-success flex items-center justify-center mx-auto mb-5 shadow-sm border border-success/20">
            <CheckCircle2 size={36} strokeWidth={2.5} />
          </div>

          <span className="inline-block text-[11px] font-bold tracking-wider uppercase px-3 py-1 rounded-full bg-success/10 text-success mb-2">
            Request Registered
          </span>

          <h2 className="text-2xl font-extrabold text-loud mb-2">
            Visit Request Submitted!
          </h2>
          <p className="text-muted text-xs max-w-sm mx-auto mb-6 leading-relaxed">
            Your visit request has been sent to the host officer for approval. Once confirmed, you will receive an SMS with your digital entry pass.
          </p>

          <div className="bg-bg-primary border border-border rounded-xl p-4 text-left mb-6 space-y-2.5 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <span className="text-muted">Visitor Name</span>
              <span className="font-semibold text-loud">{identity.visitor_name}</span>
            </div>
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <span className="text-muted">Host Officer</span>
              <span className="font-semibold text-loud">
                {selectedHost ? selectedHost.full_name : "Assigned Staff"}
              </span>
            </div>
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <span className="text-muted">Unit / Facility</span>
              <span className="font-semibold text-loud">
                {selectedUnit ? selectedUnit.name : "OHPC Office"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Scheduled Date</span>
              <span className="font-semibold text-loud">
                {formData.visit_date}
                {formData.visit_start_time ? ` (${formData.visit_start_time})` : ""}
              </span>
            </div>
          </div>

          <button onClick={handleReset} className="btn-primary w-full py-3 text-sm font-semibold justify-center">
            Submit Another Request
          </button>
        </div>
      </Shell>
    );
  }

  /* ==============================================================================
     VIEW: Step 1 - Clean Unified Identity Card
  ============================================================================== */
  if (step === 1) {
    return (
      <Shell step={step}>
        <div className="w-full max-w-xl mx-auto bg-bg-secondary border border-border rounded-2xl p-6 sm:p-8 shadow-card space-y-6 animate-fade-in">
          {/* Segmented Mode Toggle Tabs */}
          <div className="flex p-1 bg-bg-primary rounded-xl border border-subtle">
            <button
              type="button"
              onClick={() => setAuthMode("login")}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all ${
                authMode === "login"
                  ? "bg-accent text-white shadow-sm"
                  : "text-muted hover:text-loud"
              }`}
            >
              <KeyRound size={14} />
              Existing Visitor Login
            </button>
            <button
              type="button"
              onClick={() => setAuthMode("register")}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all ${
                authMode === "register"
                  ? "bg-accent text-white shadow-sm"
                  : "text-muted hover:text-loud"
              }`}
            >
              <UserPlus size={14} />
              New Visitor Registration
            </button>
          </div>

          {/* MODE A: EXISTING VISITOR LOGIN */}
          {authMode === "login" && (
            <div className="space-y-5 animate-fade-in">
              <div>
                <h3 className="text-base font-bold text-loud flex items-center gap-2 mb-1">
                  <Phone size={17} className="text-accent" /> Login with Mobile Number
                </h3>
                <p className="text-xs text-faint leading-relaxed">
                  Enter your registered 10-digit mobile number. We will send an OTP to verify your identity and automatically load your saved profile.
                </p>
              </div>

              <form onSubmit={handleExistingVisitorLogin} className="space-y-5">
                <div className="space-y-2">
                  <label className={labelCls}>Mobile Number *</label>
                  <div className="relative flex items-center">
                    <span className="absolute left-3.5 text-sm font-bold text-muted pointer-events-none">
                      +91
                    </span>
                    <input
                      type="tel"
                      required
                      autoFocus
                      value={identity.visitor_phone}
                      onChange={(e) =>
                        setIdentity((p) => ({
                          ...p,
                          visitor_phone: e.target.value.replace(/\D/g, "").slice(0, 10),
                        }))
                      }
                      placeholder="98765 43210"
                      maxLength={10}
                      className={`${inputCls} pl-12 text-base font-medium tracking-wide`}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={step1Busy || identity.visitor_phone.length !== 10}
                  className="btn-primary w-full py-3 text-sm font-semibold justify-center shadow-md disabled:opacity-50"
                >
                  {step1Busy ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Checking & Sending OTP...
                    </>
                  ) : (
                    <>
                      Send Login OTP <ArrowRight size={16} />
                    </>
                  )}
                </button>

                <div className="pt-2 text-center">
                  <button
                    type="button"
                    onClick={() => setAuthMode("register")}
                    className="text-xs text-muted hover:text-accent transition-colors"
                  >
                    First time visiting OHPC? <span className="font-semibold text-accent underline">Register New Profile</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* MODE B: NEW VISITOR REGISTRATION */}
          {authMode === "register" && (
            <div className="space-y-5 animate-fade-in">
              <div>
                <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
                  <h3 className="text-base font-bold text-loud flex items-center gap-2">
                    <User size={17} className="text-accent" /> New Visitor Registration
                  </h3>
                  {phoneVerified && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-success/10 text-success">
                      <Check size={12} strokeWidth={2.5} /> Phone Verified
                    </span>
                  )}
                </div>
                <p className="text-xs text-faint">
                  Please provide your contact details to request visitor pre-approval.
                </p>
              </div>

              <form onSubmit={handleNewVisitorRegister} className="space-y-4">
                <div className="space-y-1.5">
                  <label className={labelCls}>Full Name (As on Government ID) *</label>
                  <div className="relative">
                    <User size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
                    <input
                      type="text"
                      required
                      value={identity.visitor_name}
                      onChange={(e) => setIdentity((p) => ({ ...p, visitor_name: e.target.value }))}
                      placeholder="e.g. Rajesh Kumar Mohapatra"
                      className={`${inputCls} pl-10`}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div className="space-y-1.5">
                    <label className={labelCls}>Mobile Number *</label>
                    <div className="relative flex items-center">
                      <span className="absolute left-3.5 text-xs font-bold text-muted pointer-events-none">
                        +91
                      </span>
                      <input
                        type="tel"
                        required
                        value={identity.visitor_phone}
                        onChange={(e) =>
                          setIdentity((p) => ({
                            ...p,
                            visitor_phone: e.target.value.replace(/\D/g, "").slice(0, 10),
                          }))
                        }
                        placeholder="10-digit number"
                        maxLength={10}
                        className={`${inputCls} pl-11`}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className={labelCls}>Email Address *</label>
                    <div className="relative">
                      <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
                      <input
                        type="email"
                        required
                        value={identity.visitor_email}
                        onChange={(e) => setIdentity((p) => ({ ...p, visitor_email: e.target.value }))}
                        placeholder="name@example.com"
                        className={`${inputCls} pl-10`}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className={labelCls}>Complete Residential / Office Address *</label>
                  <div className="relative">
                    <MapPin size={15} className="absolute left-3.5 top-3 text-faint" />
                    <textarea
                      required
                      rows={2}
                      value={identity.visitor_address}
                      onChange={(e) =>
                        setIdentity((p) => ({ ...p, visitor_address: e.target.value.slice(0, 255) }))
                      }
                      placeholder="Plot / House number, Street, City, District, PIN code"
                      maxLength={255}
                      className={`${inputCls} pl-10`}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={step1Busy}
                  className="btn-primary w-full py-3 text-sm font-semibold justify-center shadow-md"
                >
                  {step1Busy ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Checking & Sending Codes...
                    </>
                  ) : (
                    <>
                      Continue to OTP Verification <ArrowRight size={16} />
                    </>
                  )}
                </button>

                <div className="pt-2 text-center">
                  <button
                    type="button"
                    onClick={() => setAuthMode("login")}
                    className="text-xs text-muted hover:text-accent transition-colors"
                  >
                    Already registered? <span className="font-semibold text-accent underline">Login with Mobile</span>
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </Shell>
    );
  }

  /* ==============================================================================
     VIEW: Step 2 - Clean, Focused OTP Verification Page
  ============================================================================== */
  if (step === 2) {
    const isLoginFlow = authMode === "login";

    return (
      <Shell step={step}>
        <div className="w-full max-w-xl mx-auto space-y-6 animate-fade-in">
          {/* FLOW A: EXISTING VISITOR PHONE OTP */}
          {isLoginFlow ? (
            <div className="bg-bg-secondary border border-border rounded-2xl p-6 sm:p-8 shadow-card space-y-6 text-center">
              <div className="w-14 h-14 rounded-2xl bg-accent/10 text-accent flex items-center justify-center mx-auto border border-accent/20">
                <Shield size={28} />
              </div>

              <div>
                <h3 className="text-lg font-bold text-loud">Enter SMS Verification Code</h3>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  We sent a 6-digit code to{" "}
                  <strong className="text-loud font-semibold">
                    +91 {identity.visitor_phone}
                  </strong>
                </p>
                <button
                  type="button"
                  onClick={() => { setStep(1); setPhoneOtp(""); }}
                  className="text-xs text-accent hover:underline mt-1 inline-flex items-center gap-1"
                >
                  <ArrowLeft size={11} /> Change Number
                </button>
              </div>

              {/* Dev mode helper */}
              {DEV_PHONE_OTP && (
                <div className="text-xs text-accent bg-mixed-bg border border-accent/20 rounded-xl px-4 py-2.5 text-left flex items-center gap-2">
                  <HelpCircle size={15} className="shrink-0" />
                  <span>
                    <strong>Dev Mode:</strong> The SMS code is printed in the backend terminal log.
                  </span>
                </div>
              )}

              {/* OTP Input */}
              <div className="space-y-3">
                <OtpField
                  value={phoneOtp}
                  onChange={setPhoneOtp}
                  disabled={phoneVerifying}
                />

                <div className="flex items-center justify-between text-xs px-1">
                  <span className="text-faint">Didn't receive code?</span>
                  <button
                    type="button"
                    onClick={resendPhone}
                    disabled={phoneTimer.count > 0 || phoneResending}
                    className="font-semibold text-accent disabled:text-faint disabled:cursor-not-allowed flex items-center gap-1 hover:underline"
                  >
                    {phoneResending ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    {phoneTimer.count > 0 ? `Resend SMS in ${phoneTimer.count}s` : "Resend SMS"}
                  </button>
                </div>
              </div>

              {/* Verify & Sign In Button */}
              <button
                type="button"
                onClick={handleVerifyExistingVisitor}
                disabled={phoneVerifying || phoneOtp.length !== 6}
                className="btn-primary w-full py-3.5 text-sm font-semibold justify-center shadow-md disabled:opacity-50"
              >
                {phoneVerifying ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Verifying Profile...
                  </>
                ) : (
                  <>
                    <Check size={16} /> Verify & Access Request Form
                  </>
                )}
              </button>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => { setAuthMode("register"); setStep(1); }}
                  className="text-xs text-faint hover:text-muted transition-colors"
                >
                  New visitor? Register your details instead
                </button>
              </div>
            </div>
          ) : (
            /* FLOW B: NEW VISITOR DUAL OTP (PHONE + EMAIL) */
            <div className="bg-bg-secondary border border-border rounded-2xl p-6 sm:p-8 shadow-card space-y-6">
              <div className="flex items-center justify-between pb-3 border-b border-border">
                <div>
                  <h3 className="text-base font-bold text-loud">Verify Phone & Email</h3>
                  <p className="text-xs text-faint">Enter the codes sent to confirm your identity</p>
                </div>
                <button
                  type="button"
                  onClick={() => { setStep(1); setPhoneOtp(""); setEmailOtp(""); }}
                  className="text-xs text-muted hover:text-loud flex items-center gap-1"
                >
                  <ArrowLeft size={12} /> Edit Details
                </button>
              </div>

              <div className="space-y-5">
                {/* 1. Phone OTP */}
                <div
                  className={`p-4 rounded-xl border transition-all ${
                    phoneVerified ? "border-success/40 bg-success/5" : "border-border bg-bg-primary"
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Phone size={15} className="text-accent" />
                      <span className="text-xs font-bold text-loud">Mobile: +91 {identity.visitor_phone}</span>
                    </div>
                    {phoneVerified ? (
                      <span className="text-xs font-bold text-success flex items-center gap-1 bg-success/10 px-2 py-0.5 rounded-full">
                        <Check size={11} strokeWidth={2.5} /> Verified
                      </span>
                    ) : (
                      <span className="text-[11px] font-semibold text-accent">SMS Code</span>
                    )}
                  </div>

                  {!phoneVerified && (
                    <div className="space-y-3">
                      <OtpField value={phoneOtp} onChange={setPhoneOtp} disabled={phoneVerifying} />
                      <div className="flex items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={resendPhone}
                          disabled={phoneTimer.count > 0 || phoneResending}
                          className="text-xs text-accent disabled:text-faint hover:underline flex items-center gap-1"
                        >
                          {phoneResending ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                          {phoneTimer.count > 0 ? `Resend (${phoneTimer.count}s)` : "Resend"}
                        </button>
                        <button
                          type="button"
                          onClick={verifyNewVisitorPhone}
                          disabled={phoneVerifying || phoneOtp.length !== 6}
                          className="btn-primary text-xs px-4 py-2"
                        >
                          {phoneVerifying ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                          Verify Phone
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. Email OTP */}
                <div
                  className={`p-4 rounded-xl border transition-all ${
                    emailVerified ? "border-success/40 bg-success/5" : "border-border bg-bg-primary"
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Mail size={15} className="text-accent" />
                      <span className="text-xs font-bold text-loud truncate max-w-[200px]">
                        Email: {maskEmail(identity.visitor_email)}
                      </span>
                    </div>
                    {emailVerified ? (
                      <span className="text-xs font-bold text-success flex items-center gap-1 bg-success/10 px-2 py-0.5 rounded-full">
                        <Check size={11} strokeWidth={2.5} /> Verified
                      </span>
                    ) : (
                      <span className="text-[11px] font-semibold text-accent">Email Code</span>
                    )}
                  </div>

                  {devEmailOtp && !emailVerified && (
                    <div className="text-[11px] text-accent bg-mixed-bg border border-accent/20 rounded px-2.5 py-1 mb-2">
                      <span>Dev OTP: </span>
                      <strong className="font-mono">{devEmailOtp}</strong>
                    </div>
                  )}

                  {!emailVerified && (
                    <div className="space-y-3">
                      <OtpField value={emailOtp} onChange={setEmailOtp} disabled={emailVerifying} />
                      <div className="flex items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={resendEmail}
                          disabled={emailTimer.count > 0 || emailResending}
                          className="text-xs text-accent disabled:text-faint hover:underline flex items-center gap-1"
                        >
                          {emailResending ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                          {emailTimer.count > 0 ? `Resend (${emailTimer.count}s)` : "Resend"}
                        </button>
                        <button
                          type="button"
                          onClick={verifyNewVisitorEmail}
                          disabled={emailVerifying || emailOtp.length !== 6 || !phoneVerified}
                          className="btn-primary text-xs px-4 py-2"
                        >
                          {emailVerifying ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                          {phoneVerified ? "Verify Email" : "Verify phone first"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={proceedToForm}
                disabled={!phoneVerified || !emailVerified}
                className="btn-primary w-full py-3 text-sm font-semibold justify-center shadow-md disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Continue to Visit Details <ArrowRight size={16} />
              </button>
            </div>
          )}
        </div>
      </Shell>
    );
  }

  /* ==============================================================================
     VIEW: Step 3 - Dashboard-Style Visit Details Form
  ============================================================================== */
  return (
    <Shell step={step}>
      <form onSubmit={handleSubmit} className="w-full space-y-8 animate-fade-in">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* LEFT: Verified Visitor Profile */}
          <div className="lg:col-span-4 bg-bg-secondary border border-border rounded-2xl p-6 shadow-sm space-y-5 lg:sticky lg:top-24">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-success/10 text-success flex items-center justify-center">
                  <ShieldCheck size={16} strokeWidth={2.5} />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-loud leading-tight">Verified Profile</h3>
                  <span className="text-[10px] font-semibold text-success uppercase tracking-wider">
                    {isExistingProfile ? "Returning Visitor" : "OTP Verified"}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleReset}
                title="Switch visitor"
                className="text-faint hover:text-error p-1 rounded-md text-xs flex items-center gap-1"
              >
                <LogOut size={13} />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div>
                <span className="text-[10px] font-bold text-muted uppercase tracking-wider block mb-0.5">
                  Full Name
                </span>
                <p className="font-semibold text-loud flex items-center gap-1.5">
                  <User size={13} className="text-accent shrink-0" />
                  <span className="truncate">{identity.visitor_name}</span>
                </p>
              </div>

              <div>
                <span className="text-[10px] font-bold text-muted uppercase tracking-wider block mb-0.5">
                  Mobile Number
                </span>
                <p className="font-medium text-loud flex items-center gap-1.5">
                  <Phone size={13} className="text-accent shrink-0" />
                  <span>+91 {identity.visitor_phone}</span>
                </p>
              </div>

              {identity.visitor_email && (
                <div>
                  <span className="text-[10px] font-bold text-muted uppercase tracking-wider block mb-0.5">
                    Email Address
                  </span>
                  <p className="font-medium text-loud flex items-center gap-1.5">
                    <Mail size={13} className="text-accent shrink-0" />
                    <span className="truncate">{identity.visitor_email}</span>
                  </p>
                </div>
              )}

              {identity.visitor_address && (
                <div>
                  <span className="text-[10px] font-bold text-muted uppercase tracking-wider block mb-0.5">
                    Address
                  </span>
                  <p className="text-muted flex items-start gap-1.5 leading-relaxed">
                    <MapPin size={13} className="text-accent shrink-0 mt-0.5" />
                    <span>{identity.visitor_address}</span>
                  </p>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-border/80">
              <div className="p-2.5 rounded-lg bg-bg-primary border border-subtle text-[11px] text-faint flex items-start gap-1.5">
                <Lock size={12} className="text-accent shrink-0 mt-0.5" />
                <span>Verified identity is locked for gate security.</span>
              </div>
            </div>
          </div>

          {/* RIGHT: Visit Details Form */}
          <div className="lg:col-span-8 bg-bg-secondary border border-border rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
            {/* 1. Visit Type */}
            <div>
              <h3 className="text-sm font-bold text-loud flex items-center gap-2 mb-1">
                <FileText size={16} className="text-accent" /> 1. Select Visit Type
              </h3>
              <p className="text-xs text-faint mb-3">Choose the category of your visit</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {VISIT_TYPES.map(({ id, label, desc, icon: Icon }) => {
                  const selected = formData.visit_type === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setFormData((p) => ({ ...p, visit_type: id, company_name: "" }))}
                      className={`p-3.5 rounded-xl border text-left transition-all ${
                        selected
                          ? "border-accent bg-mixed-bg/60 shadow-sm ring-1 ring-accent"
                          : "border-subtle bg-bg-primary hover:border-border"
                      }`}
                    >
                      <Icon size={20} className={`mb-2 ${selected ? "text-accent" : "text-muted"}`} />
                      <div className={`font-bold text-xs ${selected ? "text-accent" : "text-loud"}`}>
                        {label}
                      </div>
                      <div className="text-[11px] text-faint mt-0.5 leading-snug">{desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="h-px bg-border w-full" />

            {/* 2. Destination & Host */}
            <div>
              <h3 className="text-sm font-bold text-loud flex items-center gap-2 mb-1">
                <Building2 size={16} className="text-accent" /> 2. Destination & Host
              </h3>
              <p className="text-xs text-faint mb-3">Select the unit and host officer you are visiting</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2 space-y-1.5">
                  <label className={labelCls}>Target Unit / Office *</label>
                  <div className="relative">
                    <select
                      name="unit_id"
                      required
                      value={formData.unit_id}
                      onChange={(e) => setFormData((p) => ({ ...p, unit_id: e.target.value }))}
                      className={selectCls}
                    >
                      <option value="">— Select destination unit / branch —</option>
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} {u.city ? `(${u.city})` : ""}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className={labelCls}>Department *</label>
                  <div className="relative">
                    <select
                      name="department_id"
                      required
                      value={formData.department_id}
                      onChange={(e) => setFormData((p) => ({ ...p, department_id: e.target.value }))}
                      disabled={!formData.unit_id || loadingDepts}
                      className={`${selectCls} disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      <option value="">
                        {!formData.unit_id
                          ? "— Select Unit First —"
                          : loadingDepts
                          ? "Loading departments..."
                          : "— Select Department —"}
                      </option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className={labelCls}>Host / Contact Officer *</label>
                  <div className="relative">
                    <select
                      name="host_user_id"
                      required
                      value={formData.host_user_id}
                      onChange={(e) => setFormData((p) => ({ ...p, host_user_id: e.target.value }))}
                      disabled={!formData.department_id || loadingHosts}
                      className={`${selectCls} disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      <option value="">
                        {!formData.department_id
                          ? "— Select Department First —"
                          : loadingHosts
                          ? "Loading officers..."
                          : "— Select Host Officer —"}
                      </option>
                      {hosts.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.full_name} {h.designation_name ? `(${h.designation_name})` : ""}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
                  </div>
                </div>
              </div>
            </div>

            <div className="h-px bg-border w-full" />

            {/* 3. Schedule & Purpose */}
            <div>
              <h3 className="text-sm font-bold text-loud flex items-center gap-2 mb-1">
                <Calendar size={16} className="text-accent" /> 3. Schedule & Purpose
              </h3>
              <p className="text-xs text-faint mb-3">Set your expected visit date, time, and reason</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className={labelCls}>Date of Visit *</label>
                  <input
                    type="date"
                    required
                    value={formData.visit_date}
                    onChange={(e) => setFormData((p) => ({ ...p, visit_date: e.target.value }))}
                    min={getISTDateString()}
                    className={inputCls}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className={labelCls}>Expected Time Window (Optional)</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      value={formData.visit_start_time}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFormData((p) => {
                          const next = { ...p, visit_start_time: val };
                          if (val) {
                            const [h, m] = val.split(":").map(Number);
                            const total = h * 60 + m + 30;
                            const auto30 = `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
                            if (!p.visit_end_time || p.visit_end_time <= val) {
                              next.visit_end_time = auto30;
                            }
                          }
                          return next;
                        });
                      }}
                      className={inputCls}
                    />
                    <span className="text-faint text-xs shrink-0">to</span>
                    <input
                      type="time"
                      value={formData.visit_end_time}
                      onChange={(e) => setFormData((p) => ({ ...p, visit_end_time: e.target.value }))}
                      className={inputCls}
                    />
                  </div>
                </div>

                {formData.visit_type === "BUSINESS" && (
                  <div className="sm:col-span-2 space-y-1.5 animate-fade-in">
                    <label className={labelCls}>Company / Organization Name *</label>
                    <input
                      type="text"
                      required
                      value={formData.company_name}
                      onChange={(e) => setFormData((p) => ({ ...p, company_name: e.target.value }))}
                      placeholder="e.g. Bharat Heavy Electricals Ltd."
                      className={inputCls}
                    />
                  </div>
                )}

                <div className="sm:col-span-2 space-y-1.5">
                  <label className={labelCls}>Purpose of Visit *</label>
                  <textarea
                    required
                    rows={2}
                    minLength={5}
                    value={formData.purpose}
                    onChange={(e) => setFormData((p) => ({ ...p, purpose: e.target.value }))}
                    placeholder="Briefly describe the purpose of your visit (e.g. Technical review meeting, equipment inspection)"
                    className={inputCls}
                  />
                </div>
              </div>
            </div>

            {/* Submit */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={submitting}
                className="btn-primary w-full py-3.5 text-sm font-bold justify-center shadow-md shadow-accent/20"
              >
                {submitting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Submitting Request...
                  </>
                ) : (
                  <>
                    Submit Visit Request <ArrowRight size={16} />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </form>
    </Shell>
  );
}
