// frontend/src/pages/super/GlobalUserManagement.jsx
// Central users (DESIGN_RULES §6/§8/§12): title + Add auditor, stat strip,
// toolbar, a sortable table whose rows open the edit drawer.
import { useState, useEffect, useCallback } from 'react';
import { Plus, Shield, Eye, EyeOff, UserX, UserCog, Check, Loader2, Info } from '../../components/icons';
import { toast } from 'react-hot-toast';
import apiClient from '../../api/axios';
import PasswordStrength from '../../components/PasswordStrength';
import { validatePassword } from '../../utils/passwordValidator';
import Pagination from '../../components/shared/Pagination';
import { getApiErrorMessage } from '../../utils/apiError';
import {
  PageHeader, StatStrip, Stat, Toolbar, SearchInput, Th, SkeletonRows, Tag, State, Empty, Field, Drawer, Note,
} from '../../components/ui';
import useSort from '../../lib/useSort';
import { fmtDate } from '../../lib/format';

const EMPTY_FORM = {
  full_name: '', email: '', phone: '', employee_code: '', password: '', role_type: 'global_auditor',
};

const ROLE_LABELS = {
  super_admin:    { label: 'Super Admin',    tone: 'warning' },
  global_auditor: { label: 'Global Auditor', tone: 'success' },
};

