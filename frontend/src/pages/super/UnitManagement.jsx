// frontend/src/pages/super/UnitManagement.jsx
// Units (DESIGN_RULES §6/§8/§12): title + Create unit, stat strip, toolbar, a
// sortable table; create in a drawer, deactivate / reactivate in a modal.
import { useState, useEffect, useCallback } from 'react';
import { Plus, Building2, Power, RotateCcw, Loader2, Info } from '../../components/icons';
import { toast } from 'react-hot-toast';
import apiClient from '../../api/axios';
import useAuth from '../../hooks/useAuth';
import PasswordStrength from '../../components/PasswordStrength';
import { validatePassword } from '../../utils/passwordValidator';
import Pagination from '../../components/shared/Pagination';
import { getApiErrorMessage } from '../../utils/apiError';
import { OFFICE_TYPES, officeTypeLabel } from '../../utils/officeTypes';
import Select from '../../components/Select';
import {
  PageHeader, StatStrip, Stat, Toolbar, SearchInput, Th, SkeletonRows, Status, Tag, Empty, Field, Drawer, Modal, Note,
} from '../../components/ui';
import useSort from '../../lib/useSort';

const EMPTY_UNIT = {
  name: '', code: '', type: 'UNIT', city: '', state: '', phone: '', email: '',
};
const EMPTY_ADMIN = {
  full_name: '', email: '', phone: '', password: '', employee_code: '',
};

/** Suggested employee code for a unit's first admin, e.g. unit H1 → H1-ADM-001. */
const defaultAdminCode = (unitCode) => (unitCode ? `${unitCode}-ADM-001` : '');

