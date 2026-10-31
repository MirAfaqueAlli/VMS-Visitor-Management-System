// frontend/src/pages/requests/RequestDetail.jsx
// One visit request (DESIGN_RULES §12 full screen): breadcrumb back to Visit
// Requests, title + status tracker, the page actions; a details tile (visitor ·
// host · visit), vendor details, companions, the timeline and the gate pass.
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { QrCode, Users, Check, X, ShieldOff, Shield, AlertTriangle, CheckCircle2, Briefcase, Clock, ClipboardList } from '../../components/icons';
import { toast } from 'react-hot-toast';
import apiClient from '../../api/axios';
import useAuth from '../../hooks/useAuth';
import { PageHeader, SectionTitle, KV, Status, State, Tag, Empty, Spinner, Modal, Field, Note } from '../../components/ui';
import { fmtDate, fmtDateTime, fmtTime, orDash } from '../../lib/format';
import { describe } from '../../lib/status';

const last10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);

// Timeline: one tone per kind of event
const STEP = {
  SUBMITTED: { label: 'Submitted',   tone: 'neutral' },
  PENDING:   { label: 'Pending',     tone: 'warning' },
  APPROVED:  { label: 'Approved',    tone: 'success' },
  REJECTED:  { label: 'Rejected',    tone: 'danger' },
  CANCELLED: { label: 'Cancelled',   tone: 'neutral' },
  CHECK_IN:  { label: 'Checked in',  tone: 'brand' },
  CHECK_OUT: { label: 'Checked out', tone: 'success' },
  COMPLETED: { label: 'Completed',   tone: 'success' },
};

function buildTimeline(request) {
  const events = [{
    action: 'SUBMITTED',
    acted_by_name: request.visitor_name ?? request.requester_name ?? 'Visitor',
    created_at: request.created_at,
    remarks: null,
  }];
  if (Array.isArray(request.approval_history)) request.approval_history.forEach((e) => events.push(e));
  if (request.checked_in_at || request.status === 'CHECKED_IN') {
    events.push({ action: 'CHECK_IN', acted_by_name: request.checked_in_by_name ?? 'Security', created_at: request.checked_in_at ?? null, remarks: null });
  }
  if (request.checked_out_at || request.status === 'CHECKED_OUT' || request.status === 'COMPLETED') {
    events.push({
      action: request.status === 'COMPLETED' ? 'COMPLETED' : 'CHECK_OUT',
      acted_by_name: request.checked_out_by_name ?? 'Security',
      created_at: request.checked_out_at ?? null,
      remarks: null,
    });
  }
  events.sort((a, b) => {
    if (!a.created_at) return 1;
    if (!b.created_at) return -1;
    return new Date(a.created_at) - new Date(b.created_at);
  });
  return events;
}

function Timeline({ steps }) {
  return (
    <ol className="relative">
      {steps.map((s, i) => {
        const st = STEP[s.action] ?? { label: s.action, tone: 'neutral' };
        return (
          <li key={s.id ?? i} className={`relative pl-6 ${i < steps.length - 1 ? 'pb-4' : ''}`}>
            {i < steps.length - 1 && <span className="absolute left-[4px] top-3 bottom-0 w-px bg-line" aria-hidden="true" />}
            <span className={`state-dot tone-${st.tone} absolute left-0 top-[5px]`}
              style={{ width: 9, height: 9, background: 'var(--tone)', outline: '2px solid var(--tone-soft)' }} aria-hidden="true" />
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[12.5px] font-medium">{st.label}</span>
              {s.acted_by_name && <span className="text-[12px] text-ink-2">by {s.acted_by_name}</span>}
              {s.created_at && <span className="ml-auto text-[11px] text-muted tabular">{fmtDateTime(s.created_at)}</span>}
            </div>
            {s.remarks && <p className="mt-0.5 text-[12px] text-ink-2">“{s.remarks}”</p>}
          </li>
        );
      })}
    </ol>
  );
}