export default function GlobalUserManagement() {
  const [users,      setUsers]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [isOpen,     setIsOpen]     = useState(false);
  const [editUser,   setEditUser]   = useState(null);
  const [form,       setForm]       = useState(EMPTY_FORM);
  const [saving,     setSaving]     = useState(false);
  const [showPwd,    setShowPwd]    = useState(false);
  const [search,     setSearch]     = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page,       setPage]       = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const limit = 10;

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset page when search changes
  useEffect(() => { setPage(1); }, [debouncedSearch]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit };
      if (debouncedSearch) params.search = debouncedSearch;
      const res = await apiClient.get('/central-users', { params });
      const data = res.data?.data;
      setUsers(data?.users ?? []);
      setTotalPages(data?.pagination?.pages ?? 1);
      setTotalCount(data?.pagination?.total ?? 0);
    } catch {
      toast.error('Failed to load central users.');
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const openCreate = () => {
    setEditUser(null);
    setForm(EMPTY_FORM);
    setShowPwd(false);
    setIsOpen(true);
  };

  const openEdit = (u) => {
    setEditUser(u);
    setForm({
      full_name:     u.full_name,
      email:         u.email,
      phone:         u.phone || '',
      employee_code: u.employee_code,
      password:      '',
      role_type:     u.role_type,
    });
    setShowPwd(false);
    setIsOpen(true);
  };

  const close = () => {
    setIsOpen(false);
    setEditUser(null);
  };

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async () => {
    if (!form.full_name.trim()) {
      return toast.error('Full name is required.');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!form.email.trim()) {
      return toast.error('Email address is required.');
    }
    if (!emailRegex.test(form.email.trim())) {
      return toast.error('Please enter a valid email address (e.g. auditor@company.com).');
    }

    if (!form.employee_code.trim()) {
      return toast.error('Employee code is required.');
    }

    // Phone is optional for central users, but validate format if provided
    const phoneRaw = form.phone.trim();
    if (phoneRaw) {
      const phoneDigits = phoneRaw.replace(/\D/g, '');
      if (!/^[+]?[\d\s\-]+$/.test(phoneRaw) || phoneDigits.length < 7 || phoneDigits.length > 15) {
        return toast.error('Phone number must contain only digits (7–15 digits). Example: +91 9000000000');
      }
    }

    if (!editUser && !form.password.trim()) {
      return toast.error('Password is required when creating a new user.');
    }
    if (!editUser) {
      const { valid: pwValid } = validatePassword(form.password);
      if (!pwValid) {
        return toast.error('Password does not meet the strength requirements.');
      }
    }
    setSaving(true);
    try {
      if (editUser) {
        const payload = {
          full_name:     form.full_name.trim(),
          email:         form.email.trim(),
          phone:         phoneRaw || null,
          employee_code: form.employee_code.trim(),
        };
        await apiClient.put(`/central-users/${editUser.id}`, payload);
        toast.success('User updated successfully.');
      } else {
        await apiClient.post('/central-users', {
          full_name:     form.full_name.trim(),
          email:         form.email.trim(),
          phone:         phoneRaw || null,
          employee_code: form.employee_code.trim(),
          password:      form.password,
          role_type:     form.role_type,
        });
        toast.success('Global Auditor created successfully.');
      }
      close();
      fetchUsers();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Operation failed. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (u) => {
    if (!window.confirm(`Deactivate "${u.full_name}"? They will lose system access immediately.`)) return;
    try {
      await apiClient.delete(`/central-users/${u.id}`);
      toast.success(`${u.full_name} deactivated.`);
      fetchUsers();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to deactivate user.'));
    }
  };

  const { rows, sort, onSort } = useSort(users, {
    name: (u) => u.full_name,
    code: (u) => u.employee_code,
    role: (u) => ROLE_LABELS[u.role_type]?.label ?? u.role_type,
    status: (u) => (u.is_active ? 0 : 1),
    login: (u) => u.last_login_at,
  });

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Central users"
        actions={<button type="button" className="btn-primary" onClick={openCreate}><Plus size={14} /> Add global auditor</button>}
      />

      <StatStrip cols={3}>
        <Stat label="Central users" value={totalCount} loading={loading} />
        <Stat label="Super admins" value={users.filter(u => u.role_type === 'super_admin').length} loading={loading} hint="On this page" />
        <Stat label="Global auditors" value={users.filter(u => u.role_type === 'global_auditor').length} loading={loading} hint="On this page" />
      </StatStrip>

      <Toolbar count={loading ? null : totalCount} noun={totalCount === 1 ? 'user' : 'users'}>
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, email or code" width={260} />
        {search && <button type="button" className="btn-ghost" onClick={() => setSearch('')}>Clear</button>}
      </Toolbar>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <Th sortKey="name" sort={sort} onSort={onSort}>Name</Th>
              <Th sortKey="code" sort={sort} onSort={onSort}>Code</Th>
              <Th sortKey="role" sort={sort} onSort={onSort}>Role</Th>
              <Th sortKey="status" sort={sort} onSort={onSort}>Status</Th>
              <Th sortKey="login" sort={sort} onSort={onSort}>Last sign-in</Th>
              <th className="w-10"><span className="sr-only">Deactivate</span></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows rows={5} cols={6} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="!p-0">
                  <Empty
                    icon={Shield}
                    title={search ? 'No users match this search' : 'No central users yet'}
                    hint={search ? 'Try another name, email or code.' : 'Add a global auditor for read-only access across units.'}
                  />
                </td>
              </tr>
            ) : rows.map(u => {
              const rl = ROLE_LABELS[u.role_type] ?? { label: u.role_type, tone: 'neutral' };
              return (
                <tr key={u.id} className="is-clickable" onClick={() => openEdit(u)}>
                  <td>
                    <span className={`font-medium ${u.is_active ? '' : 'text-muted'}`}>{u.full_name}</span>
                    <span className="cell-sub">{u.email}</span>
                  </td>
                  <td className="mono">{u.employee_code}</td>
                  <td><Tag tone={rl.tone}>{rl.label}</Tag></td>
                  <td>{u.is_active ? <State tone="success">Active</State> : <State tone="danger">Inactive</State>}</td>
                  <td className="tabular text-ink-2">{u.last_login_at ? fmtDate(u.last_login_at) : '—'}</td>
                  <td>
                    {u.is_active && u.role_type !== 'super_admin' && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleDeactivate(u); }}
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

      <Drawer
        open={isOpen}
        onClose={close}
        busy={saving}
        width={520}
        icon={editUser ? UserCog : Plus}
        title={editUser ? `Edit ${editUser.full_name}` : 'New global auditor'}
        subtitle={editUser ? (ROLE_LABELS[editUser.role_type]?.label ?? editUser.role_type) : 'Read-only access across all units'}
        footer={(
          <>
            <button type="button" className="btn-outline" onClick={close} disabled={saving}>Cancel</button>
            <button type="button" className="btn-primary" onClick={handleSubmit}
              disabled={saving || (!editUser && !validatePassword(form.password).valid)}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {saving ? 'Saving…' : editUser ? 'Save changes' : 'Create auditor'}
            </button>
          </>
        )}
      >
        <div className="tile space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_150px] gap-3">
            <Field label="Full name" htmlFor="cu-name" required>
              <input id="cu-name" className="control" value={form.full_name} onChange={set('full_name')} placeholder="Full name" />
            </Field>
            <Field label="Employee code" htmlFor="cu-code" required>
              <input id="cu-code" className="control mono" value={form.employee_code} onChange={set('employee_code')} placeholder="GA-001" />
            </Field>
          </div>
          <Field label="Email" htmlFor="cu-email" required>
            <input id="cu-email" className="control" type="email" value={form.email} onChange={set('email')} placeholder="auditor@ohpc.co.in" />
          </Field>
          <Field label="Phone" htmlFor="cu-phone" hint="WhatsApp number preferred">
            <input id="cu-phone" className="control tabular" value={form.phone} onChange={set('phone')} placeholder="+91 90000 00000" />
          </Field>

          {!editUser && (
            <div>
              <Field label="Password" htmlFor="cu-pw" required>
                <div className="relative">
                  <input
                    id="cu-pw"
                    className="control pr-9"
                    type={showPwd ? 'text' : 'password'}
                    value={form.password}
                    onChange={set('password')}
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd(v => !v)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 btn-icon !w-7 !min-h-0 h-7"
                    aria-label={showPwd ? 'Hide password' : 'Show password'}
                  >
                    {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </Field>
              <PasswordStrength password={form.password} />
            </div>
          )}
        </div>

        <Note tone="info" icon={Info} className="mt-3">
          {editUser
            ? 'This updates the profile only. To change a password, the user signs in and uses My profile.'
            : 'Global auditors can view visitors, reports and audit logs of every unit. They cannot create or change records.'}
        </Note>
      </Drawer>
    </div>
  );
}
