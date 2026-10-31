import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Building2, User, ChevronRight, ChevronLeft, CheckCircle2, Loader2 } from "../../components/icons";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";
import useAuth from "../../hooks/useAuth";
import PasswordStrength from "../../components/PasswordStrength";
import { validatePassword } from "../../utils/passwordValidator";
import { getApiErrorMessage } from "../../utils/apiError";
import AuthLayout from "../../components/AuthLayout";
import Select from "../../components/Select";
import { Field } from "../../components/ui";

const STEPS = [
  { id: 1, label: "Organization", icon: Building2 },
  { id: 2, label: "Admin account", icon: User },
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
    if (!orgData.name.trim()) { toast.error("Organization name is required."); return; }
    if (!orgData.code.trim()) { toast.error("Organization short code is required."); return; }
    if (!orgData.type)        { toast.error("Organization type is required. Please select one."); return; }
    setStep(2);
  };

  const handleFinalSubmit = async (e) => {
    e.preventDefault();
    if (adminData.password !== adminData.confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }
    const { valid: pwValid } = validatePassword(adminData.password);
    if (!pwValid) {
      toast.error("Password does not meet the strength requirements.");
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
      toast.error(getApiErrorMessage(err, "Registration failed. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout eyebrow="New workspace" maxWidth={520} helpText="Already set up? Sign in instead.">
      <div className="mb-5">
        <h2 className="text-[22px] font-semibold text-ink">Register your organisation</h2>
        <p className="text-[12.5px] text-muted mt-1">Set up your VMS workspace in two short steps.</p>
      </div>

      {/* Step indicator: two segments */}
      <ol className="grid grid-cols-2 gap-2 mb-6" aria-label="Progress">
        {STEPS.map((s) => {
          const done = step > s.id;
          const current = step === s.id;
          return (
            <li key={s.id} aria-current={current ? "step" : undefined}>
              <span className={`block h-1 rounded-full ${done || current ? "bg-primary" : "bg-line"}`} />
              <span className={`mt-1.5 flex items-center gap-1 text-[12px] ${current ? "text-ink font-semibold" : done ? "text-ink-2" : "text-muted"}`}>
                {done && <CheckCircle2 size={12} className="text-primary-strong" />}
                {s.id} · {s.label}
              </span>
            </li>
          );
        })}
      </ol>

      {/* Step 1 — Organization Details */}
      {step === 1 && (
        <form onSubmit={handleStep1Submit} className="space-y-3">
          <Field label="Organisation name" htmlFor="ro-name" required>
            <input id="ro-name" type="text" name="name" required value={orgData.name} onChange={handleOrgChange}
              placeholder="e.g. Odisha Hydro Power Corporation Ltd." className="control" />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Short code" htmlFor="ro-code" required hint="Filled in for you. At most 8 characters.">
              <input id="ro-code" type="text" name="code" required maxLength={8} value={orgData.code}
                onChange={handleOrgChange} placeholder="e.g. OHPC" className="control mono uppercase" />
            </Field>
            <Field label="Type" required>
              <Select name="type" required value={orgData.type} onChange={handleOrgChange} aria-label="Organisation type">
                <option value="">Select type</option>
                {ORG_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Field>
            <Field label="City" htmlFor="ro-city">
              <input id="ro-city" type="text" name="city" value={orgData.city} onChange={handleOrgChange} className="control" placeholder="e.g. Bhubaneswar" />
            </Field>
            <Field label="State" htmlFor="ro-state">
              <input id="ro-state" type="text" name="state" value={orgData.state} onChange={handleOrgChange} className="control" placeholder="e.g. Odisha" />
            </Field>
            <Field label="Phone" htmlFor="ro-phone">
              <input id="ro-phone" type="tel" name="phone" value={orgData.phone} onChange={handleOrgChange} className="control tabular" placeholder="Office number" />
            </Field>
            <Field label="Email" htmlFor="ro-email">
              <input id="ro-email" type="email" name="email" value={orgData.email} onChange={handleOrgChange} className="control" placeholder="info@ohpc.co.in" />
            </Field>
          </div>

          <div className="pt-4 !mt-5 border-t border-line">
            <button type="submit" className="btn-primary">
              Continue <ChevronRight size={14} />
            </button>
          </div>
        </form>
      )}

      {/* Step 2 — Admin Account */}
      {step === 2 && (
        <form onSubmit={handleFinalSubmit} className="space-y-3">
          <Field label="Full name" htmlFor="ro-admin-name" required>
            <input id="ro-admin-name" type="text" name="full_name" required value={adminData.full_name} onChange={handleAdminChange} className="control" placeholder="Your full name" />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Email" htmlFor="ro-admin-email" required>
              <input id="ro-admin-email" type="email" name="email" required value={adminData.email} onChange={handleAdminChange} className="control" placeholder="admin@ohpc.co.in" />
            </Field>
            <Field label="Phone" htmlFor="ro-admin-phone" required>
              <input id="ro-admin-phone" type="tel" name="phone" required value={adminData.phone} onChange={handleAdminChange} className="control tabular" placeholder="Mobile number" />
            </Field>
            <Field label="Employee code" htmlFor="ro-admin-code" required>
              <input id="ro-admin-code" type="text" name="employee_code" required value={adminData.employee_code} onChange={handleAdminChange} className="control mono" placeholder="e.g. EMP001" />
            </Field>
            <Field label="Designation" htmlFor="ro-admin-desig">
              <input id="ro-admin-desig" type="text" name="designation" value={adminData.designation} onChange={handleAdminChange} className="control" placeholder="e.g. IT Administrator" />
            </Field>
            <div>
              <Field label="Password" htmlFor="ro-admin-pw" required>
                <input id="ro-admin-pw" type="password" name="password" required minLength={8} value={adminData.password} onChange={handleAdminChange} className="control" placeholder="At least 8 characters" />
              </Field>
              <PasswordStrength password={adminData.password} />
            </div>
            <Field label="Confirm password" htmlFor="ro-admin-confirm" required>
              <input id="ro-admin-confirm" type="password" name="confirmPassword" required value={adminData.confirmPassword} onChange={handleAdminChange} className="control" placeholder="Repeat the password" />
            </Field>
          </div>

          <div className="pt-4 !mt-5 border-t border-line flex flex-wrap gap-2">
            <button type="submit" disabled={loading || !validatePassword(adminData.password).valid} className="btn-primary">
              {loading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              {loading ? "Creating your workspace…" : "Complete registration"}
            </button>
            <button type="button" onClick={() => setStep(1)} className="btn-outline">
              <ChevronLeft size={14} /> Back
            </button>
          </div>
        </form>
      )}

      <p className="text-[12px] text-muted mt-6">
        Already registered? <Link to="/login" className="text-link font-medium">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
