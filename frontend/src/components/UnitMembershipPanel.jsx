// frontend/src/components/UnitMembershipPanel.jsx
// A super admin's unit membership: join one unit as an employee (host) to create visit
// requests, host visitors and approve visits there — or leave it. Used on the
// "Join a unit" page (/my/unit) and on My profile.
import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Building2, Loader2, LogOut } from './icons';
import apiClient from '../api/axios';
import useAuth from '../hooks/useAuth';
import { useSocket } from '../context/SocketContext';
import { getApiErrorMessage } from '../utils/apiError';
import { SectionTitle, Field, Note } from './ui';
import Select from './Select';

export default function UnitMembershipPanel({ showTitle = true }) {
  const { activeUnit, setActiveUnit, refreshUnitProfile } = useAuth();
  const { socket } = useSocket();   // re-joins the profile's live updates after a change
  const [unitProfile, setUnitProfile] = useState(null);
  const [units,       setUnits]       = useState([]);
  const [unitId,      setUnitId]      = useState('');
  const [deptId,      setDeptId]      = useState('');
  const [depts,       setDepts]       = useState([]);
  const [deptsLoading, setDeptsLoading] = useState(false);
  const [saving,      setSaving]      = useState(false);

  useEffect(() => {
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
          setUnitId(String(profile.unit_id));
          setDeptId(String(profile.department_id || ''));
        }
      } catch {
        toast.error('Failed to load unit membership.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!unitId) { setDepts([]); return undefined; }
    let cancelled = false;
    setDeptsLoading(true);
    apiClient.get('/departments/public', { params: { unit_id: unitId } })
      .then(res => { if (!cancelled) setDepts(res.data?.data ?? []); })
      .catch(() => { if (!cancelled) setDepts([]); })
      .finally(() => { if (!cancelled) setDeptsLoading(false); });
    return () => { cancelled = true; };
  }, [unitId]);

  const save = async () => {
    if (!unitId) return toast.error('Select a unit.');
    if (!deptId) return toast.error('Select a department.');
    setSaving(true);
    try {
      const res = await apiClient.put('/central-users/me/unit-profile', {
        unit_id: parseInt(unitId, 10),
        department_id: parseInt(deptId, 10),
      });
      setUnitProfile(res.data?.data ?? null);
      await refreshUnitProfile();   // the sidebar's Visits and the dashboard follow at once
      socket?.emit('rooms:refresh');
      toast.success('Unit membership saved. Your visits are now under Visits in the sidebar.');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to save unit membership.'));
    } finally {
      setSaving(false);
    }
  };

  const leave = async () => {
    setSaving(true);
    try {
      const leavingUnitId = unitProfile?.unit_id;
      await apiClient.delete('/central-users/me/unit-profile');
      setUnitProfile(null);
      setUnitId('');
      setDeptId('');
      setDepts([]);
      // Leaving the unit also ends that managed-unit view
      if (leavingUnitId && String(activeUnit?.id) === String(leavingUnitId)) setActiveUnit(null);
      await refreshUnitProfile();
      socket?.emit('rooms:refresh');
      toast.success('Unit membership removed.');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to remove unit membership.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {showTitle && <SectionTitle icon={Building2} title="Unit membership" meta="Work as an employee and host visits" />}
      <div className="tile space-y-3">
        {unitProfile ? (
          <Note tone="success">
            Joined <b>{unitProfile.unit_name}</b>
            {unitProfile.department_name ? <> · <b>{unitProfile.department_name}</b></> : null}
            {unitProfile.employee_code ? <span className="text-muted"> · {unitProfile.employee_code}</span> : null}
          </Note>
        ) : (
          <Note tone="info">
            Join a unit as an employee to create visit requests, host visitors and approve visits — they then
            appear under <b>Visits</b> in the sidebar and on your dashboard.
          </Note>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Unit" htmlFor="membership-unit">
            <Select searchable id="membership-unit" value={unitId}
              onChange={e => { setUnitId(e.target.value); setDeptId(''); }} aria-label="Unit">
              <option value="">Select unit</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}
            </Select>
          </Field>

          <Field label="Department" htmlFor="membership-dept" required>
            <Select searchable id="membership-dept" value={deptId}
              onChange={e => setDeptId(e.target.value)}
              disabled={!unitId || depts.length === 0} aria-label="Department">
              <option value="">
                {!unitId ? 'Select a unit first'
                  : deptsLoading ? 'Loading…'
                  : depts.length === 0 ? 'No departments in this unit'
                  : 'Select department'}
              </option>
              {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>

          <Field label="Role">
            <div className="control flex items-center bg-surface-alt text-ink-2">Employee (host)</div>
          </Field>
        </div>

        {unitId && !deptsLoading && depts.length === 0 && (
          <Note tone="warning">
            This unit has no departments yet. A unit admin must create a department before you can join as an employee.
          </Note>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button type="button" className="btn-primary" onClick={save}
            disabled={saving || !unitId || !deptId || depts.length === 0}>
            {saving && <Loader2 size={14} className="animate-spin" />}
            {unitProfile ? 'Update membership' : 'Join unit as employee'}
          </button>
          {unitProfile && (
            <button type="button" className="btn-outline" onClick={leave} disabled={saving}>
              <LogOut size={14} /> Leave unit
            </button>
          )}
        </div>
      </div>
    </>
  );
}
