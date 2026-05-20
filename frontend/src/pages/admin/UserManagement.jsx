import { useState, useEffect, useCallback, useRef } from "react";
import { NavLink } from "react-router-dom";
import {
 Plus,
 Search,
 Edit2,
 UserX,
 X,
 Check,
 Loader2,
 Users,
 ChevronRight,
 Shield,
 Briefcase,
 Mail,
 Phone,
 Hash,
 AlertTriangle,
} from "lucide-react";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";
import useAuth from "../../hooks/useAuth";

// ── Role styling config ────────────────────────────────────────────────────
const ROLE_CONFIG = {
  org_admin:    { label: "Org Admin",    badgeClass: "bg-[#fef3c7] text-[#92400e]" },
  dept_admin:   { label: "Dept Admin",   badgeClass: "bg-[#DCCFC2] text-[#C27B66]" },
  employee:     { label: "Employee",     badgeClass: "bg-mixed-bg text-accent" },
  security:     { label: "Security",     badgeClass: "bg-[#eff6ff] text-[#1d4ed8]" },
  receptionist: { label: "Receptionist", badgeClass: "bg-bg-primary text-muted border border-subtle" },
};

function RoleBadge({ role }) {
 const cfg = ROLE_CONFIG[role] ?? {
 label: role,
 badgeClass: "bg-bg-primary text-muted",
 };
 return (
 <span
 className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${cfg.badgeClass}`}
 >
 {cfg.label}
 </span>
 );
}

// ── Slide-over form panel ─────────────────────────────────────────────────
function UserSlideOver({
  isOpen,
  onClose,
  onSuccess,
  editUser,
  departments,
  organizationId,
  isOrgAdmin,
  lockedDepartmentId,
}) {
 const emptyForm = {
 full_name: "",
 email: "",
 phone: "",
 employee_code: "",
 role_type: "employee",
 department_id: "",
 designation: "",
 password: "",
 };
 const [form, setForm] = useState(emptyForm);
 const [submitting, setSubmitting] = useState(false);
 const isEdit = !!editUser;

 useEffect(() => {
 if (editUser) {
 setForm({
 full_name: editUser.full_name || "",
 email: editUser.email || "",
 phone: editUser.phone || "",
 employee_code: editUser.employee_code || "",
 role_type: editUser.role_type || "employee",
 department_id: editUser.department_id
 ? String(editUser.department_id)
 : "",
 designation: editUser.designation || "",
 password: "",
 });
 } else {
 setForm(emptyForm);
 }
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [editUser, isOpen]);

 const set = (field) => (e) =>
 setForm((f) => ({ ...f, [field]: e.target.value }));

 const handleSubmit = async (e) => {
 e.preventDefault();
 setSubmitting(true);
 try {
 const payload = {
 full_name: form.full_name.trim(),
 email: form.email.trim(),
 phone: form.phone.trim(),
 role_type: form.role_type,
 department_id: parseInt(form.department_id),
 designation: form.designation.trim() || undefined,
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
 payload.employee_code = form.employee_code.trim();
 payload.password = form.password;
 payload.organization_id = organizationId;
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

 const inputCls =
 "w-full btn-secondary text-loud text-sm placeholder-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-border transition-all duration-300";
 const labelCls =
 "block text-xs font-semibold text-muted uppercase tracking-widest mb-1.5";

 return (
 <>
 {/* Backdrop */}
 <div
 className={`fixed inset-0 bg-overlay backdrop-blur-sm z-40 transition-opacity duration-300 ${isOpen ? "opacity-100" : "opacity-0 pointer-events-none"}`}
 onClick={onClose}
 />

 {/* Panel */}
 <aside
 className={`fixed right-0 top-0 h-full w-full max-w-md bg-white border-l border-subtle z-50 flex flex-col shadow-card transition-transform duration-500 ease-in-out ${isOpen ? "translate-x-0" : "translate-x-full"}`}
 >
 {/* Header */}
 <div className="flex items-center justify-between p-6 border-b border-subtle">
 <div>
 <h2 className="text-2xl font-bold text-loud">
 {isEdit ? "Edit" : "New"} <em className="italic">User</em>
 </h2>
 <p className="text-xs text-faint mt-0.5">
 {isEdit
 ? `Editing ${editUser?.full_name}`
 : "Create a new system account"}
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
 <form
 onSubmit={handleSubmit}
 className="flex-1 overflow-y-auto p-6 space-y-5"
 >
 <div>
 <label className={labelCls}>Full Name *</label>
 <input
 className={inputCls}
 value={form.full_name}
 onChange={set("full_name")}
 placeholder="e.g. Priya Sharma"
 required
 autoComplete="off"
 />
 </div>

 <div className="grid grid-cols-2 gap-4">
 <div>
 <label className={labelCls}>Email *</label>
 <input
 className={inputCls}
 type="email"
 value={form.email}
 onChange={set("email")}
 placeholder="priya@company.in"
 required
 autoComplete="off"
 />
 </div>
 <div>
 <label className={labelCls}>Phone *</label>
 <input
 className={inputCls}
 type="tel"
 value={form.phone}
 onChange={set("phone")}
 placeholder="+91 9876543210"
 required
 autoComplete="off"
 />
 </div>
 </div>

 {!isEdit && (
 <div>
 <label className={labelCls}>Employee Code *</label>
 <input
 className={inputCls}
 value={form.employee_code}
 onChange={set("employee_code")}
 placeholder="EMP-001"
 required={!isEdit}
 autoComplete="off"
 />
 </div>
 )}

 <div className="grid grid-cols-2 gap-4">
 <div>
  <label className={labelCls}>Role *</label>
  <div className="relative">
    <select
      className={`${inputCls} appearance-none pr-8 cursor-pointer`}
      value={form.role_type}
      onChange={set("role_type")}
      required
    >
      <option value="employee">Employee</option>
      {isOrgAdmin && <option value="org_admin">Org Admin</option>}
      {isOrgAdmin && <option value="dept_admin">Dept Admin</option>}
      <option value="security">Security</option>
      <option value="receptionist">Receptionist</option>
    </select>
    <ChevronRight
      strokeWidth={1.5}
      className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint rotate-90 pointer-events-none"
    />
  </div>
 </div>
 <div>
  <label className={labelCls}>Department {form.role_type !== 'org_admin' ? '*' : ''}</label>
  <div className="relative">
    {lockedDepartmentId ? (
      <div className="vms-input w-full text-muted text-sm">
        {departments.find(d => d.id === lockedDepartmentId)?.name || 'Your Department'}
      </div>
    ) : (
      <select
        className={`${inputCls} appearance-none pr-8 cursor-pointer`}
        value={form.department_id}
        onChange={set("department_id")}
        required={form.role_type !== 'org_admin'}
      >
        <option value="">Select dept…</option>
        {departments.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    )}
    {!lockedDepartmentId && (
      <ChevronRight
        strokeWidth={1.5}
        className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint rotate-90 pointer-events-none"
      />
    )}
  </div>
 </div>
 </div>

 <div>
 <label className={labelCls}>Designation</label>
 <input
 className={inputCls}
 value={form.designation}
 onChange={set("designation")}
 placeholder="e.g. Senior Engineer"
 />
 </div>

 {!isEdit && (
 <div>
 <label className={labelCls}>Password *</label>
 <input
 className={inputCls}
 type="password"
 value={form.password}
 onChange={set("password")}
 placeholder="Minimum 8 characters"
 required={!isEdit}
 minLength={8}
 autoComplete="new-password"
 />
 </div>
 )}
 </form>

 {/* Footer */}
 <div className="p-6 border-t border-subtle flex items-center justify-end gap-3">
 <button
 type="button"
 onClick={onClose}
 className="btn-secondary text-xs py-2.5 px-5"
 >
 Cancel
 </button>
 <button
 type="submit"
 onClick={handleSubmit}
 disabled={submitting}
 className="btn-primary text-xs py-2.5 px-6 flex items-center gap-2 disabled:opacity-60"
 >
 {submitting ? (
 <Loader2 strokeWidth={2} className="w-3.5 h-3.5 animate-spin" />
 ) : (
 <Check strokeWidth={2} className="w-3.5 h-3.5" />
 )}
 {submitting ? "Saving…" : isEdit ? "Save Changes" : "Create User"}
 </button>
 </div>
 </aside>
 </>
 );
}

// ── Deactivate Confirm inline ─────────────────────────────────────────────
function DeactivateConfirm({ userId, userName, onConfirm, onCancel }) {
 const [busy, setBusy] = useState(false);
 const handleConfirm = async () => {
 setBusy(true);
 await onConfirm(userId);
 setBusy(false);
 };
 return (
 <div className="flex items-center gap-2 justify-end">
 <span className="text-xs text-warning flex items-center gap-1">
 <AlertTriangle strokeWidth={1.5} className="w-3.5 h-3.5" />
 Deactivate {userName}?
 </span>
 <button
 onClick={handleConfirm}
 disabled={busy}
 className="flex items-center gap-1 btn-primary transition-colors duration-300 disabled:opacity-60"
 >
 {busy ? (
 <Loader2 strokeWidth={2} className="w-3 h-3 animate-spin" />
 ) : (
 <Check strokeWidth={2} className="w-3 h-3" />
 )}
 Confirm
 </button>
 <button
 onClick={onCancel}
 className="btn-secondary text-muted hover:bg-bg-primary transition-colors duration-300"
 >
 Cancel
 </button>
 </div>
 );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function UserManagement() {
  const { user: currentUser, isOrgAdmin, isDeptAdmin } = useAuth();

 const [users, setUsers] = useState([]);
 const [departments, setDepartments] = useState([]);
 const [loading, setLoading] = useState(true);
 const [search, setSearch] = useState("");
 const [debouncedSearch, setDebouncedSearch] = useState("");
 const [roleFilter, setRoleFilter] = useState("");
 const [panelOpen, setPanelOpen] = useState(false);
 const [editUser, setEditUser] = useState(null);
 const [deactivatingId, setDeactivatingId] = useState(null);

 // Debounce search
 useEffect(() => {
 const t = setTimeout(() => setDebouncedSearch(search), 300);
 return () => clearTimeout(t);
 }, [search]);

 const fetchData = useCallback(async () => {
 try {
 setLoading(true);
 const [usersRes, deptRes] = await Promise.all([
  apiClient.get("/users", {
    params: roleFilter ? { role: roleFilter } : {},
  }),
  apiClient.get("/departments"),
]);
const rawUsers = usersRes.data?.data || [];
setUsers(rawUsers);
setDepartments(deptRes.data?.data || []);
 } catch (err) {
 toast.error("Failed to load users.");
 } finally {
 setLoading(false);
 }
 }, [roleFilter]);

 useEffect(() => {
 fetchData();
 }, [fetchData]);

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
 setEditUser(null);
 setPanelOpen(true);
 };
 const openEdit = (u) => {
 setEditUser(u);
 setPanelOpen(true);
 };

 // Apply search filter client-side
 const filtered = users.filter((u) => {
 if (!debouncedSearch) return true;
 const q = debouncedSearch.toLowerCase();
 return (
 u.full_name?.toLowerCase().includes(q) ||
 u.email?.toLowerCase().includes(q) ||
 u.employee_code?.toLowerCase().includes(q)
 );
 });

  const roleFilters = [
    { label: "All",          value: "" },
    { label: "Org Admin",    value: "org_admin" },
    { label: "Dept Admin",   value: "dept_admin" },
    { label: "Employee",     value: "employee" },
    { label: "Security",     value: "security" },
    { label: "Receptionist", value: "receptionist" },
  ].filter(f => isOrgAdmin ? true : !['org_admin','dept_admin'].includes(f.value));

 return (
 <>
 <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 animate-fade-in">
  {/* Sub-tab nav — show Departments link only for org_admin */}
  <div className="flex gap-1 p-1 w-fit mb-6" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
    {[['Users', '/admin'], ...(isOrgAdmin ? [['Departments', '/admin/departments']] : [])].map(([label, path]) => (
      <NavLink key={path} to={path} end={path === '/admin'}
        className={({ isActive }) => `px-4 py-1.5 text-[12px] font-medium transition-colors`}
        style={({ isActive }) => isActive
          ? { background: 'var(--color-accent)', borderRadius: 'var(--radius-sm)', color: '#0f172a' }
          : { borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)' }}>
        {label}
      </NavLink>
    ))}
  </div>
 {/* ── Header ────────────────────────────────────────────────────── */}
 <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
 <div>
 <h1 className="text-2xl font-bold text-loud">
 Team <em className="italic">Management</em>
 </h1>
 <p className="text-muted mt-2">
 Manage user accounts, roles, and department assignments.
 </p>
 </div>
 <button
 onClick={openCreate}
 className="btn-primary px-4 py-2 text-xs"
 >
 <Plus className="w-4 h-4" />
 Add New User
 </button>
 </div>

 <div className="vms-card rounded-md p-6 shadow-card">
 {/* ── Filters ───────────────────────────────────────────────── */}
 <div className="flex flex-col md:flex-row gap-4 mb-6 pb-6 border-b border-subtle">
 {/* Search */}
 <div className="flex-1 relative">
 <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
 <Search
 className="h-5 w-5 text-accent"
 strokeWidth={1.5}
 />
 </div>
 <input
 type="text"
 className="block w-full pl-11 pr-4 py-3 bg-bg-primary border border-subtle rounded-full text-loud placeholder-faint focus:outline-none focus:ring-2 focus:ring-accent transition-all duration-300"
 placeholder="Search by name, email, or employee code…"
 value={search}
 onChange={(e) => setSearch(e.target.value)}
 />
 </div>
 {/* Role filter pills */}
 <div className="flex flex-wrap gap-2 items-center">
 {roleFilters.map(({ label, value }) => (
 <button
 key={value}
 onClick={() => setRoleFilter(value)}
 className={`btn-primary ${roleFilter === value ? "bg-accent text-white" : "bg-bg-primary border border-subtle text-muted hover:border-border"}`}
 >
 {label}
 </button>
 ))}
 </div>
 </div>

 {/* ── Table ─────────────────────────────────────────────────── */}
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
 <tr
 key={i}
 className="border-b border-subtle animate-pulse"
 >
 {[1, 2, 3, 4, 5, 6].map((c) => (
 <td key={c} className="py-4 px-4">
 <div className="h-4 bg-border rounded-full w-3/4" />
 </td>
 ))}
 </tr>
 ))
 ) : filtered.length === 0 ? (
 <tr>
 <td
 colSpan="6"
 className="text-center py-16 text-faint italic"
 >
 No users found.
 </td>
 </tr>
 ) : (
 filtered.map((u) => (
 <tr
 key={u.id}
 className={`border-b border-subtle transition-colors duration-300 ${!u.is_active ? "opacity-50" : "hover:bg-bg-primary/40"}`}
 >
 {/* Member */}
 <td className="py-4 px-4">
 <div className="flex items-center gap-3">
 <div className="w-9 h-9 rounded-full bg-lightColor flex items-center justify-center shrink-0">
 <span className="text-loud font-semibold text-sm">
 {u.full_name?.charAt(0) ?? "?"}
 </span>
 </div>
 <div>
 <p className="font-medium text-loud text-sm">
 {u.full_name}
 </p>
 <p className="text-xs text-faint flex items-center gap-1 mt-0.5">
 <Mail strokeWidth={1.5} className="w-3 h-3" />{" "}
 {u.email}
 </p>
 </div>
 </div>
 </td>
 {/* Code */}
 <td className="py-4 px-4">
 <span className="text-xs font-mono text-muted flex items-center gap-1">
 <Hash strokeWidth={1.5} className="w-3 h-3" />{" "}
 {u.employee_code}
 </span>
 </td>
 {/* Role */}
 <td className="py-4 px-4">
 <RoleBadge role={u.role_type} />
 </td>
 {/* Department */}
 <td className="py-4 px-4">
 <span className="text-sm text-muted flex items-center gap-1">
 <Briefcase
 strokeWidth={1.5}
 className="w-3.5 h-3.5 shrink-0"
 />
 {u.department_name || "—"}
 </span>
 </td>
 {/* Status */}
 <td className="py-4 px-4">
 <span
 className={`inline-flex items-center gap-1.5 text-xs font-medium ${u.is_active ? "text-accent" : "text-faint"}`}
 >
 <span
 className={`w-1.5 h-1.5 rounded-full ${u.is_active ? "bg-accent" : "bg-accent/30"}`}
 />
 {u.is_active ? "Active" : "Inactive"}
 </span>
 </td>
 {/* Actions */}
 <td className="py-4 px-4 text-right">
 {deactivatingId === u.id ? (
 <DeactivateConfirm
 userId={u.id}
 userName={u.full_name}
 onConfirm={handleDeactivate}
 onCancel={() => setDeactivatingId(null)}
 />
 ) : (
 <div className="flex justify-end gap-2">
 <button
 onClick={() => openEdit(u)}
 title="Edit user"
 className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-bg-primary text-muted hover:bg-accent hover:text-white transition-colors duration-300"
 >
 <Edit2
 strokeWidth={1.5}
 className="w-3.5 h-3.5"
 />
 </button>
 {u.is_active && u.id !== currentUser?.id && (
 <button
 onClick={() => setDeactivatingId(u.id)}
 title="Deactivate user"
 className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-bg-primary text-muted hover:bg-accent hover:text-white transition-colors duration-300"
 >
 <UserX
 strokeWidth={1.5}
 className="w-3.5 h-3.5"
 />
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

 {/* Summary footer */}
 {!loading && (
 <div className="mt-6 pt-4 border-t border-subtle flex items-center justify-between">
 <span className="text-xs text-faint flex items-center gap-1.5">
 <Users strokeWidth={1.5} className="w-3.5 h-3.5" />
 {filtered.length} user{filtered.length !== 1 ? "s" : ""}
 {roleFilter ? ` · ${ROLE_CONFIG[roleFilter]?.label}` : ""}
 </span>
 <span className="text-xs text-faint">
 {filtered.filter((u) => u.is_active).length} active
 </span>
 </div>
 )}
 </div>
 </div>

 {/* ── Slide-over panel ──────────────────────────────────────────────── */}
 <UserSlideOver
 isOpen={panelOpen}
 onClose={() => {
 setPanelOpen(false);
 setEditUser(null);
 }}
 onSuccess={fetchData}
 editUser={editUser}
 departments={departments}
 organizationId={currentUser?.organization_id}
 isOrgAdmin={isOrgAdmin}
 lockedDepartmentId={isDeptAdmin ? currentUser?.department_id : null}
 />
 </>
 );
}
