// frontend/src/pages/approvals/ApprovalInbox.jsx
// Visit requests waiting for the signed-in host's (or unit admin's) decision,
// shown as one plain list. Neutral colours; the accent marks only the main action.
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Check, X, Loader2, AlertTriangle, Eye, Phone, CalendarDays, Clock, UserRound,
  Building2, FileText, RefreshCw, CornerDownRight,
} from "lucide-react";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";
import Pagination from "../../components/shared/Pagination";
import useSocketEvent from "../../hooks/useSocketEvent";
import useAuth from "../../hooks/useAuth";
import useTheme from "../../context/ThemeContext";

const nonotifcationlight = "/No Notifications Bell Illustration.png";
const nonotifcationdark = "/Dark 3D Notification Bell Illustration.png";

const CATEGORY_LABELS = {
  EMPLOYEE_VISIT: "Employee visit",
  VENDOR:         "Vendor",
  SPOT:           "Walk-in",
  PERSONAL_VISIT: "Personal visit",
};

// Desktop column layout shared by the header row and every item row
const COLUMNS = "md:grid md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.4fr)_minmax(0,1fr)_auto] md:items-center md:gap-6";

// ── Helpers ────────────────────────────────────────────────────────────────────
function timeAgo(dateStr) {
  if (!dateStr) return "—";
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs > 1 ? "s" : ""} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

const initials = (name) =>
  String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

const Meta = ({ icon: Icon, children }) => (
  <span className="inline-flex items-center gap-1.5 min-w-0">
    <Icon size={13} strokeWidth={1.8} className="shrink-0" style={{ color: "var(--color-text-faint)" }} />
    <span className="truncate">{children}</span>
  </span>
);

// ── Schedule conflict dialog ───────────────────────────────────────────────────
function ConflictModal({ conflict, onContinue, onGoBack, loading }) {
  if (!conflict) return null;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-overlay backdrop-blur-sm" onClick={onGoBack} />
      <div role="dialog" aria-modal="true" aria-labelledby="conflict-title"
        className="relative w-full max-w-md vms-card rounded-lg shadow-2xl animate-fade-in overflow-hidden">
        <div className="flex items-start gap-3 px-6 pt-5 pb-4" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <AlertTriangle size={18} strokeWidth={2} className="mt-0.5 shrink-0" style={{ color: "var(--color-warning)" }} />
          <div className="flex-1">
            <h2 id="conflict-title" className="text-[15px] font-semibold text-loud">Schedule conflict</h2>
            <p className="text-xs text-faint mt-0.5">The host already has a visit at this time.</p>
          </div>
          <button onClick={onGoBack} className="text-faint hover:text-loud transition-colors" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="px-6 py-5 text-[13px] text-loud leading-relaxed">
          <strong>{conflict.visitor_name}</strong> is already visiting the host during <strong>{conflict.time_window}</strong>.
          <p className="text-xs text-faint mt-3">Go back to leave the request pending, or approve it anyway.</p>
        </div>
        <div className="flex items-center gap-3 px-6 pb-5">
          <button onClick={onGoBack} disabled={loading} className="flex-1 btn-secondary justify-center">Go back</button>
          <button onClick={onContinue} disabled={loading} className="flex-1 btn-primary justify-center">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Approve anyway
          </button>
        </div>
      </div>
    </div>
  );
}

