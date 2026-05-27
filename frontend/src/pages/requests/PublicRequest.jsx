// frontend/src/pages/requests/PublicRequest.jsx
import { useState, useEffect } from "react";
import {
  Shield, Building2, User, FileText, CheckCircle2,
  ChevronDown, Briefcase, UserCircle,
} from "lucide-react";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";

const VISIT_TYPES = [
  {
    id:    "INDIVIDUAL",
    label: "Individual",
    desc:  "Personal / private visit (family, friend, or personal matter)",
    icon:  UserCircle,
  },
  {
    id:    "BUSINESS",
    label: "Business",
    desc:  "Official / company visit (vendor, contractor, client meeting)",
    icon:  Briefcase,
  },
];

const INITIAL_FORM = {
  visit_type:        "INDIVIDUAL",
  unit_id:           "",
  department_id:     "",
  host_user_id:      "",
  purpose:           "",
  visit_date:        "",
  visit_start_time:  "",
  visit_end_time:    "",
  visitor_full_name: "",
  visitor_email:     "",
  visitor_phone:     "",
  id_type:           "AADHAAR",
  id_number:         "",
  company_name:      "",
};

const selectCls = "w-full bg-bg-primary text-loud text-sm px-3 py-2.5 rounded-lg border border-subtle focus:outline-none focus:border-accent transition-colors appearance-none cursor-pointer";
const inputCls  = "w-full bg-bg-primary text-loud text-sm px-3 py-2.5 rounded-lg border border-subtle focus:outline-none focus:border-accent transition-colors placeholder:text-faint";
const labelCls  = "block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1.5";

