// frontend/src/pages/super/UnitManagement.jsx
import { useState, useEffect, useCallback } from 'react';
import { Plus, X, Building2, Users, Layers, CheckCircle, AlertCircle, Globe, Search } from 'lucide-react';
import { toast } from 'react-hot-toast';
import apiClient from '../../api/axios';
import useAuth from '../../hooks/useAuth';
import PasswordStrength from '../../components/PasswordStrength';
import { validatePassword } from '../../utils/passwordValidator';
import Pagination from '../../components/shared/Pagination';

const EMPTY_UNIT = {
  name: '', code: '', city: '', state: '', phone: '', email: '',
};
const EMPTY_ADMIN = {
  full_name: '', email: '', phone: '', password: '', employee_code: '',
};

const STATUS_COLORS = {
  ACTIVE:       { bg: '#f0fdf4', text: '#15803d', dot: '#22c55e' },
  PROVISIONING: { bg: '#fefce8', text: '#a16207', dot: '#eab308' },
  SUSPENDED:    { bg: '#fef2f2', text: '#b91c1c', dot: '#ef4444' },
};

export default function UnitManagement() {
  const { setActiveUnit, activeUnit } = useAuth();
  const [units,        setUnits]        = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [isOpen,       setIsOpen]       = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [unitForm,     setUnitForm]     = useState(EMPTY_UNIT);
  const [adminForm,    setAdminForm]    = useState(EMPTY_ADMIN);
  const [includeAdmin, setIncludeAdmin] = useState(true);
  const [search,       setSearch]       = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page,         setPage]         = useState(1);
  const [totalPages,   setTotalPages]   = useState(1);
  const [totalCount,   setTotalCount]   = useState(0);
  const limit = 10;

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset page when search changes
  useEffect(() => { setPage(1); }, [debouncedSearch]);

  const handleManageUnit = (unit) => {
    setActiveUnit({ id: unit.id, name: unit.name, db_name: unit.db_name });
    toast.success(`Switched to: ${unit.name}`);
  };

  const fetchUnits = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit };
      if (debouncedSearch) params.search = debouncedSearch;
      const res = await apiClient.get('/units', { params });
      const data = res.data?.data;
      setUnits(data?.units ?? []);
      setTotalPages(data?.pagination?.pages ?? 1);
      setTotalCount(data?.pagination?.total ?? 0);
    } catch { toast.error('Failed to load units.'); }
    finally  { setLoading(false); }
  }, [page, debouncedSearch]);

  useEffect(() => { fetchUnits(); }, [fetchUnits]);

  const openCreate = () => {
    setUnitForm(EMPTY_UNIT);
    setAdminForm(EMPTY_ADMIN);
    setIncludeAdmin(true);
    setIsOpen(true);
  };
  const close = () => setIsOpen(false);

  const handleSubmit = async () => {
    if (!unitForm.name.trim() || !unitForm.code.trim()) {
      return toast.error('Unit name and code are required.');
    }
    if (includeAdmin) {
      const nameVal = adminForm.full_name.trim();
      const emailVal = adminForm.email.trim();
      const passVal = adminForm.password.trim();
      const codeVal = adminForm.employee_code.trim();
      if (nameVal || emailVal || passVal || codeVal) {
        if (!nameVal || !emailVal || !passVal || !codeVal) {
          return toast.error('All admin fields (Name, Email, Password, and Employee Code) are required.');
        }
        const { valid: pwValid } = validatePassword(passVal);
        if (!pwValid) {
          return toast.error('Admin password does not meet the strength requirements.');
        }
      }
    }
    setSaving(true);
    try {
      const payload = { ...unitForm, code: unitForm.code.toUpperCase().trim() };
      if (includeAdmin && adminForm.full_name.trim() && adminForm.email.trim()) {
        payload.unit_admin = { ...adminForm };
      }
      await apiClient.post('/units', payload);
      toast.success('Unit created and database provisioned!');
      close();
      fetchUnits();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to create unit.');
    } finally { setSaving(false); }
  };

  const setUnit  = (k) => (e) => setUnitForm(f  => ({ ...f, [k]: e.target.value }));
  const setAdmin = (k) => (e) => setAdminForm(f => ({ ...f, [k]: e.target.value }));

  const inputCls = 'vms-input w-full';
  const labelCls = 'block text-[11px] font-medium uppercase tracking-wider mb-1.5';

  return (
    <>
      <div className="space-y-6 animate-fade-in">

        {/* Page header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-[18px] font-bold" style={{ color: 'var(--color-text)' }}>
              Unit Management
            </h1>
            <p className="text-[12px] mt-1" style={{ color: 'var(--color-text-faint)' }}>
              Each unit gets its own fully isolated MySQL database, provisioned automatically on creation.
            </p>
          </div>
          <button className="btn-primary" onClick={openCreate}>
            <Plus size={14} /> Create Unit
          </button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: 'Total Units',  value: totalCount,                                          icon: Building2,    color: 'var(--color-info)' },
            { label: 'Active',       value: units.filter(u => u.db_status === 'ACTIVE').length,  icon: CheckCircle,  color: '#22c55e' },
            { label: 'Provisioning', value: units.filter(u => u.db_status !== 'ACTIVE').length,  icon: AlertCircle,  color: '#eab308' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="vms-card p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded flex items-center justify-center" style={{ background: `${color}20` }}>
                <Icon size={16} style={{ color }} />
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
            placeholder="Search by name, code or city…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Units grid */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div
              className="w-6 h-6 rounded-full border-2 animate-spin"
              style={{ borderColor: 'var(--color-border)', borderTopColor: 'var(--color-accent)' }}
            />
          </div>
        ) : units.length === 0 ? (
          <div className="vms-card flex flex-col items-center justify-center py-16 gap-3">
            <Globe size={32} style={{ color: 'var(--color-text-faint)' }} />
            <p className="text-[13px]" style={{ color: 'var(--color-text-faint)' }}>
              No units yet. Use the <strong>Create Unit</strong> button above to get started.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {units.map(unit => {
              const sc = STATUS_COLORS[unit.db_status] ?? STATUS_COLORS.SUSPENDED;
              return (
                <div key={unit.id} className="vms-card p-5 flex flex-col gap-3 hover:shadow-md transition-shadow">
                  {/* Card header */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded flex items-center justify-center" style={{ background: 'var(--color-info-bg)' }}>
                        <Building2 size={16} style={{ color: 'var(--color-info)' }} />
                      </div>
                      <div>
                        <p className="font-semibold text-[13px]" style={{ color: 'var(--color-text)' }}>{unit.name}</p>
                        <p className="font-mono text-[10px]" style={{ color: 'var(--color-text-faint)' }}>{unit.code}</p>
                      </div>
                    </div>
                    <span
                      className="text-[10px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1 shrink-0"
                      style={{ background: sc.bg, color: sc.text }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: sc.dot }} />
                      {unit.db_status}
                    </span>
                  </div>

                  {/* Meta */}
                  <div className="flex flex-wrap gap-3 text-[11px]" style={{ color: 'var(--color-text-faint)' }}>
                    <span className="flex items-center gap-1"><Users size={11} /> {unit.user_count ?? 0} users</span>
                    <span className="flex items-center gap-1"><Layers size={11} /> {unit.department_count ?? 0} depts</span>
                    {unit.city && <span>{unit.city}{unit.state ? `, ${unit.state}` : ''}</span>}
                  </div>

                  {/* DB name footer */}
                  <div
                    className="pt-2 flex items-center justify-between gap-1.5"
                    style={{ borderTop: '1px solid var(--color-border)' }}
                  >
                    <span className="font-mono text-[10px] truncate" style={{ color: 'var(--color-text-faint)' }}>
                      DB: {unit.db_name}
                    </span>
                    <div className="flex items-center gap-2">
                      {unit.db_status === 'ACTIVE' && (
                        <button
                          onClick={() => handleManageUnit(unit)}
                          className={`px-2 py-0.5 text-[10px] font-semibold rounded transition-all ${
                            activeUnit?.id === unit.id
                              ? 'bg-green-500/10 text-green-600 border border-green-500/20'
                              : 'bg-blue-500/10 text-blue-600 border border-blue-500/20 hover:bg-blue-500 hover:text-white'
                          }`}
                        >
                          {activeUnit?.id === unit.id ? 'Managing' : 'Manage'}
                        </button>
                      )}
                      {unit.db_status === 'ACTIVE'
                        ? <CheckCircle size={12} style={{ color: '#22c55e' }} />
                        : <AlertCircle size={12} style={{ color: '#ef4444' }} />
                      }
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {!loading && (
          <Pagination
            page={page}
            totalPages={totalPages}
            totalCount={totalCount}
            onPageChange={(p) => setPage(p)}
          />
        )}
      </div>

      {/* Backdrop — outside page div so it covers the full viewport */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 transition-opacity duration-300 opacity-100"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={close}
        />
      )}

      {/* Create Unit slide-over — fixed full-height panel */}
      <aside
        className="fixed right-0 top-0 h-full z-50 flex flex-col"
        style={{
          width: 'min(600px, 100vw)',
          background: 'var(--color-bg-secondary)',
          borderLeft: '1px solid var(--color-border)',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.15)',
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 300ms ease-in-out',
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
              Create New Unit
            </h3>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-faint)' }}>
              A new isolated database will be provisioned automatically.
            </p>
          </div>
          <button onClick={close} style={{ color: 'var(--color-text-faint)' }}><X size={16} /></button>
        </div>

        {/* Form body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* ── Unit Details ─────────────────────────────────────────────────── */}
          <div>
            <p
              className="text-[11px] font-semibold uppercase tracking-wider mb-4 pb-2"
              style={{ color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)' }}
            >
              Unit Details
            </p>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls} style={{ color: 'var(--color-text-faint)' }}>Unit Name *</label>
                  <input className={inputCls} value={unitForm.name} onChange={setUnit('name')} placeholder="e.g. Head Office" />
                </div>
                <div>
                  <label className={labelCls} style={{ color: 'var(--color-text-faint)' }}>
                    Code * <span className="normal-case font-normal">(no spaces)</span>
                  </label>
                  <input
                    className={`${inputCls} font-mono`}
                    value={unitForm.code}
                    onChange={e => setUnitForm(f => ({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') }))}
                    placeholder="e.g. HQ"
                  />
                </div>
              </div>
              <div>
                <label className={labelCls} style={{ color: 'var(--color-text-faint)' }}>City</label>
                <input className={inputCls} value={unitForm.city} onChange={setUnit('city')} placeholder="e.g. Mumbai" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls} style={{ color: 'var(--color-text-faint)' }}>State</label>
                  <input className={inputCls} value={unitForm.state} onChange={setUnit('state')} placeholder="Maharashtra" />
                </div>
                <div>
                  <label className={labelCls} style={{ color: 'var(--color-text-faint)' }}>Phone <span style={{ fontSize: '10px', fontWeight: 400, letterSpacing: 0, textTransform: 'none', opacity: 0.6, marginLeft: '4px' }}>(WhatsApp preferred)</span></label>
                  <input className={inputCls} value={unitForm.phone} onChange={setUnit('phone')} placeholder="+91 22 1234 5678" />
                </div>
              </div>
              <div>
                <label className={labelCls} style={{ color: 'var(--color-text-faint)' }}>Email</label>
                <input className={inputCls} type="email" value={unitForm.email} onChange={setUnit('email')} placeholder="hq@company.com" />
              </div>
            </div>
          </div>

          {/* ── Unit Admin ───────────────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-4 pb-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
                Unit Admin Account
              </p>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeAdmin}
                  onChange={e => setIncludeAdmin(e.target.checked)}
                  className="w-3.5 h-3.5"
                />
                <span className="text-[11px]" style={{ color: 'var(--color-text-faint)' }}>Create admin</span>
              </label>
            </div>

            {includeAdmin && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls} style={{ color: 'var(--color-text-faint)' }}>Full Name *</label>
                    <input className={inputCls} value={adminForm.full_name} onChange={setAdmin('full_name')} placeholder="Admin Name" />
                  </div>
                  <div>
                    <label className={labelCls} style={{ color: 'var(--color-text-faint)' }}>Email *</label>
                    <input className={inputCls} type="email" value={adminForm.email} onChange={setAdmin('email')} placeholder="admin@unit.com" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls} style={{ color: 'var(--color-text-faint)' }}>Phone</label>
                    <input className={inputCls} value={adminForm.phone} onChange={setAdmin('phone')} placeholder="+91 9000000001" />
                  </div>
                  <div>
                    <label className={labelCls} style={{ color: 'var(--color-text-faint)' }}>Employee Code *</label>
                    <input className={`${inputCls} font-mono`} value={adminForm.employee_code} onChange={setAdmin('employee_code')} placeholder="HQ-ADM-001" required={includeAdmin} />
                  </div>
                </div>
                <div>
                  <label className={labelCls} style={{ color: 'var(--color-text-faint)' }}>Password *</label>
                  <input className={inputCls} type="password" value={adminForm.password} onChange={setAdmin('password')} placeholder="Min 8 chars, uppercase, number, symbol" autoComplete="new-password" />
                  <PasswordStrength password={adminForm.password} />
                </div>

                {/* Info box */}
                <div
                  className="text-[11px] px-3 py-2.5 rounded"
                  style={{
                    background:  'var(--color-info-bg)',
                    color:       'var(--color-info)',
                    border:      '1px solid var(--color-info)',
                    borderRadius:'var(--radius-sm)',
                  }}
                >
                  This account will be created as <strong>unit_admin</strong> in the new unit's database and can manage all users and departments for that unit.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          className="px-6 py-4 flex gap-3 shrink-0"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          <button className="btn-secondary flex-1" onClick={close} disabled={saving}>Cancel</button>
          <button className="btn-primary flex-1" onClick={handleSubmit} disabled={saving || (includeAdmin && adminForm.password.length > 0 && !validatePassword(adminForm.password).valid)}>
            {saving ? (
              <span className="flex items-center gap-1.5 justify-center">
                <span className="w-3.5 h-3.5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />
                Provisioning DB…
              </span>
            ) : (
              <span className="flex items-center gap-1.5 justify-center">
                <Plus size={13} /> Create Unit
              </span>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