export default function UnitManagement() {
  const { setActiveUnit, activeUnit } = useAuth();
  const [units,        setUnits]        = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [isOpen,       setIsOpen]       = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [unitForm,     setUnitForm]     = useState(EMPTY_UNIT);
  const [adminForm,    setAdminForm]    = useState(EMPTY_ADMIN);
  const [includeAdmin, setIncludeAdmin] = useState(true);
  // false → the admin's employee code follows the unit code; true once typed by hand
  const [empCodeEdited, setEmpCodeEdited] = useState(false);
  const [search,       setSearch]       = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page,         setPage]         = useState(1);
  const [totalPages,   setTotalPages]   = useState(1);
  const [totalCount,   setTotalCount]   = useState(0);
  const limit = 10;

  // Deactivate / reactivate confirmation: { unit, action: 'deactivate' | 'reactivate' }
  const [statusChange, setStatusChange] = useState(null);
  const [confirmCode,  setConfirmCode]  = useState('');
  const [changing,     setChanging]     = useState(false);

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

  const openStatusChange = (unit, action) => { setConfirmCode(''); setStatusChange({ unit, action }); };

  const handleStatusChange = async () => {
    const { unit, action } = statusChange;
    setChanging(true);
    try {
      if (action === 'deactivate') {
        await apiClient.delete(`/units/${unit.id}`);
        if (activeUnit?.id === unit.id) setActiveUnit(null);   // stop managing a closed unit
        toast.success(`${unit.name} has been deactivated.`);
      } else {
        await apiClient.post(`/units/${unit.id}/reactivate`);
        toast.success(`${unit.name} is active again.`);
      }
      setStatusChange(null);
      fetchUnits();
    } catch (err) {
      toast.error(getApiErrorMessage(err, `Failed to ${action} the unit.`));
    } finally { setChanging(false); }
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
    setEmpCodeEdited(false);
    setIsOpen(true);
  };
  const close = () => setIsOpen(false);

  const handleSubmit = async () => {
    if (!unitForm.name.trim()) { return toast.error('Unit name is required.'); }
    if (!unitForm.code.trim()) { return toast.error('Unit code is required.'); }
    if (includeAdmin) {
      const nameVal = adminForm.full_name.trim();
      const emailVal = adminForm.email.trim();
      const passVal = adminForm.password.trim();
      const codeVal = adminForm.employee_code.trim();
      if (nameVal || emailVal || passVal || codeVal) {
        if (!nameVal)  { return toast.error('Admin full name is required.'); }
        if (!emailVal) { return toast.error('Admin email address is required.'); }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
          return toast.error('Admin email is not a valid email address.');
        }
        if (!codeVal)  { return toast.error('Admin employee code is required.'); }
        if (!passVal)  { return toast.error('Admin password is required.'); }
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
      toast.error(getApiErrorMessage(err, 'Failed to create unit.'));
    } finally { setSaving(false); }
  };

  const setUnit  = (k) => (e) => setUnitForm(f  => ({ ...f, [k]: e.target.value }));
  const setAdmin = (k) => (e) => setAdminForm(f => ({ ...f, [k]: e.target.value }));

  const { rows, sort, onSort } = useSort(units, {
    name: (u) => u.name,
    type: (u) => officeTypeLabel(u.type),
    city: (u) => u.city,
    users: (u) => Number(u.user_count ?? 0),
    depts: (u) => Number(u.department_count ?? 0),
    status: (u) => u.db_status,
  });

  const activeCount = units.filter(u => u.db_status === 'ACTIVE').length;
  const suspendedCount = units.filter(u => u.db_status === 'SUSPENDED').length;
  const provisioningCount = units.filter(u => !['ACTIVE', 'SUSPENDED'].includes(u.db_status)).length;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Units"
        actions={<button type="button" className="btn-primary" onClick={openCreate}><Plus size={14} /> Create unit</button>}
      />

      <StatStrip cols={4}>
        <Stat label="Units" value={totalCount} loading={loading} />
        <Stat label="Active" value={activeCount} loading={loading} hint="On this page" />
        <Stat label="Deactivated" value={suspendedCount} tone={suspendedCount ? 'danger' : undefined} loading={loading} hint="On this page" />
        <Stat label="Provisioning" value={provisioningCount} tone={provisioningCount ? 'warning' : undefined} loading={loading} hint="On this page" />
      </StatStrip>

      <Toolbar count={loading ? null : totalCount} noun={totalCount === 1 ? 'unit' : 'units'}>
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, code or city" width={260} />
        {search && <button type="button" className="btn-ghost" onClick={() => setSearch('')}>Clear</button>}
      </Toolbar>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <Th sortKey="name" sort={sort} onSort={onSort}>Unit</Th>
              <Th sortKey="type" sort={sort} onSort={onSort}>Type</Th>
              <Th sortKey="city" sort={sort} onSort={onSort}>Location</Th>
              <Th sortKey="users" sort={sort} onSort={onSort} align="right">Users</Th>
              <Th sortKey="depts" sort={sort} onSort={onSort} align="right">Departments</Th>
              <Th sortKey="status" sort={sort} onSort={onSort}>Status</Th>
              <th className="text-right"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows rows={5} cols={7} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="!p-0">
                  <Empty
                    icon={Building2}
                    title={search ? 'No units match this search' : 'No units yet'}
                    hint={search ? 'Try another name, code or city.' : 'Create a unit to give it its own database, users and visitors.'}
                    action={!search && <button type="button" className="btn-outline" onClick={openCreate}><Plus size={14} /> Create unit</button>}
                  />
                </td>
              </tr>
            ) : rows.map(unit => {
              const managing = activeUnit?.id === unit.id;
              return (
                <tr key={unit.id}>
                  <td>
                    <span className="font-medium">{unit.name}</span>
                    <span className="cell-sub mono" title={`Database ${unit.db_name}`}>{unit.code}</span>
                  </td>
                  <td className="text-ink-2">{officeTypeLabel(unit.type)}</td>
                  <td className="text-ink-2">{unit.city ? `${unit.city}${unit.state ? `, ${unit.state}` : ''}` : '—'}</td>
                  <td className="num">{unit.user_count ?? 0}</td>
                  <td className="num">{unit.department_count ?? 0}</td>
                  <td><Status value={unit.db_status} /></td>
                  <td>
                    <div className="flex items-center justify-end gap-1">
                      {unit.db_status === 'ACTIVE' && (managing ? (
                        <Tag tone="success">Managing</Tag>
                      ) : (
                        <button type="button" onClick={() => handleManageUnit(unit)} className="btn-outline btn-sm">Manage</button>
                      ))}
                      {unit.db_status === 'ACTIVE' ? (
                        <button type="button" onClick={() => openStatusChange(unit, 'deactivate')} className="btn-icon"
                          aria-label={`Deactivate ${unit.name}`} title="Deactivate unit">
                          <Power size={14} />
                        </button>
                      ) : unit.db_status === 'SUSPENDED' ? (
                        <button type="button" onClick={() => openStatusChange(unit, 'reactivate')} className="btn-icon"
                          aria-label={`Reactivate ${unit.name}`} title="Reactivate unit">
                          <RotateCcw size={14} />
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!loading && <Pagination page={page} totalPages={totalPages} totalCount={totalCount} onPageChange={(p) => setPage(p)} />}

      {/* Deactivate / reactivate confirmation */}
      {statusChange && (() => {
        const { unit, action } = statusChange;
        const deactivating = action === 'deactivate';
        const codeOk = !deactivating || confirmCode.trim().toUpperCase() === String(unit.code).toUpperCase();
        return (
          <Modal
            open
            onClose={() => setStatusChange(null)}
            busy={changing}
            width={460}
            title={`${deactivating ? 'Deactivate' : 'Reactivate'} ${unit.name}?`}
            footer={(
              <>
                <button type="button" className="btn-outline" onClick={() => setStatusChange(null)} disabled={changing}>Cancel</button>
                <button
                  type="button"
                  className={deactivating ? 'btn-danger' : 'btn-primary'}
                  onClick={handleStatusChange}
                  disabled={changing || !codeOk}
                >
                  {changing && <Loader2 size={14} className="animate-spin" />}
                  {changing ? 'Please wait…' : deactivating ? 'Deactivate unit' : 'Reactivate unit'}
                </button>
              </>
            )}
          >
            {deactivating ? (
              <ul className="space-y-1.5 text-[12.5px] text-ink-2 list-disc pl-5">
                <li>All {unit.user_count ?? 0} user(s) of this unit are signed out and can no longer sign in.</li>
                <li>The unit disappears from the sign-in page and the public visitor form.</li>
                <li><b>Nothing is deleted.</b> Visit records, gate passes and audit logs are kept, and you can reactivate the unit at any time.</li>
              </ul>
            ) : (
              <p className="text-[12.5px] text-ink-2">
                The unit&apos;s users can sign in again, and it reappears on the sign-in page and the public visitor form. All its existing data is still there.
              </p>
            )}

            {deactivating && (
              <Field label={<>Type the unit code <span className="mono text-ink">{unit.code}</span> to confirm</>} htmlFor="confirm-code" className="mt-4">
                <input id="confirm-code" className="control mono uppercase" value={confirmCode} autoFocus
                  onChange={e => setConfirmCode(e.target.value)} placeholder={unit.code} />
              </Field>
            )}
          </Modal>
        );
      })()}

      {/* Create unit */}
      <Drawer
        open={isOpen}
        onClose={close}
        busy={saving}
        width={600}
        icon={Building2}
        title="New unit"
        subtitle="A separate database is provisioned for it automatically."
        footer={(
          <>
            <button type="button" className="btn-outline" onClick={close} disabled={saving}>Cancel</button>
            <button type="button" className="btn-primary" onClick={handleSubmit}
              disabled={saving || (includeAdmin && adminForm.password.length > 0 && !validatePassword(adminForm.password).valid)}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              {saving ? 'Provisioning…' : 'Create unit'}
            </button>
          </>
        )}
      >
        <div className="tile space-y-3">
          <p className="group-heading">Unit</p>
          <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_160px] gap-3">
            <Field label="Unit name" htmlFor="unit-name" required>
              <input id="unit-name" className="control" value={unitForm.name} onChange={setUnit('name')} placeholder="e.g. Head Office" />
            </Field>
            <Field label="Code" htmlFor="unit-code" required hint="Letters, digits, _">
              <input
                id="unit-code"
                className="control mono"
                value={unitForm.code}
                onChange={e => {
                  const code = e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '');
                  setUnitForm(f => ({ ...f, code }));
                  if (!empCodeEdited) setAdminForm(f => ({ ...f, employee_code: defaultAdminCode(code) }));
                }}
                placeholder="HQ"
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Office type" required>
              <Select value={unitForm.type} onChange={setUnit('type')} aria-label="Office type">
                {OFFICE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </Field>
            <Field label="City" htmlFor="unit-city">
              <input id="unit-city" className="control" value={unitForm.city} onChange={setUnit('city')} placeholder="e.g. Bhubaneswar" />
            </Field>
            <Field label="State" htmlFor="unit-state">
              <input id="unit-state" className="control" value={unitForm.state} onChange={setUnit('state')} placeholder="Odisha" />
            </Field>
            <Field label="Phone" htmlFor="unit-phone" hint="WhatsApp number preferred">
              <input id="unit-phone" className="control tabular" value={unitForm.phone} onChange={setUnit('phone')} placeholder="+91 674 123 4567" />
            </Field>
          </div>
          <Field label="Email" htmlFor="unit-email">
            <input id="unit-email" className="control" type="email" value={unitForm.email} onChange={setUnit('email')} placeholder="office@ohpc.co.in" />
          </Field>
        </div>

        <div className="tile mt-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="group-heading">Unit admin account</p>
            <label className="flex items-center gap-2 cursor-pointer select-none text-[12px] text-ink-2">
              <input
                type="checkbox"
                checked={includeAdmin}
                onChange={e => setIncludeAdmin(e.target.checked)}
                className="w-3.5 h-3.5 accent-[var(--primary)]"
              />
              Create an admin
            </label>
          </div>

          {includeAdmin && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Full name" htmlFor="adm-name" required>
                  <input id="adm-name" className="control" value={adminForm.full_name} onChange={setAdmin('full_name')} placeholder="Admin's name" />
                </Field>
                <Field label="Email" htmlFor="adm-email" required>
                  <input id="adm-email" className="control" type="email" value={adminForm.email} onChange={setAdmin('email')} placeholder="admin@ohpc.co.in" />
                </Field>
                <Field label="Phone" htmlFor="adm-phone">
                  <input id="adm-phone" className="control tabular" value={adminForm.phone} onChange={setAdmin('phone')} placeholder="+91 90000 00001" />
                </Field>
                <Field label="Employee code" htmlFor="adm-code" required>
                  <input id="adm-code" className="control mono" value={adminForm.employee_code}
                    onChange={e => {
                      const value = e.target.value;
                      setAdminForm(f => ({ ...f, employee_code: value }));
                      setEmpCodeEdited(value.trim() !== '');   // cleared → follow the unit code again
                    }}
                    placeholder={defaultAdminCode(unitForm.code) || 'HQ-ADM-001'} required={includeAdmin} />
                </Field>
              </div>
              <div>
                <Field label="Password" htmlFor="adm-pw" required>
                  <input id="adm-pw" className="control" type="password" value={adminForm.password} onChange={setAdmin('password')}
                    placeholder="At least 8 characters" autoComplete="new-password" />
                </Field>
                <PasswordStrength password={adminForm.password} />
              </div>
              <Note tone="info" icon={Info}>
                Created as the unit admin in the new unit. They can manage its users and departments.
              </Note>
            </>
          )}
        </div>
      </Drawer>
    </div>
  );
}
