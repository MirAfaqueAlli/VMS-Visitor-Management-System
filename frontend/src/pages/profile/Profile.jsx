// frontend/src/pages/profile/Profile.jsx
// My profile (DESIGN_RULES §11/§12): details tile on the left, change-password
// form on the right with its action below a hairline.
import { useState, useEffect } from 'react';
import { User, Lock, Eye, EyeOff, Loader2, Bell, Building2, LogOut } from '../../components/icons';
import PushSetting from '../../components/PushSetting';
import { toast } from 'react-hot-toast';
import apiClient from '../../api/axios';
import useAuth from '../../hooks/useAuth';
import PasswordStrength from '../../components/PasswordStrength';
import { validatePassword } from '../../utils/passwordValidator';
import { getApiErrorMessage } from '../../utils/apiError';
import { PageHeader, SectionTitle, KV, Tag, Field, Spinner, Note } from '../../components/ui';
import Select from '../../components/Select';
import { initials as toInitials, orDash } from '../../lib/format';

const PasswordInput = ({ label, value, onChange, show, onToggle, id, invalid, error, autoComplete = 'new-password' }) => (
  <Field label={label} htmlFor={id} error={error}>
    <div className="relative">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`control pr-9${invalid ? ' is-invalid' : ''}`}
        autoComplete={autoComplete}
      />
      <button
        type="button"
        onClick={onToggle}
        className="absolute right-1 top-1/2 -translate-y-1/2 btn-icon !w-7 !min-h-0 h-7"
        aria-label={show ? 'Hide password' : 'Show password'}
        title={show ? 'Hide password' : 'Show password'}
        tabIndex={-1}
      >
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  </Field>
);