export default function PublicRequest() {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [formData, setFormData] = useState(INITIAL_FORM);

  // Cascade data
  const [units,       setUnits]       = useState([]);
  const [departments, setDepartments] = useState([]);
  const [hosts,       setHosts]       = useState([]);

  // Loading states
  const [loadingDepts, setLoadingDepts] = useState(false);
  const [loadingHosts, setLoadingHosts] = useState(false);

  // ── Fetch all units on mount ─────────────────────────────────────────────────
  useEffect(() => {
    apiClient.get("/units/public")
      .then(res => setUnits(res.data?.data ?? []))
      .catch(() => toast.error("Could not load unit list."));
  }, []);

  // ── Fetch departments when unit changes ──────────────────────────────────────
  useEffect(() => {
    if (!formData.unit_id) {
      setDepartments([]);
      setHosts([]);
      setFormData(p => ({ ...p, department_id: "", host_user_id: "" }));
      return;
    }
    setLoadingDepts(true);
    setDepartments([]);
    setHosts([]);
    setFormData(p => ({ ...p, department_id: "", host_user_id: "" }));

    apiClient.get("/departments/public", { params: { unit_id: formData.unit_id } })
      .then(res => setDepartments(res.data?.data ?? []))
      .catch(() => toast.error("Failed to load departments."))
      .finally(() => setLoadingDepts(false));
  }, [formData.unit_id]);

  // ── Fetch hosts when department changes ──────────────────────────────────────
  useEffect(() => {
    if (!formData.department_id) {
      setHosts([]);
      setFormData(p => ({ ...p, host_user_id: "" }));
      return;
    }
    setLoadingHosts(true);
    setHosts([]);
    setFormData(p => ({ ...p, host_user_id: "" }));

    apiClient.get("/users/hosts", {
      params: { department_id: formData.department_id, unit_id: formData.unit_id },
    })
      .then(res => setHosts(res.data?.data ?? []))
      .catch(() => toast.error("Failed to load hosts."))
      .finally(() => setLoadingHosts(false));
  }, [formData.department_id]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(p => ({ ...p, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.unit_id)       { toast.error("Please select a unit."); return; }
    if (!formData.department_id) { toast.error("Please select a department."); return; }
    if (!formData.host_user_id)  { toast.error("Please select a host."); return; }
    if (formData.visit_type === "BUSINESS" && !formData.company_name.trim()) {
      toast.error("Company name is required for business visits."); return;
    }

    setLoading(true);
    try {
      const payload = {
        unit_id:          parseInt(formData.unit_id),
        department_id:    parseInt(formData.department_id),
        host_user_id:     parseInt(formData.host_user_id),
        visit_category:   formData.visit_type,         // Backend maps INDIVIDUAL→PERSONAL_VISIT, BUSINESS→VENDOR
        purpose:          formData.purpose.trim(),
        visit_date:       formData.visit_date,
        visit_start_time: formData.visit_start_time || undefined,
        visit_end_time:   formData.visit_end_time   || undefined,
        visitor_full_name: formData.visitor_full_name.trim(),
        visitor_phone:    formData.visitor_phone.trim(),
        visitor_email:    formData.visitor_email.trim() || undefined,
        id_type:          formData.id_type,
        id_number:        formData.id_number.trim(),
        company_name:     formData.company_name.trim() || undefined,
      };
      await apiClient.post("/visit-requests/public", payload);
      setSuccess(true);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to submit request.");
    } finally {
      setLoading(false);
    }
  };

  // ── Success screen ────────────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="min-h-screen bg-bg-primary flex flex-col items-center justify-center p-4">
        <div className="vms-card max-w-md w-full p-10 text-center rounded-2xl shadow-card animate-fade-in">
          <div className="w-16 h-16 rounded-full bg-mixed-bg flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 size={32} className="text-accent" />
          </div>
          <h2 className="text-2xl font-bold text-loud mb-2">Request Submitted!</h2>
          <p className="text-muted text-sm mb-6 leading-relaxed">
            Your visit request has been sent to the host for approval.
            You will be notified once it is confirmed.
          </p>
          <button
            onClick={() => { setSuccess(false); setFormData(INITIAL_FORM); }}
            className="btn-primary w-full"
          >
            Submit Another Request
          </button>
        </div>
      </div>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-bg-primary py-12 px-4 sm:px-6">
      {/* Background glow */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ background: "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(245,158,11,0.05) 0%, transparent 70%)" }}
      />

      <div className="max-w-2xl mx-auto relative z-10">

        {/* Page title */}
        <div className="text-center mb-10">
          <div
            className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
            style={{ background: "var(--sidebar-bg)" }}
          >
            <Shield size={28} style={{ color: "var(--color-accent)" }} />
          </div>
          <h1 className="text-3xl font-bold text-loud">
            Visitor <em className="italic text-accent">Pre-Registration</em>
          </h1>
          <p className="text-muted mt-2 text-sm">
            Request approval to visit a unit or branch.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="vms-card rounded-2xl p-8 shadow-card space-y-8">

          {/* ── Section 1: Visit Type ──────────────────────────────────────────── */}
          <div>
            <h3 className="text-base font-semibold text-loud flex items-center gap-2 mb-4">
              <FileText size={16} className="text-accent" />
              Type of Visit
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {VISIT_TYPES.map(({ id, label, desc, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFormData(p => ({ ...p, visit_type: id, company_name: "" }))}
                  className={`p-4 rounded-xl border text-left transition-all duration-200 ${
                    formData.visit_type === id
                      ? "border-accent bg-mixed-bg"
                      : "border-subtle hover:border-border"
                  }`}
                >
                  <Icon
                    size={20}
                    className={`mb-2 ${formData.visit_type === id ? "text-accent" : "text-muted"}`}
                  />
                  <div className={`font-semibold text-sm ${formData.visit_type === id ? "text-accent" : "text-loud"}`}>
                    {label}
                  </div>
                  <div className="text-[11px] text-faint mt-0.5 leading-snug">{desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="h-px bg-border w-full" />

          {/* ── Section 2: Where are you visiting? ────────────────────────────── */}
          <div>
            <h3 className="text-base font-semibold text-loud flex items-center gap-2 mb-4">
              <Building2 size={16} className="text-accent" />
              Where are you visiting?
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">

              {/* Unit */}
              <div className="sm:col-span-2 space-y-1.5">
                <label className={labelCls}>Select Unit / Branch *</label>
                <div className="relative">
                  <select
                    name="unit_id"
                    required
                    value={formData.unit_id}
                    onChange={handleChange}
                    className={selectCls}
                  >
                    <option value="">— Select the unit you&apos;re visiting —</option>
                    {units.map(u => (
                      <option key={u.id} value={u.id}>
                        {u.name}{u.city ? ` — ${u.city}` : ""}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
                </div>
              </div>

              {/* Department */}
              <div className="space-y-1.5">
                <label className={labelCls}>Department *</label>
                <div className="relative">
                  <select
                    name="department_id"
                    required
                    value={formData.department_id}
                    onChange={handleChange}
                    disabled={!formData.unit_id || loadingDepts}
                    className={`${selectCls} disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <option value="">
                      {!formData.unit_id ? "— Select Unit First —" : loadingDepts ? "Loading…" : "— Select Department —"}
                    </option>
                    {departments.map(d => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
                </div>
              </div>

              {/* Host */}
              <div className="space-y-1.5">
                <label className={labelCls}>Host / Contact Person *</label>
                <div className="relative">
                  <select
                    name="host_user_id"
                    required
                    value={formData.host_user_id}
                    onChange={handleChange}
                    disabled={!formData.department_id || loadingHosts}
                    className={`${selectCls} disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <option value="">
                      {!formData.department_id ? "— Select Department First —" : loadingHosts ? "Loading…" : "— Select Host —"}
                    </option>
                    {hosts.map(h => (
                      <option key={h.id} value={h.id}>
                        {h.full_name}{h.designation_name ? ` — ${h.designation_name}` : ""}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
                </div>
              </div>

              {/* Date */}
              <div className="space-y-1.5">
                <label className={labelCls}>Date of Visit *</label>
                <input
                  type="date"
                  name="visit_date"
                  required
                  value={formData.visit_date}
                  onChange={handleChange}
                  min={new Date().toISOString().split("T")[0]}
                  className={inputCls}
                />
              </div>

              {/* Time range */}
              <div className="space-y-1.5">
                <label className={labelCls}>Time Window (Optional)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    name="visit_start_time"
                    value={formData.visit_start_time}
                    onChange={handleChange}
                    className={inputCls}
                  />
                  <span className="text-faint text-xs shrink-0">to</span>
                  <input
                    type="time"
                    name="visit_end_time"
                    value={formData.visit_end_time}
                    onChange={handleChange}
                    className={inputCls}
                  />
                </div>
              </div>

              {/* Purpose */}
              <div className="space-y-1.5 sm:col-span-2">
                <label className={labelCls}>Purpose of Visit *</label>
                <input
                  type="text"
                  name="purpose"
                  required
                  minLength={5}
                  value={formData.purpose}
                  onChange={handleChange}
                  placeholder="e.g. Product demo, Project review meeting, Official discussion"
                  className={inputCls}
                />
              </div>
            </div>
          </div>

          <div className="h-px bg-border w-full" />

          {/* ── Section 3: Your Details ────────────────────────────────────────── */}
          <div>
            <h3 className="text-base font-semibold text-loud flex items-center gap-2 mb-4">
              <User size={16} className="text-accent" />
              Your Details
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">

              {/* Full Name */}
              <div className="space-y-1.5 sm:col-span-2">
                <label className={labelCls}>Full Name *</label>
                <input
                  type="text"
                  name="visitor_full_name"
                  required
                  value={formData.visitor_full_name}
                  onChange={handleChange}
                  placeholder="Your full name"
                  className={inputCls}
                />
              </div>

              {/* Phone */}
              <div className="space-y-1.5">
                <label className={labelCls}>Phone Number *</label>
                <input
                  type="tel"
                  name="visitor_phone"
                  required
                  value={formData.visitor_phone}
                  onChange={handleChange}
                  placeholder="10-digit mobile number"
                  className={inputCls}
                />
              </div>

              {/* Email */}
              <div className="space-y-1.5">
                <label className={labelCls}>Email (Optional)</label>
                <input
                  type="email"
                  name="visitor_email"
                  value={formData.visitor_email}
                  onChange={handleChange}
                  placeholder="you@email.com"
                  className={inputCls}
                />
              </div>

              {/* ID Type */}
              <div className="space-y-1.5">
                <label className={labelCls}>Government ID Type *</label>
                <div className="relative">
                  <select
                    name="id_type"
                    required
                    value={formData.id_type}
                    onChange={handleChange}
                    className={selectCls}
                  >
                    <option value="AADHAAR">Aadhaar</option>
                    <option value="PAN">PAN Card</option>
                    <option value="DRIVING_LICENSE">Driving License</option>
                    <option value="PASSPORT">Passport</option>
                    <option value="VOTER_ID">Voter ID</option>
                    <option value="OTHER">Other</option>
                  </select>
                  <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
                </div>
              </div>

              {/* ID Number */}
              <div className="space-y-1.5">
                <label className={labelCls}>ID Number *</label>
                <input
                  type="text"
                  name="id_number"
                  required
                  value={formData.id_number}
                  onChange={handleChange}
                  placeholder="ID document number"
                  className={inputCls}
                />
              </div>

              {/* Company Name — only for BUSINESS type */}
              {formData.visit_type === "BUSINESS" && (
                <div className="space-y-1.5 sm:col-span-2 animate-fade-in">
                  <label className={labelCls}>Company / Organisation Name *</label>
                  <input
                    type="text"
                    name="company_name"
                    required
                    value={formData.company_name}
                    onChange={handleChange}
                    placeholder="Your company or organisation name"
                    className={inputCls}
                  />
                </div>
              )}

            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full py-3.5 text-sm font-semibold flex items-center justify-center gap-2"
          >
            {loading
              ? <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <FileText size={16} />
            }
            {loading ? "Submitting…" : "Submit Visit Request"}
          </button>

          {/* Disclaimer */}
          <p className="text-[11px] text-faint text-center leading-relaxed">
            By submitting, you agree that your details may be shared with the host for security verification purposes.
          </p>

        </form>
      </div>
    </div>
  );
}
