// frontend/src/pages/visitor/VisitorHistory.jsx
import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Calendar,
  Clock,
  Building,
  User,
  Search,
  RotateCcw,
  QrCode,
  XCircle,
  PlusCircle,
  AlertCircle,
  FileText,
  CheckCircle2,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import apiClient from "../../api/axios";
import StatusBadge from "../../components/shared/StatusBadge";
import toast from "react-hot-toast";

const TABS = [
  { id: "ALL",                label: "All Visits",           countKey: "ALL"                },
  { id: "APPROVED",          label: "Approved & Passes",    countKey: "APPROVED"           },
  { id: "PENDING",           label: "Pending Review",       countKey: "PENDING"            },
  { id: "COMPLETED",         label: "Completed",            countKey: "COMPLETED"          },
  { id: "REJECTED_CANCELLED",label: "Rejected / Cancelled", countKey: "REJECTED_CANCELLED" },
];

const PAGE_LIMIT = 10;

export default function VisitorHistory() {
  const navigate = useNavigate();

  const [requests,    setRequests]    = useState([]);
  const [counts,      setCounts]      = useState({ ALL: 0, PENDING: 0, APPROVED: 0, COMPLETED: 0, REJECTED_CANCELLED: 0 });
  const [pagination,  setPagination]  = useState({ page: 1, totalPages: 1, total: 0 });
  const [loading,     setLoading]     = useState(true);
  const [activeTab,   setActiveTab]   = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [cancellingId, setCancellingId] = useState(null);
  const [page, setPage] = useState(1);

  // Debounce search input
  const debounceRef = useRef(null);
  const handleSearchChange = (val) => {
    setSearchQuery(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(val);
      setPage(1); // reset page on new search
    }, 350);
  };

  // Reset to page 1 on tab change
  const handleTabChange = (tabId) => {
    setActiveTab(tabId);
    setPage(1);
  };

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        page,
        limit: PAGE_LIMIT,
        status: activeTab,
      };
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();

      const res = await apiClient.get("/public-auth/my-requests", { params });
      const data = res.data?.data || {};
      setRequests(data.requests || []);
      setCounts(data.counts || { ALL: 0, PENDING: 0, APPROVED: 0, COMPLETED: 0, REJECTED_CANCELLED: 0 });
      setPagination(data.pagination || { page: 1, totalPages: 1, total: 0 });
    } catch (err) {
      console.error("Failed to fetch requests:", err);
      toast.error("Could not load your visits.");
    } finally {
      setLoading(false);
    }
  }, [page, activeTab, debouncedSearch]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  // 1-Click Revisit handler
  const handleRevisit = (r) => {
    const params = new URLSearchParams({
      revisit_unit:     r.unit_id      || "",
      revisit_dept:     r.department_id || "",
      revisit_host:     r.host_user_id  || "",
      revisit_category: r.visit_category || "INDIVIDUAL",
      revisit_purpose:  r.purpose        || "",
      revisit_company:  r.company_name   || "",
    });
    navigate(`/visitor/new-request?${params.toString()}`);
  };

  // Cancel Request handler
  const handleCancel = async (r) => {
    if (!window.confirm("Are you sure you want to cancel this visit request?")) return;
    setCancellingId(r.id);
    try {
      await apiClient.post("/public-auth/cancel-request", {
        unit_id:    r.unit_id,
        request_id: r.id,
      });
      toast.success("Visit request cancelled.");
      fetchRequests();
    } catch (err) {
      console.error("Cancel error:", err);
      toast.error(err?.response?.data?.message || "Failed to cancel request.");
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* ── Top Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-loud tracking-tight">
            My Visits & Gate Passes
          </h1>
          {pagination.total > 0 && (
            <p className="text-xs text-faint mt-0.5">
              {pagination.total} total visit{pagination.total !== 1 ? "s" : ""}
            </p>
          )}
        </div>

        <Link
          to="/visitor/new-request"
          className="btn-primary py-2.5 px-4 text-xs sm:text-sm font-bold shadow-md shadow-accent/20 shrink-0 self-start sm:self-auto"
        >
          <PlusCircle size={15} />
          <span>New Visit Request</span>
        </Link>
      </div>

      {/* ── Filter Tabs & Search Bar ────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full">
          {TABS.map((tab) => {
            const count = counts[tab.countKey] ?? 0;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  activeTab === tab.id
                    ? "bg-accent text-white shadow-xs"
                    : "text-muted hover:text-loud hover:bg-surface-hover"
                }`}
              >
                {tab.label}
                {" "}
                <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-bold ${
                  activeTab === tab.id ? "bg-white/20 text-white" : "bg-border text-muted"
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="relative w-full md:w-72">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none"
          />
          <input
            type="text"
            placeholder="Search host, unit, pass #..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="vms-input pl-9 text-xs"
          />
        </div>
      </div>

      {/* ── List / Cards ────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="vms-card p-5 border border-border animate-pulse space-y-3">
              <div className="h-4 bg-border rounded w-1/3" />
              <div className="h-3 bg-border rounded w-2/3" />
              <div className="h-3 bg-border rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : requests.length === 0 ? (
        <div className="vms-card p-12 text-center space-y-3 border border-border">
          <div className="w-12 h-12 rounded-full bg-mixed-bg mx-auto flex items-center justify-center text-accent">
            <FileText size={22} />
          </div>
          <h3 className="text-sm font-bold text-loud">No visits found</h3>
          <p className="text-xs text-faint max-w-sm mx-auto">
            {debouncedSearch
              ? "No visit requests matched your search. Try a different query."
              : activeTab !== "ALL"
              ? "No visits in this category yet."
              : "You haven't submitted any visit requests yet."}
          </p>
          {!debouncedSearch && activeTab === "ALL" && (
            <Link
              to="/visitor/new-request"
              className="btn-primary py-2 px-4 text-xs font-bold inline-flex"
            >
              <PlusCircle size={14} /> Schedule a Visit
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {requests.map((r) => {
              const hasPass  = Boolean(r.pass_number);
              const isApproved = r.status === "APPROVED" || r.status === "CHECKED_IN";
              const isPending  = r.status === "PENDING";
              const isRejected = r.status === "REJECTED";

              return (
                <div
                  key={`${r.unit_id}-${r.id}`}
                  className="vms-card p-5 border border-border hover:border-accent/30 transition-all space-y-4"
                >
                  {/* Header row */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-border">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-bold text-sm text-loud">
                        {r.unit_name || "OHPC Unit"}
                      </span>
                      <span className="text-[10px] font-mono bg-bg-primary px-2 py-0.5 rounded border border-border text-muted">
                        ID #{r.id}
                      </span>
                      <StatusBadge status={r.status} />
                    </div>

                    <div className="flex items-center gap-3 text-xs text-faint">
                      <span className="flex items-center gap-1 font-semibold text-accent">
                        <Calendar size={13} />
                        {r.visit_date}
                      </span>
                      {r.visit_start_time && (
                        <span className="flex items-center gap-1">
                          <Clock size={13} />
                          {r.visit_start_time} – {r.visit_end_time || "End of Day"}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Body details */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                    <div>
                      <span className="block text-[11px] font-semibold text-faint uppercase tracking-wider">
                        Host Contact
                      </span>
                      <p className="font-bold text-loud mt-0.5">{r.host_name}</p>
                      <p className="text-muted">{r.department_name}</p>
                    </div>

                    <div className="sm:col-span-2">
                      <span className="block text-[11px] font-semibold text-faint uppercase tracking-wider">
                        Purpose & Details
                      </span>
                      <p className="text-loud font-medium mt-0.5">{r.purpose}</p>
                      {r.company_name && (
                        <p className="text-faint text-[11px] mt-0.5">
                          Company: <span className="font-semibold">{r.company_name}</span>
                        </p>
                      )}
                      {r.accompanying_count > 0 && (
                        <p className="text-faint text-[11px]">
                          Accompanying persons: +{r.accompanying_count}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Rejection note */}
                  {isRejected && r.rejection_reason && (
                    <div className="p-3 rounded-lg bg-danger-bg text-error text-xs flex items-start gap-2 border border-error/20">
                      <AlertCircle size={15} className="shrink-0 mt-0.5" />
                      <div>
                        <strong className="font-bold">Rejection Reason:</strong> {r.rejection_reason}
                      </div>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border">
                    <div className="flex items-center gap-2 flex-wrap">
                      {hasPass && isApproved ? (
                        <Link
                          to={`/visitor/pass/${r.unit_id}/${r.pass_number}`}
                          className="btn-primary py-2 px-3.5 text-xs font-bold flex items-center gap-1.5 shadow-sm"
                        >
                          <QrCode size={14} />
                          <span>View Gate Pass (#{r.pass_number})</span>
                        </Link>
                      ) : null}

                      {/* 1-Click Revisit */}
                      <button
                        onClick={() => handleRevisit(r)}
                        className="btn-secondary py-2 px-3 text-xs font-semibold flex items-center gap-1.5"
                        title="Schedule another appointment with this same host officer"
                      >
                        <RotateCcw size={13} />
                        <span>Revisit Same Host</span>
                      </button>
                    </div>

                    {/* Cancel Request (If Pending) */}
                    {isPending && (
                      <button
                        onClick={() => handleCancel(r)}
                        disabled={cancellingId === r.id}
                        className="text-xs font-semibold text-error hover:underline flex items-center gap-1 px-2 py-1"
                      >
                        <XCircle size={14} />
                        <span>{cancellingId === r.id ? "Cancelling..." : "Cancel Request"}</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Pagination Controls ───────────────────────────────────────── */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 border-t border-border mt-2">
              <span className="text-xs text-faint">
                Page {pagination.page} of {pagination.totalPages}
                {" · "}
                <span className="font-medium text-muted">{pagination.total} total</span>
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || loading}
                  className="p-2 rounded-full border border-border text-loud disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface-hover transition-colors"
                  aria-label="Previous page"
                >
                  <ChevronLeft size={16} strokeWidth={1.5} />
                </button>

                {/* Page number pills */}
                <div className="flex items-center gap-1">
                  {Array.from({ length: pagination.totalPages }, (_, i) => i + 1)
                    .filter((p) =>
                      p === 1 ||
                      p === pagination.totalPages ||
                      Math.abs(p - page) <= 1
                    )
                    .reduce((acc, p, idx, arr) => {
                      if (idx > 0 && p - arr[idx - 1] > 1) {
                        acc.push("…");
                      }
                      acc.push(p);
                      return acc;
                    }, [])
                    .map((p, idx) =>
                      p === "…" ? (
                        <span key={`ellipsis-${idx}`} className="px-1 text-xs text-faint">…</span>
                      ) : (
                        <button
                          key={p}
                          onClick={() => setPage(p)}
                          disabled={loading}
                          className={`w-7 h-7 rounded-full text-xs font-bold transition-colors ${
                            p === page
                              ? "bg-accent text-white"
                              : "border border-border text-muted hover:bg-surface-hover"
                          }`}
                        >
                          {p}
                        </button>
                      )
                    )}
                </div>

                <button
                  onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                  disabled={page >= pagination.totalPages || loading}
                  className="p-2 rounded-full border border-border text-loud disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface-hover transition-colors"
                  aria-label="Next page"
                >
                  <ChevronRight size={16} strokeWidth={1.5} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
