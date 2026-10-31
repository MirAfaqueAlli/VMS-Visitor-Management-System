// frontend/src/pages/approvals/ApprovalInbox.jsx
// Visit requests waiting for the signed-in host's (or unit admin's) decision.
// List anatomy (DESIGN_RULES §6/§8): stat strip, toolbar, plain sortable table;
// rows open the request; Approve / Reject is the row's real action.
import { Fragment, useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Check, X, Loader2, AlertTriangle, RefreshCw } from "../../components/icons";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";
import Pagination from "../../components/shared/Pagination";
import useSocketEvent from "../../hooks/useSocketEvent";
import useAuth from "../../hooks/useAuth";
import useTheme from "../../context/ThemeContext";
import { PageHeader, StatStrip, Stat, Toolbar, Th, SkeletonRows, Tag, Modal, Note } from "../../components/ui";
import useSort from "../../lib/useSort";
import { fmtDate, fmtTime, relTime, orDash } from "../../lib/format";

const nonotifcationlight = "/No Notifications Bell Illustration.png";
const nonotifcationdark = "/Dark 3D Notification Bell Illustration.png";

const CATEGORY_LABELS = {
  EMPLOYEE_VISIT: "Employee visit",
  VENDOR:         "Vendor",
  SPOT:           "Walk-in",
  PERSONAL_VISIT: "Personal visit",
};

const isToday = (d) => d && new Date(d).toDateString() === new Date().toDateString();

