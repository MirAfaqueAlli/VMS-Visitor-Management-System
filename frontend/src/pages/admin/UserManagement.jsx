// frontend/src/pages/admin/UserManagement.jsx
import { useState, useEffect, useCallback } from "react";
import { NavLink, Link } from "react-router-dom";
import {
  Plus, Search, Edit2, UserX, X, Check, Loader2, Users,
  ChevronRight, Briefcase, Mail, Hash, AlertTriangle, ArrowRight,
} from "lucide-react";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";
import useAuth from "../../hooks/useAuth";
import PasswordStrength from "../../components/PasswordStrength";
import { validatePassword } from "../../utils/passwordValidator";
import Pagination from "../../components/shared/Pagination";

// ── Role styling ────────────────────────────────────────────────────────────
const ROLE_CONFIG = {
  super_admin:    { label: "Super Admin",    badgeClass: "bg-[#fef3c7] text-[#92400e]" },
  unit_admin:     { label: "Unit Admin",     badgeClass: "bg-[#fef3c7] text-[#92400e]" },
  employee:       { label: "Employee",       badgeClass: "bg-mixed-bg text-accent" },
  security:       { label: "Security",       badgeClass: "bg-[#eff6ff] text-[#1d4ed8]" },
  receptionist:   { label: "Receptionist",  badgeClass: "bg-bg-primary text-muted border border-subtle" },
  unit_auditor:   { label: "Unit Auditor",   badgeClass: "bg-[#f0fdf4] text-[#15803d]" },
  global_auditor: { label: "Global Auditor", badgeClass: "bg-[#f0fdf4] text-[#15803d]" },
};