export default function Profile() {
  const { user, activeUnit, setActiveUnit } = useAuth();

  const [profileData, setProfileData] = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [pwLoading, setPwLoading] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword,     setNewPassword]     = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew,     setShowNew]     = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Super admin: join a unit as an employee/host
  const isSuperAdmin = (user?.role_type || user?.role) === 'super_admin';
  const [unitProfile,       setUnitProfile]       = useState(null);
  const [units,             setUnits]             = useState([]);
  const [membershipUnitId,  setMembershipUnitId]  = useState('');
  const [membershipDeptId,  setMembershipDeptId]  = useState('');
  const [membershipDepts,   setMembershipDepts]   = useState([]);
  const [deptsLoading,      setDeptsLoading]      = useState(false);
  const [membershipSaving,  setMembershipSaving]  = useState(false);

  useEffect(() => {
    if (!isSuperAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const [unitsRes, profileRes] = await Promise.all([
          apiClient.get('/units', { params: { limit: 100 } }),
          apiClient.get('/central-users/me/unit-profile'),
        ]);
        if (cancelled) return;
        const list = unitsRes.data?.data?.units ?? [];
        setUnits(list.filter(u => u.is_active && u.db_status === 'ACTIVE'));
        const profile = profileRes.data?.data ?? null;
        setUnitProfile(profile);
        if (profile) {
          setMembershipUnitId(String(profile.unit_id));
          setMembershipDeptId(String(profile.department_id || ''));
        }
      } catch {
        toast.error('Failed to load unit membership.');
      }
    })();
    return () => { cancelled = true; };
  }, [isSuperAdmin]);

  useEffect(() => {
    if (!isSuperAdmin || !membershipUnitId) { setMembershipDepts([]); return; }
    let cancelled = false;
    setDeptsLoading(true);
    apiClient.get('/departments/public', { params: { unit_id: membershipUnitId } })
      .then(res => { if (!cancelled) setMembershipDepts(res.data?.data ?? []); })
      .catch(() => { if (!cancelled) setMembershipDepts([]); })
      .finally(() => { if (!cancelled) setDeptsLoading(false); });
    return () => { cancelled = true; };
  }, [isSuperAdmin, membershipUnitId]);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await apiClient.get('/auth/me');
        setProfileData(res.data?.data ?? res.data);
      } catch {
        toast.error('Failed to load profile.');
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, []);

  const handlePasswordChange = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      return toast.error('Please fill in all password fields.');
    }
    if (newPassword !== confirmPassword) {
      return toast.error('New passwords do not match.');
    }
    const { valid: pwValid } = validatePassword(newPassword);
    if (!pwValid) {
      return toast.error('New password does not meet the strength requirements.');
    }
    setPwLoading(true);
    try {
      const res = await apiClient.put('/auth/change-password', { currentPassword, newPassword });
      // Changing the password signs out all older sessions — keep this one on the fresh token
      const freshToken = res.data?.data?.token;
      if (freshToken) localStorage.setItem('vms_token', freshToken);
      toast.success('Password updated successfully.');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to update password.'));
    } finally {
      setPwLoading(false);
    }
  };

  const data  = profileData ?? user ?? {};
  const roleLabel = data.role_type ? data.role_type.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()) : null;
  const mismatch  = !!confirmPassword && newPassword !== confirmPassword;

  const saveMembership = async () => {
    if (!membershipUnitId) return toast.error('Select a unit.');
    if (!membershipDeptId) return toast.error('Select a department.');
    setMembershipSaving(true);
    try {
      const res = await apiClient.put('/central-users/me/unit-profile', {
        unit_id: parseInt(membershipUnitId, 10),
        department_id: parseInt(membershipDeptId, 10),
      });
      setUnitProfile(res.data?.data ?? null);
      toast.success('Unit membership saved. You can now host visits in that unit.');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to save unit membership.'));
    } finally {
      setMembershipSaving(false);
    }
  };

  const removeMembership = async () => {
    setMembershipSaving(true);
    try {
      const leavingUnitId = unitProfile?.unit_id;
      await apiClient.delete('/central-users/me/unit-profile');
      setUnitProfile(null);
      setMembershipUnitId('');
      setMembershipDeptId('');
      setMembershipDepts([]);
      // Leaving the unit also ends that managed-unit view.
      if (leavingUnitId && String(activeUnit?.id) === String(leavingUnitId)) {
        setActiveUnit(null);
      }
      toast.success('Unit membership removed.');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to remove unit membership.'));
    } finally {
      setMembershipSaving(false);
    }
  };

  if (loading) return <><PageHeader title="My profile" /><Spinner label="Loading your profile…" /></>;

  return (
    <div className="animate-fade-in">
      <PageHeader title="My profile" />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-10 gap-y-8 items-start max-w-[1100px]">
        {/* Details */}
        <section>
          <SectionTitle icon={User} title="Details" />
          <div className="tile">
            <div className="flex items-center gap-3 mb-4">
              <span className="avatar !w-10 !h-10 !text-[14px]">{toInitials(data.full_name) || '?'}</span>
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-ink truncate">{data.full_name}</p>
                <p className="text-[12px] text-muted truncate">{data.designation || 'No designation'}</p>
              </div>
              {roleLabel && <span className="ml-auto"><Tag tone="brand">{roleLabel}</Tag></span>}
            </div>
            <KV items={[
              ['Email', orDash(data.email)],
              ['Phone', <span key="p" className="tabular">{orDash(data.phone)}</span>],
              ['Employee code', <span key="c" className="mono">{orDash(data.employee_code)}</span>],
              ['Department', orDash(data.department_name)],
              ['Organisation', orDash(data.organization_name)],
            ]} />
          </div>

          <div className="mt-8">
            <SectionTitle icon={Bell} title="Notifications" meta="This device" />
            <PushSetting variant="tile" />
          </div>
        </section>

        {/* Change password */}
        <section>
          <SectionTitle icon={Lock} title="Change password" />
          <form
            className="space-y-3 max-w-[420px]"
            onSubmit={e => { e.preventDefault(); handlePasswordChange(); }}
          >
            <PasswordInput
              id="current-pw"
              label="Current password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={setCurrentPassword}
              show={showCurrent}
              onToggle={() => setShowCurrent(p => !p)}
            />
            <div>
              <PasswordInput
                id="new-pw"
                label="New password"
                value={newPassword}
                onChange={setNewPassword}
                show={showNew}
                onToggle={() => setShowNew(p => !p)}
              />
              <PasswordStrength password={newPassword} />
            </div>
            <PasswordInput
              id="confirm-pw"
              label="Confirm new password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              show={showConfirm}
              onToggle={() => setShowConfirm(p => !p)}
              invalid={mismatch}
              error={mismatch ? 'The passwords do not match.' : ''}
            />

            <div className="pt-4 border-t border-line">
              <button
                id="update-password-btn"
                type="submit"
                className="btn-primary"
                disabled={pwLoading || !validatePassword(newPassword).valid}
              >
                {pwLoading && <Loader2 size={14} className="animate-spin" />}
                {pwLoading ? 'Updating…' : 'Update password'}
              </button>
            </div>
          </form>
        </section>
      </div>

      {isSuperAdmin && (
        <section className="mt-10 max-w-[760px]">
          <SectionTitle icon={Building2} title="Unit membership" meta="Work as an employee and host visits" />
          <div className="tile space-y-3">
            {unitProfile && (
              <Note tone="success">
                Joined <b>{unitProfile.unit_name}</b>
                {unitProfile.department_name ? <> · <b>{unitProfile.department_name}</b></> : null}
                {unitProfile.employee_code ? <span className="text-muted"> · {unitProfile.employee_code}</span> : null}
              </Note>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Unit" htmlFor="membership-unit">
                <Select searchable id="membership-unit" value={membershipUnitId}
                  onChange={e => { setMembershipUnitId(e.target.value); setMembershipDeptId(''); }}
                  aria-label="Unit">
                  <option value="">Select unit</option>
                  {units.map(u => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}
                </Select>
              </Field>

              <Field label="Department" htmlFor="membership-dept" required>
                <Select searchable id="membership-dept" value={membershipDeptId}
                  onChange={e => setMembershipDeptId(e.target.value)}
                  disabled={!membershipUnitId || membershipDepts.length === 0}
                  aria-label="Department">
                  <option value="">
                    {!membershipUnitId ? 'Select a unit first'
                      : deptsLoading ? 'Loading…'
                      : membershipDepts.length === 0 ? 'No departments in this unit'
                      : 'Select department'}
                  </option>
                  {membershipDepts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Select>
              </Field>

              <Field label="Role">
                <div className="control flex items-center bg-surface-alt text-ink-2">Employee (host)</div>
              </Field>
            </div>

            {membershipUnitId && !deptsLoading && membershipDepts.length === 0 && (
              <Note tone="warning">
                This unit has no departments yet. A unit admin must create a department before you can join as an employee.
              </Note>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button type="button" className="btn-primary" onClick={saveMembership}
                disabled={membershipSaving || !membershipUnitId || !membershipDeptId || membershipDepts.length === 0}>
                {membershipSaving && <Loader2 size={14} className="animate-spin" />}
                {unitProfile ? 'Update membership' : 'Join unit as employee'}
              </button>
              {unitProfile && (
                <button type="button" className="btn-outline" onClick={removeMembership} disabled={membershipSaving}>
                  <LogOut size={14} /> Leave unit
                </button>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
