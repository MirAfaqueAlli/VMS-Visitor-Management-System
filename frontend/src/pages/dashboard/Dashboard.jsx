// frontend/src/pages/dashboard/Dashboard.jsx
// Role dashboards (DESIGN_RULES §13): title + scope, a lead row with one hero
// number (54px, parts bar + legend) beside smaller metric tiles, then sections
// with head-icon chips and plain tables. No greetings, no gradients.
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Clock, UserCheck, AlertCircle, Calendar, Check, X, Plus, ClipboardList, Building2, ChevronRight,
} from "../../components/icons";
import { toast } from "react-hot-toast";
import apiClient from "../../api/axios";
import useAuth from "../../hooks/useAuth";
import useSocketEvent from "../../hooks/useSocketEvent";
import { PageHeader, SectionTitle, Status, Tag, State, Empty, Spinner, Modal, Field } from "../../components/ui";
import { fmtDate, fmtTime, fmtClock, fmtNumber, orDash } from "../../lib/format";
import { describe } from "../../lib/status";

/* ─── Shared pieces ──────────────────────────────────────────────────────── */

/** The one number that matters, with its parts as a stacked 6px bar + legend. */
function HeroTile({ label, value, tone, hint, parts = [] }) {
  const total = parts.reduce((s, p) => s + (Number(p.value) || 0), 0);
  return (
    <div className="tile flex flex-col justify-between min-h-[168px]">
      <div>
        <div className="stat-label">{label}</div>
        <div className="mt-2 tabular" style={{
          fontSize: 54, fontWeight: 650, letterSpacing: "-0.03em", lineHeight: 0.9,
          color: tone === "warning" ? "var(--warning-text)" : "var(--ink)",
        }}>
          {fmtNumber(value ?? 0)}
        </div>
        {hint && <div className="stat-hint mt-2">{hint}</div>}
      </div>
      {parts.length > 0 && (
        <div className="mt-4">
          <div className="flex h-1.5 rounded-full overflow-hidden gap-[2px]" style={{ background: total ? undefined : "var(--line)" }}>
            {total > 0 && parts.map((p) => (Number(p.value) > 0 ? (
              <span key={p.label} style={{ flexGrow: Number(p.value), background: p.color }} title={`${p.label}: ${p.value}`} />
            ) : null))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink-2">
            {parts.map((p) => (
              <span key={p.label} className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                {p.label} <b className="tabular font-semibold text-ink">{fmtNumber(p.value ?? 0)}</b>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricTile({ label, value, unit, hint, tone, onClick }) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp type={onClick ? "button" : undefined} onClick={onClick}
      className={`stat text-left ${onClick ? "hover:bg-neutral-soft transition-colors" : ""}`}>
      <div className="stat-label flex items-center gap-1">{label}{onClick && <ChevronRight size={12} className="text-muted" />}</div>
      <div className={`stat-value${tone ? ` is-${tone}` : ""}`}>
        {fmtNumber(value ?? 0)}{unit && <span className="stat-unit">{unit}</span>}
      </div>
      {hint && <div className="stat-hint">{hint}</div>}
    </Comp>
  );
}

/** Remarks for approve (optional) / reject (required) — replaces window.prompt. */
function RemarksModal({ mode, onConfirm, onCancel, loading }) {
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState("");
  const isReject = mode === "reject";
  const confirm = () => {
    if (isReject && !remarks.trim()) { setError("Enter the reason for rejecting — the visitor is told it."); return; }
    onConfirm(remarks.trim());
  };
  return (
    <Modal
      open={!!mode}
      onClose={onCancel}
      busy={loading}
      width={440}
      title={isReject ? "Reject this visit request" : "Approve this visit request"}
      footer={(
        <>
          <button type="button" className="btn-outline" onClick={onCancel} disabled={loading}>Cancel</button>
          <button type="button" className={isReject ? "btn-danger" : "btn-primary"} onClick={confirm} disabled={loading}>
            {isReject ? <X size={14} /> : <Check size={14} />}
            {loading ? "Saving…" : isReject ? "Reject request" : "Approve request"}
          </button>
        </>
      )}
    >
      <Field label={isReject ? "Reason for rejecting" : "Remarks (optional)"} required={isReject} error={error}>
        <textarea autoFocus rows={3} value={remarks} className={`control resize-none${error ? " is-invalid" : ""}`}
          onChange={(e) => { setRemarks(e.target.value); setError(""); }}
          placeholder={isReject ? "e.g. The host is on leave that day" : "e.g. Meeting room 2B is booked"} />
      </Field>
    </Modal>
  );
}

const timeOf = (v) => (v.visit_start_time ? fmtTime(v.visit_start_time) : "Any time");

function useApprovalModal(onDone) {
  const [modalState, setModalState] = useState(null); // null | { mode, id, loading }
  const open = (mode, id) => setModalState({ mode, id, loading: false });
  const confirm = async (remarks) => {
    if (!modalState) return;
    const { mode, id } = modalState;
    setModalState((p) => ({ ...p, loading: true }));
    try {
      await apiClient.put(`/approvals/${id}/${mode}`, { remarks: remarks || undefined });
      toast.success(mode === "approve" ? "Request approved — the gate pass has been sent to the visitor." : "Request rejected — the visitor has been told.");
      setModalState(null);
      onDone();
    } catch (err) {
      toast.error(err?.response?.data?.message || `Failed to ${mode} the request.`);
      setModalState((p) => ({ ...p, loading: false }));
    }
  };
  const modal = (
    <RemarksModal key={modalState ? `${modalState.mode}-${modalState.id}` : "none"} mode={modalState?.mode ?? null}
      loading={modalState?.loading ?? false} onConfirm={confirm} onCancel={() => setModalState(null)} />
  );
  return { open, modal };
}

/* ─── A: Security / Receptionist ─────────────────────────────────────────── */
function SecurityDashboard() {
  const navigate = useNavigate();
  const { hasRole, user } = useAuth();
  const [dashData, setDashData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get("/gate/dashboard");
      setDashData(res.data?.data ?? res.data);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load gate data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Socket: a visit for today was approved → add it to Expected today
  useSocketEvent("visit:approved:today", useCallback((data) => {
    setDashData((prev) => {
      if (!prev) return prev;
      if ((prev.yet_to_come ?? []).some((v) => v.id === data.id)) return prev;
      const updated = [{
        id: data.id, visitor_name: data.visitor_name, visitor_phone: data.visitor_phone,
        visit_date: data.visit_date, visit_start_time: data.visit_start_time, visit_category: data.visit_category,
        status: "APPROVED", purpose: data.purpose, pass_number: data.pass_number,
        host_name: data.host_name ?? null, department_name: data.department_name ?? null,
      }, ...(prev.yet_to_come ?? [])];
      return { ...prev, yet_to_come: updated, summary: { ...prev.summary, yet_to_come_count: updated.length } };
    });
    toast(`${data.visitor_name || "A visitor"} is approved to visit today.`, { duration: 4000 });
  }, []), []);

  // Socket: checked in → move from Expected to On premises
  useSocketEvent("visit:checkin", useCallback((data) => {
    setDashData((prev) => {
      if (!prev) return prev;
      const newActive = {
        visit_log_id: data.visit_log_id, visit_request_id: data.visit_request_id, visitor_name: data.visitor_name,
        visitor_phone: data.visitor_phone, pass_number: data.pass_number, host_name: data.host_name,
        department_name: data.department_name, check_in_at: data.check_in_at,
      };
      const updatedYetToCome = (prev.yet_to_come ?? []).filter((v) => v.id !== data.visit_request_id);
      const alreadyActive = (prev.active ?? []).some((v) => v.visit_request_id === data.visit_request_id);
      const updatedActive = alreadyActive ? (prev.active ?? []) : [newActive, ...(prev.active ?? [])];
      return {
        ...prev, yet_to_come: updatedYetToCome, active: updatedActive,
        summary: { ...prev.summary, yet_to_come_count: updatedYetToCome.length, active_count: updatedActive.length },
      };
    });
    toast(`${data.visitor_name ?? "A visitor"} checked in.`, { duration: 4000 });
  }, []), []);

  // Socket: checked out → off premises, one more completed
  useSocketEvent("visit:checkout", useCallback((data) => {
    setDashData((prev) => {
      if (!prev) return prev;
      const updatedActive = (prev.active ?? []).filter(
        (v) => v.visit_log_id !== data.visit_log_id && v.visit_request_id !== data.visit_request_id,
      );
      return {
        ...prev, active: updatedActive,
        summary: { ...prev.summary, active_count: updatedActive.length, completed_today_count: (prev.summary?.completed_today_count ?? 0) + 1 },
      };
    });
    toast(`${data.visitor_name ?? "A visitor"} checked out.`, { duration: 3000 });
  }, []), []);

  if (loading) return <><PageHeader title="Dashboard" /><Spinner label="Loading today’s gate activity…" /></>;

  const summary = dashData?.summary ?? {};
  const yetToCome = dashData?.yet_to_come ?? [];
  const active = dashData?.active ?? [];
  const expected = summary.yet_to_come_count ?? yetToCome.length;
  const inside = summary.active_count ?? active.length;
  const completed = summary.completed_today_count ?? 0;
  const canCheckIn = hasRole("security", "receptionist");

  return (
    <div className="animate-fade-in">
      <PageHeader title="Dashboard" meta={user?.unit_name ? `${user.unit_name} · gate today` : "Gate today"}
        actions={(
          <button type="button" onClick={() => navigate("/requests/new?category=SPOT")} className="btn-primary">
            <Plus size={14} /> Register walk-in
          </button>
        )} />

      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr_1fr] gap-3 mb-7">
        <HeroTile label="On premises now" value={inside} hint="Visitors checked in and not yet out"
          parts={[
            { label: "Expected", value: expected, color: "var(--ramp-1)" },
            { label: "Inside", value: inside, color: "var(--ramp-3)" },
            { label: "Left", value: completed, color: "var(--ramp-4)" },
          ]} />
        <MetricTile label="Expected today" value={expected} hint="Approved, not yet arrived" />
        <MetricTile label="Completed today" value={completed} hint="Checked in and out" />
      </div>

      <section className="section !mt-0">
        <SectionTitle icon={Clock} title="Expected today" meta={`${yetToCome.length} visitor${yetToCome.length !== 1 ? "s" : ""}`} />
        {yetToCome.length === 0 ? (
          <Empty icon={Calendar} title="No visitors expected today" hint="Approved visits for today appear here as soon as they are approved." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Visitor</th><th>Type</th><th>Host</th><th>Department</th><th>Time</th>{canCheckIn && <th className="num">Action</th>}</tr>
              </thead>
              <tbody>
                {yetToCome.map((v, i) => (
                  <tr key={v.id ?? i}>
                    <td className="font-medium">{orDash(v.visitor_name)}<span className="cell-sub">{v.pass_number ? <span className="mono">{v.pass_number}</span> : v.visitor_phone}</span></td>
                    <td><Status value={v.visit_category || v.visitor_type_code || v.visitor_type} /></td>
                    <td>{orDash(v.host_name)}</td>
                    <td>{orDash(v.department_name ?? v.department ?? v.dept_name)}</td>
                    <td className="tabular">{timeOf(v)}</td>
                    {canCheckIn && (
                      <td className="num">
                        {v.id && (
                          <button type="button" onClick={() => navigate(`/gate/checkin/${v.id}`)} className="btn-primary btn-sm">
                            <Check size={13} /> Check in
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section">
        <SectionTitle icon={UserCheck} tone="success" title="On premises" meta={`${active.length} inside`} />
        {active.length === 0 ? (
          <Empty icon={UserCheck} title="No visitors on the premises" hint="Visitors appear here when security checks them in at the gate." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Visitor</th><th>Host</th><th>State</th><th>Checked in</th></tr></thead>
              <tbody>
                {active.map((v, i) => (
                  <tr key={v.visit_log_id ?? v.id ?? i}>
                    <td className="font-medium">{orDash(v.visitor_name)}<span className="cell-sub mono">{v.pass_number}</span></td>
                    <td>{orDash(v.host_name)}</td>
                    <td><State tone="info">On premises</State></td>
                    <td className="tabular">{fmtClock(v.check_in_at ?? v.check_in_time ?? v.checked_in_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/* ─── B: Employee ────────────────────────────────────────────────────────── */
function EmployeeDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [inbox, setInbox] = useState([]);
  const [upcomingVisits, setUpcomingVisits] = useState([]);
  const [myTotal, setMyTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [inboxRes, upcomingRes, totalRes] = await Promise.all([
        apiClient.get("/approvals/inbox"),
        apiClient.get("/visit-requests/my?upcoming=true&limit=5"),
        apiClient.get("/visit-requests/my?limit=1"),
      ]);
      setInbox(inboxRes.data?.data?.items ?? inboxRes.data?.data ?? []);
      setUpcomingVisits(upcomingRes.data?.data?.requests ?? []);
      setMyTotal(totalRes.data?.data?.pagination?.total ?? 0);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Socket: a new request for me → add it at once
  useSocketEvent("visit:request:new", (data) => {
    setInbox((prev) => {
      if (prev.some((i) => i.visit_request_id === data.visit_request_id)) return prev;
      return [{
        visit_request_id: data.visit_request_id, visitor_name: data.visitor_name, visitor_phone: data.visitor_phone,
        visit_date: data.visit_date, visit_start_time: data.visit_start_time, visit_category: data.visit_category, purpose: data.purpose,
      }, ...prev];
    });
    toast(`New visit request from ${data.visitor_name || "a visitor"}.`, { duration: 4000 });
  }, []);

  // Socket: I decided from another view → drop it
  useSocketEvent("visit:actioned", (data) => {
    setInbox((prev) => prev.filter((i) => (i.visit_request_id ?? i.id) !== data.visit_request_id));
  }, []);

  const approvals = useApprovalModal(fetchData);

  if (loading) return <><PageHeader title="Dashboard" /><Spinner label="Loading your dashboard…" /></>;

  return (
    <div className="animate-fade-in">
      {approvals.modal}
      <PageHeader title="Dashboard" meta={user?.unit_name}
        actions={<button type="button" className="btn-primary" onClick={() => navigate("/requests/new")}><Plus size={14} /> New request</button>} />

      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr_1fr] gap-3 mb-7">
        <HeroTile label="Waiting for your approval" value={inbox.length} tone={inbox.length > 0 ? "warning" : undefined}
          hint={inbox.length ? "Visitors asking to meet you" : "Nothing is waiting for you"} />
        <MetricTile label="Upcoming visits" value={upcomingVisits.length} hint="Approved visits ahead" onClick={() => navigate("/requests")} />
        <MetricTile label="My requests" value={myTotal} hint="All time" onClick={() => navigate("/requests")} />
      </div>

      <section className="section !mt-0">
        <SectionTitle icon={AlertCircle}  title="Needs your approval" meta={inbox.length ? `${inbox.length} open` : undefined}
          actions={inbox.length > 5 && <button type="button" className="btn-link text-[12px]" onClick={() => navigate("/approvals")}>View all {inbox.length}</button>} />
        {inbox.length === 0 ? (
          <Empty icon={Check} title="You’re all caught up" hint="Requests from visitors who want to meet you appear here." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Visitor</th><th>Visit</th><th>Purpose</th><th className="num">Decision</th></tr></thead>
              <tbody>
                {inbox.slice(0, 5).map((row, i) => (
                  <tr key={row.visit_request_id ?? row.id ?? i} className="is-clickable" onClick={() => navigate(`/requests/${row.visit_request_id ?? row.id}`)}>
                    <td className="font-medium">{orDash(row.visitor_name)}<span className="cell-sub">{describe(row.visit_category).label}</span></td>
                    <td className="tabular whitespace-nowrap">{fmtDate(row.visit_date)}<span className="cell-sub">{timeOf(row)}</span></td>
                    <td className="max-w-[260px] truncate">{orDash(row.purpose)}</td>
                    <td className="num" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1.5">
                        <button type="button" onClick={() => approvals.open("reject", row.visit_request_id ?? row.id)} className="btn-danger btn-sm"><X size={13} /> Reject</button>
                        <button type="button" onClick={() => approvals.open("approve", row.visit_request_id ?? row.id)} className="btn-primary btn-sm"><Check size={13} /> Approve</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section">
        <SectionTitle icon={Calendar} title="Upcoming visits"
          actions={<button type="button" className="btn-link text-[12px]" onClick={() => navigate("/requests")}>All requests</button>} />
        {upcomingVisits.length === 0 ? (
          <Empty icon={Calendar} title="No upcoming visits" hint="Approved visits you host or make appear here." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Visitor</th><th>Type</th><th>Visit</th><th>Purpose</th></tr></thead>
              <tbody>
                {upcomingVisits.map((v, i) => (
                  <tr key={v.id ?? i} className="is-clickable" onClick={() => v.id && navigate(`/requests/${v.id}`)}>
                    <td className="font-medium">{orDash(v.visitor_name)}</td>
                    <td><Status value={v.visit_category || v.visitor_type_code || v.visitor_type} /></td>
                    <td className="tabular whitespace-nowrap">{fmtDate(v.visit_date)}<span className="cell-sub">{timeOf(v)}</span></td>
                    <td className="max-w-[280px] truncate">{orDash(v.purpose)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/* ─── C: Unit admin (also /unit-dashboard for a super admin managing a unit) ── */
function AdminDashboard({ unitName: unitNameProp } = {}) {
  const navigate = useNavigate();
  const { activeUnit, isSuperAdmin, user } = useAuth();
  // Super admins oversee a unit here but approvals are for unit staff (API enforces this too)
  const canApprove = !isSuperAdmin;
  const unitName = unitNameProp ?? activeUnit?.name ?? user?.unit_name ?? null;
  const [dashData, setDashData] = useState(null);
  const [inbox, setInbox] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [dashRes, inboxRes, pendingRes] = await Promise.all([
        apiClient.get("/gate/dashboard"),
        apiClient.get("/approvals/inbox"),
        apiClient.get("/visit-requests?status=PENDING&limit=1"),
      ]);
      setDashData(dashRes.data?.data ?? dashRes.data);
      const ibRaw = inboxRes.data?.data;
      setInbox(ibRaw?.items ?? (Array.isArray(ibRaw) ? ibRaw : []));
      setPendingCount(pendingRes.data?.data?.pagination?.total ?? 0);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useSocketEvent("visit:request:new", (data) => {
    setInbox((prev) => {
      if (prev.some((i) => i.visit_request_id === data.visit_request_id)) return prev;
      return [{
        visit_request_id: data.visit_request_id, visitor_name: data.visitor_name, visitor_phone: data.visitor_phone,
        visit_date: data.visit_date, visit_start_time: data.visit_start_time, visit_category: data.visit_category, purpose: data.purpose,
      }, ...prev];
    });
    setPendingCount((prev) => prev + 1);
    toast(`New visit request from ${data.visitor_name || "a visitor"}.`, { duration: 4000 });
  }, []);
  useSocketEvent("visit:approved", () => { setPendingCount((prev) => Math.max(0, prev - 1)); }, []);
  useSocketEvent("visit:rejected", () => { setPendingCount((prev) => Math.max(0, prev - 1)); }, []);
  useSocketEvent("visit:actioned", (data) => {
    setInbox((prev) => prev.filter((i) => (i.visit_request_id ?? i.id) !== data.visit_request_id));
    setPendingCount((prev) => Math.max(0, prev - 1));
  }, []);

  const approvals = useApprovalModal(fetchData);

  if (loading) return <><PageHeader title="Dashboard" /><Spinner label="Loading the unit dashboard…" /></>;

  const summary = dashData?.summary ?? {};
  const yetToCome = dashData?.yet_to_come ?? [];
  const expected = summary.yet_to_come_count ?? yetToCome.length;
  const inside = summary.active_count ?? 0;
  const completed = summary.completed_today_count ?? 0;

  return (
    <div className="animate-fade-in">
      {approvals.modal}
      <PageHeader title="Dashboard" meta={unitName}
        actions={<button type="button" className="btn-outline" onClick={() => navigate("/reports")}>Open reports</button>} />

      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr_1fr] gap-3 mb-7">
        <HeroTile label="Visitors today" value={expected + inside + completed} hint={fmtDate(new Date())}
          parts={[
            { label: "Expected", value: expected, color: "var(--ramp-1)" },
            { label: "On premises", value: inside, color: "var(--ramp-3)" },
            { label: "Left", value: completed, color: "var(--ramp-4)" },
          ]} />
        <MetricTile label="Waiting for approval" value={pendingCount} tone={pendingCount > 0 ? "warning" : undefined}
          hint="Across the unit" onClick={() => navigate("/requests")} />
        <MetricTile label="On premises now" value={inside} hint="Checked in, not yet out" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-8">
        <section className="section !mt-0">
          <SectionTitle icon={Clock} title="Expected today" meta={`${yetToCome.length}`} />
          {yetToCome.length === 0 ? (
            <Empty icon={Calendar} title="No visitors expected today" hint="Approved visits for today appear here." />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Visitor</th><th>Host</th><th>Time</th></tr></thead>
                <tbody>
                  {yetToCome.slice(0, 8).map((v, i) => (
                    <tr key={v.id ?? i} className="is-clickable" onClick={() => v.id && navigate(`/requests/${v.id}`)}>
                      <td className="font-medium">{orDash(v.visitor_name)}<span className="cell-sub">{describe(v.visit_category).label}</span></td>
                      <td>{orDash(v.host_name)}<span className="cell-sub">{orDash(v.department_name)}</span></td>
                      <td className="tabular">{timeOf(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="section xl:!mt-0">
          <SectionTitle icon={AlertCircle} tone="warning" title="Needs your attention" meta={inbox.length ? `${inbox.length} open` : undefined}
            actions={canApprove && inbox.length > 5 && <button type="button" className="btn-link text-[12px]" onClick={() => navigate("/approvals")}>View all {inbox.length}</button>} />
          {inbox.length === 0 ? (
            <Empty icon={Check} title="Nothing is waiting" hint="Requests that need a decision appear here." />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Visitor</th><th>Date</th><th className="num">{canApprove ? "Decision" : ""}</th></tr></thead>
                <tbody>
                  {inbox.slice(0, 5).map((row, i) => (
                    <tr key={row.visit_request_id ?? row.id ?? i} className="is-clickable" onClick={() => navigate(`/requests/${row.visit_request_id ?? row.id}`)}>
                      <td className="font-medium">{orDash(row.visitor_name)}<span className="cell-sub">{describe(row.visit_category).label}</span></td>
                      <td className="tabular whitespace-nowrap">{fmtDate(row.visit_date)}</td>
                      <td className="num" onClick={(e) => e.stopPropagation()}>
                        {canApprove ? (
                          <div className="flex justify-end gap-1.5">
                            <button type="button" onClick={() => approvals.open("reject", row.visit_request_id ?? row.id)} className="btn-danger btn-sm"><X size={13} /> Reject</button>
                            <button type="button" onClick={() => approvals.open("approve", row.visit_request_id ?? row.id)} className="btn-primary btn-sm"><Check size={13} /> Approve</button>
                          </div>
                        ) : (
                          <Tag tone="neutral">Unit staff decide</Tag>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/* ─── D: Super admin / global auditor ───────────────────────────────────── */
function SuperAdminDashboard() {
  const navigate = useNavigate();
  const { isGlobalAuditor, setActiveUnit } = useAuth();
  const [units, setUnits] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [unitsRes, summaryRes] = await Promise.all([
        apiClient.get("/units"),
        apiClient.get("/reports/global-summary"),
      ]);
      const unitsRaw = unitsRes.data?.data;
      setUnits(unitsRaw?.units ?? (Array.isArray(unitsRaw) ? unitsRaw : []));
      setSummary(summaryRes.data?.data ?? {});
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  if (loading) return <><PageHeader title="Dashboard" /><Spinner label="Loading the system overview…" /></>;

  const s = summary ?? {};
  const inside = s.currently_inside ?? 0;
  const today = s.today_visits ?? 0;

  const openUnit = (u) => {
    if (isGlobalAuditor) {
      setActiveUnit({ id: u.id, name: u.name, db_name: u.db_name });
      toast.success(`Auditing ${u.name}.`);
    } else {
      navigate("/super/units");
    }
  };

  return (
    <div className="animate-fade-in">
      <PageHeader title="Dashboard" meta="All units"
        actions={!isGlobalAuditor && (
          <button type="button" onClick={() => navigate("/super/units")} className="btn-primary"><Plus size={14} /> Add unit</button>
        )} />

      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr_1fr] gap-3 mb-3">
        <HeroTile label="Visits today" value={today} hint="Across every unit"
          parts={[
            { label: "On premises", value: inside, color: "var(--ramp-3)" },
            { label: "Other visits today", value: Math.max(0, today - inside), color: "var(--ramp-1)" },
          ]} />
        <MetricTile label="This month" value={s.this_month_visits ?? 0} unit="visits" hint={`${fmtNumber(s.total_visits ?? 0)} visits in all`} />
        <MetricTile label="Units" value={s.total_units ?? units.length}
          hint={`${s.active_units ?? 0} active${s.provisioning_units ? ` · ${s.provisioning_units} provisioning` : ""}`}
          onClick={isGlobalAuditor ? undefined : () => navigate("/super/units")} />
      </div>

      <section className="section">
        <SectionTitle icon={Building2} title="Units" meta={`${units.length}`}
          actions={!isGlobalAuditor && <button type="button" className="btn-link text-[12px]" onClick={() => navigate("/super/units")}>Manage units</button>} />
        {units.length === 0 ? (
          <Empty icon={Building2} title="No units yet" hint="Units appear here once they are created in Unit management." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Unit</th><th>Code</th><th>Office type</th><th>Status</th></tr></thead>
              <tbody>
                {units.slice(0, 8).map((u, i) => (
                  <tr key={u.id ?? i} className="is-clickable" onClick={() => openUnit(u)} title={isGlobalAuditor ? "Audit this unit" : "Manage units"}>
                    <td className="font-medium">{u.name}</td>
                    <td className="mono">{u.code}</td>
                    <td>{orDash(u.type)}</td>
                    <td><State tone={describe(u.db_status).tone}>{describe(u.db_status).label}</State></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section">
        <SectionTitle icon={ClipboardList} title="Records" />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => navigate("/reports")} className="btn-outline">Open reports</button>
          <button type="button" onClick={() => navigate("/audit-logs")} className="btn-outline">Open audit logs</button>
        </div>
      </section>
    </div>
  );
}

/* ─── Root ───────────────────────────────────────────────────────────────── */
export default function Dashboard() {
  const { hasRole, isSuperAdmin, isGlobalAuditor } = useAuth();
  // Super admins always see their own system overview at /dashboard;
  // the managed unit's dashboard is /unit-dashboard.
  if (isSuperAdmin || isGlobalAuditor) return <SuperAdminDashboard />;
  if (hasRole("security", "receptionist")) return <SecurityDashboard />;
  if (hasRole("employee")) return <EmployeeDashboard />;
  return <AdminDashboard />;
}

// Named export: App.jsx uses AdminDashboard for the /unit-dashboard route
export { AdminDashboard };
