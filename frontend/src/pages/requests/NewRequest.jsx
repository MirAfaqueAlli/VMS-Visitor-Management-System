import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Check,
  Plus,
  Trash2,
  Calendar,
  Clock,
  Building,
  User,
  Users,
  Phone,
  Search,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";
import useAuth from "../../hooks/useAuth";

// ── Category definitions ───────────────────────────────────────────────────────
const ALL_CATEGORIES = [
  { id: "EMPLOYEE_VISIT", label: "Employee Visit",      desc: "Visit or invite a fellow employee" },
  { id: "PERSONAL_VISIT", label: "Personal Visit",      desc: "Family / friend visiting you" },
  { id: "VENDOR",         label: "Vendor / Contractor", desc: "Service and maintenance vendor" },
  { id: "PRIOR",          label: "Prior Approval",      desc: "Pre-scheduled official visit" },
  { id: "SPOT",           label: "Spot Walk-in",        desc: "Urgent unplanned visit" },
];

const ROLE_CATEGORIES = {
  security:     ["SPOT"],
  employee:     ["EMPLOYEE_VISIT", "PERSONAL_VISIT", "VENDOR"],
  unit_admin:   ["EMPLOYEE_VISIT", "PERSONAL_VISIT", "VENDOR", "PRIOR", "SPOT"],
  receptionist: ["EMPLOYEE_VISIT", "VENDOR", "PRIOR", "SPOT"],
  org_admin:    ["EMPLOYEE_VISIT", "PERSONAL_VISIT", "VENDOR", "PRIOR", "SPOT"],
};

