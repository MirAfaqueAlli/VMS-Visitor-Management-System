// frontend/src/pages/super/GlobalUserManagement.jsx
import { useState, useEffect, useCallback } from 'react';
import { Plus, X, UserCheck, Shield, Eye, EyeOff, UserX, Search } from 'lucide-react';
import { toast } from 'react-hot-toast';
import apiClient from '../../api/axios';
import PasswordStrength from '../../components/PasswordStrength';
import { validatePassword } from '../../utils/passwordValidator';

const EMPTY_FORM = {
  full_name: '', email: '', phone: '', employee_code: '', password: '', role_type: 'global_auditor',
};

const ROLE_LABELS = {
  super_admin:    { label: 'Super Admin',    color: '#7c3aed', bg: '#ede9fe' },
  global_auditor: { label: 'Global Auditor', color: '#0369a1', bg: '#e0f2fe' },
};

export default function GlobalUserManagement() {
  const [users,      setUsers]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [isOpen,     setIsOpen]     = useState(false);
  const [editUser,   setEditUser]   = useState(null); // null = create, obj = edit
  const [form,       setForm]       = useState(EMPTY_FORM);
  const [saving,     setSaving]     = useState(false);
  const [showPwd,    setShowPwd]    = useState(false);
  const [search,     setSearch]     = useState('');

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/central-users');
      setUsers(res.data?.data ?? []);
    } catch {
      toast.error('Failed to load central users.');
    } finally {
      setLoading(false);
    }
  }, []);

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
    if (!form.full_name.trim() || !form.email.trim() || !form.employee_code.trim()) {
      return toast.error('Full name, email, and employee code are required.');
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
          phone:         form.phone.trim() || null,
          employee_code: form.employee_code.trim(),
        };
        await apiClient.put(`/central-users/${editUser.id}`, payload);
        toast.success('User updated successfully.');
      } else {
        await apiClient.post('/central-users', {
          full_name:     form.full_name.trim(),
          email:         form.email.trim(),
          phone:         form.phone.trim() || null,
          employee_code: form.employee_code.trim(),
          password:      form.password,
          role_type:     form.role_type,
        });
        toast.success('Global Auditor created successfully.');
      }
      close();
      fetchUsers();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Operation failed.');
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
      toast.error(err?.response?.data?.message || 'Failed to deactivate user.');
    }
  };

  const filtered = users.filter(u =>
    `${u.full_name} ${u.email} ${u.employee_code}`.toLowerCase().includes(search.toLowerCase())
  );

  const inputCls = 'vms-input w-full';
  const labelCls = 'block text-[11px] font-medium uppercase tracking-wider mb-1.5';

  return (
    <>
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 animate-fade-in space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-[18px] font-bold" style={{ color: 'var(--color-text)' }}>
              Central User Management
            </h1>
            <p className="text-[12px] mt-1" style={{ color: 'var(--color-text-faint)' }}>
              Manage Super Admins and Global Auditors stored in the central database.
            </p>
          </div>
          <button className="btn-primary" onClick={openCreate}>
            <Plus size={14} /> Add Global Auditor
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: 'Total Central Users', value: users.length,                                        color: 'var(--color-info)' },
            { label: 'Super Admins',         value: users.filter(u => u.role_type === 'super_admin').length,    color: '#7c3aed' },
            { label: 'Global Auditors',      value: users.filter(u => u.role_type === 'global_auditor').length, color: '#0369a1' },
          ].map(({ label, value, color }) => (
            <div key={label} className="vms-card p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded flex items-center justify-center" style={{ background: `${color}20` }}>
                <UserCheck size={16} style={{ color }} />
              </div>
              <div>
                <p className="text-[20px] font-bold leading-none" style={{ color: 'var(--color-text)' }}>{value}</p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-faint)' }}>{label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="vms-card p-3 flex items-center gap-2">
          <Search size={14} style={{ color: 'var(--color-text-faint)' }} />
          <input
            className="flex-1 bg-transparent text-[13px] outline-none"
            style={{ color: 'var(--color-text)' }}
            placeholder="Search by name, email or employee code…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div
              className="w-6 h-6 rounded-full border-2 animate-spin"
              style={{ borderColor: 'var(--color-border)', borderTopColor: 'var(--color-accent)' }}
            />
          </div>
        ) : filtered.length === 0 ? (
          <div className="vms-card flex flex-col items-center justify-center py-16 gap-3">
            <Shield size={32} style={{ color: 'var(--color-text-faint)' }} />
            <p className="text-[13px]" style={{ color: 'var(--color-text-faint)' }}>
              {search ? 'No users match your search.' : 'No central users found.'}
            </p>
          </div>
        ) : (
          <div className="vms-card overflow-hidden">
            <table className="w-full text-[12px]">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}>
                  {['Name', 'Email', 'Employee Code', 'Role', 'Status', 'Last Login', 'Actions'].map(h => (
                    <th
                      key={h}
                      className="text-left px-4 py-3 font-semibold uppercase tracking-wider text-[10px]"
                      style={{ color: 'var(--color-text-faint)' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((u, i) => {
                  const rl = ROLE_LABELS[u.role_type] ?? { label: u.role_type, color: '#888', bg: '#f3f4f6' };
                  return (
                    <tr
                      key={u.id}
                      style={{
                        borderBottom: i < filtered.length - 1 ? '1px solid var(--color-border)' : 'none',
                        opacity: u.is_active ? 1 : 0.5,
                      }}
                    >
                      <td className="px-4 py-3 font-medium" style={{ color: 'var(--color-text)' }}>
                        {u.full_name}
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--color-text-faint)' }}>
                        {u.email}
                      </td>
                      <td className="px-4 py-3 font-mono" style={{ color: 'var(--color-text-faint)' }}>
                        {u.employee_code}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                          style={{ background: rl.bg, color: rl.color }}
                        >
                          {rl.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                          style={{
                            background: u.is_active ? '#f0fdf4' : '#fef2f2',
                            color:      u.is_active ? '#15803d' : '#b91c1c',
                          }}
                        >
                          {u.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--color-text-faint)' }}>
                        {u.last_login_at
                          ? new Date(u.last_login_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                          : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openEdit(u)}
                            className="text-[11px] px-2 py-0.5 rounded font-medium transition-colors"
                            style={{ background: 'var(--color-info-bg)', color: 'var(--color-info)' }}
                            title="Edit user"
                          >
                            Edit
                          </button>
                          {u.is_active && u.role_type !== 'super_admin' && (
                            <button
                              onClick={() => handleDeactivate(u)}
                              className="text-[11px] px-2 py-0.5 rounded font-medium transition-colors"
                              style={{ background: '#fef2f2', color: '#b91c1c' }}
                              title="Deactivate user"
                            >
                              <UserX size={11} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 transition-opacity"
        style={{
          background:    'rgba(0,0,0,0.5)',
          opacity:       isOpen ? 1 : 0,
          pointerEvents: isOpen ? 'auto' : 'none',
          transition:    'opacity 200ms ease',
        }}
        onClick={close}
      />

      {/* Slide-over */}
      <div
        className="fixed right-0 top-0 h-full z-50 flex flex-col"
        style={{
          width: 'min(520px, 100vw)',
          background: 'var(--color-bg-secondary)',
          borderLeft: '1px solid var(--color-border)',
          transform:  isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 250ms ease',
          boxShadow:  '-8px 0 32px rgba(0,0,0,0.15)',
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
      >
        {/* Header */}
        <div
          className="px-6 py-4 flex items-start justify-between shrink-0"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <div>
            <h3 className="font-semibold text-[13px]" style={{ color: 'var(--color-text)' }}>
              {editUser ? 'Edit Central User' : 'Add Global Auditor'}
            </h3>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-faint)' }}>
              {editUser
                ? 'Update the user\'s profile details.'
                : 'Create a new Global Auditor in the central database.'}
            </p>
          </div>
          <button onClick={close} style={{ color: 'var(--color-text-faint)' }}><X size={16} /></button>
        </div>

        {/* Form body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* Role (create only, locked to global_auditor) */}
          {!editUser && (
            <div>
              <label className={labelCls} style={{ color: 'var(--color-text-faint)' }}>Role</label>
              <div
                className="flex items-center gap-2 px-3 py-2.5 rounded text-[12px] font-semibold"
                style={{ background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd', borderRadius: 'var(--radius-sm)' }}
              >
                <Shield size={13} />
                Global Auditor — read-only access across all units
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls} style={{ color: 'var(--color-text-faint)' }}>Full Name *</label>
              <input className={inputCls} value={form.full_name} onChange={set('full_name')} placeholder="Full Name" />
            </div>
            <div>
              <label className={labelCls} style={{ color: 'var(--color-text-faint)' }}>Employee Code *</label>
              <input className={`${inputCls} font-mono`} value={form.employee_code} onChange={set('employee_code')} placeholder="GA-001" />
            </div>
          </div>

          <div>
            <label className={labelCls} style={{ color: 'var(--color-text-faint)' }}>Email Address *</label>
            <input className={inputCls} type="email" value={form.email} onChange={set('email')} placeholder="auditor@company.com" />
          </div>

          <div>
            <label className={labelCls} style={{ color: 'var(--color-text-faint)' }}>Phone <span style={{ fontSize: '10px', fontWeight: 400, letterSpacing: 0, textTransform: 'none', opacity: 0.6, marginLeft: '4px' }}>(WhatsApp preferred)</span></label>
            <input className={inputCls} value={form.phone} onChange={set('phone')} placeholder="+91 9000000000" />
          </div>

          {!editUser && (
            <div>
              <label className={labelCls} style={{ color: 'var(--color-text-faint)' }}>Password *</label>
              <div className="relative">
                <input
                  className={inputCls}
                  type={showPwd ? 'text' : 'password'}
                  value={form.password}
                  onChange={set('password')}
                  placeholder="Minimum 8 characters"
                  autoComplete="new-password"
                  style={{ paddingRight: 36 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--color-text-faint)' }}
                >
                  {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <PasswordStrength password={form.password} />
            </div>
          )}

          {/* Info box */}
          <div
            className="text-[11px] px-3 py-2.5 rounded"
            style={{
              background:   'var(--color-info-bg)',
              color:        'var(--color-info)',
              border:       '1px solid var(--color-info)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            {editUser
              ? 'You can update the user\'s profile details. To reset their password, they must use the Profile page or contact the DBA.'
              : 'Global Auditors can view all unit data (visitors, reports, audit logs) in read-only mode. They cannot create or modify records.'}
          </div>
        </div>

        {/* Footer */}
        <div
          className="px-6 py-4 flex gap-3 shrink-0"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          <button className="btn-secondary flex-1" onClick={close} disabled={saving}>Cancel</button>
          <button className="btn-primary flex-1" onClick={handleSubmit} disabled={saving || (!editUser && !validatePassword(form.password).valid)}>
            {saving ? (
              <span className="flex items-center gap-1.5 justify-center">
                <span className="w-3.5 h-3.5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'rgba(15,23,42,0.2)', borderTopColor: '#0f172a' }} />
                Saving…
              </span>
            ) : (
              <span className="flex items-center gap-1.5 justify-center">
                <Plus size={13} /> {editUser ? 'Save Changes' : 'Create Auditor'}
              </span>
            )}
          </button>
        </div>
      </div>
    </>
  );
}
