// frontend/src/pages/auth/Setup.jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Building2, User, Lock, Mail, Phone, MapPin,
  Hash, ChevronRight, CheckCircle2, Eye, EyeOff,
  Sun, Moon,
} from "lucide-react";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";
import useAuth from "../../hooks/useAuth";
import useTheme from "../../context/ThemeContext";
import PasswordStrength from "../../components/PasswordStrength";
import { validatePassword } from "../../utils/passwordValidator";
import { getApiErrorMessage } from "../../utils/apiError";

const inputCls = "w-full bg-bg-secondary border border-subtle rounded-lg px-3.5 py-2.5 text-sm text-loud placeholder:text-faint focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all";
const labelCls = "block text-[11px] font-semibold text-loud uppercase tracking-wider mb-1.5";

const INITIAL = {
  org_name:            "",
  org_code:            "",
  org_city:            "",
  org_state:           "",
  org_phone:           "",
  org_email:           "",
  admin_name:          "",
  admin_email:         "",
  admin_phone:         "",
  admin_password:      "",
  admin_confirm_password: "",
  admin_employee_code: "SA-001",
};

export default function Setup() {
  const navigate = useNavigate();
  const { loginDirect } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [form, setForm]         = useState(INITIAL);
  const [loading, setLoading]   = useState(false);
  const [showPwd, setShowPwd]         = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);
  const [step, setStep]                 = useState(1); // 1 = org, 2 = admin

  const set = (k) => (e) => {
    let v = e.target.value;
    if (k === "org_code") v = v.toUpperCase().replace(/[^A-Z0-9_]/g, "");
    setForm(f => ({ ...f, [k]: v }));
  };

  const goNext = (e) => {
    e.preventDefault();
    if (!form.org_name.trim()) { toast.error("Organization name is required."); return; }
    if (!form.org_code.trim()) { toast.error("Organization code is required."); return; }
    setStep(2);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.admin_name.trim())     { toast.error("Admin full name is required."); return; }
    if (!form.admin_email.trim())    { toast.error("Admin email is required."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.admin_email.trim())) {
      toast.error("Admin email is not a valid email address (e.g. admin@company.com)."); return;
    }
    if (!form.admin_password.trim()) { toast.error("Password is required."); return; }
    const { valid: pwValid } = validatePassword(form.admin_password);
    if (!pwValid) { toast.error("Password does not meet the strength requirements."); return; }
    if (form.admin_password !== form.admin_confirm_password) {
      toast.error("Passwords do not match."); return;
    }

    setLoading(true);
    try {
      const payload = { ...form };
      delete payload.admin_confirm_password;
      const response = await apiClient.post("/setup", payload);
      const { token, user } = response.data?.data ?? {};

      if (token && user) {
        // Store session and sync context — same as regular login
        loginDirect(token, user);
        toast.success(`Welcome, ${user.full_name}! System initialized.`);
        navigate("/dashboard");
      } else {
        toast.success("System initialized! Please sign in.");
        navigate("/login");
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Setup failed. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-bg-primary">
      {/* Theme toggle in top corner */}
      <button
        type="button"
        onClick={toggleTheme}
        className="fixed top-5 right-5 p-2 rounded-lg border border-subtle bg-bg-secondary text-muted hover:text-loud hover:bg-surface-hover transition-colors shadow-sm z-50"
        title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      >
        {theme === "dark" ? <Sun size={18} className="text-warning" /> : <Moon size={18} />}
      </button>

      <div className="w-full max-w-lg relative z-10 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4 bg-mixed-bg border border-subtle">
            <Building2 size={26} className="text-accent" />
          </div>
          <h1 className="text-2xl font-bold text-loud tracking-tight">
            First-Time Setup
          </h1>
          <p className="text-sm text-muted mt-1.5">
            Configure your organization and super admin account
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-3 mb-6 px-2">
          {[
            { n: 1, label: "Organization" },
            { n: 2, label: "Super Admin"  },
          ].map(({ n, label }, i, arr) => (
            <div key={n} className="flex-1 flex items-center">
              <div
                className="flex items-center gap-2 cursor-pointer"
                onClick={() => n < step && setStep(n)}
              >
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                    step === n
                      ? "bg-accent text-white shadow-sm"
                      : step > n
                      ? "bg-success-bg text-success border border-success/30"
                      : "bg-bg-secondary text-faint border border-subtle"
                  }`}
                >
                  {step > n ? <CheckCircle2 size={14} /> : n}
                </div>
                <span
                  className={`text-xs font-medium transition-colors ${
                    step >= n ? "text-loud font-semibold" : "text-faint"
                  }`}
                >
                  {label}
                </span>
              </div>
              {i < arr.length - 1 && (
                <div className={`flex-1 h-px mx-3 transition-colors ${step > n ? "bg-accent" : "bg-border"}`} />
              )}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="vms-card rounded-2xl p-7 shadow-card">
          {/* ── Step 1: Organization ─────────────────────────────────────── */}
          {step === 1 && (
            <form onSubmit={goNext} className="space-y-5">
              {/* Organization Name — full width */}
              <div className="space-y-1.5">
                <label className={labelCls}>
                  <Building2 className="inline w-3 h-3 mr-1" />
                  Organization Name *
                </label>
                <input
                  autoFocus
                  type="text"
                  required
                  value={form.org_name}
                  onChange={set("org_name")}
                  placeholder="e.g. Acme Corporation"
                  className={inputCls}
                />
              </div>

              {/* Short Code + Phone — side by side */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className={labelCls}>
                    <Hash className="inline w-3 h-3 mr-1" />
                    Short Code *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={20}
                    value={form.org_code}
                    onChange={set("org_code")}
                    placeholder="e.g. ACME"
                    className={`${inputCls} font-mono tracking-wider`}
                  />
                  <p className="text-[11px] text-faint mt-0.5">Uppercase &amp; numbers only</p>
                </div>
                <div className="space-y-1.5">
                  <label className={labelCls}>
                    <Phone className="inline w-3 h-3 mr-1" />
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={form.org_phone}
                    onChange={set("org_phone")}
                    placeholder="+91 22 1234 5678"
                    className={inputCls}
                  />
                </div>
              </div>

              {/* Email — full width */}
              <div className="space-y-1.5">
                <label className={labelCls}>
                  <Mail className="inline w-3 h-3 mr-1" />
                  Email
                </label>
                <input
                  type="email"
                  value={form.org_email}
                  onChange={set("org_email")}
                  placeholder="info@company.com"
                  className={inputCls}
                />
              </div>

              {/* City + State — side by side */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className={labelCls}>
                    <MapPin className="inline w-3 h-3 mr-1" />
                    City
                  </label>
                  <input
                    type="text"
                    value={form.org_city}
                    onChange={set("org_city")}
                    placeholder="e.g. Mumbai"
                    className={inputCls}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className={labelCls}>State</label>
                  <input
                    type="text"
                    value={form.org_state}
                    onChange={set("org_state")}
                    placeholder="e.g. Maharashtra"
                    className={inputCls}
                  />
                </div>
              </div>

              <button
                type="submit"
                className="btn-primary w-full py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-all shadow-sm"
              >
                Next — Super Admin
                <ChevronRight size={16} />
              </button>
            </form>
          )}

          {/* ── Step 2: Super Admin ──────────────────────────────────────── */}
          {step === 2 && (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <p className="text-muted text-xs mb-5 leading-relaxed">
                  Create the super admin account. This account will have full system access across all units.
                </p>
              </div>

              <div className="space-y-4">
                {/* Full Name — full width */}
                <div className="space-y-1.5">
                  <label className={labelCls}>
                    <User className="inline w-3 h-3 mr-1" />
                    Full Name *
                  </label>
                  <input
                    autoFocus
                    type="text"
                    required
                    value={form.admin_name}
                    onChange={set("admin_name")}
                    placeholder="e.g. John Smith"
                    className={inputCls}
                  />
                </div>

                {/* Email — full width */}
                <div className="space-y-1.5">
                  <label className={labelCls}>
                    <Mail className="inline w-3 h-3 mr-1" />
                    Email *
                  </label>
                  <input
                    type="email"
                    required
                    value={form.admin_email}
                    onChange={set("admin_email")}
                    placeholder="superadmin@company.com"
                    className={inputCls}
                  />
                </div>

                {/* Phone + Employee Code — side by side */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className={labelCls}>
                      <Phone className="inline w-3 h-3 mr-1" />
                      Phone
                    </label>
                    <input
                      type="tel"
                      value={form.admin_phone}
                      onChange={set("admin_phone")}
                      placeholder="+91 9000000000"
                      className={inputCls}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className={labelCls}>
                      <Hash className="inline w-3 h-3 mr-1" />
                      Employee Code
                    </label>
                    <input
                      type="text"
                      value={form.admin_employee_code}
                      onChange={set("admin_employee_code")}
                      placeholder="SA-001"
                      className={`${inputCls} font-mono`}
                    />
                  </div>
                </div>

                {/* Password — full width */}
                <div className="space-y-1.5">
                  <label className={labelCls}>
                    <Lock className="inline w-3 h-3 mr-1" />
                    Password *
                  </label>
                  <div className="relative">
                    <input
                      type={showPwd ? "text" : "password"}
                      required
                      value={form.admin_password}
                      onChange={set("admin_password")}
                      placeholder="Uppercase, number & symbol required"
                      className={inputCls}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-loud transition-colors"
                    >
                      {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  {/* Password strength indicator */}
                  <PasswordStrength password={form.admin_password} />
                </div>

                {/* Confirm Password — full width */}
                <div className="space-y-1.5">
                  <label className={labelCls}>Confirm Password *</label>
                  <div className="relative">
                    <input
                      type={showConfirmPwd ? "text" : "password"}
                      required
                      value={form.admin_confirm_password}
                      onChange={set("admin_confirm_password")}
                      placeholder="Re-enter password"
                      className={`${inputCls} ${
                        form.admin_confirm_password && form.admin_password !== form.admin_confirm_password
                          ? "!border-error ring-1 ring-error/30"
                          : form.admin_confirm_password && form.admin_password === form.admin_password
                          ? "!border-success ring-1 ring-success/30"
                          : ""
                      }`}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPwd(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-loud transition-colors"
                    >
                      {showConfirmPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  {form.admin_confirm_password && form.admin_password !== form.admin_confirm_password && (
                    <p className="text-[11px] text-error mt-1">Passwords do not match</p>
                  )}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="btn-secondary px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
                >
                  ← Back
                </button>
                <button
                  type="submit"
                  disabled={loading || !validatePassword(form.admin_password).valid}
                  className="btn-primary flex-1 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                >
                  {loading ? (
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <CheckCircle2 size={16} />
                  )}
                  {loading ? "Setting up…" : "Complete Setup"}
                </button>
              </div>
            </form>
          )}
        </div>

        <p className="text-center text-faint text-[11px] mt-5">
          This page is only available when the system is uninitialized.
        </p>
      </div>
    </div>
  );
}
