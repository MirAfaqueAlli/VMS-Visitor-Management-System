// frontend/src/pages/requests/RequestDetail.jsx
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, User, Building2, Calendar, Clock, QrCode, Users, Check, X } from 'lucide-react';
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
  APPROVED:  { bg: '#16a34a', text: '#fff' },
  REJECTED:  { bg: '#dc2626', text: '#fff' },
  PENDING:   { bg: '#f59e0b', text: '#fff' },
  CANCELLED: { bg: '#94a3b8', text: '#fff' },
};

export default function RequestDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

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

  const handleCancel = async () => {
    if (!window.confirm('Cancel this visit request?')) return;
    setActionLoading(true);
    try {
      await apiClient.put(`/visit-requests/${id}/cancel`);
      toast.success('Request cancelled.'); fetchRequest();
    } catch (err) { toast.error(err?.response?.data?.message || 'Failed.'); }
    finally { setActionLoading(false); }
  };

  const handleApprove = async () => {
    const remarks = window.prompt('Approval remarks (optional):') ?? '';
    setActionLoading(true);
    try {
      await apiClient.put(`/approvals/${id}/approve`, { remarks });
      toast.success('Approved.'); fetchRequest();
    } catch (err) { toast.error(err?.response?.data?.message || 'Failed.'); }
    finally { setActionLoading(false); }
  };

  const handleReject = async () => {
    const remarks = window.prompt('Rejection reason:');
    if (remarks === null) return;
    setActionLoading(true);
    try {
      await apiClient.put(`/approvals/${id}/reject`, { remarks });
      toast.success('Rejected.'); fetchRequest();
    } catch (err) { toast.error(err?.response?.data?.message || 'Failed.'); }
    finally { setActionLoading(false); }
  };

  if (loading) return <Spinner />;
  if (!request) return <div className="text-center py-20" style={{ color: 'var(--color-text-faint)' }}>Request not found.</div>;

  const isHost    = String(request.host_user_id) === String(user?.id);
  const isAdmin   = ['super_admin', 'unit_admin'].includes(user?.role_type);
  const canApprove = (isHost || isAdmin) && request.status === 'PENDING';
  const companions = request.companions ?? [];
  const timeline = request.approval_history ?? [];

  return (
    <div className="space-y-5 animate-fade-in">

      {/* Header */}
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
          {canApprove && (
            <>
              <button className="btn-primary" onClick={handleApprove} disabled={actionLoading}><Check size={14}/> Approve</button>
              <button className="btn-secondary" onClick={handleReject} disabled={actionLoading}
                style={{ borderColor: 'var(--color-error)', color: 'var(--color-error)' }}><X size={14}/> Reject</button>
            </>
          )}
        </div>
      </div>

      {/* Info grid */}
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
            { label: 'Host',    icon: Building2, lines: [request.host_name, request.host_designation, request.host_email] },
            { label: 'Visit',   icon: Calendar, lines: [fmtDate(request.visit_date), `${request.visit_start_time ?? '—'} – ${request.visit_end_time ?? '—'}`, request.department_name, request.purpose] },
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

      {/* Inter-unit banner */}
      {(request.visit_category === 'INTER_UNIT_VISIT' || request.visit_category === 'INTER_UNIT_INVITE') &&
        request.target_unit_id && (
          <div
            className="vms-card p-4 flex items-center gap-3"
            style={{ background: 'var(--color-info-bg)' }}
          >
            <span
              className="text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--color-info)' }}
            >
              Inter-Unit Request — Target Unit ID: {request.target_unit_id}
            </span>
          </div>
        )
      }

      {/* Gate pass */}
      {request.pass_number && (
        <div className="vms-card p-5 flex items-center justify-between gap-4"
             style={{ background: 'var(--color-info-bg)' }}>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-faint)' }}>Gate Pass</p>
            <p className="font-bold text-[20px] font-mono" style={{ color: 'var(--color-text)' }}>{request.pass_number}</p>
            <div className="mt-2"><StatusBadge status={request.gate_pass_status ?? 'ISSUED'} /></div>
          </div>
          {request.qr_code_path && (
            <img src={`${import.meta.env.VITE_API_URL?.replace('/api', '')}/${request.qr_code_path}`}
              alt="QR" className="w-20 h-20 object-contain"
              style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }} />
          )}
        </div>
      )}

      {/* Companions */}
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

      {/* Timeline */}
      <div className="vms-card p-5">
        <h3 className="font-semibold text-[13px] flex items-center gap-2 mb-5" style={{ color: 'var(--color-text)' }}>
          <Clock size={15} style={{ color: 'var(--color-accent)' }} /> Approval Timeline
        </h3>
        {timeline.length === 0 ? (
          <p className="text-[12px] text-center py-4" style={{ color: 'var(--color-text-faint)' }}>No timeline events yet</p>
        ) : (
          <div className="relative">
            <div className="absolute left-[17px] top-2 bottom-2 w-0.5" style={{ background: 'var(--color-border)' }} />
            <div className="space-y-5">
              {timeline.map((step, i) => {
                const tc = TIMELINE_COLORS[step.action] ?? { bg: '#94a3b8', text: '#fff' };
                return (
                  <div key={step.id ?? i} className="relative flex gap-4 pl-10">
                    <div className="absolute left-0 w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-bold"
                         style={{ background: tc.bg, color: tc.text }}>
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={step.action} />
                        <span className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>by {step.acted_by_name}</span>
                        <span className="ml-auto text-[11px]" style={{ color: 'var(--color-text-faint)' }}>{fmtDateTime(step.created_at)}</span>
                      </div>
                      {step.remarks && <p className="mt-1 text-[12px] italic" style={{ color: 'var(--color-text-muted)' }}>"{step.remarks}"</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
