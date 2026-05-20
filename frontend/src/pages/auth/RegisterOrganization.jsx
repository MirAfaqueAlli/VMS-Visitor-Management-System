import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Building2, User, ChevronRight, ChevronLeft, Shield, CheckCircle2 } from "lucide-react";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";
import useAuth from "../../hooks/useAuth";

const STEPS = [
  { id: 1, label: "Organization", icon: Building2 },
  { id: 2, label: "Admin Account", icon: User },
];

const ORG_TYPES = ["Government", "Industrial", "Corporate", "Educational", "Healthcare", "Other"];

export default function RegisterOrganization() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  const [orgData, setOrgData] = useState({
    name: "",
    code: "",
    type: "",
    city: "",
    state: "",
    phone: "",
    email: "",
  });

  const [adminData, setAdminData] = useState({
    full_name: "",
    email: "",
    phone: "",
    employee_code: "",
    designation: "",
    password: "",
    confirmPassword: "",
  });

  const handleOrgChange = (e) => {
    const { name, value } = e.target;
    setOrgData((prev) => ({ ...prev, [name]: value }));
    // Auto-generate code from name if code is empty
    if (name === "name" && !orgData.code) {
      setOrgData((prev) => ({
        ...prev,
        name: value,
        code: value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8),
      }));
    }
  };

  const handleAdminChange = (e) => {
    const { name, value } = e.target;
    setAdminData((prev) => ({ ...prev, [name]: value }));
  };

  const handleStep1Submit = (e) => {
    e.preventDefault();
    if (!orgData.name || !orgData.code || !orgData.type) {
      toast.error("Please fill all required fields.");
      return;
    }
    setStep(2);
  };

  const handleFinalSubmit = async (e) => {
    e.preventDefault();
    if (adminData.password !== adminData.confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }
    if (adminData.password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    try {
      const { confirmPassword, ...adminPayload } = adminData;
      const res = await apiClient.post("/auth/register-org", {
        org: orgData,
        admin: adminPayload,
      });

      const { token, user } = res.data.data;
      localStorage.setItem("vms_token", token);
      localStorage.setItem("vms_user", JSON.stringify(user));
      // Dispatch login to context
      await login(adminData.email, adminData.password);
      toast.success("Organization registered! Welcome to VMS.");
      navigate("/dashboard");
    } catch (err) {
      toast.error(err.response?.data?.message || "Registration failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center px-4 py-12">
      {/* Background decoration */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(245,158,11,0.08) 0%, transparent 70%)",
        }}
      />

      <div className="w-full max-w-lg relative z-10">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
            style={{ background: "var(--sidebar-bg)" }}>
            <Shield size={28} style={{ color: "var(--color-accent)" }} />
          </div>
          <h1 className="text-3xl font-bold text-loud">
            Register Your <em className="italic text-accent">Organization</em>
          </h1>
          <p className="text-muted mt-2 text-sm">
            Set up your VMS workspace in under 2 minutes.
          </p>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center gap-0 mb-8">
          {STEPS.map((s, idx) => (
            <div key={s.id} className="flex-1 flex items-center">
              <div className="flex flex-col items-center flex-1">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300"
                  style={{
                    background: step >= s.id ? "var(--color-accent)" : "var(--bg-secondary, #f1f5f9)",
                    color: step >= s.id ? "#fff" : "var(--text-muted)",
                  }}
                >
                  {step > s.id ? <CheckCircle2 size={18} /> : s.id}
                </div>
                <p className="text-xs mt-1.5 font-medium"
                  style={{ color: step >= s.id ? "var(--color-accent)" : "var(--text-muted)" }}>
                  {s.label}
                </p>
              </div>
              {idx < STEPS.length - 1 && (
                <div className="h-0.5 flex-1 mx-2 rounded transition-all duration-500"
                  style={{
                    background: step > s.id ? "var(--color-accent)" : "var(--border-subtle, #e2e8f0)",
                  }} />
              )}
            </div>
          ))}
        </div>

        {/* Step 1 — Organization Details */}
        {step === 1 && (
          <form onSubmit={handleStep1Submit} className="vms-card rounded-2xl p-8 shadow-card space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-loud flex items-center gap-2">
                <Building2 size={18} className="text-accent" />
                Organization Details
              </h2>
              <p className="text-xs text-muted mt-1">Tell us about your organization.</p>
            </div>

            <div className="grid grid-cols-1 gap-5">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-loud uppercase tracking-wider">
                  Organization Name *
                </label>
                <input
                  type="text"
                  name="name"
                  required
                  value={orgData.name}
                  onChange={handleOrgChange}
                  placeholder="e.g. Ministry of Finance"
                  className="vms-input w-full"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-loud uppercase tracking-wider">
                    Short Code *
                  </label>
                  <input
                    type="text"
                    name="code"
                    required
                    maxLength={8}
                    value={orgData.code}
                    onChange={handleOrgChange}
                    placeholder="e.g. MOF"
                    className="vms-input w-full uppercase"
                  />
                  <p className="text-[10px] text-faint">Auto-generated. Max 8 chars.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-loud uppercase tracking-wider">
                    Type *
                  </label>
                  <select
                    name="type"
                    required
                    value={orgData.type}
                    onChange={handleOrgChange}
                    className="vms-input w-full"
                  >
                    <option value="">Select type</option>
                    {ORG_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-loud uppercase tracking-wider">City</label>
                  <input type="text" name="city" value={orgData.city} onChange={handleOrgChange} className="vms-input w-full" placeholder="e.g. New Delhi" />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-loud uppercase tracking-wider">State</label>
                  <input type="text" name="state" value={orgData.state} onChange={handleOrgChange} className="vms-input w-full" placeholder="e.g. Delhi" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-loud uppercase tracking-wider">Phone</label>
                  <input type="tel" name="phone" value={orgData.phone} onChange={handleOrgChange} className="vms-input w-full" placeholder="Org contact no." />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-loud uppercase tracking-wider">Email</label>
                  <input type="email" name="email" value={orgData.email} onChange={handleOrgChange} className="vms-input w-full" placeholder="Org email" />
                </div>
              </div>
            </div>

            <button
              type="submit"
              className="btn-primary w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold"
            >
              Continue <ChevronRight size={16} />
            </button>
          </form>
        )}

        {/* Step 2 — Admin Account */}
        {step === 2 && (
          <form onSubmit={handleFinalSubmit} className="vms-card rounded-2xl p-8 shadow-card space-y-6">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="p-1.5 rounded-lg hover:bg-bg-secondary transition-colors"
                title="Back"
              >
                <ChevronLeft size={18} className="text-muted" />
              </button>
              <div>
                <h2 className="text-lg font-semibold text-loud flex items-center gap-2">
                  <User size={18} className="text-accent" />
                  Admin Account
                </h2>
                <p className="text-xs text-muted mt-0.5">This will be your Organization Administrator login.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-loud uppercase tracking-wider">Full Name *</label>
                <input type="text" name="full_name" required value={adminData.full_name} onChange={handleAdminChange} className="vms-input w-full" placeholder="Your full name" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-loud uppercase tracking-wider">Email *</label>
                  <input type="email" name="email" required value={adminData.email} onChange={handleAdminChange} className="vms-input w-full" placeholder="admin@org.com" />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-loud uppercase tracking-wider">Phone *</label>
                  <input type="tel" name="phone" required value={adminData.phone} onChange={handleAdminChange} className="vms-input w-full" placeholder="Mobile number" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-loud uppercase tracking-wider">Employee Code *</label>
                  <input type="text" name="employee_code" required value={adminData.employee_code} onChange={handleAdminChange} className="vms-input w-full" placeholder="e.g. EMP001" />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-loud uppercase tracking-wider">Designation</label>
                  <input type="text" name="designation" value={adminData.designation} onChange={handleAdminChange} className="vms-input w-full" placeholder="e.g. IT Administrator" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-loud uppercase tracking-wider">Password *</label>
                  <input type="password" name="password" required minLength={8} value={adminData.password} onChange={handleAdminChange} className="vms-input w-full" placeholder="Min 8 characters" />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-loud uppercase tracking-wider">Confirm Password *</label>
                  <input type="password" name="confirmPassword" required value={adminData.confirmPassword} onChange={handleAdminChange} className="vms-input w-full" placeholder="Repeat password" />
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Creating your workspace…
                </span>
              ) : (
                <>
                  <CheckCircle2 size={16} />
                  Complete Registration
                </>
              )}
            </button>
          </form>
        )}

        <p className="text-center text-xs text-muted mt-6">
          Already registered?{" "}
          <Link to="/login" className="text-accent hover:underline font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
