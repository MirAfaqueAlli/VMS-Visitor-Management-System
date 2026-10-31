// frontend/src/pages/admin/UserManagement.jsx
// Unit users (DESIGN_RULES §6/§8/§12): title + Add user, toolbar (count · search ·
// role), a sortable table whose rows open the edit drawer.
import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Plus, Check, Loader2, Users, UserX, UserCog, AlertTriangle, ArrowRight,
} from "../../components/icons";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";
import useAuth from "../../hooks/useAuth";
import PasswordStrength from "../../components/PasswordStrength";
import { validatePassword } from "../../utils/passwordValidator";
import { getApiErrorMessage } from "../../utils/apiError";
import Pagination from "../../components/shared/Pagination";
import Select from "../../components/Select";
import {
  PageHeader, Toolbar, SearchInput, Th, SkeletonRows, Tag, State, Empty, Field, Drawer, Modal, Note,
} from "../../components/ui";
import useSort from "../../lib/useSort";

// ── Role labels ─────────────────────────────────────────────────────────────
const ROLE_CONFIG = {
  super_admin:    { label: "Super Admin",    tone: "warning" },
  unit_admin:     { label: "Unit Admin",     tone: "warning" },
  employee:       { label: "Employee",       tone: "brand" },
  security:       { label: "Security",       tone: "info" },
  receptionist:   { label: "Receptionist",   tone: "neutral" },
  unit_auditor:   { label: "Unit Auditor",   tone: "success" },
  global_auditor: { label: "Global Auditor", tone: "success" },
};