// ── One request in the list ────────────────────────────────────────────────────
function ApprovalRow({ item, isUnitAdmin, onActionSuccess }) {
  const navigate                        = useNavigate();
  const [mode,         setMode]         = useState(null);   // null | 'approve' | 'reject'
  const [remarks,      setRemarks]      = useState("");
  const [remarkError,  setRemarkError]  = useState("");
  const [submitting,   setSubmitting]   = useState(false);
  const [conflictData, setConflictData] = useState(null);

  const name = item.visitor_name || item.requester_name || "Unknown visitor";
  const time = item.visit_start_time ? ` · ${String(item.visit_start_time).slice(0, 5)}` : "";

  const doApprove = async (forceApprove = false) => {
    setSubmitting(true);
    try {
      await apiClient.put(`/approvals/${item.visit_request_id}/approve`, {
        remarks: remarks.trim() || undefined,
        force_approve: forceApprove || undefined,
      });
      toast.success("Request approved. The gate pass has been sent to the visitor.");
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
      setRemarkError("A reason is required when rejecting a request.");
      return;
    }
    setRemarkError("");
    if (mode === "approve") { await doApprove(false); return; }
    setSubmitting(true);
    try {
      await apiClient.put(`/approvals/${item.visit_request_id}/reject`, { remarks: remarks.trim() || undefined });
      toast.success("Request rejected.");
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
    <li style={{ borderBottom: "1px solid var(--color-border)", background: mode ? "var(--color-bg-primary)" : undefined }}>
      <ConflictModal
        conflict={conflictData}
        loading={submitting}
        onGoBack={() => { setConflictData(null); setSubmitting(false); }}
        onContinue={() => doApprove(true)}
      />

      <div className={`px-5 py-4 space-y-3 md:space-y-0 ${COLUMNS}`}>
        {/* Visitor */}
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-semibold shrink-0"
            style={{ background: "var(--color-bg-primary)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>
            {initials(name)}
          </span>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-loud truncate">{name}</p>
            <p className="text-[12px] flex items-center gap-3 flex-wrap" style={{ color: "var(--color-text-muted)" }}>
              <span>{CATEGORY_LABELS[item.visit_category] ?? item.visit_category ?? "Visit"}</span>
              {item.visitor_phone && <Meta icon={Phone}>{item.visitor_phone}</Meta>}
            </p>
          </div>
        </div>

        {/* Visit */}
        <div className="min-w-0 text-[12.5px] space-y-1" style={{ color: "var(--color-text-muted)" }}>
          <div className="text-loud font-medium"><Meta icon={CalendarDays}>{formatDate(item.visit_date)}{time}</Meta></div>
          <div title={item.purpose || undefined}><Meta icon={FileText}>{item.purpose || "No purpose given"}</Meta></div>
        </div>

        {/* Host / received */}
        <div className="min-w-0 text-[12.5px] space-y-1" style={{ color: "var(--color-text-muted)" }}>
          {isUnitAdmin && item.host_name && (
            <div><Meta icon={UserRound}>{item.host_name}{item.department_name ? `, ${item.department_name}` : ""}</Meta></div>
          )}
          {item.requester_name && item.requester_name !== name && (
            <div><Meta icon={Building2}>Raised by {item.requester_name}</Meta></div>
          )}
          <div><Meta icon={Clock}>Received {timeAgo(item.assigned_at)}</Meta></div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 md:justify-end">
          <button
            onClick={() => navigate(`/requests/${item.visit_request_id}`)}
            className="btn-secondary px-2.5 text-[12px]"
            title="View details"
            aria-label={`View details for ${name}`}
          >
            <Eye size={14} />
            <span className="md:hidden xl:inline">Details</span>
          </button>
          <button
            onClick={() => openMode("reject")}
            disabled={submitting}
            className="btn-secondary px-3 text-[12px]"
            style={mode === "reject" ? { borderColor: "var(--color-text)", color: "var(--color-text)" } : undefined}
          >
            <X size={14} /> Reject
          </button>
          <button onClick={() => openMode("approve")} disabled={submitting} className="btn-primary px-3 text-[12px]">
            <Check size={14} /> Approve
          </button>
        </div>
      </div>

      {/* Remarks + confirm */}
      {mode && (
        <div className="px-5 pb-4 md:pl-[4.25rem] animate-fade-in">
          <label htmlFor={`remarks-${item.visit_request_id}`}
            className="flex items-center gap-1.5 text-[12px] font-semibold text-loud mb-1.5">
            <CornerDownRight size={13} style={{ color: "var(--color-text-faint)" }} />
            {mode === "approve" ? "Approve this request" : "Reject this request"}
            <span className="font-normal" style={{ color: "var(--color-text-faint)" }}>
              — {mode === "approve" ? "remarks are optional" : "a reason is required"}
            </span>
          </label>
          <textarea
            id={`remarks-${item.visit_request_id}`}
            rows={2}
            autoFocus
            value={remarks}
            onChange={(e) => { setRemarks(e.target.value); setRemarkError(""); }}
            placeholder={mode === "approve" ? "e.g. Meeting room 2B is booked" : "Reason for rejecting the request"}
            className="vms-input resize-none"
            style={remarkError ? { borderColor: "var(--color-error)" } : undefined}
            aria-invalid={!!remarkError}
          />
          {remarkError && (
            <p className="mt-1.5 text-[12px] flex items-center gap-1" style={{ color: "var(--color-error)" }}>
              <AlertTriangle size={12} /> {remarkError}
            </p>
          )}
          <div className="flex items-center gap-2 mt-3">
            <button onClick={handleConfirm} disabled={submitting} className="btn-primary text-[12.5px]">
              {submitting ? <Loader2 size={14} className="animate-spin" /> : mode === "approve" ? <Check size={14} /> : <X size={14} />}
              {submitting ? "Saving…" : mode === "approve" ? "Confirm approval" : "Confirm rejection"}
            </button>
            <button onClick={handleCancel} disabled={submitting} className="btn-secondary text-[12.5px]">Cancel</button>
          </div>
        </div>
      )}
    </li>
  );
}

function SkeletonRow() {
  const bar = (w) => <div className="h-3 rounded animate-pulse" style={{ width: w, background: "var(--color-border)" }} />;
  return (
    <li className={`px-5 py-4 space-y-3 md:space-y-0 ${COLUMNS}`} style={{ borderBottom: "1px solid var(--color-border)" }}>
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full animate-pulse" style={{ background: "var(--color-border)" }} />
        <div className="space-y-2">{bar(130)}{bar(80)}</div>
      </div>
      <div className="space-y-2">{bar(150)}{bar(110)}</div>
      <div className="space-y-2">{bar(100)}{bar(80)}</div>
      <div className="flex gap-2 md:justify-end">{bar(60)}{bar(70)}</div>
    </li>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function ApprovalInbox() {
  const { user }    = useAuth();
  const { theme }   = useTheme();
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
    toast.success("New visit request received.", { duration: 5000 });
  }, [page]);

  /* Socket: own approve/reject from another view */
  useSocketEvent("visit:actioned", (data) => {
    setItems((prev) => prev.filter((i) => i.visit_request_id !== data.visit_request_id));
    setTotalCount((n) => Math.max(0, n - 1));
  }, []);

  return (
    <div className="max-w-7xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-6 gap-4">
        <div>
          <h1 className="text-xl font-bold text-loud">Approvals</h1>
        </div>
        <button onClick={fetchInbox} disabled={loading} className="btn-secondary text-[12.5px]">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {/* Nothing pending: the original illustrated empty state */}
      {!loading && items.length === 0 ? (
        <div className="vms-card rounded-md py-20 flex flex-col items-center justify-center text-center gap-5 border-none">
          <div className="w-80 h-80 rounded-full  flex items-center justify-center">
            <img
              className="w-full h-full object-contain"
              src={theme === "dark" ? nonotifcationdark : nonotifcationlight}
              alt="No notifications"
            />
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-loud mb-2">
              You&apos;re all <em className="italic">caught up</em>
            </h2>
            <p className="text-faint max-w-xs mx-auto text-sm">
              No pending approvals right now. New requests assigned to you will appear here.
            </p>
          </div>
        </div>
      ) : (
      <div className="vms-card rounded-lg overflow-hidden">
        {/* Column headings (desktop) */}
        <div className={`hidden ${COLUMNS} px-5 py-2.5 text-[10.5px] font-semibold uppercase tracking-wider`}
          style={{ color: "var(--color-text-faint)", background: "var(--color-bg-primary)", borderBottom: "1px solid var(--color-border)" }}>
          <span>Visitor</span>
          <span>Visit</span>
          <span>Host / received</span>
          <span className="text-right">Decision</span>
        </div>

        {loading ? (
          <ul>{[1, 2, 3, 4].map((n) => <SkeletonRow key={n} />)}</ul>
        ) : (
          <ul>
            {items.map((item) => (
              <ApprovalRow
                key={item.visit_request_id}
                item={item}
                isUnitAdmin={isUnitAdmin}
                onActionSuccess={handleActionSuccess}
              />
            ))}
          </ul>
        )}

        {!loading && items.length > 0 && (
          <div className="px-5 pb-4">
            <Pagination page={page} totalPages={totalPages} totalCount={totalCount} onPageChange={setPage} />
          </div>
        )}
      </div>
      )}
    </div>
  );
}