export default function RequestDetail() {
  const { id } = useParams();
  // Set when opening a cross-unit request (stored in another unit's DB) from the list
  const [searchParams] = useSearchParams();
  const crossUnitId = searchParams.get('unit_id');
  const navigate = useNavigate();
  const { user } = useAuth();

  const [request, setRequest]             = useState(null);
  const [loading, setLoading]             = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [remarks, setRemarks]             = useState('');
  const [remarksError, setRemarksError]   = useState('');
  const [actionMode, setActionMode]       = useState(null); // null | 'approve' | 'reject'

  const [blockModal, setBlockModal]     = useState(false);
  const [blockReason, setBlockReason]   = useState('');
  const [blocking, setBlocking]         = useState(false);
  const [unblockModal, setUnblockModal] = useState(false);
  const [unblocking, setUnblocking]     = useState(false);
  const [approvalConflict, setApprovalConflict] = useState(null); // null | { visitor_name, time_window }

  const fetchRequest = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get(`/visit-requests/${id}`, {
        params: crossUnitId ? { unit_id: crossUnitId } : undefined,
      });
      setRequest(res.data?.data ?? res.data);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to load request.');
    } finally { setLoading(false); }
  }, [id, crossUnitId]);

  useEffect(() => { fetchRequest(); }, [fetchRequest]);

  // ── Approve / Reject ───────────────────────────────────────────────────────
  const submitAction = async (type, forceApprove = false) => {
    if (type === 'reject' && !remarks.trim()) { setRemarksError('Enter the reason for rejecting — the visitor is told it.'); return; }
    setActionLoading(true);
    try {
      if (type === 'approve') {
        await apiClient.put(`/approvals/${id}/approve`, { remarks, force_approve: forceApprove || undefined });
        toast.success(`Request #${id} approved — the gate pass has been sent to the visitor.`);
        setApprovalConflict(null);
      } else {
        await apiClient.put(`/approvals/${id}/reject`, { remarks });
        toast.success(`Request #${id} rejected — the visitor has been told.`);
      }
      setActionMode(null);
      setRemarks('');
      fetchRequest();
    } catch (err) {
      const data = err?.response?.data;
      if (err?.response?.status === 409 && data?.conflict && type === 'approve') {
        setApprovalConflict(data.host_conflict); // the conflict modal explains it
        return;
      }
      toast.error(data?.message || 'Could not update the request.');
    } finally { setActionLoading(false); }
  };

  // ── Block / unblock visitor ────────────────────────────────────────────────
  const handleBlockVisitor = async () => {
    if (!blockReason.trim()) return;
    setBlocking(true);
    try {
      await apiClient.post(`/visit-requests/${id}/blacklist-visitor`, { reason: blockReason.trim() });
      toast.success(`${request.visitor_name || 'Visitor'} blocked — their future requests to you are declined automatically.`);
      setBlockModal(false);
      setBlockReason('');
      fetchRequest();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to block visitor.');
    } finally { setBlocking(false); }
  };

  const handleUnblockVisitor = async () => {
    setUnblocking(true);
    try {
      await apiClient.delete(`/visit-requests/blocked-visitors/${request.host_block_id}`);
      toast.success(`${request.visitor_name || 'Visitor'} unblocked.`);
      setUnblockModal(false);
      fetchRequest();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to unblock visitor.');
    } finally { setUnblocking(false); }
  };

  if (loading) return <><PageHeader title="Visit request" /><Spinner label="Loading the request…" /></>;
  if (!request) {
    return (
      <>
        <PageHeader title="Visit request" />
        <Empty icon={ClipboardList} title="Request not found" hint="It may belong to another unit, or the link is wrong."
          action={<button type="button" className="btn-outline" onClick={() => navigate('/requests')}>Back to visit requests</button>} />
      </>
    );
  }

  const role = user?.role_type || user?.role;
  // A cross-unit request lives in another unit's DB: its ids are that unit's and every
  // action endpoint targets the viewer's own unit — so no host/admin actions on it.
  const isCrossUnit = !!request.cross_unit;
  // super_admin is read-only inside a unit (no approve/reject/block/pass) — API enforces the same
  const isHost    = !isCrossUnit && role !== 'super_admin' && String(request.host_user_id) === String(user?.id);
  const isVisitor = !isHost && (
    (String(request.requester_user_id) === String(user?.id) && request.visit_category === 'EMPLOYEE_VISIT') ||
    (user?.email && request.visitor_email?.toLowerCase() === user.email.toLowerCase()) ||
    (user?.phone && request.visitor_phone && last10(request.visitor_phone) === last10(user.phone)) ||
    (isCrossUnit && request.my_role === 'VISITOR')
  );
  const canViewPass = (!isCrossUnit && ['security', 'receptionist', 'unit_admin'].includes(role)) ||
                      (request.status === 'APPROVED' && request.pass_number && (isVisitor || role === 'employee'));
  const isAdmin    = !isCrossUnit && role === 'unit_admin';
  const canApprove = (isHost || isAdmin) && request.status === 'PENDING';
  const isBlocked  = !!request.host_block_id;
  const canBlock   = (isHost || isAdmin) && !!request.visitor_phone;
  const companions = request.companions ?? [];
  const timeline   = buildTimeline(request);
  const conflictFlag = request.force_created === 1 || request.force_created === true;

  // qr_code_path: a short-lived signed S3 link, or a data: image the API drew from the pass data
  const qrSrc = /^(https?:\/\/|data:image\/)/.test(request.qr_code_path ?? '') ? request.qr_code_path : null;
  const passLink = `/passes/pass/${request.pass_number}${crossUnitId ? `?unit_id=${crossUnitId}` : ''}`;

  const vendorDetails = (request.visit_category === 'VENDOR' || request.company_name || request.work_order_ref || request.service_type || request.vendor_email);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={`Visit request #${request.id}`}
        actions={(
          <>
            {canViewPass && request.status === 'APPROVED' && request.pass_number && (
              <button type="button" className="btn-outline" onClick={() => navigate(passLink)}><QrCode size={14} /> Open gate pass</button>
            )}
            {canBlock && !isBlocked && (
              <button type="button" className="btn-danger" onClick={() => { setBlockModal(true); setBlockReason(''); }}
                title="Decline this visitor's future requests to you automatically">
                <ShieldOff size={14} /> Block visitor
              </button>
            )}
            {canBlock && isBlocked && (
              <button type="button" className="btn-outline" onClick={() => setUnblockModal(true)}
                title="Let this visitor request visits to you again">
                <Shield size={14} /> Unblock visitor
              </button>
            )}
            {canApprove && (
              <>
                <button type="button" className="btn-danger" onClick={() => { setActionMode('reject'); setRemarks(''); setRemarksError(''); }}><X size={14} /> Reject</button>
                <button type="button" className="btn-primary" onClick={() => { setActionMode('approve'); setRemarks(''); setRemarksError(''); }}><Check size={14} /> Approve</button>
              </>
            )}
          </>
        )}
      />

      {/* Status line */}
      <div className="flex flex-wrap items-center gap-2 -mt-2 mb-6">
        <Status value={request.status} />
        <span className="text-line-strong" aria-hidden="true">·</span>
        <Tag tone={describe(request.visit_category).tone}>{describe(request.visit_category).label}</Tag>
        {isVisitor && <Tag tone="success">You are the visitor</Tag>}
        {isHost && <Tag tone="brand">You are the host</Tag>}
        {isBlocked && <Tag tone="danger">Blocked by host</Tag>}
        {conflictFlag && <Tag tone="warning" title="Created even though the host had another visit at this time">Time conflict</Tag>}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-x-8 gap-y-6 items-start">
        <div className="min-w-0">
          {/* Visitor · host · visit */}
          <div className="tile grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-5">
            <div>
              <p className="group-heading mb-2">Visitor</p>
              <p className="text-[13.5px] font-semibold">{request.visitor_name ?? request.company_name ?? 'Visitor to be confirmed'}</p>
              <dl className="mt-1 space-y-0.5 text-[12px] text-ink-2">
                {request.company_name && request.visitor_name && <dd>{request.company_name}</dd>}
                {request.visitor_phone && <dd className="tabular">{request.visitor_phone}</dd>}
                {(request.visitor_email || request.vendor_email) && <dd className="break-all">{request.visitor_email || request.vendor_email}</dd>}
                {request.visitor_address && <dd>{request.visitor_address}</dd>}
              </dl>
            </div>
            <div>
              <p className="group-heading mb-2">Host</p>
              <p className="text-[13.5px] font-semibold">{orDash(request.host_name)}</p>
              <dl className="mt-1 space-y-0.5 text-[12px] text-ink-2">
                {request.host_designation && <dd>{request.host_designation}</dd>}
                {request.department_name && <dd>{request.department_name}</dd>}
                {request.host_email && <dd className="break-all">{request.host_email}</dd>}
              </dl>
            </div>
            <div>
              <p className="group-heading mb-2">Visit</p>
              <p className="text-[13.5px] font-semibold tabular">{fmtDate(request.visit_date)}</p>
              <dl className="mt-1 space-y-0.5 text-[12px] text-ink-2">
                <dd className="tabular">{request.visit_start_time ? `${fmtTime(request.visit_start_time)}${request.visit_end_time ? ` – ${fmtTime(request.visit_end_time)}` : ''}` : 'Any time'}</dd>
                {request.purpose && <dd>{request.purpose}</dd>}
                {request.accompanying_count > 0 && <dd>{request.accompanying_count} accompanying</dd>}
              </dl>
            </div>
          </div>

          {vendorDetails && (
            <section className="section">
              <SectionTitle icon={Briefcase} title="Vendor and business details" />
              <div className="tile">
                <KV items={[
                  request.company_name && ['Company', request.company_name],
                  request.vendor_email && ['Vendor email', request.vendor_email],
                  request.service_type && ['Service type', request.service_type],
                  request.work_order_ref && ['Work order', <span key="w" className="mono">{request.work_order_ref}</span>],
                ]} />
              </div>
            </section>
          )}

          {companions.length > 0 && (
            <section className="section">
              <SectionTitle icon={Users} title="Companions" meta={`${companions.length}`} />
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Full name</th><th>ID type</th><th>ID number</th></tr></thead>
                  <tbody>
                    {companions.map((c, i) => (
                      <tr key={c.id ?? i}>
                        <td className="font-medium">{c.full_name}</td>
                        <td>{c.id_type ? <Tag tone="neutral">{c.id_type}</Tag> : '—'}</td>
                        <td className="mono">{orDash(c.id_number)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="section">
            <SectionTitle icon={Clock} title="Timeline" />
            {timeline.length === 0
              ? <p className="text-[12px] text-muted">No events yet.</p>
              : <Timeline steps={timeline} />}
          </section>
        </div>

        {/* Gate pass */}
        <aside className="space-y-3">
          {canViewPass && request.pass_number ? (
            <div className="tile">
              <p className="group-heading mb-2">Gate pass</p>
              <p className="mono text-[20px] font-semibold">{request.pass_number}</p>
              <div className="mt-1.5"><Status value={request.gate_pass_status ?? 'ISSUED'} /></div>
              <div className="inset-cell mt-3 flex items-center justify-center">
                {qrSrc ? (
                  <img src={qrSrc} alt="Gate pass QR code" className="w-32 h-32 object-contain"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                ) : (
                  <div className="w-32 h-32 flex flex-col items-center justify-center text-muted text-[11px] gap-1">
                    <QrCode size={26} />No QR image
                  </div>
                )}
              </div>
              {request.status === 'APPROVED' && (
                <button type="button" className="btn-outline w-full mt-3" onClick={() => navigate(passLink)}>
                  <QrCode size={14} /> Open gate pass
                </button>
              )}
            </div>
          ) : request.status === 'APPROVED' ? (
            <div className="tile">
              <State tone="success">Approved — pass issued</State>
              <p className="mt-2 text-[12px] text-ink-2">The gate pass has been emailed to the visitor for entry at security.</p>
            </div>
          ) : null}
        </aside>
      </div>

      {/* ── Approve / reject ─────────────────────────────────────────────────── */}
      <Modal
        open={!!actionMode}
        onClose={() => { setActionMode(null); setRemarks(''); }}
        busy={actionLoading}
        width={460}
        title={actionMode === 'approve' ? `Approve request #${request.id}` : `Reject request #${request.id}`}
        footer={(
          <>
            <button type="button" className="btn-outline" onClick={() => { setActionMode(null); setRemarks(''); }} disabled={actionLoading}>Cancel</button>
            <button type="button" className={actionMode === 'reject' ? 'btn-danger' : 'btn-primary'} onClick={() => submitAction(actionMode)} disabled={actionLoading}>
              {actionMode === 'approve' ? <CheckCircle2 size={14} /> : <X size={14} />}
              {actionLoading ? 'Saving…' : actionMode === 'approve' ? 'Approve request' : 'Reject request'}
            </button>
          </>
        )}
      >
        <Field label={actionMode === 'reject' ? 'Reason for rejecting' : 'Remarks (optional)'} required={actionMode === 'reject'} error={remarksError}
          hint={actionMode === 'approve' ? 'The visitor receives the gate pass by email and SMS.' : undefined}>
          <textarea rows={3} autoFocus className={`control resize-none${remarksError ? ' is-invalid' : ''}`}
            value={remarks} onChange={(e) => { setRemarks(e.target.value); setRemarksError(''); }}
            placeholder={actionMode === 'reject' ? 'e.g. The host is on leave that day' : 'e.g. Meeting room 2B is booked'} />
        </Field>
      </Modal>

      {/* ── Schedule conflict ────────────────────────────────────────────────── */}
      <Modal
        open={!!approvalConflict}
        onClose={() => setApprovalConflict(null)}
        busy={actionLoading}
        width={440}
        title="Schedule conflict"
        footer={(
          <>
            <button type="button" className="btn-outline" onClick={() => setApprovalConflict(null)} disabled={actionLoading}>Keep it pending</button>
            <button type="button" className="btn-primary" onClick={() => submitAction('approve', true)} disabled={actionLoading}>
              {actionLoading ? 'Approving…' : 'Approve anyway'}
            </button>
          </>
        )}
      >
        {approvalConflict && (
          <Note tone="warning" icon={AlertTriangle}>
            <b>{approvalConflict.visitor_name}</b> is already scheduled to visit the host during <b>{approvalConflict.time_window}</b>.
            Approving anyway marks this request with a time-conflict flag.
          </Note>
        )}
      </Modal>

      {/* ── Block visitor ────────────────────────────────────────────────────── */}
      <Modal
        open={blockModal}
        onClose={() => setBlockModal(false)}
        busy={blocking}
        width={460}
        title={`Block ${request.visitor_name || 'this visitor'}`}
        footer={(
          <>
            <button type="button" className="btn-outline" onClick={() => setBlockModal(false)} disabled={blocking}>Cancel</button>
            <button type="button" className="btn-danger" onClick={handleBlockVisitor} disabled={blocking || !blockReason.trim()}
              title={!blockReason.trim() ? 'Enter a reason first' : undefined}>
              {blocking ? 'Blocking…' : 'Block visitor'}
            </button>
          </>
        )}
      >
        <p className="text-[12.5px] text-ink-2 mb-3">
          Future visit requests from {request.visitor_phone ? <span className="tabular">{request.visitor_phone}</span> : 'this visitor'} to you will be declined automatically. You can unblock them later.
        </p>
        <Field label="Reason" required>
          <textarea rows={3} autoFocus value={blockReason} onChange={(e) => setBlockReason(e.target.value)}
            placeholder="e.g. Repeated requests without an appointment" className="control resize-none" />
        </Field>
      </Modal>

      {/* ── Unblock visitor ──────────────────────────────────────────────────── */}
      <Modal
        open={unblockModal}
        onClose={() => setUnblockModal(false)}
        busy={unblocking}
        width={420}
        title={`Unblock ${request.visitor_name || 'this visitor'}`}
        footer={(
          <>
            <button type="button" className="btn-outline" onClick={() => setUnblockModal(false)} disabled={unblocking}>Cancel</button>
            <button type="button" className="btn-primary" onClick={handleUnblockVisitor} disabled={unblocking}>
              {unblocking ? 'Unblocking…' : 'Unblock visitor'}
            </button>
          </>
        )}
      >
        <p className="text-[12.5px] text-ink-2">They will be able to send visit requests to you again.</p>
      </Modal>
    </div>
  );
}
