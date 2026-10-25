// frontend/src/pages/visitors/VisitorDetail.jsx
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CreditCard, Check, Clock, AlertTriangle, Phone, Mail, Calendar, ShieldOff, ShieldCheck } from 'lucide-react';
import { toast } from 'react-hot-toast';
import apiClient from '../../api/axios';
import useAuth from '../../hooks/useAuth';
import StatusBadge from '../../components/shared/StatusBadge';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function Spinner() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="w-7 h-7 rounded-full border-2 animate-spin"
        style={{ borderColor: 'var(--color-border)', borderTopColor: 'var(--color-accent)' }} />
    </div>
  );
}

export default function VisitorDetail() {
  const { id }      = useParams();
  const navigate    = useNavigate();
  const { user }    = useAuth();
  const [visitor,   setVisitor]   = useState(null);
  const [history,   setHistory]   = useState([]);
  const [loading,   setLoading]   = useState(true);

  // Debar / lift-debarment modal (unit_admin only — the API enforces the same)
  const canDebar = (user?.role_type || user?.role) === 'unit_admin';
  const [debarMode,   setDebarMode]   = useState(null); // null | 'debar' | 'lift'
  const [debarReason, setDebarReason] = useState('');
  const [debarBusy,   setDebarBusy]   = useState(false);

  const fetchVisitor = useCallback(async () => {
    setLoading(true);
    try {
      // The visitor endpoint returns this visitor's own visit history (last 20)
      const visRes = await apiClient.get(`/visitors/${id}`);
      const data   = visRes.data?.data ?? visRes.data;
      setVisitor(data);
      setHistory(data?.visit_history ?? []);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to load visitor.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchVisitor(); }, [fetchVisitor]);

  const submitDebar = async () => {
    if (debarMode === 'debar' && !debarReason.trim()) { toast.error('Please enter a reason.'); return; }
    setDebarBusy(true);
    try {
      if (debarMode === 'debar') {
        await apiClient.post(`/visitors/${id}/blacklist`, { reason: debarReason.trim() });
        toast.success('Visitor debarred. Future visits will be denied.');
      } else {
        await apiClient.put(`/visitors/${id}/blacklist/lift`, { lift_reason: debarReason.trim() || null });
        toast.success('Debarment lifted.');
      }
      setDebarMode(null);
      setDebarReason('');
      fetchVisitor();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Action failed.');
    } finally {
      setDebarBusy(false);
    }
  };

  if (loading) return <Spinner />;
  if (!visitor) return (
    <div className="text-center py-20" style={{ color: 'var(--color-text-faint)' }}>
      Visitor not found.
    </div>
  );

  const initials = visitor.full_name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) ?? '?';
  const idProofs = visitor.id_proofs ?? [];

  return (
    <div className="space-y-5 animate-fade-in">
      {/* ── Back ───────────────────────────────────────────────────────── */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-[12px] transition-colors"
        style={{ color: 'var(--color-text-faint)' }}
        onMouseEnter={e => e.currentTarget.style.color = 'var(--color-accent)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-faint)'}
      >
        <ArrowLeft size={14} /> Back to Visitors
      </button>

      {/* ── Main layout ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* ── Left: Profile card ─────────────────────────────────────── */}
        <div className="vms-card p-5 flex flex-col items-center text-center">
          {/* Avatar */}
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold mb-3 shrink-0"
            style={{ background: 'var(--color-mixed-bg)', color: 'var(--color-mixed)' }}
          >
            {initials}
          </div>
          <p className="font-semibold text-[15px]" style={{ color: 'var(--color-text)' }}>
            {visitor.full_name}
          </p>
          <div className="mt-1.5">
            <StatusBadge status={visitor.visitor_type} />
          </div>

          {/* Blacklist warning */}
          {visitor.blacklisted && (
            <div
              className="mt-4 w-full px-3 py-2.5 flex items-start gap-2 text-left text-[12px] font-medium"
              style={{
                background: 'var(--color-danger-bg)',
                border: '1px solid #fecaca',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-error)',
              }}
            >
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <div>
                <p>Debarred visitor</p>
                {visitor.blacklist_details?.reason && (
                  <p className="font-normal mt-0.5 opacity-80">{visitor.blacklist_details.reason}</p>
                )}
              </div>
            </div>
          )}

          {/* Debar / lift (unit admin) */}
          {canDebar && (
            <button
              type="button"
              onClick={() => { setDebarReason(''); setDebarMode(visitor.blacklisted ? 'lift' : 'debar'); }}
              className={`mt-3 w-full flex items-center justify-center gap-1.5 text-[12px] ${visitor.blacklisted ? 'btn-secondary' : 'btn-primary'}`}
            >
              {visitor.blacklisted
                ? <><ShieldCheck size={13} /> Lift Debarment</>
                : <><ShieldOff size={13} /> Debar Visitor</>}
            </button>
          )}

          {/* Details list */}
          <div className="mt-5 w-full space-y-3">
            {[
              [Phone,    'Phone',      visitor.phone],
              [Mail,     'Email',      visitor.email],
              [Calendar, 'Registered', fmtDate(visitor.created_at)],
            ].map(([Icon, label, value]) => (
              <div key={label} className="flex items-center justify-between gap-2 text-[12px]">
                <span className="flex items-center gap-1.5" style={{ color: 'var(--color-text-faint)' }}>
                  <Icon size={12} /> {label}
                </span>
                <span className="font-medium text-right truncate max-w-[160px]"
                      style={{ color: 'var(--color-text)' }}>
                  {value || '—'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Right: two stacked cards ────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-5">

          {/* ── ID Documents ──────────────────────────────────────────── */}
          <div className="vms-card overflow-hidden">
            <div className="px-5 py-4 flex items-center gap-2"
                 style={{ borderBottom: '1px solid var(--color-border)' }}>
              <CreditCard size={15} style={{ color: 'var(--color-accent)' }} />
              <h3 className="font-semibold text-[13px]" style={{ color: 'var(--color-text)' }}>
                ID Documents
              </h3>
              <span className="ml-auto text-[11px]" style={{ color: 'var(--color-text-faint)' }}>
                {idProofs.length} document{idProofs.length !== 1 ? 's' : ''}
              </span>
            </div>
            {idProofs.length === 0 ? (
              <p className="text-center py-8 text-[12px]" style={{ color: 'var(--color-text-faint)' }}>
                No ID documents recorded
              </p>
            ) : (
              <table className="vms-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Number</th>
                    <th>Primary</th>
                  </tr>
                </thead>
                <tbody>
                  {idProofs.map((doc, i) => (
                    <tr key={doc.id ?? i}>
                      <td><StatusBadge status={doc.id_type} /></td>
                      <td className="font-mono text-[12px]">{doc.id_number}</td>
                      <td>
                        {doc.is_primary
                          ? <Check size={14} style={{ color: 'var(--color-success)' }} />
                          : <span style={{ color: 'var(--color-text-faint)' }}>—</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* ── Visit History ─────────────────────────────────────────── */}
          <div className="vms-card overflow-hidden">
            <div className="px-5 py-4 flex items-center gap-2"
                 style={{ borderBottom: '1px solid var(--color-border)' }}>
              <Clock size={15} style={{ color: 'var(--color-accent)' }} />
              <h3 className="font-semibold text-[13px]" style={{ color: 'var(--color-text)' }}>
                Visit History
              </h3>
              <span className="ml-auto text-[11px]" style={{ color: 'var(--color-text-faint)' }}>
                Last {history.length} visit{history.length !== 1 ? 's' : ''}
              </span>
            </div>
            {history.length === 0 ? (
              <p className="text-center py-8 text-[12px]" style={{ color: 'var(--color-text-faint)' }}>
                No visit history found
              </p>
            ) : (
              <table className="vms-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Category</th>
                    <th>Host</th>
                    <th>Department</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((v, i) => (
                    <tr key={v.id ?? i}
                        className="cursor-pointer"
                        onClick={() => navigate(`/requests/${v.id}`)}>
                      <td className="whitespace-nowrap">{fmtDate(v.visit_date)}</td>
                      <td><StatusBadge status={v.visit_category || v.visitor_type_code || v.visitor_type} /></td>
                      <td className="whitespace-nowrap">{v.host_name ?? '—'}</td>
                      <td className="whitespace-nowrap">{v.department_name ?? '—'}</td>
                      <td><StatusBadge status={v.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

        </div>
      </div>

      {/* ── Debar / lift modal ─────────────────────────────────────────── */}
      {debarMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
          <div className="vms-card w-full max-w-md p-6 space-y-4">
            <h3 className="font-semibold text-[15px]" style={{ color: 'var(--color-text)' }}>
              {debarMode === 'debar' ? `Debar ${visitor.full_name}?` : `Lift debarment for ${visitor.full_name}?`}
            </h3>
            <p className="text-[12px]" style={{ color: 'var(--color-text-faint)' }}>
              {debarMode === 'debar'
                ? 'New visit requests and gate entry for this visitor will be refused in this unit until the debarment is lifted.'
                : 'The visitor will be able to request visits again.'}
            </p>
            <textarea
              rows={3}
              value={debarReason}
              onChange={e => setDebarReason(e.target.value)}
              placeholder={debarMode === 'debar' ? 'Reason (required)' : 'Reason for lifting (optional)'}
              className="w-full px-3 py-2 rounded-lg text-sm border border-subtle bg-bg-primary text-loud focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary text-sm" onClick={() => setDebarMode(null)} disabled={debarBusy}>
                Cancel
              </button>
              <button type="button" className="btn-primary text-sm" onClick={submitDebar} disabled={debarBusy}>
                {debarBusy ? 'Saving…' : debarMode === 'debar' ? 'Debar Visitor' : 'Lift Debarment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
