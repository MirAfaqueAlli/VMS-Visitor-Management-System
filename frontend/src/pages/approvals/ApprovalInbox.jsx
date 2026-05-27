import { useState, useEffect, useCallback } from "react";
import {
 CheckCircle2,
 XCircle,
 Clock,
 User,
 Calendar,
 Briefcase,
 Inbox,
 Check,
 X,
 ChevronDown,
 Loader2,
} from "lucide-react";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";
import StatusBadge from "../../components/shared/StatusBadge";

const CATEGORY_LABELS = {
  EMP:               'Employee Visit',
  EMPLOYEE_VISIT:    'Employee Visit',
  INTER_UNIT_VISIT:  'Employee Visit',
  INTER_UNIT_INVITE: 'Employee Visit',
  VENDOR:            'Vendor',
  PRIOR:             'Prior Approval',
  SPOT:              'Walk-in',
  PERSONAL_VISIT:    'Personal Visit',
};

// ── Relative time helper (no external deps) ────────────────────────────────
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

// ── Format visit date ──────────────────────────────────────────────────────
function formatDate(dateStr) {
 return new Date(dateStr).toLocaleDateString("en-GB", {
 day: "2-digit",
 month: "short",
 year: "numeric",
 });
}

// ── Individual Approval Card ───────────────────────────────────────────────
function ApprovalCard({ item, onActionSuccess }) {
 const [mode, setMode] = useState(null); // null | 'approve' | 'reject'
 const [remarks, setRemarks] = useState("");
 const [remarkError, setRemarkError] = useState("");
 const [submitting, setSubmitting] = useState(false);

 const handleConfirm = async () => {
 if (mode === "reject" && !remarks.trim()) {
 setRemarkError("A reason is required when rejecting a request.");
 return;
 }
 setRemarkError("");
 setSubmitting(true);
 try {
 const endpoint = `/approvals/${item.visit_request_id}/${mode}`;
 await apiClient.put(endpoint, { remarks: remarks.trim() || undefined });

 if (mode === "approve") {
 toast.success("Request approved. Gate pass emailed to visitor.");
 } else {
 toast.success("Request rejected successfully.");
 }
 onActionSuccess(item.visit_request_id);
 } catch (err) {
 toast.error(err.response?.data?.message || `Failed to ${mode} request.`);
 } finally {
 setSubmitting(false);
 }
 };

 const handleCancel = () => {
 setMode(null);
 setRemarks("");
 setRemarkError("");
 };

 return (
 <div className="vms-card rounded-md p-6 transition-all duration-500 hover:shadow-hover hover:shadow-card">
 {/* Card Top Row */}
 <div className="flex items-start justify-between gap-4">
 <div className="flex items-start gap-4 flex-1 min-w-0">
 {/* Avatar circle */}
 <div className="w-11 h-11 rounded-full bg-lightColor flex items-center justify-center shrink-0">
 <User strokeWidth={1.5} className="w-5 h-5 text-muted" />
 </div>

 <div className="flex-1 min-w-0">
 {/* Visitor name + type badge */}
 <div className="flex flex-wrap items-center gap-2 mb-1">
 <h3 className="font-semibold text-loud text-lg leading-tight truncate">
 {item.visitor_name || item.requester_name || "Unknown Visitor"}
 </h3>
 <span
   className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider"
   style={{ background: 'var(--color-info-bg)', color: 'var(--color-info)' }}
 >
   {CATEGORY_LABELS[item.visit_category] ?? item.visit_category ?? 'Visit'}
 </span>
 </div>
 {item.visitor_phone && (
 <p className="text-xs text-faint mt-0.5 mb-1">📞 {item.visitor_phone}</p>
 )}

 {/* Purpose */}
 <p className="text-muted text-sm leading-relaxed line-clamp-2 mb-3">
 {item.purpose || "No purpose specified."}
 </p>

 {/* Meta row */}
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

 {/* Action buttons — only when no mode is active */}
 {!mode && (
 <div className="flex items-center gap-2 shrink-0">
 <button
 onClick={() => setMode("approve")}
 className="flex items-center gap-1.5 btn-secondary/30 hover:bg-accent hover:text-white transition-all duration-300"
 >
 <Check strokeWidth={2} className="w-3.5 h-3.5" />
 Approve
 </button>
 <button
 onClick={() => setMode("reject")}
 className="flex items-center gap-1.5 btn-secondary/40 hover:bg-accent hover:text-white transition-all duration-300"
 >
 <X strokeWidth={2} className="w-3.5 h-3.5" />
 Reject
 </button>
 </div>
 )}
 </div>

 {/* ── Inline Expansion Panel ──────────────────────────────────────── */}
 {mode && (
 <div className="mt-5 pt-5 border-t border-subtle animate-fade-in">
 <div className="flex items-center gap-2 mb-3">
 <div
 className={`w-2 h-2 rounded-full ${mode === "approve" ? "bg-accent" : "bg-accent"}`}
 />
 <p className="text-sm font-semibold text-loud capitalize">
 {mode === "approve" ? "Confirm Approval" : "Confirm Rejection"}{" "}
 <span className="font-normal text-faint">
 {mode === "approve"
 ? "— remarks are optional"
 : "— remarks are required"}
 </span>
 </p>
 </div>

 <textarea
 rows={3}
 value={remarks}
 onChange={(e) => {
 setRemarks(e.target.value);
 setRemarkError("");
 }}
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
 {remarkError && (
 <p className="mt-1.5 text-xs text-warning">
 {remarkError}
 </p>
 )}

 <div className="flex items-center gap-3 mt-4">
 <button
 onClick={handleConfirm}
 disabled={submitting}
 className="flex items-center gap-2 btn-primary"
 >
 {submitting ? (
 <Loader2 strokeWidth={2} className="w-3.5 h-3.5 animate-spin" />
 ) : mode === "approve" ? (
 <Check strokeWidth={2} className="w-3.5 h-3.5" />
 ) : (
 <X strokeWidth={2} className="w-3.5 h-3.5" />
 )}
 {submitting
 ? "Processing…"
 : `Confirm ${mode === "approve" ? "Approval" : "Rejection"}`}
 </button>
 <button
 onClick={handleCancel}
 disabled={submitting}
 className="flex items-center gap-1.5 btn-secondary text-muted hover:bg-bg-primary hover:border-border transition-all duration-300 disabled:opacity-60"
 >
 <ChevronDown
 strokeWidth={1.5}
 className="w-3.5 h-3.5 rotate-90"
 />
 Cancel
 </button>
 </div>
 </div>
 )}
 </div>
 );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function ApprovalInbox() {
 const [items, setItems] = useState([]);
 const [loading, setLoading] = useState(true);

 const fetchInbox = useCallback(async () => {
 try {
 setLoading(true);
 const res = await apiClient.get("/approvals/inbox");
 setItems(res.data?.data || []);
 } catch (err) {
 toast.error(
 err.response?.data?.message || "Failed to load approval inbox.",
 );
 } finally {
 setLoading(false);
 }
 }, []);

 useEffect(() => {
 fetchInbox();
 }, [fetchInbox]);

 const handleActionSuccess = (visitRequestId) => {
 setItems((prev) =>
 prev.filter((i) => i.visit_request_id !== visitRequestId),
 );
 };

 return (
 <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6 lg:px-8 animate-fade-in">
 {/* ── Page Header ─────────────────────────────────────────────────── */}
 <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
 <div>
 <div className="flex items-center gap-3">
 <h1 className="text-2xl font-bold text-loud">
 Approval <em className="italic">Inbox</em>
 </h1>
 {!loading && items.length > 0 && (
 <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-accent text-white text-xs font-bold">
 {items.length}
 </span>
 )}
 </div>
 <p className="text-muted mt-2">
 Review and action pending visit requests assigned to you.
 </p>
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

 {/* ── Content ─────────────────────────────────────────────────────── */}
 {loading ? (
 /* Skeleton loaders */
 <div className="space-y-4">
 {[1, 2, 3].map((n) => (
 <div
 key={n}
 className="vms-card rounded-md p-6 animate-pulse"
 >
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
 /* Empty state */
 <div className="vms-card rounded-md py-20 flex flex-col items-center justify-center text-center gap-5">
 <div className="w-16 h-16 rounded-full bg-mixed-bg flex items-center justify-center">
 <CheckCircle2
 strokeWidth={1.5}
 className="w-8 h-8 text-accent"
 />
 </div>
 <div>
 <h2 className="text-2xl font-semibold text-loud mb-2">
 You&apos;re all <em className="italic">caught up</em>
 </h2>
 <p className="text-faint max-w-xs mx-auto text-sm">
 No pending approvals right now. New requests assigned to you will
 appear here.
 </p>
 </div>
 </div>
 ) : (
 /* Card list */
 <div className="space-y-4">
 {items.map((item) => (
 <ApprovalCard
 key={item.visit_request_id}
 item={item}
 onActionSuccess={handleActionSuccess}
 />
 ))}
 </div>
 )}
 </div>
 );
}
