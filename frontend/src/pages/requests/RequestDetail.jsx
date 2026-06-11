// frontend/src/pages/requests/RequestDetail.jsx
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, User, Building2, Calendar, Clock, QrCode, Users, Check, X, ShieldOff, Shield, AlertTriangle } from 'lucide-react';
import { toast } from 'react-hot-toast';
import apiClient from '../../api/axios';
import useAuth from '../../hooks/useAuth';
import StatusBadge from '../../components/shared/StatusBadge';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
}

function Spinner() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="w-7 h-7 rounded-full border-2 animate-spin"
        style={{ borderColor: 'var(--color-border)', borderTopColor: 'var(--color-accent)' }} />
    </div>
  );
}

const TIMELINE_COLORS = {
  SUBMITTED:   { bg: '#3b82f6', text: '#fff' },
  PENDING:     { bg: '#f59e0b', text: '#fff' },
  APPROVED:    { bg: '#16a34a', text: '#fff' },
  REJECTED:    { bg: '#dc2626', text: '#fff' },
  CANCELLED:   { bg: '#94a3b8', text: '#fff' },
  CHECK_IN:    { bg: '#8b5cf6', text: '#fff' },
  CHECK_OUT:   { bg: '#0891b2', text: '#fff' },
  COMPLETED:   { bg: '#059669', text: '#fff' },
};

function buildTimeline(request) {
  const events = [];
  events.push({
    action:        'SUBMITTED',
    acted_by_name: request.visitor_name ?? request.requester_name ?? 'Visitor',
    created_at:    request.created_at,
    remarks:       null,
  });
  if (Array.isArray(request.approval_history)) {
    request.approval_history.forEach(e => events.push(e));
  }
  if (request.checked_in_at || request.status === 'CHECKED_IN') {
    events.push({
      action:        'CHECK_IN',
      acted_by_name: request.checked_in_by_name ?? 'Security',
      created_at:    request.checked_in_at ?? null,
      remarks:       null,
    });
  }
  if (request.checked_out_at || request.status === 'CHECKED_OUT' || request.status === 'COMPLETED') {
    events.push({
      action:        request.status === 'COMPLETED' ? 'COMPLETED' : 'CHECK_OUT',
      acted_by_name: request.checked_out_by_name ?? 'Security',
      created_at:    request.checked_out_at ?? null,
      remarks:       null,
    });
  }
  events.sort((a, b) => {
    if (!a.created_at) return 1;
    if (!b.created_at) return -1;
    return new Date(a.created_at) - new Date(b.created_at);
  });
  return events;
}

// ── Generic in-app confirm modal ──────────────────────────────────────────────
function ConfirmModal({ open, onClose, onConfirm, loading, icon, iconBg, iconColor, title, description, confirmLabel, confirmStyle }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !loading && onClose()} />
      <div
        className="relative z-10 w-full max-w-sm rounded-xl p-6 space-y-4 animate-fade-in"
        style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: iconBg }}>
            {icon}
          </div>
          <div>
            <h3 className="text-[15px] font-bold" style={{ color: 'var(--color-text)' }}>{title}</h3>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--color-text-faint)' }}>{description}</p>
          </div>
        </div>
        <div className="flex gap-2 justify-end pt-1">
          <button className="btn-secondary text-[12px]" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            className="btn-primary text-[12px]"
            style={confirmStyle}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? 'Please wait…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Approval conflict modal ───────────────────────────────────────────────────