function RoleBadge({ role }) {
  const cfg = ROLE_CONFIG[role] ?? { label: role, badgeClass: "bg-bg-primary text-muted" };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${cfg.badgeClass}`}>
      {cfg.label}
    </span>
  );
}

// ── Slide-over form panel ───────────────────────────────────────────────────
function UserSlideOver({
  isOpen, onClose, onSuccess, editUser,
  departments, isUnitAdmin, lockedDepartmentId, designations,
  onDepartmentChange,
}) {
  const isEdit   = !!editUser;
  const noDepts  = !isEdit && departments.length === 0;
  const emptyForm = {
    full_name: "", email: "", phone: "", employee_code: "",
    role_type: "employee", department_id: "", designation_id: "", password: "",
  };
  const [form,       setForm]       = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  // isEdit already declared above

  useEffect(() => {
    if (editUser) {
      setForm({
        full_name:      editUser.full_name || "",
        email:          editUser.email || "",
        phone:          editUser.phone || "",
        employee_code:  editUser.employee_code || "",
        role_type:      editUser.role_type || "employee",
        department_id:  editUser.department_id ? String(editUser.department_id) : "",
        designation_id: editUser.designation_id ? String(editUser.designation_id) : "",
        password:       "",
      });
    } else {
      setForm(emptyForm);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editUser, isOpen]);

  // Roles that don't belong to any department
  const NO_DEPT_ROLES = ['security', 'receptionist', 'unit_auditor'];
  const isNoDeptRole = NO_DEPT_ROLES.includes(form.role_type);

  // Only block creation when dept is actually required for the selected role
  const deptRequiredForRole = !isNoDeptRole && form.role_type !== 'unit_admin';
  const blockForNoDepts = noDepts && deptRequiredForRole;

  const set = (field) => (e) => {
    const value = e.target.value;
    if (field === 'role_type' && NO_DEPT_ROLES.includes(value)) {
      // Clear department + designation when switching to a no-dept role
      setForm(f => ({ ...f, role_type: value, department_id: '', designation_id: '' }));
      onDepartmentChange?.('');
    } else {
      setForm(f => ({ ...f, [field]: value }));
      if (field === 'department_id') onDepartmentChange?.(value);
    }
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        full_name:      form.full_name.trim(),
        email:          form.email.trim(),
        phone:          form.phone.trim(),
        role_type:      form.role_type,
        department_id:  form.department_id ? parseInt(form.department_id) : undefined,
        designation_id: form.designation_id ? parseInt(form.designation_id) : undefined,
      };

      if (isEdit) {
        await apiClient.put(`/users/${editUser.id}`, payload);
        toast.success("User updated successfully.");
      } else {
        if (!form.employee_code.trim() || !form.password.trim()) {
          toast.error("Employee code and password are required for new users.");
          setSubmitting(false);
          return;
        }
        const { valid: pwValid } = validatePassword(form.password);
        if (!pwValid) {
          toast.error("Password does not meet the strength requirements.");
          setSubmitting(false);
          return;
        }
        payload.employee_code = form.employee_code.trim();
        payload.password      = form.password;
        await apiClient.post("/users", payload);
        toast.success("New user created successfully.");
      }
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to save user.");
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = "w-full btn-secondary text-loud text-sm placeholder-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-border transition-all duration-300";
  const labelCls = "block text-xs font-semibold text-muted uppercase tracking-widest mb-1.5";

  const deptId = lockedDepartmentId || form.department_id;

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 backdrop-blur-sm z-40 transition-opacity duration-300 opacity-100"
          style={{ background: 'rgba(0,0,0,0.4)' }}
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <aside
        className="fixed right-0 top-0 h-full w-full max-w-md border-l border-subtle z-50 flex flex-col shadow-card transition-transform duration-500 ease-in-out"
        style={{
          background: 'var(--color-bg-primary)',
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-subtle">
          <div>
            <h2 className="text-2xl font-bold text-loud">
              {isEdit ? "Edit" : "New"} <em className="italic">User</em>
            </h2>
            <p className="text-xs text-faint mt-0.5">
              {isEdit ? `Editing ${editUser?.full_name}` : "Create a new system account"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full flex items-center justify-center text-faint hover:bg-bg-primary hover:text-loud transition-colors duration-300"
          >
            <X strokeWidth={1.5} className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* ── No-departments warning banner ────────────────────────────── */}
          {blockForNoDepts && (
            <div
              className="flex items-start gap-3 rounded-lg px-4 py-3.5"
              style={{
                background: 'var(--color-warning-bg, #fffbeb)',
                border:     '1px solid var(--color-warning, #f59e0b)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <AlertTriangle
                strokeWidth={2}
                className="w-4 h-4 shrink-0 mt-0.5"
                style={{ color: 'var(--color-warning, #f59e0b)' }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold" style={{ color: '#92400e' }}>
                  No departments found
                </p>
                <p className="text-xs mt-0.5" style={{ color: '#b45309' }}>
                  You must create at least one department before adding employees.
                </p>
                <Link
                  to="/admin/departments"
                  onClick={onClose}
                  className="inline-flex items-center gap-1 text-xs font-semibold mt-2 underline-offset-2 hover:underline"
                  style={{ color: '#92400e' }}
                >
                  Go to Departments <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </div>
          )}


          <div>
            <label className={labelCls}>Full Name *</label>
            <input className={inputCls} value={form.full_name} onChange={set("full_name")} placeholder="e.g. Priya Sharma" required autoComplete="off" />
          </div>

          {/* Email + Phone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Email *</label>
              <input className={inputCls} type="email" value={form.email} onChange={set("email")} placeholder="priya@company.in" required autoComplete="off" />
            </div>
            <div>
              <label className={labelCls}>Phone * <span className="text-[10px] text-faint normal-case font-normal tracking-normal">(WhatsApp preferred)</span></label>
              <input className={inputCls} type="tel" value={form.phone} onChange={set("phone")} placeholder="+91 9876543210" required autoComplete="off" />
            </div>
          </div>

          {/* Employee code — create only */}
          {!isEdit && (
            <div>
              <label className={labelCls}>Employee Code *</label>
              <input className={inputCls} value={form.employee_code} onChange={set("employee_code")} placeholder="EMP-001" required autoComplete="off" />
            </div>
          )}

          {/* Role + Department */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Role *</label>
              <div className="relative">
                <select className={`${inputCls} appearance-none pr-8 cursor-pointer`} value={form.role_type} onChange={set("role_type")} required>
                  <option value="employee">Employee</option>
                  <option value="security">Security</option>
                  <option value="receptionist">Receptionist</option>
                  <option value="unit_auditor">Unit Auditor</option>
                </select>
                <ChevronRight strokeWidth={1.5} className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint rotate-90 pointer-events-none" />
              </div>
            </div>
            <div>
              <label className={labelCls}>
                Department {!isNoDeptRole && form.role_type !== 'unit_admin' ? '*' : ''}
              </label>
              <div className="relative">
                {isNoDeptRole ? (
                  // Blocked — security/receptionist have no department
                  <div
                    className="w-full text-sm px-3 py-2 rounded border select-none"
                    style={{
                      background:   'var(--color-bg-primary)',
                      border:       '1px solid var(--color-border)',
                      color:        'var(--color-text-faint)',
                      cursor:       'not-allowed',
                      opacity:      0.6,
                    }}
                  >
                    Not applicable for {form.role_type === 'security' ? 'Security' : form.role_type === 'unit_auditor' ? 'Unit Auditor' : 'Receptionist'}
                  </div>
                ) : lockedDepartmentId ? (
                  <div className="vms-input w-full text-muted text-sm">
                    {departments.find(d => d.id === lockedDepartmentId)?.name || 'Your Department'}
                  </div>
                ) : (
                  <select
                    className={`${inputCls} appearance-none pr-8 cursor-pointer`}
                    value={form.department_id}
                    onChange={set("department_id")}
                    required={!isNoDeptRole && form.role_type !== 'unit_admin'}
                  >
                    <option value="">Select dept...</option>
                    {departments.map(d => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                )}
                {!lockedDepartmentId && !isNoDeptRole && (
                  <ChevronRight strokeWidth={1.5} className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint rotate-90 pointer-events-none" />
                )}
              </div>
            </div>
          </div>

          {/* Designation — dropdown from API, depends on selected department */}
          <div>
            <label className={labelCls}>Designation</label>
            <div className="relative">
              <select
                className={`${inputCls} appearance-none pr-8 cursor-pointer`}
                value={form.designation_id || ""}
                onChange={set("designation_id")}
                disabled={isNoDeptRole || !deptId || designations.length === 0}
              >
                <option value="">
                  {isNoDeptRole
                    ? "Not applicable"
                    : !deptId
                    ? "Select a department first"
                    : designations.length === 0
                    ? "No designations — add via Departments"
                    : "Select designation..."}
                </option>
                {designations.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <ChevronRight strokeWidth={1.5} className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint rotate-90 pointer-events-none" />
            </div>
          </div>

          {/* Password — create only */}
          {!isEdit && (
            <div>
              <label className={labelCls}>Password *</label>
              <input className={inputCls} type="password" value={form.password} onChange={set("password")} placeholder="Min 8 chars, uppercase, number, symbol" required={!isEdit} minLength={8} autoComplete="new-password" />
              <PasswordStrength password={form.password} />
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="p-6 border-t border-subtle flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="btn-secondary text-xs py-2.5 px-5">Cancel</button>
          <button
            type="submit"
            onClick={handleSubmit}
            disabled={submitting || blockForNoDepts || (!isEdit && !validatePassword(form.password).valid)}
            className="btn-primary text-xs py-2.5 px-6 flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? <Loader2 strokeWidth={2} className="w-3.5 h-3.5 animate-spin" /> : <Check strokeWidth={2} className="w-3.5 h-3.5" />}
            {submitting ? "Saving..." : isEdit ? "Save Changes" : "Create User"}
          </button>
        </div>
      </aside>
    </>
  );
}

// ── Deactivate Confirm ──────────────────────────────────────────────────────â”€â”€
function DeactivateConfirm({ userId, userName, onConfirm, onCancel }) {
  const [busy, setBusy] = useState(false);
  const handleConfirm = async () => { setBusy(true); await onConfirm(userId); setBusy(false); };
  return (
    <div className="flex items-center gap-2 justify-end">
      <span className="text-xs text-warning flex items-center gap-1">
        <AlertTriangle strokeWidth={1.5} className="w-3.5 h-3.5" />
        Deactivate {userName}?
      </span>
      <button onClick={handleConfirm} disabled={busy} className="flex items-center gap-1 btn-primary transition-colors duration-300 disabled:opacity-60">
        {busy ? <Loader2 strokeWidth={2} className="w-3 h-3 animate-spin" /> : <Check strokeWidth={2} className="w-3 h-3" />}
        Confirm
      </button>
      <button onClick={onCancel} className="btn-secondary text-muted hover:bg-bg-primary transition-colors duration-300">Cancel</button>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────
export default function UserManagement() {
  const { user: currentUser, isUnitAdmin } = useAuth();

  const [users,          setUsers]          = useState([]);
  const [departments,    setDepartments]    = useState([]);
  const [designations,   setDesignations]   = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [search,         setSearch]         = useState("");
  const [debouncedSearch,setDebouncedSearch]= useState("");
  const [roleFilter,     setRoleFilter]     = useState("");
  const [panelOpen,      setPanelOpen]      = useState(false);
  const [editUser,       setEditUser]       = useState(null);
  const [deactivatingId, setDeactivatingId] = useState(null);
  const [page,           setPage]           = useState(1);
  const [totalPages,     setTotalPages]     = useState(1);
  const [totalCount,     setTotalCount]     = useState(0);
  const limit = 10;

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset to page 1 whenever search or role filter changes
  useEffect(() => { setPage(1); }, [debouncedSearch, roleFilter]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params = { page, limit };
      if (roleFilter) params.role = roleFilter;
      if (debouncedSearch) params.search = debouncedSearch;
      const [usersRes, deptRes] = await Promise.all([
        apiClient.get("/users", { params }),
        apiClient.get("/departments"),
      ]);
      const usersData = usersRes.data?.data;
      setUsers(usersData?.users || []);
      setTotalPages(usersData?.pagination?.pages || 1);
      setTotalCount(usersData?.pagination?.total || 0);
      setDepartments(deptRes.data?.data?.departments || deptRes.data?.data || []);
    } catch {
      toast.error("Failed to load users.");
    } finally {
      setLoading(false);
    }
  }, [roleFilter, page, debouncedSearch]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Fetch designations when a department is selected in the panel
  const fetchDesignations = useCallback(async (deptId) => {
    if (!deptId) { setDesignations([]); return; }
    try {
      const res = await apiClient.get('/designations', { params: { department_id: deptId } });
      setDesignations(res.data?.data ?? []);
    } catch {
      setDesignations([]);
    }
  }, []);

  // Load designations whenever panel opens on an existing user
  useEffect(() => {
    if (panelOpen && editUser?.department_id) {
      fetchDesignations(editUser.department_id);
    } else if (!panelOpen) {
      setDesignations([]);
    }
  }, [panelOpen, editUser, fetchDesignations]);

  const handleDeactivate = async (userId) => {
    try {
      await apiClient.delete(`/users/${userId}`);
      toast.success("User deactivated.");
      setDeactivatingId(null);
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to deactivate user.");
    }
  };

  const openCreate = () => {
    setEditUser(null); setDesignations([]); setPanelOpen(true);
  };
  const openEdit   = (u) => { setEditUser(u); setPanelOpen(true); };

  const roleFilters = [
    { label: "All",          value: "" },
    { label: "Unit Admin",   value: "unit_admin" },
    { label: "Employee",     value: "employee" },
    { label: "Security",     value: "security" },
    { label: "Receptionist", value: "receptionist" },
  ].filter(f => isUnitAdmin ? true : !['unit_admin'].includes(f.value));

  return (
    <>
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 animate-fade-in">



        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
          <div>
            <h1 className="text-2xl font-bold text-loud">Team <em className="italic">Management</em></h1>
            <p className="text-muted mt-2">Manage user accounts, roles, and department assignments.</p>
          </div>
          <button onClick={openCreate} className="btn-primary px-4 py-2 text-xs">
            <Plus className="w-4 h-4" /> Add New User
          </button>
        </div>

        {/* ── No departments advisory banner ────────────────────────── */}
        {!loading && departments.length === 0 && (
          <div
            className="flex items-start gap-3 px-4 py-4 mb-6 rounded-lg"
            style={{
              background: '#fffbeb',
              border: '1px solid var(--color-warning)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--color-warning)' }} strokeWidth={2} />
            <div>
              <p className="text-sm font-semibold" style={{ color: '#92400e' }}>
                No departments set up yet
              </p>
              <p className="text-xs mt-1" style={{ color: '#b45309' }}>
                Security, Receptionist, and Auditor users can be created without a department.{' '}
                <strong>Employees require a department.</strong>{' '}
                <NavLink
                  to="/admin/departments"
                  className="font-bold underline underline-offset-2 hover:opacity-80"
                  style={{ color: '#92400e' }}
                >
                  Create a department →
                </NavLink>
              </p>
            </div>
          </div>
        )}

        <div className="vms-card rounded-md p-6 shadow-card">
          {/* Filters */}
          <div className="flex flex-col md:flex-row gap-4 mb-6 pb-6 border-b border-subtle">
            <div className="flex-1 relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-accent" strokeWidth={1.5} />
              </div>
              <input
                type="text"
                className="block w-full pl-11 pr-4 py-3 bg-bg-primary border border-subtle rounded-full text-loud placeholder-faint focus:outline-none focus:ring-2 focus:ring-accent transition-all duration-300"
                placeholder="Search by name, email, or employee code..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              {roleFilters.map(({ label, value }) => (
                <button
                  key={value}
                  onClick={() => { setRoleFilter(value); setPage(1); }}
                  className={`btn-primary ${roleFilter === value ? "bg-accent text-white" : "bg-bg-primary border border-subtle text-muted hover:border-border"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-subtle text-muted text-xs uppercase tracking-wider">
                  <th className="py-4 px-4 font-medium">Member</th>
                  <th className="py-4 px-4 font-medium">Code</th>
                  <th className="py-4 px-4 font-medium">Role</th>
                  <th className="py-4 px-4 font-medium">Department</th>
                  <th className="py-4 px-4 font-medium">Status</th>
                  <th className="py-4 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(4)].map((_, i) => (
                    <tr key={i} className="border-b border-subtle animate-pulse">
                      {[1,2,3,4,5,6].map(c => (
                        <td key={c} className="py-4 px-4"><div className="h-4 bg-border rounded-full w-3/4" /></td>
                      ))}
                    </tr>
                  ))
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="text-center py-16 text-faint italic">No users found.</td>
                  </tr>
                ) : (
                  users.map(u => (
                    <tr key={u.id} className={`border-b border-subtle transition-colors duration-300 ${!u.is_active ? "opacity-50" : "hover:bg-bg-primary/40"}`}>
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-lightColor flex items-center justify-center shrink-0">
                            <span className="text-loud font-semibold text-sm">{u.full_name?.charAt(0) ?? "?"}</span>
                          </div>
                          <div>
                            <p className="font-medium text-loud text-sm">{u.full_name}</p>
                            <p className="text-xs text-faint flex items-center gap-1 mt-0.5">
                              <Mail strokeWidth={1.5} className="w-3 h-3" /> {u.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <span className="text-xs font-mono text-muted flex items-center gap-1">
                          <Hash strokeWidth={1.5} className="w-3 h-3" /> {u.employee_code}
                        </span>
                      </td>
                      <td className="py-4 px-4"><RoleBadge role={u.role_type} /></td>
                      <td className="py-4 px-4">
                        <span className="text-sm text-muted flex items-center gap-1">
                          <Briefcase strokeWidth={1.5} className="w-3.5 h-3.5 shrink-0" />
                          {u.department_name || "—"}
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${u.is_active ? "text-accent" : "text-faint"}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${u.is_active ? "bg-accent" : "bg-accent/30"}`} />
                          {u.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-right">
                        {deactivatingId === u.id ? (
                          <DeactivateConfirm userId={u.id} userName={u.full_name} onConfirm={handleDeactivate} onCancel={() => setDeactivatingId(null)} />
                        ) : (
                          <div className="flex justify-end gap-2">
                            <button onClick={() => openEdit(u)} title="Edit user" className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-bg-primary text-muted hover:bg-accent hover:text-white transition-colors duration-300">
                              <Edit2 strokeWidth={1.5} className="w-3.5 h-3.5" />
                            </button>
                            {u.is_active && u.id !== currentUser?.id && (
                              <button onClick={() => setDeactivatingId(u.id)} title="Deactivate user" className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-bg-primary text-muted hover:bg-accent hover:text-white transition-colors duration-300">
                                <UserX strokeWidth={1.5} className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Footer: count + pagination */}
          {!loading && (
            <div className="mt-6 pt-4 border-t border-subtle">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-faint flex items-center gap-1.5">
                  <Users strokeWidth={1.5} className="w-3.5 h-3.5" />
                  {totalCount} user{totalCount !== 1 ? "s" : ""}
                  {roleFilter ? ` · ${ROLE_CONFIG[roleFilter]?.label}` : ""}
                </span>
                <span className="text-xs text-faint">{users.filter(u => u.is_active).length} active (this page)</span>
              </div>
              <Pagination
                page={page}
                totalPages={totalPages}
                totalCount={totalCount}
                onPageChange={(p) => setPage(p)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Slide-over */}
      <UserSlideOver
        isOpen={panelOpen}
        onClose={() => { setPanelOpen(false); setEditUser(null); }}
        onSuccess={fetchData}
        editUser={editUser}
        departments={departments}
        isUnitAdmin={isUnitAdmin}
        lockedDepartmentId={null}
        designations={designations}
        onDepartmentChange={fetchDesignations}
      />
    </>
  );
}
