import { useState, useEffect } from "react";
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
} from "lucide-react";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";
import useAuth from "../../hooks/useAuth";

const ALL_CATEGORIES = [
  { id: "EMP",    label: "Employee Visitor",    desc: "Personal or direct visit" },
  { id: "VENDOR", label: "Vendor / Contractor", desc: "Service and maintenance" },
  { id: "PRIOR",  label: "Prior Approval",      desc: "Pre-scheduled official visit" },
  { id: "SPOT",   label: "Spot Walk-in",        desc: "Urgent unplanned visit" },
];

const ROLE_CATEGORIES = {
  security:     ["SPOT"],
  employee:     ["EMP", "VENDOR"],
  org_admin:    ["EMP", "VENDOR", "PRIOR", "SPOT"],
  dept_admin:   ["EMP", "VENDOR", "PRIOR", "SPOT"],
  receptionist: ["EMP", "VENDOR", "PRIOR", "SPOT"],
};

export default function NewRequest() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [visitors, setVisitors] = useState([]);
  const [hosts, setHosts] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [selectedDeptId, setSelectedDeptId] = useState("");

  const role = user?.role_type || user?.role || "employee";
  const allowedIds = ROLE_CATEGORIES[role] ?? ["EMP", "VENDOR"];
  const availableCategories = ALL_CATEGORIES.filter((c) => allowedIds.includes(c.id));

  const getInitialCategory = () => {
    const param = searchParams.get("category")?.toUpperCase();
    if (allowedIds.includes(param)) return param;
    return allowedIds[0];
  };

  const isRoleAdminOrStaff = ["super_admin", "admin", "receptionist", "security", "org_admin", "dept_admin"].includes(
    user?.role_type || user?.role
  );

  const [formData, setFormData] = useState({
    visit_category: getInitialCategory(),
    host_user_id: isRoleAdminOrStaff ? "" : user?.id || "",
    department_id: user?.department_id || "",
    organization_id: user?.organization_id || "",
    purpose: "",
    visit_date: "",
    visit_start_time: "",
    visit_end_time: "",
    accompanying_count: 0,
    visitor_id: "",
    company_name: "",
    vendor_email: "",
    contact_person: "",
    gst_number: "",
    work_order_ref: "",
    service_type: "",
    companions: [],
  });

  // Fetch visitors and departments for dropdown
  useEffect(() => {
    const fetchDropdownData = async () => {
      try {
        const visRes = await apiClient.get("/visitors?limit=100");
        setVisitors(visRes.data.data?.visitors || []);
      } catch (err) {
        console.error("Failed to load visitors for dropdown", err);
      }

      try {
        const orgId = user?.organization_id;
        const deptsUrl = orgId
          ? `/departments/public?organization_id=${orgId}`
          : `/departments/public`;
        const deptsRes = await apiClient.get(deptsUrl);
        setDepartments(deptsRes.data.data || []);
      } catch (err) {
        console.error("Failed to load departments", err);
      }
    };
    fetchDropdownData();
  }, [user?.organization_id]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleDeptChange = async (e) => {
    const deptId = e.target.value;
    setSelectedDeptId(deptId);
    setFormData((prev) => ({
      ...prev,
      host_user_id: "",
      department_id: deptId,
    }));
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
      department_id: selectedHost
        ? selectedHost.department_id
        : prev.department_id,
      organization_id: selectedHost
        ? selectedHost.organization_id || prev.organization_id
        : prev.organization_id,
    }));
  };

  const handleCategoryChange = (category) => {
    setFormData((prev) => ({
      ...prev,
      visit_category: category,
      host_user_id: isRoleAdminOrStaff ? "" : category === "EMP" ? "" : user?.id || "",
      department_id: isRoleAdminOrStaff ? "" : category === "EMP" ? "" : user?.department_id || "",
    }));
    setSelectedDeptId("");
    setHosts([]);
  };

 const addCompanion = () => {
 setFormData((prev) => ({
 ...prev,
 companions: [
 ...prev.companions,
 { full_name: "", id_type: "AADHAAR", id_number: "" },
 ],
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
 setFormData((prev) => ({
 ...prev,
 companions: updated,
 accompanying_count: updated.length,
 }));
 };

 const handleSubmit = async (e) => {
 e.preventDefault();
 setLoading(true);

 try {
 // Clean up payload based on category
 const payload = { ...formData };

 if (payload.visit_category !== "VENDOR") {
 delete payload.company_name;
 delete payload.vendor_email;
 delete payload.contact_person;
 delete payload.gst_number;
 delete payload.work_order_ref;
 delete payload.service_type;
 }

 // Convert to numbers for Zod validation
 payload.host_user_id = Number(payload.host_user_id);
 payload.department_id = Number(payload.department_id);
 payload.organization_id = Number(payload.organization_id);
 if (payload.visitor_id) payload.visitor_id = Number(payload.visitor_id);
 payload.accompanying_count = Number(payload.accompanying_count);

 // Nullify empty strings for time to avoid MySQL strict mode errors
 if (!payload.visit_start_time) payload.visit_start_time = null;
 if (!payload.visit_end_time) payload.visit_end_time = null;
 if (!payload.visitor_id) payload.visitor_id = null;

 await apiClient.post("/visit-requests", payload);
 toast.success("Visit request created successfully");
 navigate("/requests");
 } catch (error) {
 toast.error(error.response?.data?.message || "Failed to create request");
 } finally {
 setLoading(false);
 }
 };

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
 {/* Category Selection */}
 <div className="vms-card rounded-md p-8 shadow-card">
 <h2 className="text-xl text-loud mb-6 flex items-center gap-2">
 <span className="w-8 h-8 rounded-full bg-mixed-bg text-accent flex items-center justify-center text-sm font-bold">
 1
 </span>
 Visit Category
 </h2>
 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
 {availableCategories.map((cat) => (
 <button
 key={cat.id}
 type="button"
 onClick={() => handleCategoryChange(cat.id)}
 className={`p-4 rounded-md border text-left transition-all duration-300 ${
 formData.visit_category === cat.id
 ? "border-border bg-mixed-bg shadow-soft-sm"
 : "border-subtle hover:border-border hover:bg-bg-primary"
 }`}
 >
 <div
 className={`font-medium mb-1 ${formData.visit_category === cat.id ? "text-accent" : "text-loud"}`}
 >
 {cat.label}
 </div>
 <div className="text-xs text-muted">{cat.desc}</div>
 </button>
 ))}
 </div>
 </div>

 {/* Primary Details */}
 <div className="vms-card rounded-md p-8 shadow-card">
 <h2 className="text-xl text-loud mb-6 flex items-center gap-2">
 <span className="w-8 h-8 rounded-full bg-mixed-bg text-accent flex items-center justify-center text-sm font-bold">
 2
 </span>
 Visit Details
 </h2>

 <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
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
 className="w-full bg-bg-primary border-0 border-b border-subtle px-0 py-2 text-loud focus:ring-0 focus:border-border transition-colors duration-300"
 />
 </div>

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
 className="w-full bg-bg-primary border-0 border-b border-subtle px-0 py-2 text-loud focus:ring-0 focus:border-border transition-colors duration-300"
 />
 </div>
 <div className="space-y-2">
 <label className="block text-sm font-medium text-loud">
 End Time
 </label>
 <input
 type="time"
 name="visit_end_time"
 value={formData.visit_end_time}
 onChange={handleInputChange}
 className="w-full bg-bg-primary border-0 border-b border-subtle px-0 py-2 text-loud focus:ring-0 focus:border-border transition-colors duration-300"
 />
 </div>
 </div>

 
  {(() => {
    const isEmployeeRole = user?.role_type === "employee" || user?.role === "employee";
    const isSelfEmpVisit = formData.visit_category === "EMP" && isEmployeeRole;
    const showSelectVisitor = formData.visit_category !== "VENDOR" && !isSelfEmpVisit;
    const showSelectHost = !isEmployeeRole || isSelfEmpVisit;

    return (
      <>
        {/* Visitor Section */}
        {showSelectVisitor ? (
          <div className="space-y-2 md:col-span-2">
            <label className="block text-sm font-medium text-loud flex items-center gap-2">
              <User className="w-4 h-4 text-accent" />
              Select Visitor *
            </label>
            <select
              name="visitor_id"
              required
              value={formData.visitor_id}
              onChange={handleInputChange}
              className="w-full bg-bg-primary border-0 border-b border-subtle px-0 py-2 text-loud focus:ring-0 focus:border-border transition-colors duration-300"
            >
              <option value="">-- Search & Select Visitor --</option>
              {visitors.map((v) => (
                <option key={v.visitor_id} value={v.visitor_id}>
                  {v.full_name} ({v.phone})
                </option>
              ))}
            </select>
            <p className="text-xs text-faint mt-1">
              Visitor not found?{" "}
              <button
                type="button"
                onClick={() => navigate("/visitors/new")}
                className="text-accent underline"
              >
                Register them first
              </button>
              .
            </p>
          </div>
        ) : isSelfEmpVisit ? (
          <div className="space-y-2 md:col-span-2">
            <label className="block text-sm font-medium text-loud flex items-center gap-2">
              <User className="w-4 h-4 text-accent" />
              Visitor (You)
            </label>
            <div className="py-2 text-loud font-medium border-b border-subtle">
              {user?.full_name} — {user?.designation || user?.role}
            </div>
          </div>
        ) : null}

        {/* Department Section */}
        {showSelectHost && (
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
              className="w-full bg-bg-primary border-0 border-b border-subtle px-0 py-2 text-loud focus:ring-0 focus:border-border transition-colors duration-300"
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
        {showSelectHost ? (
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
              className="w-full bg-bg-primary border-0 border-b border-subtle px-0 py-2 text-loud focus:ring-0 focus:border-border transition-colors duration-300 disabled:opacity-50"
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
        ) : (
          <div className="space-y-2 md:col-span-2">
            <label className="block text-sm font-medium text-loud flex items-center gap-2">
              <Building className="w-4 h-4 text-accent" />
              Host (You)
            </label>
            <div className="py-2 text-loud font-medium border-b border-subtle">
              {user?.full_name} — {user?.designation || user?.role}
            </div>
            {/* hidden input keeps host_user_id in formData */}
            <input type="hidden" name="host_user_id" value={user?.id || ""} />
          </div>
        )}
      </>
    );
  })()}

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
 className="w-full bg-bg-primary border-0 border-b border-subtle px-0 py-2 text-loud focus:ring-0 focus:border-border transition-colors duration-300 resize-none"
 placeholder="Brief description of the visit purpose (min 10 chars)..."
 ></textarea>
 </div>
 </div>
 </div>

 {/* Vendor Specific Fields */}
 {formData.visit_category === "VENDOR" && (
 <div className="vms-card rounded-md p-8 shadow-card animate-fade-in">
 <h2 className="text-xl text-loud mb-6 flex items-center gap-2">
 <span className="w-8 h-8 rounded-full bg-mixed-bg text-accent flex items-center justify-center text-sm font-bold">
 3
 </span>
 <Building className="w-5 h-5 text-accent" />
 Vendor Details
 </h2>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
 <div className="space-y-2">
 <label className="block text-sm font-medium text-loud">
 Company Name *
 </label>
 <input
 type="text"
 name="company_name"
 required
 value={formData.company_name}
 onChange={handleInputChange}
 className="w-full bg-bg-primary border-0 border-b border-subtle px-0 py-2 text-loud focus:ring-0 focus:border-border transition-colors duration-300"
 />
 </div>
 <div className="space-y-2">
 <label className="block text-sm font-medium text-loud">
 Email Address
 </label>
 <input
 type="email"
 name="vendor_email"
 value={formData.vendor_email}
 onChange={handleInputChange}
 className="w-full bg-bg-primary border-0 border-b border-subtle px-0 py-2 text-loud focus:ring-0 focus:border-border transition-colors duration-300"
 placeholder="For gate pass delivery"
 />
 </div>
 <div className="space-y-2">
 <label className="block text-sm font-medium text-loud">
 Contact Person
 </label>
 <input
 type="text"
 name="contact_person"
 value={formData.contact_person}
 onChange={handleInputChange}
 className="w-full bg-bg-primary border-0 border-b border-subtle px-0 py-2 text-loud focus:ring-0 focus:border-border transition-colors duration-300"
 />
 </div>
 <div className="space-y-2">
 <label className="block text-sm font-medium text-loud">
 Service Type
 </label>
 <input
 type="text"
 name="service_type"
 value={formData.service_type}
 onChange={handleInputChange}
 className="w-full bg-bg-primary border-0 border-b border-subtle px-0 py-2 text-loud focus:ring-0 focus:border-border transition-colors duration-300"
 placeholder="e.g. AC Maintenance, Delivery"
 />
 </div>
 <div className="space-y-2">
 <label className="block text-sm font-medium text-loud">
 Work Order Ref
 </label>
 <input
 type="text"
 name="work_order_ref"
 value={formData.work_order_ref}
 onChange={handleInputChange}
 className="w-full bg-bg-primary border-0 border-b border-subtle px-0 py-2 text-loud focus:ring-0 focus:border-border transition-colors duration-300"
 />
 </div>
 </div>
 </div>
 )}

 {/* Companions */}
 <div className="vms-card rounded-md p-8 shadow-card">
 <div className="flex justify-between items-center mb-6">
 <h2 className="text-xl text-loud flex items-center gap-2">
 <span className="w-8 h-8 rounded-full bg-mixed-bg text-accent flex items-center justify-center text-sm font-bold">
 {formData.visit_category === "VENDOR" ? "4" : "3"}
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
 onChange={(e) =>
 updateCompanion(idx, "full_name", e.target.value)
 }
 className="w-full bg-transparent border-0 border-b border-subtle px-0 py-1 text-sm text-loud focus:ring-0 focus:border-border"
 />
 </div>
 <div className="flex-1 space-y-1 w-full">
 <select
 value={comp.id_type}
 onChange={(e) =>
 updateCompanion(idx, "id_type", e.target.value)
 }
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
 onChange={(e) =>
 updateCompanion(idx, "id_number", e.target.value)
 }
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