function ApprovalConflictModal({ conflict, remarks, onClose, onForceApprove, loading }) {
  if (!conflict) return null;
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !loading && onClose()} />
      <div
        className="relative z-10 w-full max-w-md rounded-xl overflow-hidden animate-fade-in"
        style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', boxShadow: '0 24px 60px rgba(0,0,0,0.35)' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-5 pb-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: '#fef3c7' }}>
              <AlertTriangle size={18} style={{ color: '#d97706' }} strokeWidth={2} />
            </div>
            <div>
              <h3 className="font-bold text-[15px]" style={{ color: 'var(--color-text)' }}>Schedule Conflict Detected</h3>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-faint)' }}>Approving this request may cause an overlap</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-black/5 transition-colors"
            style={{ color: 'var(--color-text-faint)' }}
          >
            <X size={15} />
          </button>
        </div>

        {/* Conflict detail */}
        <div className="px-6 py-4 space-y-3">
          <div
            className="rounded-lg px-4 py-3 space-y-1"
            style={{ background: '#fff7ed', border: '1px solid #fed7aa' }}
          >
            <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#c2410c' }}>
              🔴 Host already has an approved visit
            </p>
            <p className="text-[13px]" style={{ color: '#9a3412' }}>
              <strong>{conflict.visitor_name}</strong> is already scheduled to visit the host during{' '}
              <strong>{conflict.time_window}</strong>.
            </p>
          </div>
          <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
            You can go back and adjust, or approve anyway — the request will be flagged with a ⚠ badge for reference.
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4" style={{ borderTop: '1px solid var(--color-border)' }}>
          <button
            onClick={onClose}
            disabled={loading}
            className="btn-secondary text-[12px] px-4 py-2"
          >
            Go Back
          </button>
          <button
            onClick={onForceApprove}
            disabled={loading}
            className="btn-primary text-[12px] px-4 py-2 flex items-center gap-1.5 disabled:opacity-60"
          >
            <AlertTriangle size={13} strokeWidth={2} />
            {loading ? 'Approving…' : 'Approve Anyway'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function RequestDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [request, setRequest]           = useState(null);
  const [loading, setLoading]           = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [remarks, setRemarks]           = useState('');
  const [actionMode, setActionMode]     = useState(null); // null | 'approve' | 'reject'

  // Block modal state
  const [blockModal, setBlockModal]     = useState(false);
  const [blockReason, setBlockReason]   = useState('');
  const [blocking, setBlocking]         = useState(false);

  // Unblock confirm modal state (replaces window.confirm)
  const [unblockModal, setUnblockModal] = useState(false);
  const [unblocking, setUnblocking]     = useState(false);

  // Approval conflict modal state
  const [approvalConflict, setApprovalConflict] = useState(null); // null | { visitor_name, time_window }

  const fetchRequest = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get(`/visit-requests/${id}`);
      setRequest(res.data?.data ?? res.data);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to load request.');
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { fetchRequest(); }, [fetchRequest]);

  // ── Cancel ─────────────────────────────────────────────────────────────────
  const handleCancel = async () => {
    if (!window.confirm('Cancel this visit request?')) return;
    setActionLoading(true);
    try {
      await apiClient.put(`/visit-requests/${id}/cancel`);
      toast.success('Request cancelled.'); fetchRequest();
    } catch (err) { toast.error(err?.response?.data?.message || 'Failed.'); }
    finally { setActionLoading(false); }
  };

  // ── Approve / Reject ───────────────────────────────────────────────────────
  const submitAction = async (type, forceApprove = false) => {
    setActionLoading(true);
    try {
      if (type === 'approve') {
        await apiClient.put(`/approvals/${id}/approve`, { remarks, force_approve: forceApprove || undefined });
        toast.success('Approved.');
        setApprovalConflict(null);
      } else {
        await apiClient.put(`/approvals/${id}/reject`, { remarks });
        toast.success('Rejected.');
      }
      setActionMode(null);
      setRemarks('');
      fetchRequest();
    } catch (err) {
      const data = err?.response?.data;
      // Schedule conflict returned from approval endpoint
      if (err?.response?.status === 409 && data?.conflict && type === 'approve') {
        setApprovalConflict(data.host_conflict); // { visitor_name, time_window, clashing_request_id }
        return; // Don't toast — the modal handles it
      }
      toast.error(data?.message || 'Failed.');
    } finally { setActionLoading(false); }
  };

  // Force-approve after conflict acknowledgment
  const handleForceApprove = async () => {
    await submitAction('approve', true);
  };

  // ── Block visitor ──────────────────────────────────────────────────────────
  const handleBlockVisitor = async () => {
    if (!blockReason.trim()) { toast.error('Please enter a reason.'); return; }
    setBlocking(true);
    try {
      await apiClient.post(`/visit-requests/${id}/blacklist-visitor`, { reason: blockReason.trim() });
      toast.success('Visitor blocked. Future requests will be declined automatically.');
      setBlockModal(false);
      setBlockReason('');
      fetchRequest();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to block visitor.');
    } finally { setBlocking(false); }
  };

  // ── Unblock visitor (in-app modal, no window.confirm) ─────────────────────
  const handleUnblockVisitor = async () => {
    setUnblocking(true);
    try {
      await apiClient.delete(`/visit-requests/blocked-visitors/${request.host_block_id}`);
      toast.success('Visitor unblocked successfully.');
      setUnblockModal(false);
      fetchRequest();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to unblock visitor.');
    } finally { setUnblocking(false); }
  };

  // ─────────────────────────────────────────────────────────────────────────
  if (loading) return <Spinner />;
  if (!request) return <div className="text-center py-20" style={{ color: 'var(--color-text-faint)' }}>Request not found.</div>;

  const isHost     = String(request.host_user_id) === String(user?.id);
  const isAdmin    = ['super_admin', 'unit_admin'].includes(user?.role_type);
  const canApprove = (isHost || isAdmin) && request.status === 'PENDING';
  const isBlocked  = !!request.host_block_id;
  const canBlock   = (isHost || isAdmin) && !!request.visitor_phone;
  const companions = request.companions ?? [];
  const timeline   = buildTimeline(request);

  const apiBase = (import.meta.env.VITE_API_URL ?? '').replace(/\/api\/?$/, '');
  const qrSrc   = request.qr_code_path ? `${apiBase}/${request.qr_code_path}` : null;

  return (
    <div className="space-y-5 animate-fade-in">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <button onClick={() => navigate(-1)}
            className="flex items-center gap-1.5 text-[12px] mb-2"
            style={{ color: 'var(--color-text-faint)' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--color-accent)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-faint)'}>
            <ArrowLeft size={13} /> Back to Requests
          </button>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-[16px] font-bold" style={{ color: 'var(--color-text)' }}>Request #{request.id}</h1>
            <StatusBadge status={request.status} />
            <StatusBadge status={request.visit_category} />
            {(request.force_created === 1 || request.force_created === true) && (
              <span
                className="text-[10px] px-2 py-0.5 rounded font-medium"
                style={{ background: '#fef3c7', color: '#92400e' }}
              >
                ⚠ Created with conflict
              </span>
            )}
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          {request.status === 'APPROVED' && request.pass_number && (
            <button className="btn-primary" onClick={() => navigate(`/gate/pass/${request.pass_number}`)}>
              <QrCode size={14} /> Gate Pass
            </button>
          )}
          {['PENDING','APPROVED'].includes(request.status) && (
            <button className="btn-secondary" onClick={handleCancel} disabled={actionLoading}>Cancel</button>
          )}
          {canApprove && !actionMode && (
            <>
              <button className="btn-primary" onClick={() => setActionMode('approve')}><Check size={14}/> Approve</button>
              <button className="btn-secondary" onClick={() => setActionMode('reject')}
                style={{ borderColor: 'var(--color-error)', color: 'var(--color-error)' }}><X size={14}/> Reject</button>
            </>
          )}
          {/* Block / Unblock toggle */}
          {canBlock && !isBlocked && (
            <button
              className="btn-secondary"
              onClick={() => { setBlockModal(true); setBlockReason(''); }}
              style={{ borderColor: '#dc2626', color: '#dc2626' }}
              title="Block this visitor — their future requests to you will be automatically declined"
            >
              <ShieldOff size={14} /> Block Visitor
            </button>
          )}
          {canBlock && isBlocked && (
            <button
              className="btn-secondary"
              onClick={() => setUnblockModal(true)}
              style={{ borderColor: '#16a34a', color: '#16a34a' }}
              title="Unblock this visitor — they will be able to request visits to you again"
            >
              <Shield size={14} /> Unblock Visitor
            </button>
          )}
        </div>
      </div>

      {/* ── Approve / Reject inline panel ──────────────────────────────────── */}
      {actionMode && (
        <div className="vms-card p-4 space-y-3">
          <p className="text-[13px] font-medium" style={{ color: 'var(--color-text)' }}>
            {actionMode === 'approve' ? 'Approve request?' : 'Reject request?'}
          </p>
          <textarea
            className="w-full text-[13px] p-2 rounded border"
            placeholder={actionMode === 'reject' ? 'Reason for rejection (required)…' : 'Add remarks (optional)…'}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text)' }}
          />
          <div className="flex gap-2">
            <button
              className="btn-primary text-[12px]"
              onClick={() => submitAction(actionMode)}
              disabled={actionLoading || (actionMode === 'reject' && !remarks.trim())}
            >
              {actionLoading ? 'Please wait…' : 'Confirm'}
            </button>
            <button className="btn-secondary text-[12px]" onClick={() => { setActionMode(null); setRemarks(''); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Info grid ──────────────────────────────────────────────────────── */}
      <div className="vms-card p-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 divide-y md:divide-y-0 md:divide-x"
             style={{ '--tw-divide-opacity': 1, borderColor: 'var(--color-border)' }}>
          {[
            {
              label: 'Visitor', icon: User,
              lines: [
                request.visitor_name ?? request.company_name ?? 'Visitor TBD',
                request.visitor_phone ? `📞 ${request.visitor_phone}` : null,
                request.visitor_email ? `✉ ${request.visitor_email}` : null,
              ].filter(Boolean),
            },
            { label: 'Host',  icon: Building2, lines: [request.host_name, request.host_designation, request.host_email] },
            { label: 'Visit', icon: Calendar,  lines: [fmtDate(request.visit_date), `${request.visit_start_time ?? '—'} – ${request.visit_end_time ?? '—'}`, request.department_name, request.purpose] },
          ].map(({ label, icon: Icon, lines }) => (
            <div key={label} className="pt-4 md:pt-0 md:pl-5 first:pl-0 first:pt-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5"
                 style={{ color: 'var(--color-text-faint)' }}>
                <Icon size={11} /> {label}
              </p>
              {lines.filter(Boolean).map((line, i) => (
                <p key={i} className={`text-[${i === 0 ? '13px' : '12px'}] ${i === 0 ? 'font-semibold' : ''}`}
                   style={{ color: i === 0 ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                  {line}
                </p>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ── Gate pass QR ───────────────────────────────────────────────────── */}
      {request.qr_code_path && qrSrc && (
        <div className="vms-card p-5 flex items-center justify-between gap-4"
             style={{ background: 'var(--color-info-bg)' }}>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-faint)' }}>Gate Pass</p>
            <p className="font-bold text-[20px] font-mono" style={{ color: 'var(--color-text)' }}>{request.pass_number}</p>
            <div className="mt-2"><StatusBadge status={request.gate_pass_status ?? 'ISSUED'} /></div>
          </div>
          <img
            src={qrSrc}
            alt="Gate Pass QR Code"
            className="w-24 h-24 object-contain rounded"
            style={{ border: '1px solid var(--color-border)' }}
            onError={e => { e.currentTarget.style.display = 'none'; }}
          />
        </div>
      )}
      {request.pass_number && !request.qr_code_path && (
        <div className="vms-card p-5 flex items-center justify-between gap-4"
             style={{ background: 'var(--color-info-bg)' }}>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-faint)' }}>Gate Pass</p>
            <p className="font-bold text-[20px] font-mono" style={{ color: 'var(--color-text)' }}>{request.pass_number}</p>
            <div className="mt-2"><StatusBadge status={request.gate_pass_status ?? 'ISSUED'} /></div>
          </div>
          <div className="flex items-center justify-center w-24 h-24 rounded"
               style={{ border: '1px dashed var(--color-border)', color: 'var(--color-text-faint)' }}>
            <QrCode size={28} strokeWidth={1.2} />
          </div>
        </div>
      )}

      {/* ── Companions ─────────────────────────────────────────────────────── */}
      {companions.length > 0 && (
        <div className="vms-card overflow-hidden">
          <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <Users size={15} style={{ color: 'var(--color-accent)' }} />
            <h3 className="font-semibold text-[13px]" style={{ color: 'var(--color-text)' }}>Companions ({companions.length})</h3>
          </div>
          <table className="vms-table">
            <thead><tr><th>Full Name</th><th>ID Type</th><th>ID Number</th></tr></thead>
            <tbody>
              {companions.map((c, i) => (
                <tr key={c.id ?? i}>
                  <td className="font-medium" style={{ color: 'var(--color-text)' }}>{c.full_name}</td>
                  <td>{c.id_type ?? '—'}</td>
                  <td className="font-mono text-[12px]">{c.id_number ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Timeline ───────────────────────────────────────────────────────── */}
      <div className="vms-card p-5">
        <h3 className="font-semibold text-[13px] flex items-center gap-2 mb-5" style={{ color: 'var(--color-text)' }}>
          <Clock size={15} style={{ color: 'var(--color-accent)' }} /> Visit Lifecycle
        </h3>
        {timeline.length === 0 ? (
          <p className="text-[12px] text-center py-4" style={{ color: 'var(--color-text-faint)' }}>No timeline events yet</p>
        ) : (
          <div className="relative">
            <div className="absolute left-[17px] top-2 bottom-2 w-0.5" style={{ background: 'var(--color-border)' }} />
            <div className="space-y-5">
              {timeline.map((step, i) => {
                const tc = TIMELINE_COLORS[step.action] ?? { bg: '#94a3b8', text: '#fff' };
                const actionLabel = step.action === 'SUBMITTED' ? 'Submitted'
                  : step.action === 'CHECK_IN'  ? 'Checked In'
                  : step.action === 'CHECK_OUT' ? 'Checked Out'
                  : step.action === 'COMPLETED' ? 'Completed'
                  : step.action;
                return (
                  <div key={step.id ?? i} className="relative flex gap-4 pl-10">
                    <div className="absolute left-0 w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-bold"
                         style={{ background: tc.bg, color: tc.text }}>
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
                          style={{ background: tc.bg + '22', color: tc.bg }}
                        >
                          {actionLabel}
                        </span>
                        {step.acted_by_name && (
                          <span className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>by {step.acted_by_name}</span>
                        )}
                        {step.created_at && (
                          <span className="ml-auto text-[11px]" style={{ color: 'var(--color-text-faint)' }}>{fmtDateTime(step.created_at)}</span>
                        )}
                      </div>
                      {step.remarks && <p className="mt-1 text-[12px] italic" style={{ color: 'var(--color-text-muted)' }}>&#34;{step.remarks}&#34;</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════ MODALS ══════════════════════════════════════ */}

      {/* Block Visitor Modal */}
      {blockModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !blocking && setBlockModal(false)} />
          <div
            className="relative z-10 w-full max-w-md rounded-xl p-6 space-y-4 animate-fade-in"
            style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'rgba(220,38,38,0.1)' }}>
                <ShieldOff size={18} style={{ color: '#dc2626' }} />
              </div>
              <div>
                <h3 className="text-[15px] font-bold" style={{ color: 'var(--color-text)' }}>Block This Visitor</h3>
                <p className="text-[12px]" style={{ color: 'var(--color-text-faint)' }}>
                  {request.visitor_name} &middot; {request.visitor_phone}
                </p>
              </div>
            </div>
            <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
              Future visit requests from this visitor to you will be <strong>automatically declined</strong>. You can unblock them later.
            </p>
            <div>
              <label className="block text-[12px] font-medium mb-1" style={{ color: 'var(--color-text)' }}>
                Reason <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <textarea
                rows={3}
                value={blockReason}
                onChange={e => setBlockReason(e.target.value)}
                placeholder="e.g. Unprofessional behaviour, security concern..."
                className="w-full text-[13px] p-2 rounded border resize-none focus:outline-none"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text)' }}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button className="btn-secondary text-[12px]" onClick={() => setBlockModal(false)} disabled={blocking}>
                Cancel
              </button>
              <button
                className="btn-primary text-[12px]"
                style={{ background: '#dc2626', borderColor: '#dc2626' }}
                onClick={handleBlockVisitor}
                disabled={blocking || !blockReason.trim()}
              >
                {blocking ? 'Blocking…' : 'Confirm Block'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unblock Visitor Confirm Modal (in-app, no window.confirm) */}
      <ConfirmModal
        open={unblockModal}
        onClose={() => !unblocking && setUnblockModal(false)}
        onConfirm={handleUnblockVisitor}
        loading={unblocking}
        icon={<Shield size={18} style={{ color: '#16a34a' }} />}
        iconBg="rgba(22,163,74,0.1)"
        iconColor="#16a34a"
        title="Unblock This Visitor?"
        description={`${request.visitor_name ?? 'This visitor'} will be able to send visit requests to you again.`}
        confirmLabel="Yes, Unblock"
        confirmStyle={{ background: '#16a34a', borderColor: '#16a34a' }}
      />

      {/* Approval Conflict Modal */}
      <ApprovalConflictModal
        conflict={approvalConflict}
        remarks={remarks}
        onClose={() => setApprovalConflict(null)}
        onForceApprove={handleForceApprove}
        loading={actionLoading}
      />

    </div>
  );
}
