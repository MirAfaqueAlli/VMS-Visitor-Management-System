import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  CheckCircle2,
  Clock,
  User,
  Calendar,
  Briefcase,
  Inbox,
  Check,
  X,
  ChevronDown,
  Loader2,
  AlertTriangle,
  Eye,
} from "lucide-react";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";
import Pagination from "../../components/shared/Pagination";
import useSocketEvent from "../../hooks/useSocketEvent";
import useAuth from "../../hooks/useAuth";
import nonotifcationlight from "../../../public/No Notifications Bell Illustration.png"
import nonotifcationdark from "../../../public/Dark 3D Notification Bell Illustration.png"

const CATEGORY_LABELS = {
  EMPLOYEE_VISIT: "Employee Visit",
  VENDOR:         "Vendor",
  SPOT:           "Walk-in",
  PERSONAL_VISIT: "Personal Visit",
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} minute${mins > 1 ? "s" : ""} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? "s" : ""} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

// ── Schedule Conflict Modal ────────────────────────────────────────────────────
function ConflictModal({ conflict, onContinue, onGoBack, loading }) {
  if (!conflict) return null;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-overlay backdrop-blur-sm" onClick={onGoBack} />
      <div
        className="relative w-full max-w-md rounded-xl shadow-2xl border border-subtle animate-fade-in overflow-hidden"
        style={{ background: "var(--color-bg-card)" }}
      >
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-subtle">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: "#fef9c3" }}>
              <AlertTriangle size={18} strokeWidth={2} style={{ color: "#d97706" }} />
            </div>
            <div>
              <h2 className="text-base font-bold text-loud leading-tight">Schedule Conflict Detected</h2>
              <p className="text-xs text-faint mt-0.5">Review the conflicts below before proceeding</p>
            </div>
          </div>
          <button onClick={onGoBack} className="text-faint hover:text-loud transition-colors">
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <div className="px-6 py-5">
          <div className="rounded-lg px-5 py-4 mb-5" style={{ background: "#fff7ed", border: "1px solid #fed7aa" }}>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5 flex items-center gap-1.5" style={{ color: "#ef4444" }}>
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: "#ef4444" }} />
              Host is already busy
            </p>
            <p className="text-sm text-loud leading-snug">
              <strong>{conflict.visitor_name}</strong> is already visiting the host during{" "}
              <strong>{conflict.time_window}</strong>.
            </p>
          </div>
          <p className="text-xs text-faint leading-relaxed">
            You can go back and adjust the time, or continue anyway to override the conflict.
          </p>
        </div>
        <div className="flex items-center gap-3 px-6 pb-5">
          <button onClick={onGoBack} disabled={loading} className="flex-1 btn-secondary text-sm font-medium py-2.5 disabled:opacity-60">
            Go Back
          </button>
          <button
            onClick={onContinue}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 disabled:opacity-60"
            style={{ background: "#2563eb", color: "#fff" }}
          >
            {loading ? <Loader2 size={14} strokeWidth={2} className="animate-spin" /> : <AlertTriangle size={14} strokeWidth={2} />}
            Continue Anyway
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Individual Approval Card ───────────────────────────────────────────────────
function ApprovalCard({ item, isUnitAdmin, onActionSuccess }) {
  const navigate                  = useNavigate();
  const [mode, setMode]           = useState(null);
  const [remarks, setRemarks]     = useState("");
  const [remarkError, setRemarkError] = useState("");
  const [submitting, setSubmitting]   = useState(false);
  const [conflictData, setConflictData] = useState(null);

  const doApprove = async (forceApprove = false) => {
    setSubmitting(true);
    try {
      await apiClient.put(`/approvals/${item.visit_request_id}/approve`, {
        remarks: remarks.trim() || undefined,
        force_approve: forceApprove || undefined,
      });
      toast.success("Request approved. Gate pass emailed to visitor.");
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
      await apiClient.put(`/approvals/${item.visit_request_id}/reject`, {
        remarks: remarks.trim() || undefined,
      });
      toast.success("Request rejected successfully.");
      onActionSuccess(item.visit_request_id);
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to reject request.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = () => { setMode(null); setRemarks(""); setRemarkError(""); };

  return (
    <>
      <ConflictModal
        conflict={conflictData}
        loading={submitting}
        onGoBack={() => { setConflictData(null); setSubmitting(false); }}
        onContinue={() => doApprove(true)}
      />

      <div className="vms-card rounded-md p-6 transition-all duration-500 hover:shadow-hover hover:shadow-card" style={{border:'none !important'}}>
        {/* Top Row */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          {/* Left: avatar + details */}
          <div className="flex items-start gap-4 min-w-0 flex-1">
            <div className="w-11 h-11 rounded-full bg-lightColor flex items-center justify-center shrink-0">
              <User strokeWidth={1.5} className="w-5 h-5 text-muted" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h3 className="font-semibold text-loud text-lg leading-tight truncate">
                  {item.visitor_name || item.requester_name || "Unknown Visitor"}
                </h3>
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider"
                  style={{ background: "var(--color-info-bg)", color: "var(--color-info)" }}
                >
                  {CATEGORY_LABELS[item.visit_category] ?? item.visit_category ?? "Visit"}
                </span>
              </div>
              {item.visitor_phone && (
                <p className="text-xs text-faint mt-0.5 mb-1">📞 {item.visitor_phone}</p>
              )}
              {isUnitAdmin && item.host_name && (
                <p className="text-xs text-muted mt-1 mb-2 font-medium flex items-center gap-1.5">
                  <User strokeWidth={1.5} className="w-3.5 h-3.5 text-accent" />
                  <span>Host: <strong className="text-loud">{item.host_name}</strong>{" "}
                    {item.department_name && <span className="text-faint">({item.department_name})</span>}
                  </span>
                </p>
              )}
              <p className="text-muted text-sm leading-relaxed line-clamp-2 mb-3">
                {item.purpose || "No purpose specified."}
              </p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-faint">
                <span className="flex items-center gap-1">
                  <Calendar strokeWidth={1.5} className="w-3.5 h-3.5" />
                  {formatDate(item.visit_date)}
                </span>
                <span className="flex items-center gap-1">
                  <Clock strokeWidth={1.5} className="w-3.5 h-3.5" />
                  {timeAgo(item.assigned_at)}
                </span>
                {item.requester_name && (
                  <span className="flex items-center gap-1">
                    <Briefcase strokeWidth={1.5} className="w-3.5 h-3.5" />
                    via {item.requester_name}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right: buttons */}
          {!mode && (
            <div className="flex sm:flex-col items-center gap-2 sm:shrink-0 w-full sm:w-auto">
              {/* View Details — navigates directly to the detailed request page */}
              <button
                onClick={() => navigate(`/requests/${item.visit_request_id}`)}
                className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 btn-secondary text-xs text-accent hover:border-accent transition-all duration-300"
              >
                <Eye className="w-3.5 h-3.5" /> Details
              </button>
              <button
                onClick={() => setMode("approve")}
                className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 btn-secondary/30 hover:bg-accent hover:text-white transition-all duration-300"
              >
                <Check strokeWidth={2} className="w-3.5 h-3.5" /> Approve
              </button>
              <button
                onClick={() => setMode("reject")}
                className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 btn-secondary/40 hover:bg-accent hover:text-white transition-all duration-300"
              >
                <X strokeWidth={2} className="w-3.5 h-3.5" /> Reject
              </button>
            </div>
          )}
        </div>

        {/* Inline Expansion Panel */}
        {mode && (
          <div className="mt-5 pt-5 border-t border-subtle animate-fade-in">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-accent" />
              <p className="text-sm font-semibold text-loud capitalize">
                {mode === "approve" ? "Confirm Approval" : "Confirm Rejection"}{" "}
                <span className="font-normal text-faint">
                  {mode === "approve" ? "— remarks are optional" : "— remarks are required"}
                </span>
              </p>
            </div>
            <textarea
              rows={3}
              value={remarks}
              onChange={(e) => { setRemarks(e.target.value); setRemarkError(""); }}
              placeholder={
                mode === "approve"
                  ? 'Add optional remarks (e.g., "Meeting room 2B confirmed")…'
                  : "State the reason for rejection (required)…"
              }
              className={`w-full px-4 py-3 rounded-md bg-bg-primary border text-sm text-loud placeholder-muted resize-none focus:outline-none focus:ring-2 transition-all duration-300 ${
                remarkError
                  ? "border-warning/70 focus:ring-warning/30"
                  : "border-subtle focus:ring-accent/30 focus:border-border"
              }`}
            />
            {remarkError && <p className="mt-1.5 text-xs text-warning">{remarkError}</p>}
            <div className="flex items-center gap-3 mt-4">
              <button onClick={handleConfirm} disabled={submitting} className="flex items-center gap-2 btn-primary">
                {submitting ? (
                  <Loader2 strokeWidth={2} className="w-3.5 h-3.5 animate-spin" />
                ) : mode === "approve" ? (
                  <Check strokeWidth={2} className="w-3.5 h-3.5" />
                ) : (
                  <X strokeWidth={2} className="w-3.5 h-3.5" />
                )}
                {submitting ? "Processing…" : `Confirm ${mode === "approve" ? "Approval" : "Rejection"}`}
              </button>
              <button
                onClick={handleCancel}
                disabled={submitting}
                className="flex items-center gap-1.5 btn-secondary text-muted hover:bg-bg-primary hover:border-border transition-all duration-300 disabled:opacity-60"
              >
                <ChevronDown strokeWidth={1.5} className="w-3.5 h-3.5 rotate-90" />
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function ApprovalInbox() {
  const { user }     = useAuth();
  const isUnitAdmin  = user?.role_type === "unit_admin";
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
    toast.success("New visit request received!", { icon: "📋", duration: 5000 });
  }, [page]);

  /* Socket: own approve/reject from another view */
  useSocketEvent("visit:actioned", (data) => {
    setItems((prev) => prev.filter((i) => i.visit_request_id !== data.visit_request_id));
    setTotalCount((n) => Math.max(0, n - 1));
  }, []);

  return (
    <div className=" animate-fade-in">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold text-loud">
              Approval <em className="italic">Inbox</em>
            </h1>
            {!loading && totalCount > 0 && (
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-accent text-white text-xs font-bold">
                {totalCount}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={fetchInbox}
          disabled={loading}
          className="flex items-center gap-2 btn-secondary text-muted text-sm hover:bg-bg-primary hover:border-border transition-all duration-300 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 strokeWidth={1.5} className="w-4 h-4 animate-spin" />
          ) : (
            <Inbox strokeWidth={1.5} className="w-4 h-4" />
          )}
          Refresh
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((n) => (
            <div key={n} className="vms-card rounded-md p-6 animate-pulse" >
              <div className="flex items-start gap-4">
                <div className="w-11 h-11 rounded-full bg-border" />
                <div className="flex-1 space-y-3">
                  <div className="h-4 bg-border rounded-full w-1/3" />
                  <div className="h-3 bg-border rounded-full w-2/3" />
                  <div className="h-3 bg-border rounded-full w-1/2" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="vms-card rounded-md py-20 flex flex-col items-center justify-center text-center gap-5 border-none">
          <div className="w-80 h-80 rounded-full  flex items-center justify-center">
            
            <img className="w-full h-full object-contain" src={nonotifcationlight} alt="" />
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
        <div className="space-y-4">
          {items.map((item) => (
            <ApprovalCard
              key={item.visit_request_id}
              item={item}
              isUnitAdmin={isUnitAdmin}
              onActionSuccess={handleActionSuccess}
            />
          ))}
          <Pagination
            page={page}
            totalPages={totalPages}
            totalCount={totalCount}
            onPageChange={(p) => setPage(p)}
          />
        </div>
      )}
    </div>
  );
}
