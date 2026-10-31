// frontend/src/pages/visitors/VisitorDetail.jsx
// One visitor (DESIGN_RULES §12 full screen): breadcrumb back to Visitors, title,
// debar / lift as the page action; a details tile beside ID documents and the
// visit history (rows open the visit).
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CreditCard, Clock, AlertTriangle, ShieldOff, ShieldCheck, User, Check } from '../../components/icons';
import { toast } from 'react-hot-toast';
import apiClient from '../../api/axios';
import useAuth from '../../hooks/useAuth';
import {
  PageHeader, SectionTitle, KV, Tag, State, Status, Empty, Spinner, Modal, Field, Note,
} from '../../components/ui';
import { fmtDate, fmtTime, orDash } from '../../lib/format';

export default function VisitorDetail() {
  const { id }      = useParams();
  const navigate    = useNavigate();
  const { user }    = useAuth();
  const [visitor,   setVisitor]   = useState(null);
  const [history,   setHistory]   = useState([]);
  const [loading,   setLoading]   = useState(true);

  // Debar / lift-debarment (unit_admin only — the API enforces the same)
  const canDebar = (user?.role_type || user?.role) === 'unit_admin';
  const [debarMode,   setDebarMode]   = useState(null); // null | 'debar' | 'lift'
  const [debarReason, setDebarReason] = useState('');
  const [debarError,  setDebarError]  = useState('');
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
    if (debarMode === 'debar' && !debarReason.trim()) { setDebarError('Enter the reason for debarring this visitor.'); return; }
    setDebarBusy(true);
    try {
      if (debarMode === 'debar') {
        await apiClient.post(`/visitors/${id}/blacklist`, { reason: debarReason.trim() });
        toast.success(`${visitor.full_name} debarred — new visits and gate entry will be refused.`);
      } else {
        await apiClient.put(`/visitors/${id}/blacklist/lift`, { lift_reason: debarReason.trim() || null });
        toast.success(`Debarment lifted for ${visitor.full_name}.`);
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

  if (loading) return <><PageHeader title="Visitor" /><Spinner label="Loading the visitor…" /></>;
  if (!visitor) {
    return (
      <>
        <PageHeader title="Visitor" />
        <Empty icon={User} title="Visitor not found" hint="The visitor may have been removed, or the link is wrong."
          action={<button type="button" className="btn-outline" onClick={() => navigate('/visitors')}>Back to visitors</button>} />
      </>
    );
  }

  const idProofs = visitor.id_proofs ?? [];
  const isBusiness = visitor.visitor_type === 'business';
  const openDebar = () => { setDebarReason(''); setDebarError(''); setDebarMode(visitor.blacklisted ? 'lift' : 'debar'); };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={visitor.full_name}
        actions={canDebar && (visitor.blacklisted ? (
          <button type="button" onClick={openDebar} className="btn-outline"><ShieldCheck size={14} /> Lift debarment</button>
        ) : (
          <button type="button" onClick={openDebar} className="btn-danger"><ShieldOff size={14} /> Debar visitor</button>
        ))}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-x-8 gap-y-6 items-start">
        {/* Details */}
        <div className="tile space-y-4">
          {visitor.blacklisted && (
            <Note tone="danger" icon={AlertTriangle}>
              <b>Debarred.</b> {visitor.blacklist_details?.reason || 'Visits and gate entry are refused in this unit.'}
            </Note>
          )}
          <KV items={[
            ['Type', <Tag key="t" tone={isBusiness ? 'info' : 'neutral'}>{isBusiness ? 'Business' : 'Individual'}</Tag>],
            ['State', visitor.blacklisted
              ? <State key="s" tone="danger">Debarred</State>
              : <State key="s" tone="success">Allowed</State>],
            ['Phone', visitor.phone],
            ['Email', visitor.email],
            visitor.company_name && ['Company', visitor.company_name],
            ['Registered', fmtDate(visitor.created_at)],
          ]} className="!grid-cols-[100px_minmax(0,1fr)]" />
        </div>

        <div>
          <section>
            <SectionTitle icon={CreditCard} title="ID documents" meta={`${idProofs.length}`} />
            {idProofs.length === 0 ? (
              <Empty icon={CreditCard} title="No ID documents recorded" hint="ID documents are added when the visitor checks in at the gate." />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Type</th><th>Number</th><th>Primary</th></tr></thead>
                  <tbody>
                    {idProofs.map((doc, i) => (
                      <tr key={doc.id ?? i}>
                        <td><Tag tone="neutral">{doc.id_type}</Tag></td>
                        <td className="mono">{doc.id_number}</td>
                        <td>{doc.is_primary ? <Check size={14} weight="bold" className="text-success" aria-label="Primary" /> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="section">
            <SectionTitle icon={Clock} title="Visit history" meta={`Last ${history.length}`} />
            {history.length === 0 ? (
              <Empty icon={Clock} title="No visits yet" hint="Each visit request for this visitor appears here." />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Date</th><th>Type</th><th>Host</th><th>Department</th><th>Status</th></tr></thead>
                  <tbody>
                    {history.map((v, i) => (
                      <tr key={v.id ?? i} className="is-clickable" onClick={() => navigate(`/requests/${v.id}`)}>
                        <td className="tabular whitespace-nowrap">{fmtDate(v.visit_date)}<span className="cell-sub">{v.visit_start_time ? fmtTime(v.visit_start_time) : ''}</span></td>
                        <td><Status value={v.visit_category || v.visitor_type_code || v.visitor_type} /></td>
                        <td>{orDash(v.host_name)}</td>
                        <td>{orDash(v.department_name)}</td>
                        <td><Status value={v.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Debar / lift */}
      <Modal
        open={!!debarMode}
        onClose={() => setDebarMode(null)}
        busy={debarBusy}
        width={460}
        title={debarMode === 'debar' ? `Debar ${visitor.full_name}` : `Lift the debarment for ${visitor.full_name}`}
        footer={(
          <>
            <button type="button" className="btn-outline" onClick={() => setDebarMode(null)} disabled={debarBusy}>Cancel</button>
            <button type="button" className={debarMode === 'debar' ? 'btn-danger' : 'btn-primary'} onClick={submitDebar} disabled={debarBusy}>
              {debarBusy ? 'Saving…' : debarMode === 'debar' ? 'Debar visitor' : 'Lift debarment'}
            </button>
          </>
        )}
      >
        <p className="text-[12.5px] text-ink-2 mb-3">
          {debarMode === 'debar'
            ? 'New visit requests and gate entry for this visitor will be refused in this unit until the debarment is lifted.'
            : 'The visitor will be able to request visits again.'}
        </p>
        <Field label={debarMode === 'debar' ? 'Reason for debarring' : 'Reason for lifting (optional)'} required={debarMode === 'debar'} error={debarError}>
          <textarea rows={3} value={debarReason} autoFocus className={`control resize-none${debarError ? ' is-invalid' : ''}`}
            onChange={(e) => { setDebarReason(e.target.value); setDebarError(''); }}
            placeholder={debarMode === 'debar' ? 'e.g. Misbehaved with staff on 24 Oct' : ''} />
        </Field>
      </Modal>
    </div>
  );
}