export default function NewRequest() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [hosts, setHosts] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [selectedDeptId, setSelectedDeptId] = useState("");

  // ── Visitor phone lookup state ────────────────────────────────────────────────
  const [visitorLookupState, setVisitorLookupState] = useState("idle"); // idle | loading | found | not_found
  const [foundVisitorData,   setFoundVisitorData]   = useState(null);

  const resetVisitorLookup = useCallback(() => {
    setVisitorLookupState("idle");
    setFoundVisitorData(null);
  }, []);

  // ── Vendor phone lookup state ────────────────────────────────────────────────
  const [vendorLookupState, setVendorLookupState] = useState("idle"); // idle | loading | found | not_found

  const resetVendorLookup = useCallback(() => {
    setVendorLookupState("idle");
  }, []);

  // ── EMPLOYEE_VISIT state ─────────────────────────────────────────────────────
  const [visitMode,      setVisitMode]      = useState("visiting"); // 'visiting' | 'hosting'
  const [units,          setUnits]          = useState([]);
  const [selectedUnitId, setSelectedUnitId] = useState("");
  const [empDepartments, setEmpDepartments] = useState([]);
  const [empDeptId,      setEmpDeptId]      = useState("");
  const [employees,      setEmployees]      = useState([]);
  const [selectedEmpId,  setSelectedEmpId]  = useState("");

  const role = user?.role_type || user?.role || "employee";
  const allowedIds = ROLE_CATEGORIES[role] ?? ["EMPLOYEE_VISIT", "VENDOR"];
  const availableCategories = ALL_CATEGORIES.filter((c) => allowedIds.includes(c.id));

  const getInitialCategory = () => {
    const param = searchParams.get("category")?.toUpperCase();
    if (allowedIds.includes(param)) return param;
    return allowedIds[0];
  };

  const isAdminOrStaff = ["super_admin", "admin", "receptionist", "security", "org_admin", "unit_admin"].includes(
    user?.role_type || user?.role
  );

  const [formData, setFormData] = useState({
    visit_category: getInitialCategory(),
    host_user_id:    isAdminOrStaff ? "" : user?.id || "",
    department_id:   user?.department_id || "",
    organization_id: user?.organization_id || "",
    purpose: "",
    visit_date: "",
    visit_start_time: "",
    visit_end_time: "",
    accompanying_count: 0,
    visitor_id:    "",
    visitor_phone: "",
    visitor_name:  "",
    visitor_email: "",
    company_name: "",
    vendor_email: "",
    contact_person: "",
    gst_number: "",
    work_order_ref: "",
    service_type: "",
    companions: [],
  });

  // ── Data fetching ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const fetchDropdownData = async () => {
      try {
        // Use the authenticated endpoint — the JWT tells the backend which unit DB to query.
        const deptsRes = await apiClient.get("/departments");
        setDepartments(deptsRes.data.data || []);
      } catch (err) {
        console.error("Failed to load departments", err);
      }
    };
    fetchDropdownData();
  }, []);

  // ── Visitor phone lookup ───────────────────────────────────────────────────────
  const handleVisitorLookup = async () => {
    const phone = formData.visitor_phone.trim();
    if (!phone || phone.length < 5) {
      toast.error("Please enter a valid phone number to look up.");
      return;
    }
    setVisitorLookupState("loading");
    setFoundVisitorData(null);
    try {
      const res = await apiClient.get("/visitors/lookup", { params: { phone } });
      const { found, visitor } = res.data.data;
      if (found && visitor) {
        if (formData.visit_category === "PERSONAL_VISIT" && visitor.visitor_type && visitor.visitor_type !== "individual") {
          setVisitorLookupState("not_found");
          setFormData(p => ({ ...p, visitor_id: "", visitor_name: "", visitor_email: "" }));
          toast.success("New contact");
          return;
        }
        setVisitorLookupState("found");
        setFoundVisitorData(visitor);
        setFormData(p => ({
          ...p,
          visitor_id:    visitor.id    || "",
          visitor_name:  visitor.full_name || "",
          visitor_email: visitor.email    || "",
        }));
        toast.success(`Returning visitor found: ${visitor.full_name}`);
      } else {
        setVisitorLookupState("not_found");
        setFormData(p => ({ ...p, visitor_id: "", visitor_name: "", visitor_email: "" }));
        toast.success("New contact");
      }
    } catch {
      setVisitorLookupState("not_found");
    }
  };

  // ── Vendor phone lookup ───────────────────────────────────────────────────────
  const handleVendorLookup = async () => {
    const phone = formData.visitor_phone.trim();
    if (!phone || phone.length < 5) {
      toast.error("Please enter a valid contact number to look up.");
      return;
    }
    setVendorLookupState("loading");
    try {
      const res = await apiClient.get("/visitors/lookup", { params: { phone } });
      const { found, visitor } = res.data.data;
      if (found && visitor) {
        if (visitor.visitor_type && visitor.visitor_type !== "business") {
          setVendorLookupState("not_found");
          toast.success("New contact");
          return;
        }
        setVendorLookupState("found");
        // Auto-fill contact person name and email from past records
        setFormData(p => ({
          ...p,
          contact_person: visitor.full_name || p.contact_person,
          vendor_email:   visitor.email     || p.vendor_email,
        }));
        toast.success(`Returning contact found: ${visitor.full_name}`);
      } else {
        setVendorLookupState("not_found");
        toast.success("New contact");
      }
    } catch {
      setVendorLookupState("not_found");
    }
  };

  // Fetch all units on mount for the EMPLOYEE_VISIT unit picker
  useEffect(() => {
    apiClient.get("/units/public")
      .then(res => setUnits(res.data?.data ?? []))
      .catch(() => {});
  }, []);

  // ── Standard handlers ─────────────────────────────────────────────────────────
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleDeptChange = async (e) => {
    const deptId = e.target.value;
    setSelectedDeptId(deptId);
    setFormData((prev) => ({ ...prev, host_user_id: "", department_id: deptId }));
    setHosts([]);

    if (deptId) {
      try {
        const hostsRes = await apiClient.get(`/users/hosts?department_id=${deptId}`);
        setHosts(hostsRes.data.data || []);
      } catch (err) {
        console.warn("Failed to load hosts", err);
        toast.error("Failed to load hosts for selected department.");
      }
    }
  };

  const handleHostChange = (e) => {
    const hostId = e.target.value;
    const selectedHost = hosts.find((h) => String(h.id) === String(hostId));
    setFormData((prev) => ({
      ...prev,
      host_user_id: hostId,
      department_id: selectedHost ? selectedHost.department_id : prev.department_id,
      organization_id: selectedHost ? selectedHost.organization_id || prev.organization_id : prev.organization_id,
    }));
  };

  // ── EMPLOYEE_VISIT handlers ───────────────────────────────────────────────────
  const resetEmpVisitState = () => {
    setSelectedUnitId("");
    setEmpDeptId("");
    setEmpDepartments([]);
    setSelectedEmpId("");
    setEmployees([]);
  };

  const handleEmpUnitChange = async (e) => {
    const uId = e.target.value;
    setSelectedUnitId(uId);
    setEmpDeptId("");
    setEmpDepartments([]);
    setSelectedEmpId("");
    setEmployees([]);
    if (uId) {
      try {
        const res = await apiClient.get("/departments/public", { params: { unit_id: uId } });
        setEmpDepartments(res.data?.data ?? []);
      } catch {
        toast.error("Failed to load departments.");
      }
    }
  };

  const handleEmpDeptChange = async (e) => {
    const dId = e.target.value;
    setEmpDeptId(dId);
    setSelectedEmpId("");
    setEmployees([]);
    if (dId && selectedUnitId) {
      try {
        const res = await apiClient.get("/users/hosts", {
          params: { department_id: dId, unit_id: selectedUnitId },
        });
        setEmployees(res.data?.data ?? []);
      } catch {
        toast.error("Failed to load employees.");
      }
    }
  };

  // ── Category change ────────────────────────────────────────────────────────────
  const handleCategoryChange = (category) => {
    setFormData((prev) => ({
      ...prev,
      visit_category: category,
      host_user_id: isAdminOrStaff ? "" : user?.id || "",
      department_id: isAdminOrStaff ? "" : (category === "EMPLOYEE_VISIT" ? "" : user?.department_id || ""),
      target_unit_id: "",
      visitor_phone: "",
      visitor_name:  "",
      visitor_email: "",
      visitor_id:    "",
    }));
    resetVisitorLookup();
    setSelectedDeptId("");
    setHosts([]);
    setVisitMode("visiting");
    resetEmpVisitState();
  };

  // ── Companions ─────────────────────────────────────────────────────────────────
  const addCompanion = () => {
    setFormData((prev) => ({
      ...prev,
      companions: [...prev.companions, { full_name: "", id_type: "AADHAAR", id_number: "" }],
      accompanying_count: prev.companions.length + 1,
    }));
  };

  const updateCompanion = (index, field, value) => {
    const updated = [...formData.companions];
    updated[index][field] = value;
    setFormData((prev) => ({ ...prev, companions: updated }));
  };

  const removeCompanion = (index) => {
    const updated = formData.companions.filter((_, i) => i !== index);
    setFormData((prev) => ({ ...prev, companions: updated, accompanying_count: updated.length }));
  };

  // ── Submit ─────────────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const payload = { ...formData };
      const cat = payload.visit_category;

      // Clean up vendor-only fields
      if (cat !== "VENDOR") {
        delete payload.company_name;
        delete payload.vendor_email;
        delete payload.contact_person;
        delete payload.gst_number;
        delete payload.work_order_ref;
        delete payload.service_type;
      }

      // ── EMPLOYEE_VISIT special payload ────────────────────────────────────
      if (cat === "EMPLOYEE_VISIT") {
        const isVisiting = visitMode === "visiting"; // I am the visitor
        const isHosting  = visitMode === "hosting";  // I am the host
        payload.request_source = isVisiting ? "SELF" : "HOST";

        if (isVisiting) {
          // Visitor = me; host = selected employee
          payload.visitor_name   = user?.full_name || null;
          payload.visitor_phone  = user?.phone     || null;
          payload.visitor_email  = user?.email     || null;
          payload.host_user_id   = Number(selectedEmpId) || null;
          payload.department_id  = Number(empDeptId)     || null;
          payload.target_unit_id = Number(selectedUnitId) || null;
        } else if (isHosting) {
          // Host = me; visitor = selected employee
          const selectedEmp = employees.find(emp => String(emp.id) === String(selectedEmpId));
          payload.visitor_name   = selectedEmp?.full_name || null;
          payload.visitor_phone  = selectedEmp?.phone     || null;
          payload.visitor_email  = selectedEmp?.email     || null;
          payload.target_unit_id = Number(selectedUnitId) || null;
          // host_user_id and department_id resolved by backend from req.user
        }

        // Convert numeric fields
        if (payload.host_user_id)   payload.host_user_id   = Number(payload.host_user_id);
        if (payload.department_id)  payload.department_id  = Number(payload.department_id);
        if (payload.target_unit_id) payload.target_unit_id = Number(payload.target_unit_id);
      } else {
        // Visitor details come directly from formData (phone lookup or manual entry)
        // The backend auto-finds or auto-creates the visitor record from the phone number.
        payload.visitor_phone = formData.visitor_phone?.trim() || null;
        // For vendors: visitor_name = contact_person (who physically visits), fallback to company_name
        if (cat === 'VENDOR') {
          payload.visitor_name  = formData.contact_person?.trim() || formData.company_name?.trim() || null;
          payload.visitor_email = formData.vendor_email?.trim() || null;
        } else {
          payload.visitor_name  = formData.visitor_name?.trim() || null;
          payload.visitor_email = formData.visitor_email?.trim() || null;
        }
        payload.visitor_id    = null; // backend resolves this

        // Standard numeric conversions — use || null so 0 doesn't become a bad FK
        payload.host_user_id    = Number(payload.host_user_id)  || user?.id  || null;
        payload.department_id   = Number(payload.department_id) || user?.department_id || null;
        payload.organization_id = Number(payload.organization_id) || null;
      }

      payload.accompanying_count = Number(payload.accompanying_count);
      if (!payload.visit_start_time) payload.visit_start_time = null;
      if (!payload.visit_end_time)   payload.visit_end_time   = null;
      // visitor_id is resolved by backend; remove it from payload to avoid confusion
      delete payload.visitor_id;

      console.log('[NewRequest] Submitting payload:', JSON.stringify(payload, null, 2));
      await apiClient.post("/visit-requests", payload);
      toast.success("Visit request created successfully");
      navigate("/requests");
    } catch (error) {
      console.error('[NewRequest] Submit error:', error.response?.data);
      const zodErrors = error.response?.data?.errors;
      if (Array.isArray(zodErrors) && zodErrors.length > 0) {
        const details = zodErrors
          .map((e) => `${e.path?.join('.') || 'field'}: ${e.message}`)
          .join(' | ');
        toast.error(`Validation failed — ${details}`, { duration: 8000 });
      } else {
        toast.error(error.response?.data?.message || "Failed to create request");
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Derived booleans ──────────────────────────────────────────────────────────
  const cat           = formData.visit_category;
  const isVendor      = cat === "VENDOR";
  const isEmpVisit    = cat === "EMPLOYEE_VISIT";
  const isSelfHosting = !isAdminOrStaff && !isEmpVisit;

  // Hide the standard visitor phone fields and host picker for EMPLOYEE_VISIT
  const showVisitorFields = !isVendor && !isEmpVisit;
  const showHostPicker    = !isSelfHosting && !isEmpVisit;

  // Shared input style
  const inputCls = "w-full bg-bg-primary border-0 border-b border-subtle px-0 py-2 text-loud focus:ring-0 focus:border-border transition-colors duration-300";

  return (
    <div className="max-w-4xl mx-auto py-12 px-4 sm:px-6 lg:px-8 animate-fade-in">
      <div className="mb-12">
        <h1 className="text-2xl font-bold text-loud">
          New <em className="italic">Request</em>
        </h1>
        <p className="text-muted mt-3 text-lg">
          Schedule a new visit or register a walk-in.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* ── Step 1: Category Selection ──────────────────────────────────────── */}
        <div className="vms-card rounded-md p-8 shadow-card">
          <h2 className="text-xl text-loud mb-6 flex items-center gap-2">
            <span className="w-8 h-8 rounded-full bg-mixed-bg text-accent flex items-center justify-center text-sm font-bold">
              1
            </span>
            Visit Category
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {availableCategories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => handleCategoryChange(c.id)}
                className={`p-4 rounded-md border text-left transition-all duration-300 ${
                  formData.visit_category === c.id
                    ? "border-border bg-mixed-bg shadow-soft-sm"
                    : "border-subtle hover:border-border hover:bg-bg-primary"
                }`}
              >
                <div className={`font-medium mb-1 ${formData.visit_category === c.id ? "text-accent" : "text-loud"}`}>
                  {c.label}
                </div>
                <div className="text-xs text-muted">{c.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* ── Step 2: Visit Details ──────────────────────────────────────────── */}
        <div className="vms-card rounded-md p-8 shadow-card">
          <h2 className="text-xl text-loud mb-6 flex items-center gap-2">
            <span className="w-8 h-8 rounded-full bg-mixed-bg text-accent flex items-center justify-center text-sm font-bold">
              2
            </span>
            Visit Details
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Date */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-loud flex items-center gap-2">
                <Calendar className="w-4 h-4 text-accent" />
                Visit Date *
              </label>
              <input
                type="date"
                name="visit_date"
                required
                value={formData.visit_date}
                onChange={handleInputChange}
                className={inputCls}
              />
            </div>

            {/* Time */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-loud flex items-center gap-2">
                  <Clock className="w-4 h-4 text-accent" />
                  Start Time
                </label>
                <input
                  type="time"
                  name="visit_start_time"
                  value={formData.visit_start_time}
                  onChange={handleInputChange}
                  className={inputCls}
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-loud">End Time</label>
                <input
                  type="time"
                  name="visit_end_time"
                  value={formData.visit_end_time}
                  onChange={handleInputChange}
                  className={inputCls}
                />
              </div>
            </div>

            {/* ── EMPLOYEE VISIT — mode selector + cascading employee picker ── */}
            {isEmpVisit && (
              <div className="md:col-span-2 space-y-5">

                {/* Mode toggle */}
                <div>
                  <label className="block text-sm font-medium text-loud mb-2">
                    What are you doing?
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { mode: "visiting", label: "I'm visiting someone",  desc: "You are the visitor — they must approve" },
                      { mode: "hosting",  label: "I'm hosting someone",   desc: "You are the host — auto-approved" },
                    ].map(({ mode, label, desc }) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => { setVisitMode(mode); resetEmpVisitState(); }}
                        className={`p-3 rounded-md border text-left transition-all duration-200 ${
                          visitMode === mode
                            ? "border-border bg-mixed-bg"
                            : "border-subtle hover:border-border"
                        }`}
                      >
                        <div className={`font-medium text-sm ${visitMode === mode ? "text-accent" : "text-loud"}`}>
                          {label}
                        </div>
                        <div className="text-xs text-muted mt-0.5">{desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* My role display */}
                <div className="p-3 rounded-md border border-subtle bg-bg-primary text-sm">
                  <p className="text-loud">
                    <span className="text-faint text-xs uppercase tracking-wider block mb-0.5">
                      {visitMode === "visiting" ? "Visitor (You)" : "Host (You)"}
                    </span>
                    {user?.full_name} — {user?.designation || user?.role_type}
                  </p>
                </div>

                {/* Unit picker */}
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-loud flex items-center gap-1.5">
                    <Building className="w-4 h-4 text-accent" />
                    {visitMode === "visiting" ? "Select Unit to Visit *" : "Select Visitor's Unit *"}
                  </label>
                  <select
                    value={selectedUnitId}
                    onChange={handleEmpUnitChange}
                    required
                    className={inputCls}
                  >
                    <option value="">— Select Unit —</option>
                    {units.map(u => (
                      <option key={u.id} value={u.id}>
                        {u.name}{u.city ? ` — ${u.city}` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Department picker */}
                {selectedUnitId && (
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-loud flex items-center gap-1.5">
                      <Building className="w-4 h-4 text-accent" />
                      Select Department *
                    </label>
                    <select
                      value={empDeptId}
                      onChange={handleEmpDeptChange}
                      required
                      disabled={empDepartments.length === 0}
                      className={`${inputCls} disabled:opacity-50`}
                    >
                      <option value="">— Select Department —</option>
                      {empDepartments.map(d => (
                        <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Employee picker */}
                {empDeptId && (
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-loud flex items-center gap-1.5">
                      <User className="w-4 h-4 text-accent" />
                      {visitMode === "visiting" ? "Select Host Employee *" : "Select Visitor (Employee) *"}
                    </label>
                    <select
                      value={selectedEmpId}
                      onChange={e => setSelectedEmpId(e.target.value)}
                      required
                      disabled={employees.length === 0}
                      className={`${inputCls} disabled:opacity-50`}
                    >
                      <option value="">
                        {employees.length === 0 ? "— No employees found —" : "— Select Employee —"}
                      </option>
                      {employees.map(emp => (
                        <option key={emp.id} value={emp.id}>
                          {emp.full_name} ({emp.designation_name || emp.role_type})
                        </option>
                      ))}
                    </select>
                    {visitMode === "hosting" && (
                      <p className="text-xs text-faint mt-1">
                        ✅ This request will be auto-approved since you are the host.
                      </p>
                    )}
                    {visitMode === "visiting" && (
                      <p className="text-xs text-faint mt-1">
                        ⏳ The selected employee will need to approve your visit.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Standard Visitor / Host section (non-EMPLOYEE_VISIT) ──────── */}
            {(() => {
              return (
                <>
                  {/* Visitor Section */}
                  {showVisitorFields ? (
                    <div className="space-y-4 md:col-span-2">
                      <label className="block text-sm font-medium text-loud flex items-center gap-2">
                        <Phone className="w-4 h-4 text-accent" />
                        Visitor *
                      </label>

                      {/* Phone + Lookup button */}
                      <div className="flex gap-2">
                        <input
                          type="tel"
                          placeholder="Enter visitor mobile number"
                          value={formData.visitor_phone}
                          onChange={e => {
                            setFormData(p => ({ ...p, visitor_phone: e.target.value, visitor_name: '', visitor_email: '', visitor_id: '' }));
                            resetVisitorLookup();
                          }}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleVisitorLookup(); }}}
                          required
                          className={`${inputCls} flex-1`}
                        />
                        <button
                          type="button"
                          onClick={handleVisitorLookup}
                          disabled={visitorLookupState === 'loading' || !formData.visitor_phone}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 disabled:opacity-50 shrink-0"
                          style={{ background: 'var(--color-info-bg)', color: 'var(--color-info)' }}
                        >
                          {visitorLookupState === 'loading'
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <Search className="w-4 h-4" />}
                          {visitorLookupState === 'loading' ? 'Looking up...' : 'Lookup'}
                        </button>
                      </div>

                      {/* Status banners */}
                      {visitorLookupState === 'found' && (
                        <div className="flex items-center gap-2 px-4 py-3 rounded-md text-sm"
                          style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d' }}>
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          <span><strong>Returning visitor</strong> — details auto-filled from our records.</span>
                        </div>
                      )}
                      {visitorLookupState === 'not_found' && (
                        <div className="flex items-center gap-2 px-4 py-3 rounded-md text-sm"
                          style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
                          <AlertCircle className="w-4 h-4 shrink-0" />
                          <span><strong>New visitor</strong> — fill in the details below. They will be saved automatically.</span>
                        </div>
                      )}
                      {visitorLookupState === 'idle' && (
                        <p className="text-xs text-faint">
                          Enter the visitor mobile number and click <strong>Lookup</strong>.
                          Details auto-fill for returning visitors.
                        </p>
                      )}

                      {/* Name + Email shown after lookup */}
                      {(visitorLookupState === 'found' || visitorLookupState === 'not_found') && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="block text-xs font-medium text-faint uppercase tracking-wider">Full Name *</label>
                            <input
                              type="text"
                              required
                              readOnly={visitorLookupState === 'found'}
                              value={formData.visitor_name}
                              onChange={e => setFormData(p => ({ ...p, visitor_name: e.target.value }))}
                              placeholder="Visitor full name"
                              className={`${inputCls}${visitorLookupState === 'found' ? ' opacity-60 cursor-default' : ''}`}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="block text-xs font-medium text-faint uppercase tracking-wider">Email (optional)</label>
                            <input
                              type="email"
                              readOnly={visitorLookupState === 'found'}
                              value={formData.visitor_email}
                              onChange={e => setFormData(p => ({ ...p, visitor_email: e.target.value }))}
                              placeholder="visitor@email.com"
                              className={`${inputCls}${visitorLookupState === 'found' ? ' opacity-60 cursor-default' : ''}`}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}

                  {/* Department Section */}
                  {showHostPicker && (
                    <div className="space-y-2 md:col-span-2">
                      <label className="block text-sm font-medium text-loud flex items-center gap-2">
                        <Building className="w-4 h-4 text-accent" />
                        Select Department *
                      </label>
                      <select
                        name="selected_department_id"
                        required
                        value={selectedDeptId}
                        onChange={handleDeptChange}
                        className={inputCls}
                      >
                        <option value="">-- Select Department --</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name} ({d.code})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Host Section */}
                  {showHostPicker ? (
                    <div className="space-y-2 md:col-span-2">
                      <label className="block text-sm font-medium text-loud flex items-center gap-2">
                        <Building className="w-4 h-4 text-accent" />
                        Select Host (Employee) *
                      </label>
                      <select
                        name="host_user_id"
                        required
                        value={formData.host_user_id}
                        onChange={handleHostChange}
                        disabled={!selectedDeptId}
                        className={`${inputCls} disabled:opacity-50`}
                      >
                        <option value="">
                          {!selectedDeptId ? "-- Select Department First --" : "-- Select Host Employee --"}
                        </option>
                        {hosts.map((h) => (
                          <option key={h.id} value={h.id}>
                            {h.full_name} ({h.department_name || h.designation || h.role_type})
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : !isEmpVisit ? (
                    <div className="space-y-2 md:col-span-2">
                      <label className="block text-sm font-medium text-loud flex items-center gap-2">
                        <Building className="w-4 h-4 text-accent" />
                        Host (You)
                      </label>
                      <div className="py-2 text-loud font-medium border-b border-subtle">
                        {user?.full_name} — {user?.designation || user?.role}
                      </div>
                      <input type="hidden" name="host_user_id" value={user?.id || ""} />
                    </div>
                  ) : null}
                </>
              );
            })()}

            {/* Purpose */}
            <div className="space-y-2 md:col-span-2">
              <label className="block text-sm font-medium text-loud">
                Purpose of Visit *
              </label>
              <textarea
                name="purpose"
                required
                minLength={10}
                rows="2"
                value={formData.purpose}
                onChange={handleInputChange}
                className={`${inputCls} resize-none`}
                placeholder="Brief description of the visit purpose (min 10 chars)..."
              />
            </div>
          </div>
        </div>


        {/* ── Step 3: Vendor Details (conditional) ─────────────────────────────── */}
        {isVendor && (
          <div className="vms-card rounded-md p-8 shadow-card animate-fade-in">
            <h2 className="text-xl text-loud mb-6 flex items-center gap-2">
              <span className="w-8 h-8 rounded-full bg-mixed-bg text-accent flex items-center justify-center text-sm font-bold">
                3
              </span>
              <Building className="w-5 h-5 text-accent" />
              Vendor Details
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Company Name */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-loud">Company Name *</label>
                <input type="text" name="company_name" required value={formData.company_name} onChange={handleInputChange} className={inputCls} />
              </div>

              {/* Email Address */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-loud">Email Address</label>
                <input
                  type="email" name="vendor_email"
                  value={formData.vendor_email}
                  onChange={handleInputChange}
                  readOnly={vendorLookupState === 'found'}
                  className={`${inputCls}${vendorLookupState === 'found' ? ' opacity-60 cursor-default' : ''}`}
                  placeholder="For gate pass delivery"
                />
              </div>

              {/* Contact Phone with Lookup — full width */}
              <div className="space-y-2 md:col-span-2">
                <label className="block text-sm font-medium text-loud flex items-center gap-2">
                  <Phone className="w-4 h-4 text-accent" />
                  Contact Phone *
                </label>
                <div className="flex gap-2">
                  <input
                    type="tel" name="visitor_phone" required
                    placeholder="Representative's mobile number"
                    value={formData.visitor_phone}
                    onChange={e => {
                      setFormData(p => ({ ...p, visitor_phone: e.target.value, contact_person: '' }));
                      resetVendorLookup();
                    }}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleVendorLookup(); }}}
                    className={`${inputCls} flex-1`}
                  />
                  <button
                    type="button"
                    onClick={handleVendorLookup}
                    disabled={vendorLookupState === 'loading' || !formData.visitor_phone}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 disabled:opacity-50 shrink-0"
                    style={{ background: 'var(--color-info-bg)', color: 'var(--color-info)' }}
                  >
                    {vendorLookupState === 'loading'
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Search className="w-4 h-4" />}
                    {vendorLookupState === 'loading' ? 'Looking up...' : 'Lookup'}
                  </button>
                </div>
                {vendorLookupState === 'found' && (
                  <div className="flex items-center gap-2 px-4 py-3 rounded-md text-sm"
                    style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d' }}>
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span><strong>Returning contact</strong> — name and email auto-filled from previous visit.</span>
                  </div>
                )}
                {vendorLookupState === 'not_found' && (
                  <div className="flex items-center gap-2 px-4 py-3 rounded-md text-sm"
                    style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span><strong>New contact</strong> — fill in the name below.</span>
                  </div>
                )}
                {vendorLookupState === 'idle' && (
                  <p className="text-xs text-faint">
                    Enter the representative's mobile and click <strong>Lookup</strong> to auto-fill details.
                  </p>
                )}
              </div>

              {/* Contact Person — auto-filled or manual */}
              <div className="space-y-2 md:col-span-2">
                <label className="block text-sm font-medium text-loud">Contact Person *</label>
                <input
                  type="text" name="contact_person" required
                  value={formData.contact_person}
                  onChange={e => setFormData(p => ({ ...p, contact_person: e.target.value }))}
                  readOnly={vendorLookupState === 'found'}
                  placeholder="Representative's full name"
                  className={`${inputCls}${vendorLookupState === 'found' ? ' opacity-60 cursor-default' : ''}`}
                />
              </div>

              {/* Service Type */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-loud">Service Type</label>
                <input type="text" name="service_type" value={formData.service_type} onChange={handleInputChange} className={inputCls} placeholder="e.g. AC Maintenance, Delivery" />
              </div>

              {/* Work Order Ref */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-loud">Work Order Ref</label>
                <input type="text" name="work_order_ref" value={formData.work_order_ref} onChange={handleInputChange} className={inputCls} />
              </div>
            </div>
          </div>
        )}

        {/* ── Companions ─────────────────────────────────────────────────────── */}
        <div className="vms-card rounded-md p-8 shadow-card">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl text-loud flex items-center gap-2">
              <span className="w-8 h-8 rounded-full bg-mixed-bg text-accent flex items-center justify-center text-sm font-bold">
                {isVendor ? "4" : "3"}
              </span>
              <Users className="w-5 h-5 text-accent" />
              Companions ({formData.accompanying_count})
            </h2>
            <button
              type="button"
              onClick={addCompanion}
              className="btn-secondary text-accent text-xs font-medium uppercase tracking-wider hover:bg-mixed-bg transition-colors flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Add Companion
            </button>
          </div>

          {formData.companions.length === 0 ? (
            <div className="text-center py-6 text-faint italic border border-dashed border-subtle rounded-md">
              No companions added.
            </div>
          ) : (
            <div className="space-y-4">
              {formData.companions.map((comp, idx) => (
                <div
                  key={idx}
                  className="flex flex-col sm:flex-row gap-4 items-start sm:items-center bg-bg-primary p-4 rounded-md border border-subtle"
                >
                  <div className="flex-1 space-y-1 w-full">
                    <input
                      type="text"
                      placeholder="Full Name"
                      required
                      value={comp.full_name}
                      onChange={(e) => updateCompanion(idx, "full_name", e.target.value)}
                      className="w-full bg-transparent border-0 border-b border-subtle px-0 py-1 text-sm text-loud focus:ring-0 focus:border-border"
                    />
                  </div>
                  <div className="flex-1 space-y-1 w-full">
                    <select
                      value={comp.id_type}
                      onChange={(e) => updateCompanion(idx, "id_type", e.target.value)}
                      className="w-full bg-transparent border-0 border-b border-subtle px-0 py-1 text-sm text-loud focus:ring-0 focus:border-border"
                    >
                      <option value="AADHAAR">Aadhaar</option>
                      <option value="PAN">PAN</option>
                      <option value="DRIVING_LICENSE">Driving License</option>
                      <option value="PASSPORT">Passport</option>
                    </select>
                  </div>
                  <div className="flex-1 space-y-1 w-full">
                    <input
                      type="text"
                      placeholder="ID Number"
                      required
                      value={comp.id_number}
                      onChange={(e) => updateCompanion(idx, "id_number", e.target.value)}
                      className="w-full bg-transparent border-0 border-b border-subtle px-0 py-1 text-sm text-loud focus:ring-0 focus:border-border"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeCompanion(idx)}
                    className="p-2 text-warning hover:bg-accent/10 rounded-full transition-colors self-end sm:self-auto"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Actions ────────────────────────────────────────────────────────── */}
        <div className="flex justify-end gap-4 pt-4">
          <button
            type="button"
            onClick={() => navigate("/requests")}
            className="btn-secondary text-accent uppercase tracking-widest text-sm font-medium hover:bg-mixed-bg transition-colors duration-300"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="btn-primary text-white uppercase tracking-widest text-sm font-medium hover:bg-accent transition-colors duration-300 shadow-card hover:shadow-hover disabled:opacity-70 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading ? (
              "Submitting..."
            ) : (
              <>
                <Check className="w-4 h-4" />
                Submit Request
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
