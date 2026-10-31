// frontend/src/pages/visitor/VisitorNewRequest.jsx
import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import {
  Calendar,
  Clock,
  Building,
  User,
  Briefcase,
  Users,
  FileText,
  ArrowRight,
  ArrowLeft,
  ChevronDown,
  Loader2,
  CheckCircle,
  RotateCcw,
} from "lucide-react";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";

const getTodayDateIST = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const VISIT_TYPES = [
  {
    id: "INDIVIDUAL",
    label: "Individual Visit",
    
    icon: User,
  },
  {
    id: "BUSINESS",
    label: "Official / Business",

    icon: Briefcase,
  },
];

const DRAFT_KEY = "vms_visitor_new_request_draft";

export default function VisitorNewRequest() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Query params for Revisit
  const revisitUnit = searchParams.get("revisit_unit");
  const revisitDept = searchParams.get("revisit_dept");
  const revisitHost = searchParams.get("revisit_host");
  const revisitCategory = searchParams.get("revisit_category");
  const revisitPurpose = searchParams.get("revisit_purpose");
  const revisitCompany = searchParams.get("revisit_company");

  // Load initial form from draft or defaults
  const [formData, setFormData] = useState(() => {
    try {
      const saved = sessionStorage.getItem(DRAFT_KEY);
      if (saved && !revisitUnit) {
        return JSON.parse(saved);
      }
    } catch {}

    return {
      visit_type: revisitCategory || "INDIVIDUAL",
      unit_id: revisitUnit || "",
      department_id: revisitDept || "",
      host_user_id: revisitHost || "",
      purpose: revisitPurpose || "",
      visit_date: getTodayDateIST(),
      visit_start_time: "10:00",
      visit_end_time: "11:00",
      company_name: revisitCompany || "",
      accompanying_count: 0,
    };
  });

  const [units, setUnits] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [hosts, setHosts] = useState([]);
  const [loadingDepts, setLoadingDepts] = useState(false);
  const [loadingHosts, setLoadingHosts] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Sync draft to sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(formData));
    } catch {}
  }, [formData]);

  // Load Units on Mount
  useEffect(() => {
    apiClient
      .get("/units/public")
      .then((res) => {
        setUnits(res.data?.data || []);
      })
      .catch(() => toast.error("Could not load OHPC units."));
  }, []);

  // Load Departments when unit_id changes
  useEffect(() => {
    if (!formData.unit_id) {
      setDepartments([]);
      setHosts([]);
      return;
    }
    setLoadingDepts(true);
    apiClient
      .get("/departments/public", { params: { unit_id: formData.unit_id } })
      .then((res) => {
        setDepartments(res.data?.data || []);
      })
      .catch(() => toast.error("Failed to load departments."))
      .finally(() => setLoadingDepts(false));
  }, [formData.unit_id]);

  // Load Hosts when department_id changes
  useEffect(() => {
    if (!formData.department_id) {
      setHosts([]);
      return;
    }
    setLoadingHosts(true);
    apiClient
      .get("/users/hosts", {
        params: {
          department_id: formData.department_id,
          unit_id: formData.unit_id,
        },
      })
      .then((res) => {
        setHosts(res.data?.data || []);
      })
      .catch(() => toast.error("Failed to load hosts."))
      .finally(() => setLoadingHosts(false));
  }, [formData.department_id, formData.unit_id]);

  // Submit Handler
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.unit_id) {
      toast.error("Please select an OHPC Unit / Facility.");
      return;
    }
    if (!formData.department_id) {
      toast.error("Please select a Department.");
      return;
    }
    if (!formData.host_user_id) {
      toast.error("Please select a Host Officer.");
      return;
    }
    if (formData.visit_type === "BUSINESS" && !formData.company_name?.trim()) {
      toast.error("Company / Organization name is required for business visits.");
      return;
    }
    if (!formData.purpose?.trim()) {
      toast.error("Please describe the purpose of your visit.");
      return;
    }

    setSubmitting(true);
    try {
      await apiClient.post("/visit-requests/public", {
        unit_id: parseInt(formData.unit_id, 10),
        department_id: parseInt(formData.department_id, 10),
        host_user_id: parseInt(formData.host_user_id, 10),
        visit_category: formData.visit_type,
        purpose: formData.purpose.trim(),
        visit_date: formData.visit_date,
        visit_start_time: formData.visit_start_time || undefined,
        visit_end_time: formData.visit_end_time || undefined,
        company_name: formData.company_name?.trim() || undefined,
        accompanying_count: parseInt(formData.accompanying_count, 10) || 0,
      });

      // Clear draft on success
      sessionStorage.removeItem(DRAFT_KEY);

      toast.success("Visit request submitted successfully!");
      navigate("/visitor/history", { replace: true });
    } catch (err) {
      console.error("Submit visit request error:", err);
      toast.error(
        err?.response?.data?.message || "Failed to submit visit request."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const isRevisiting = Boolean(revisitUnit && revisitHost);

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in pb-12">
      {/* ── Top Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between pb-4 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <Link
              to="/visitor/dashboard"
              className="text-xs font-semibold text-faint hover:text-loud flex items-center gap-1 transition-colors"
            >
              <ArrowLeft size={13} /> Back to Dashboard
            </Link>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-loud tracking-tight mt-1">
            {isRevisiting ? "Schedule Revisit with Host" : "Book New Visit Request"}
          </h1>
          
        </div>

        {isRevisiting && (
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-mixed-bg text-accent text-xs font-bold border border-accent/20">
            <RotateCcw size={13} />
            <span>Revisit Mode</span>
          </div>
        )}
      </div>

      {/* ── Form Card ───────────────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit} className="vms-card p-6 sm:p-8 border border-border space-y-6">
        {/* Section 1: Visit Category */}
        <div className="space-y-3">
          <label className="block text-xs font-bold text-muted uppercase tracking-wider">
            1. Select Visit Type *
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {VISIT_TYPES.map(({ id, label, desc, icon: Icon }) => {
              const selected = formData.visit_type === id;
              return (
                <button
                  type="button"
                  key={id}
                  onClick={() =>
                    setFormData((prev) => ({ ...prev, visit_type: id }))
                  }
                  className={`text-left p-4 rounded-xl border transition-all ${
                    selected
                      ? "border-accent bg-accent/5 ring-1 ring-accent/20"
                      : "border-border bg-bg-secondary hover:border-border/80"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <Icon
                        size={16}
                        className={selected ? "text-accent" : "text-faint"}
                      />
                      <span className="text-xs font-bold text-loud">
                        {label}
                      </span>
                    </div>
                    {selected && (
                      <CheckCircle size={14} className="text-accent" />
                    )}
                  </div>
                  <p className="text-[11px] text-faint leading-tight">{desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Section 2: Destination & Host */}
        <div className="space-y-4 pt-4 border-t border-border">
          <label className="block text-xs font-bold text-muted uppercase tracking-wider flex items-center gap-2">
            <Building size={15} className="text-accent" />
            <span>2. Target Unit & Host Contact *</span>
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Unit */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-muted">
                OHPC Unit / Location *
              </label>
              <div className="relative">
                <select
                  required
                  value={formData.unit_id}
                  onChange={(e) =>
                    setFormData((p) => ({
                      ...p,
                      unit_id: e.target.value,
                      department_id: "",
                      host_user_id: "",
                    }))
                  }
                  className="vms-input appearance-none pr-8 cursor-pointer"
                >
                  <option value="">— Select Unit —</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={14}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none"
                />
              </div>
            </div>

            {/* Department */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-muted">
                Department *
              </label>
              <div className="relative">
                <select
                  required
                  disabled={!formData.unit_id || loadingDepts}
                  value={formData.department_id}
                  onChange={(e) =>
                    setFormData((p) => ({
                      ...p,
                      department_id: e.target.value,
                      host_user_id: "",
                    }))
                  }
                  className="vms-input appearance-none pr-8 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">
                    {!formData.unit_id
                      ? "— Select Unit First —"
                      : loadingDepts
                      ? "Loading departments..."
                      : "— Select Department —"}
                  </option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={14}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none"
                />
              </div>
            </div>

            {/* Host Officer */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-muted">
                Host / Officer to Meet *
              </label>
              <div className="relative">
                <select
                  required
                  disabled={!formData.department_id || loadingHosts}
                  value={formData.host_user_id}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, host_user_id: e.target.value }))
                  }
                  className="vms-input appearance-none pr-8 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">
                    {!formData.department_id
                      ? "— Select Dept First —"
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
                <ChevronDown
                  size={14}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Section 3: Schedule & Purpose */}
        <div className="space-y-4 pt-4 border-t border-border">
          <label className="block text-xs font-bold text-muted uppercase tracking-wider flex items-center gap-2">
            <Calendar size={15} className="text-accent" />
            <span>3. Schedule & Purpose of Visit *</span>
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Visit Date */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-muted">
                Date of Visit *
              </label>
              <input
                type="date"
                required
                min={getTodayDateIST()}
                value={formData.visit_date}
                onChange={(e) =>
                  setFormData((p) => ({ ...p, visit_date: e.target.value }))
                }
                className="vms-input"
              />
            </div>

            {/* Arrival Time */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-muted">
                Expected Arrival Time
              </label>
              <input
                type="time"
                value={formData.visit_start_time}
                onChange={(e) =>
                  setFormData((p) => ({ ...p, visit_start_time: e.target.value }))
                }
                className="vms-input"
              />
            </div>

            {/* Departure Time */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-muted">
                Estimated Departure Time
              </label>
              <input
                type="time"
                value={formData.visit_end_time}
                onChange={(e) =>
                  setFormData((p) => ({ ...p, visit_end_time: e.target.value }))
                }
                className="vms-input"
              />
            </div>
          </div>

          {/* Company Name if Business */}
          {formData.visit_type === "BUSINESS" && (
            <div className="space-y-1.5 animate-fade-in">
              <label className="block text-xs font-semibold text-muted">
                Company / Organization Name *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Bharat Heavy Electricals Ltd. / Alstom Grid"
                value={formData.company_name}
                onChange={(e) =>
                  setFormData((p) => ({ ...p, company_name: e.target.value }))
                }
                className="vms-input"
              />
            </div>
          )}

          {/* Purpose of Visit */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-muted">
              Purpose of Visit *
            </label>
            <textarea
              required
              rows={3}
              placeholder="Provide a brief summary of the agenda or reason for the visit (e.g., Annual technical audit, transformer inspection, contract discussion)"
              value={formData.purpose}
              onChange={(e) =>
                setFormData((p) => ({ ...p, purpose: e.target.value }))
              }
              className="vms-input"
            />
          </div>

          {/* Accompanying Persons Count */}
          <div className="space-y-1.5 max-w-xs">
            <label className="block text-xs font-semibold text-muted flex items-center gap-1.5">
              <Users size={13} className="text-accent" />
              <span>Accompanying Persons (if any)</span>
            </label>
            <input
              type="number"
              min={0}
              max={10}
              value={formData.accompanying_count}
              onChange={(e) =>
                setFormData((p) => ({
                  ...p,
                  accompanying_count: Math.max(0, parseInt(e.target.value, 10) || 0),
                }))
              }
              className="vms-input"
            />
            
          </div>
        </div>

        {/* ── Submit Button ─────────────────────────────────────────────────── */}
        <div className="pt-4 border-t border-border flex items-center justify-end gap-3">
          <Link
            to="/visitor/dashboard"
            className="btn-secondary py-2.5 px-4 text-xs font-semibold"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="btn-primary py-2.5 px-6 text-xs sm:text-sm font-bold shadow-md shadow-accent/20"
          >
            {submitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Submitting Request...</span>
              </>
            ) : (
              <>
                <span>Submit Visit Request</span>
                <ArrowRight size={15} />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