function RoleBadge({ role }) {
  const cfg = ROLE_CONFIG[role] ?? { label: role, tone: "neutral" };
  return <Tag tone={cfg.tone}>{cfg.label}</Tag>;
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
  // false → employee code is the API's suggestion (follows the role); true once typed by hand
  const [codeEdited, setCodeEdited] = useState(false);
  // isEdit already declared above

  useEffect(() => {
    setCodeEdited(false);
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

  // New user: fill in the next free employee code for the chosen role (e.g. H1-EMP-003)
  useEffect(() => {
    if (!isOpen || isEdit || codeEdited) return;
    let cancelled = false;
    apiClient.get('/users/next-employee-code', { params: { role_type: form.role_type } })
      .then(res => {
        const code = res.data?.data?.employee_code;
        if (!cancelled && code) setForm(f => ({ ...f, employee_code: code }));
      })
      .catch(() => { /* no suggestion — the field stays editable */ });
    return () => { cancelled = true; };
  }, [isOpen, isEdit, codeEdited, form.role_type]);

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

    // ── Client-side validation ────────────────────────────────────────────────
    if (!form.full_name.trim()) {
      toast.error('Full name is required.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!form.email.trim()) {
      toast.error('Email address is required.');
      return;
    }
    if (!emailRegex.test(form.email.trim())) {
      toast.error('Please enter a valid email address (e.g. user@company.com).');
      return;
    }

    const phoneRaw = form.phone.trim();
    if (!phoneRaw) {
      toast.error('Phone number is required.');
      return;
    }
    // Allow optional leading +, then digits, spaces, hyphens; strip non-digit to count
    const phoneDigits = phoneRaw.replace(/\D/g, '');
    if (!/^[+]?[\d\s\-]+$/.test(phoneRaw) || phoneDigits.length < 7 || phoneDigits.length > 15) {
      toast.error('Phone number must contain only digits (7–15 digits). Example: +91 9876543210');
      return;
    }
    // ─────────────────────────────────────────────────────────────────────────

    setSubmitting(true);
    try {
      const payload = {
        full_name:      form.full_name.trim(),
        email:          form.email.trim(),
        phone:          phoneRaw,
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
      toast.error(getApiErrorMessage(err, "Failed to save user."));
    } finally {
      setSubmitting(false);
    }
  };

  const deptId = lockedDepartmentId || form.department_id;
  const noDeptRoleLabel = form.role_type === 'security' ? 'Security' : form.role_type === 'unit_auditor' ? 'Unit Auditor' : 'Receptionist';

  return (
    <Drawer
      open={isOpen}
      onClose={onClose}
      busy={submitting}
      width={520}
      icon={isEdit ? UserCog : Plus}
      title={isEdit ? `Edit ${editUser?.full_name}` : "New user"}
      subtitle={isEdit ? editUser?.employee_code : "Create a system account in this unit"}
      footer={(
        <>
          <button type="button" onClick={onClose} className="btn-outline" disabled={submitting}>Cancel</button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || blockForNoDepts || (!isEdit && !validatePassword(form.password).valid)}
            className="btn-primary"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {submitting ? "Saving…" : isEdit ? "Save changes" : "Create user"}
          </button>
        </>
      )}
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        {blockForNoDepts && (
          <Note tone="warning" icon={AlertTriangle}>
            <b>No departments yet.</b> Create a department before adding employees.{" "}
            <Link to="/admin/departments" onClick={onClose} className="text-link font-medium inline-flex items-center gap-0.5">
              Go to departments <ArrowRight size={11} />
            </Link>
          </Note>
        )}

        <div className="tile space-y-3">
          <p className="group-heading">Person</p>
          <Field label="Full name" htmlFor="u-name" required>
            <input id="u-name" className="control" value={form.full_name} onChange={set("full_name")} placeholder="e.g. Priya Sharma" required autoComplete="off" />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Email" htmlFor="u-email" required>
              <input id="u-email" className="control" type="email" value={form.email} onChange={set("email")} placeholder="priya@ohpc.co.in" required autoComplete="off" />
            </Field>
            <Field label="Phone" htmlFor="u-phone" required hint="WhatsApp number preferred">
              <input id="u-phone" className="control tabular" type="tel" value={form.phone} onChange={set("phone")} placeholder="+91 98765 43210" required autoComplete="off" />
            </Field>
          </div>
        </div>

        <div className="tile space-y-3">
          <p className="group-heading">Role</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Role" required>
              <Select value={form.role_type} onChange={set("role_type")} required aria-label="Role">
                <option value="employee">Employee</option>
                <option value="security">Security</option>
                <option value="receptionist">Receptionist</option>
                <option value="unit_auditor">Unit Auditor</option>
              </Select>
            </Field>
            {!isEdit ? (
              <Field label="Employee code" htmlFor="u-code" required hint="Suggested from the role; you can change it.">
                <input id="u-code" className="control mono" value={form.employee_code}
                  onChange={e => {
                    const value = e.target.value;
                    setForm(f => ({ ...f, employee_code: value }));
                    setCodeEdited(value.trim() !== '');   // cleared → use the suggestion again
                  }}
                  placeholder="EMP-001" required autoComplete="off" />
              </Field>
            ) : <div className="hidden sm:block" />}

            <Field label="Department" required={!isNoDeptRole && form.role_type !== 'unit_admin'}>
              {isNoDeptRole ? (
                // Security / receptionist / auditor have no department
                <div className="control flex items-center bg-surface-alt text-muted cursor-not-allowed select-none">
                  Not applicable for {noDeptRoleLabel}
                </div>
              ) : lockedDepartmentId ? (
                <div className="control flex items-center bg-surface-alt text-ink-2">
                  {departments.find(d => d.id === lockedDepartmentId)?.name || 'Your department'}
                </div>
              ) : (
                <Select
                  value={form.department_id}
                  onChange={set("department_id")}
                  required={!isNoDeptRole && form.role_type !== 'unit_admin'}
                  aria-label="Department"
                >
                  <option value="">Select department</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Select>
              )}
            </Field>

            <Field label="Designation">
              <Select
                value={form.designation_id || ""}
                onChange={set("designation_id")}
                disabled={isNoDeptRole || !deptId || designations.length === 0}
                aria-label="Designation"
              >
                <option value="">
                  {isNoDeptRole
                    ? "Not applicable"
                    : !deptId
                    ? "Select a department first"
                    : designations.length === 0
                    ? "None yet (add in Departments)"
                    : "Select designation"}
                </option>
                {designations.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </Field>
          </div>
        </div>

        {!isEdit && (
          <div className="tile">
            <Field label="Password" htmlFor="u-pw" required>
              <input id="u-pw" className="control" type="password" value={form.password} onChange={set("password")}
                placeholder="At least 8 characters" required={!isEdit} minLength={8} autoComplete="new-password" />
            </Field>
            <PasswordStrength password={form.password} />
          </div>
        )}
      </form>
    </Drawer>
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
  const openEdit = (u) => {
    if (u.role_type === "unit_admin" || u.id === currentUser?.id) {
      toast.error("Unit Admin details cannot be edited here.");
      return;
    }
    setEditUser(u);
    setPanelOpen(true);
  };

  const roleFilters = [
    { label: "All",          value: "" },
    { label: "Unit Admin",   value: "unit_admin" },
    { label: "Employee",     value: "employee" },
    { label: "Security",     value: "security" },
    { label: "Receptionist", value: "receptionist" },
  ].filter(f => isUnitAdmin ? true : !['unit_admin'].includes(f.value));

  const { rows, sort, onSort } = useSort(users, {
    name: (u) => u.full_name,
    code: (u) => u.employee_code,
    role: (u) => ROLE_CONFIG[u.role_type]?.label ?? u.role_type,
    dept: (u) => u.department_name,
    status: (u) => (u.is_active ? 0 : 1),
  });

  const canEdit = (u) => !(u.role_type === "unit_admin" || u.id === currentUser?.id);
  const deactivating = users.find(u => u.id === deactivatingId);
  const [deactivateBusy, setDeactivateBusy] = useState(false);
  const confirmDeactivate = async () => {
    setDeactivateBusy(true);
    await handleDeactivate(deactivatingId);
    setDeactivateBusy(false);
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Users"
        actions={<button type="button" onClick={openCreate} className="btn-primary"><Plus size={14} /> Add user</button>}
      />

      {!loading && departments.length === 0 && (
        <Note tone="warning" icon={AlertTriangle} className="mb-4">
          <b>No departments yet.</b> Security, receptionist and auditor users need no department; employees do.{" "}
          <Link to="/admin/departments" className="text-link font-medium">Create a department</Link>
        </Note>
      )}

      <Toolbar count={loading ? null : totalCount} noun={totalCount === 1 ? "user" : "users"}>
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, email or code" width={260} />
        <Select value={roleFilter} onChange={e => { setRoleFilter(e.target.value); setPage(1); }} aria-label="Role" style={{ width: 160 }}>
          {roleFilters.map(({ label, value }) => (
            <option key={value} value={value}>{value ? label : "All roles"}</option>
          ))}
        </Select>
        {(search || roleFilter) && (
          <button type="button" className="btn-ghost" onClick={() => { setSearch(""); setRoleFilter(""); setPage(1); }}>Clear</button>
        )}
      </Toolbar>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <Th sortKey="name" sort={sort} onSort={onSort}>Name</Th>
              <Th sortKey="code" sort={sort} onSort={onSort}>Code</Th>
              <Th sortKey="role" sort={sort} onSort={onSort}>Role</Th>
              <Th sortKey="dept" sort={sort} onSort={onSort}>Department</Th>
              <Th sortKey="status" sort={sort} onSort={onSort}>Status</Th>
              <th className="w-10"><span className="sr-only">Deactivate</span></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows rows={6} cols={6} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="!p-0">
                  <Empty
                    icon={Users}
                    title={search || roleFilter ? "No users match these filters" : "No users yet"}
                    hint={search || roleFilter ? "Try another search or role." : "Add the people who host, approve and guard visits."}
                  />
                </td>
              </tr>
            ) : rows.map(u => {
              const editable = canEdit(u);
              return (
                <tr
                  key={u.id}
                  className={editable ? "is-clickable" : undefined}
                  onClick={editable ? () => openEdit(u) : undefined}
                  title={editable ? undefined : "Unit admin details can't be edited here"}
                >
                  <td>
                    <span className={`font-medium ${u.is_active ? "" : "text-muted"}`}>{u.full_name}</span>
                    {u.id === currentUser?.id && <span className="ml-1.5"><Tag tone="brand">You</Tag></span>}
                    <span className="cell-sub">{u.email}</span>
                  </td>
                  <td className="mono">{u.employee_code}</td>
                  <td><RoleBadge role={u.role_type} /></td>
                  <td className="text-ink-2">{u.department_name || "—"}</td>
                  <td>{u.is_active ? <State tone="success">Active</State> : <State tone="neutral">Inactive</State>}</td>
                  <td>
                    {u.is_active && u.id !== currentUser?.id && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setDeactivatingId(u.id); }}
                        className="btn-icon"
                        aria-label={`Deactivate ${u.full_name}`}
                        title="Deactivate"
                      >
                        <UserX size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!loading && <Pagination page={page} totalPages={totalPages} totalCount={totalCount} onPageChange={(p) => setPage(p)} />}

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

      <Modal
        open={!!deactivating}
        onClose={() => setDeactivatingId(null)}
        busy={deactivateBusy}
        width={420}
        title={`Deactivate ${deactivating?.full_name ?? "user"}?`}
        footer={(
          <>
            <button type="button" className="btn-outline" onClick={() => setDeactivatingId(null)} disabled={deactivateBusy}>Cancel</button>
            <button type="button" className="btn-danger" onClick={confirmDeactivate} disabled={deactivateBusy}>
              {deactivateBusy && <Loader2 size={14} className="animate-spin" />}
              Deactivate
            </button>
          </>
        )}
      >
        <p className="text-[12.5px] text-ink-2">They will no longer be able to sign in. Their past visits stay on record.</p>
      </Modal>
    </div>
  );
}
