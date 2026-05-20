// frontend/src/pages/visitors/VisitorDetail.jsx
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, CreditCard, Check, Clock, AlertTriangle, Phone, Mail, Calendar } from 'lucide-react';
import { toast } from 'react-hot-toast';
import apiClient from '../../api/axios';
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
  const [visitor,   setVisitor]   = useState(null);
  const [history,   setHistory]   = useState([]);
  const [loading,   setLoading]   = useState(true);

  const fetchVisitor = useCallback(async () => {
    setLoading(true);
    try {
      const [visRes, histRes] = await Promise.all([
        apiClient.get(`/visitors/${id}`),
        apiClient.get(`/visit-requests?visitor_id=${id}&limit=5`),
      ]);
      setVisitor(visRes.data?.data ?? visRes.data);
      setHistory(histRes.data?.data?.requests ?? []);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to load visitor.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchVisitor(); }, [fetchVisitor]);

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
                <p>Blacklisted visitor</p>
                {visitor.blacklist_details?.reason && (
                  <p className="font-normal mt-0.5 opacity-80">{visitor.blacklist_details.reason}</p>
                )}
              </div>
            </div>
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
              <Link
                to={`/requests?visitor_id=${id}`}
                className="ml-auto text-[11px] transition-colors"
                style={{ color: 'var(--color-accent)' }}
              >
                View All →
              </Link>
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
                      <td><StatusBadge status={v.visitor_type_code} /></td>
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
    </div>
  );
}