/* ── One request: row + (when deciding) a remarks row under it ──────────────── */
function ApprovalRow({ item, isUnitAdmin, onActionSuccess, onOpen }) {
  const [mode,         setMode]         = useState(null);   // null | 'approve' | 'reject'
  const [remarks,      setRemarks]      = useState("");
  const [remarkError,  setRemarkError]  = useState("");
  const [submitting,   setSubmitting]   = useState(false);
  const [conflictData, setConflictData] = useState(null);

  const name = item.visitor_name || item.requester_name || "Unknown visitor";

  const doApprove = async (forceApprove = false) => {
    setSubmitting(true);
    try {
      await apiClient.put(`/approvals/${item.visit_request_id}/approve`, {
        remarks: remarks.trim() || undefined,
        force_approve: forceApprove || undefined,
      });
      toast.success(`${name}'s visit approved — the gate pass has been sent to the visitor.`);
      setConflictData(null);
      onActionSuccess(item.visit_request_id);
    } catch (err) {
      const data = err.response?.data;
      if (err.response?.status === 409 && data?.conflict && data?.host_conflict) {
        setConflictData(data.host_conflict);
      } else {
        toast.error(data?.message || "Failed to approve request.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirm = async () => {
    if (mode === "reject" && !remarks.trim()) {
      setRemarkError("Enter the reason for rejecting — the visitor is told it.");
      return;
    }
    setRemarkError("");
    if (mode === "approve") { await doApprove(false); return; }
    setSubmitting(true);
    try {
      await apiClient.put(`/approvals/${item.visit_request_id}/reject`, { remarks: remarks.trim() || undefined });
      toast.success(`${name}'s visit rejected — the visitor has been told.`);
      onActionSuccess(item.visit_request_id);
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to reject request.");
    } finally {
      setSubmitting(false);
    }
  };

  const openMode = (m) => { setMode(m); setRemarks(""); setRemarkError(""); };
  const handleCancel = () => { setMode(null); setRemarks(""); setRemarkError(""); };

  return (
    <Fragment>
      <tr className={`is-clickable${mode ? " is-selected" : ""}`} onClick={onOpen}>
        <td>
          <span className="inline-flex items-center gap-1.5 flex-wrap">
            <span className="font-medium">{name}</span>
            {item.visit_category === "SPOT" && <Tag tone="warning">At the gate</Tag>}
          </span>
          <span className="cell-sub">
            {CATEGORY_LABELS[item.visit_category] ?? item.visit_category ?? "Visit"}
            {item.visitor_phone ? ` · ${item.visitor_phone}` : ""}
          </span>
        </td>
        <td className="whitespace-nowrap tabular">
          {fmtDate(item.visit_date)}
          <span className="cell-sub">{item.visit_start_time ? fmtTime(item.visit_start_time) : "Any time"}</span>
        </td>
        <td className="max-w-[280px]">
          <span className="block truncate" title={item.purpose || undefined}>{orDash(item.purpose)}</span>
          {isUnitAdmin && item.host_name && (
            <span className="cell-sub">Host: {item.host_name}{item.department_name ? `, ${item.department_name}` : ""}</span>
          )}
        </td>
        <td className="whitespace-nowrap text-muted">{relTime(item.assigned_at)}</td>
        <td onClick={(e) => e.stopPropagation()}>
          <div className="flex justify-end gap-1.5">
            <button type="button" className="btn-danger btn-sm" onClick={() => openMode("reject")} disabled={submitting}>
              <X size={13} /> Reject
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={() => openMode("approve")} disabled={submitting}>
              <Check size={13} /> Approve
            </button>
          </div>
        </td>
      </tr>

      {mode && (
        <tr className="is-selected">
          <td colSpan={5} onClick={(e) => e.stopPropagation()}>
            <div className="max-w-[720px] py-1">
              <label htmlFor={`remarks-${item.visit_request_id}`} className="field-label">
                {mode === "approve" ? "Remarks for the visitor (optional)" : "Reason for rejecting"}
                {mode === "reject" && <span className="req">*</span>}
              </label>
              <textarea
                id={`remarks-${item.visit_request_id}`}
                rows={2}
                autoFocus
                value={remarks}
                onChange={(e) => { setRemarks(e.target.value); setRemarkError(""); }}
                placeholder={mode === "approve" ? "e.g. Meeting room 2B is booked" : "e.g. The host is on leave that day"}
                className={`control resize-none${remarkError ? " is-invalid" : ""}`}
                aria-invalid={!!remarkError}
              />
              {remarkError && <p className="field-error" role="alert">{remarkError}</p>}
              <div className="flex justify-end gap-2 mt-2">
                <button type="button" onClick={handleCancel} disabled={submitting} className="btn-outline btn-sm">Cancel</button>
                <button type="button" onClick={handleConfirm} disabled={submitting}
                  className={mode === "approve" ? "btn-primary btn-sm" : "btn-danger btn-sm"}>
                  {submitting ? <Loader2 size={13} className="animate-spin" /> : mode === "approve" ? <Check size={13} /> : <X size={13} />}
                  {submitting ? "Saving…" : mode === "approve" ? `Approve ${name}'s visit` : `Reject ${name}'s visit`}
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}

      {/* Schedule conflict: the host already has a visit at this time */}
      <Modal
        open={!!conflictData}
        onClose={() => { setConflictData(null); setSubmitting(false); }}
        busy={submitting}
        width={440}
        title="Schedule conflict"
        footer={(
          <>
            <button type="button" className="btn-outline" onClick={() => { setConflictData(null); setSubmitting(false); }} disabled={submitting}>
              Keep it pending
            </button>
            <button type="button" className="btn-primary" onClick={() => doApprove(true)} disabled={submitting}>
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Approve anyway
            </button>
          </>
        )}
      >
        {conflictData && (
          <Note tone="warning" icon={AlertTriangle}>
            <b>{conflictData.visitor_name}</b> is already visiting the host during <b>{conflictData.time_window}</b>.
            Approving anyway books both visits at the same time.
          </Note>
        )}
      </Modal>
    </Fragment>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────────── */
export default function ApprovalInbox() {
  const { user }    = useAuth();
  const { theme }   = useTheme();
  const navigate    = useNavigate();
  const isUnitAdmin = user?.role_type === "unit_admin";
  const [items,      setItems]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [page,       setPage]       = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const limit = 10;

  const fetchInbox = useCallback(async () => {
    try {
      setLoading(true);
      const res  = await apiClient.get("/approvals/inbox", { params: { page, limit } });
      const data = res.data?.data;
      setItems(data?.items || []);
      setTotalPages(data?.pagination?.pages || 1);
      setTotalCount(data?.pagination?.total  || 0);
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to load approval inbox.");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { fetchInbox(); }, [fetchInbox]);

  const handleActionSuccess = (visitRequestId) => {
    setItems((prev) => prev.filter((i) => i.visit_request_id !== visitRequestId));
    setTotalCount((n) => Math.max(0, n - 1));
  };

  /* Socket: new request arrives */
  useSocketEvent("visit:request:new", (data) => {
    if (page === 1) {
      setItems((prev) => {
        if (prev.some((i) => i.visit_request_id === data.visit_request_id)) return prev;
        return [{
          visit_request_id: data.visit_request_id,
          visitor_name:     data.visitor_name,
          visitor_phone:    data.visitor_phone,
          visit_date:       data.visit_date,
          visit_start_time: data.visit_start_time,
          visit_category:   data.visit_category,
          purpose:          data.purpose,
          assigned_at:      data.created_at,
        }, ...prev];
      });
    }
    setTotalCount((n) => n + 1);
    toast.success(`New visit request from ${data.visitor_name || "a visitor"}.`, { duration: 5000 });
  }, [page]);

  /* Socket: own approve/reject from another view */
  useSocketEvent("visit:actioned", (data) => {
    setItems((prev) => prev.filter((i) => i.visit_request_id !== data.visit_request_id));
    setTotalCount((n) => Math.max(0, n - 1));
  }, []);

  const { rows, sort, onSort } = useSort(items, {
    visitor: (i) => i.visitor_name || i.requester_name,
    visit: (i) => `${String(i.visit_date).slice(0, 10)} ${i.visit_start_time || ""}`,
    purpose: (i) => i.purpose,
    received: (i) => i.assigned_at,
  });

  const todayCount = items.filter((i) => isToday(i.visit_date)).length;
  const walkIns    = items.filter((i) => i.visit_category === "SPOT").length;

  const refresh = (
    <button type="button" onClick={fetchInbox} disabled={loading} className="btn-outline">
      <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
    </button>
  );

  return (
    <div className="animate-fade-in">
      <PageHeader title="Approvals" actions={refresh} />

      {/* Nothing pending: the illustrated empty state */}
      {!loading && items.length === 0 ? (
        <div className="py-12 flex flex-col items-center justify-center text-center gap-5">
          <div className="w-80 h-80 flex items-center justify-center">
            <img
              className="w-full h-full object-contain"
              src={theme === "dark" ? nonotifcationdark : nonotifcationlight}
              alt="No notifications"
            />
          </div>
          <div>
            <h2 className="text-[17px] font-semibold mb-1">You’re all caught up</h2>
            <p className="text-muted max-w-xs mx-auto text-[12.5px]">
              No pending approvals right now. New requests assigned to you will appear here.
            </p>
          </div>
        </div>
      ) : (
        <>
          <StatStrip cols={3}>
            <Stat label="Waiting for you" value={totalCount} loading={loading} tone={totalCount > 0 ? "warning" : undefined}
              hint="Requests that need your decision" />
            <Stat label="Visiting today" value={todayCount} loading={loading} hint="Of the requests on this page" />
            <Stat label="Walk-ins at the gate" value={walkIns} loading={loading} tone={walkIns > 0 ? "warning" : undefined}
              hint="Visitors waiting at reception" />
          </StatStrip>

          <Toolbar count={loading ? null : totalCount} noun={totalCount === 1 ? "request waiting" : "requests waiting"} />

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <Th sortKey="visitor" sort={sort} onSort={onSort}>Visitor</Th>
                  <Th sortKey="visit" sort={sort} onSort={onSort}>Visit</Th>
                  <Th sortKey="purpose" sort={sort} onSort={onSort}>Purpose</Th>
                  <Th sortKey="received" sort={sort} onSort={onSort}>Received</Th>
                  <Th align="right">Decision</Th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonRows rows={5} cols={5} />
                ) : (
                  rows.map((item) => (
                    <ApprovalRow
                      key={item.visit_request_id}
                      item={item}
                      isUnitAdmin={isUnitAdmin}
                      onActionSuccess={handleActionSuccess}
                      onOpen={() => navigate(`/requests/${item.visit_request_id}`)}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>

          {!loading && <Pagination page={page} totalPages={totalPages} totalCount={totalCount} onPageChange={setPage} />}
        </>
      )}
    </div>
  );
}
