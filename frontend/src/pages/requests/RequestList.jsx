// frontend/src/pages/requests/RequestList.jsx
// Visit requests (DESIGN_RULES §6 list anatomy): breadcrumb + title + New request,
// stat strip, perspective tabs, toolbar (count · search · status · date · export),
// a plain sortable table whose rows open the request.
import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus, ClipboardList } from "../../components/icons";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";
import useAuth from "../../hooks/useAuth";
import useSocketEvent from "../../hooks/useSocketEvent";
import Select from "../../components/Select";
import Pagination from "../../components/shared/Pagination";
import {
  PageHeader, StatStrip, Stat, Tabs, Toolbar, SearchInput, Th, SkeletonRows, Status, Tag, Empty, ExportButton,
} from "../../components/ui";
import useSort from "../../lib/useSort";
import { fmtDate, fmtTime, orDash } from "../../lib/format";
import { statusLabel } from "../../lib/status";
import { downloadXlsx, fetchAllPages } from "../../lib/exportXlsx";

const CATEGORY_LABELS = {
  EMPLOYEE_VISIT: "Employee visit",
  VENDOR: "Vendor",
  SPOT: "Walk-in",
  PERSONAL_VISIT: "Personal visit",
};

// 'Public request' when the record came from the public self-registration form
const categoryLabel = (r) =>
  r.request_source === "PUBLIC" ? "Public request" : (CATEGORY_LABELS[r.visit_category] ?? r.visit_category);

const last10 = (p) => String(p || "").replace(/\D/g, "").slice(-10);

/**
 * How the signed-in user relates to a row: 'host' | 'visitor' | null.
 * Worked out here — the API's my_role is 'VISITOR' for every row the user
 * doesn't host, which is wrong for an admin looking at all requests.
 */
function relationTo(r, user) {
  if (!user) return null;
  const isMe = (id) => id != null && Number(id) === Number(user.id);
  const emailMatch = user.email && r.visitor_email && r.visitor_email.toLowerCase() === user.email.toLowerCase();
  const phoneMatch = user.phone && r.visitor_phone && last10(r.visitor_phone) === last10(user.phone);
  // Rows from another unit's database: ids there aren't ours, so only contact details tell.
  // (A unit admin also gets their unit's employees' cross-unit visits — not "mine".)
  if (r._cross_unit_id) return emailMatch || phoneMatch ? "visitor" : null;
  if (isMe(r.host_user_id)) return "host";
  if (emailMatch || phoneMatch || (isMe(r.requester_user_id) && r.visit_category === "EMPLOYEE_VISIT")) return "visitor";
  return null;
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const TAB_IDS = ["as_host", "as_visitor", "all"];
const tabKey = (userId) => `vms_requests_tab:${userId || "anon"}`;

export default function RequestList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const canViewPass = ["security", "unit_admin", "receptionist"].includes(user?.role_type);
  const canCreate   = ["unit_admin", "employee", "security", "receptionist"].includes(user?.role_type);

  // Tabs: 'as_host' (visitors to me), 'as_visitor' (my visits), 'all'
  // The chosen tab survives leaving the page: ?tab= in the address, else the last one used here
  const [activeTab, setActiveTab] = useState(() => {
    const fromUrl = searchParams.get("tab");
    if (TAB_IDS.includes(fromUrl)) return fromUrl;
    try {
      const saved = localStorage.getItem(tabKey(user?.id));
      if (TAB_IDS.includes(saved)) return saved;
    } catch { /* storage blocked */ }
    return user?.role_type === "employee" ? "as_host" : "all";
  });

  // Filters (the top bar's quick search opens this page with ?search=)
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [search, setSearch] = useState(() => searchParams.get("search") || "");
  const [debouncedSearch, setDebouncedSearch] = useState(search);

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const limit = 10;

  // Stat strip (counts for the current tab)
  const [stats, setStats] = useState({ total: null, pending: null, today: null, approved: null });

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(handler);
  }, [search]);

  const baseParams = useCallback(() => {
    const params = {};
    if (activeTab && activeTab !== "all") params.tab = activeTab;
    return params;
  }, [activeTab]);

  const fetchRequests = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);   // live refreshes update in place, no skeleton flash
      const params = { ...baseParams(), page, limit };
      if (statusFilter) params.status = statusFilter;
      if (dateFilter) params.visit_date = dateFilter;
      if (debouncedSearch) params.search = debouncedSearch;

      const response = await apiClient.get("/visit-requests", { params });
      const data = response.data.data;
      setRequests(data?.requests || data || []);
      setTotalPages(data?.pagination?.pages || 1);
      setTotalCount(data?.pagination?.total ?? 0);
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to fetch visit requests");
    } finally {
      setLoading(false);
    }
  }, [baseParams, page, statusFilter, dateFilter, debouncedSearch]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  // ── Live: a request arrived / was decided / a visitor came or left → refresh the list
  //    and the counts (a burst of events refreshes once)
  const [liveTick, setLiveTick] = useState(0);
  const liveTimer = useRef(null);
  const latestFetch = useRef(fetchRequests);
  useEffect(() => { latestFetch.current = fetchRequests; }, [fetchRequests]);
  useEffect(() => () => clearTimeout(liveTimer.current), []);
  const onLive = useCallback(() => {
    clearTimeout(liveTimer.current);
    liveTimer.current = setTimeout(() => setLiveTick((n) => n + 1), 400);
  }, []);
  useEffect(() => { if (liveTick) latestFetch.current({ silent: true }); }, [liveTick]);
  useSocketEvent("visit:request:new", onLive, [onLive]);
  useSocketEvent("visit:actioned", onLive, [onLive]);
  useSocketEvent("visit:approved", onLive, [onLive]);
  useSocketEvent("visit:rejected", onLive, [onLive]);
  useSocketEvent("visit:checkin", onLive, [onLive]);
  useSocketEvent("visit:checkout", onLive, [onLive]);
  useSocketEvent("visit:cancelled", onLive, [onLive]);

  // Counts for the stat strip — one light query per number (limit 1, total only)
  useEffect(() => {
    let cancelled = false;
    const count = (extra) => apiClient
      .get("/visit-requests", { params: { ...baseParams(), page: 1, limit: 1, ...extra } })
      .then((r) => r.data?.data?.pagination?.total ?? 0)
      .catch(() => null);
    Promise.all([count({}), count({ status: "PENDING" }), count({ visit_date: todayIso() }), count({ status: "APPROVED" })])
      .then(([total, pending, today, approved]) => { if (!cancelled) setStats({ total, pending, today, approved }); });
    return () => { cancelled = true; };
  }, [baseParams, liveTick]);   // liveTick: recount when a socket event arrives

  const { rows, sort, onSort } = useSort(requests, {
    visitor: (r) => r.visitor_name || r.company_name,
    host: (r) => r.host_name,
    date: (r) => `${String(r.visit_date).slice(0, 10)} ${r.visit_start_time || ""}`,
    status: (r) => r.status,
    pass: (r) => r.pass_number,
  });

  const detailLink = (r) => (r._cross_unit_id ? `/requests/${r.id}?unit_id=${r._cross_unit_id}` : `/requests/${r.id}`);
  const passLink   = (r) => `/passes/pass/${r.pass_number}${r._cross_unit_id ? `?unit_id=${r._cross_unit_id}` : ""}`;

  const onExport = async () => {
    setExporting(true);
    try {
      const all = await fetchAllPages(async (p) => {
        const params = { ...baseParams(), page: p, limit: 100 };
        if (statusFilter) params.status = statusFilter;
        if (dateFilter) params.visit_date = dateFilter;
        if (debouncedSearch) params.search = debouncedSearch;
        const res = await apiClient.get("/visit-requests", { params });
        return { rows: res.data?.data?.requests || [], pages: res.data?.data?.pagination?.pages || 1 };
      });
      await downloadXlsx(all, [
        { header: "REQUEST_ID", value: (r) => r.id },
        { header: "VISITOR", value: (r) => r.visitor_name || r.company_name },
        { header: "PHONE", value: (r) => r.visitor_phone },
        { header: "TYPE", value: (r) => categoryLabel(r) },
        { header: "HOST", value: (r) => r.host_name },
        { header: "DEPARTMENT", value: (r) => r.department_name },
        { header: "VISIT_DATE", value: (r) => fmtDate(r.visit_date) },
        { header: "START", value: (r) => r.visit_start_time?.slice(0, 5) },
        { header: "END", value: (r) => r.visit_end_time?.slice(0, 5) },
        { header: "STATUS", value: (r) => statusLabel(r.status) },
        { header: "GATE_PASS", value: (r) => r.pass_number },
        { header: "PURPOSE", value: (r) => r.purpose },
      ], `visit-requests_${activeTab}`);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not export the requests.");
    } finally {
      setExporting(false);
    }
  };

  const switchTab = (id) => {
    setActiveTab(id);
    setPage(1);
    try { localStorage.setItem(tabKey(user?.id), id); } catch { /* storage blocked */ }
    setSearchParams((p) => { const next = new URLSearchParams(p); next.set("tab", id); return next; }, { replace: true });
  };
  const hasFilters = !!(statusFilter || dateFilter || search);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Visit Requests"
        actions={canCreate && (
          <Link to="/requests/new" className="btn-primary"><Plus size={14} /> New request</Link>
        )}
      />

      <Tabs
        className="mb-5"
        value={activeTab}
        onChange={switchTab}
        tabs={[
          { id: "as_host", label: "Visitors to me" },
          { id: "as_visitor", label: "My visits" },
          { id: "all", label: "All requests" },
        ]}
      />

      <StatStrip cols={4}>
        <Stat label="Requests" value={stats.total ?? "—"} loading={stats.total === null} hint="In this view" />
        <Stat label="Waiting for approval" value={stats.pending ?? "—"} loading={stats.pending === null}
          tone={stats.pending > 0 ? "warning" : undefined} hint="Pending a host's decision" />
        <Stat label="Visiting today" value={stats.today ?? "—"} loading={stats.today === null} hint={fmtDate(new Date())} />
        <Stat label="Approved" value={stats.approved ?? "—"} loading={stats.approved === null} hint="Gate pass issued" />
      </StatStrip>

      <Toolbar count={loading ? null : totalCount} noun={totalCount === 1 ? "request" : "requests"}>
        <SearchInput
          value={search}
          onChange={(v) => { setSearch(v); setPage(1); }}
          placeholder="Search visitor, phone, host or pass"
          width={260}
        />
        <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          aria-label="Status" style={{ width: 160 }}>
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
          <option value="EXPIRED">Expired</option>
        </Select>
        <input
          type="date"
          className="control"
          style={{ width: 150 }}
          value={dateFilter}
          onChange={(e) => { setDateFilter(e.target.value); setPage(1); }}
          aria-label="Visit date"
          title="Visit date"
        />
        {hasFilters && (
          <button type="button" className="btn-ghost" onClick={() => { setStatusFilter(""); setDateFilter(""); setSearch(""); setPage(1); }}>
            Clear
          </button>
        )}
        <ExportButton onClick={onExport} busy={exporting} disabled={!totalCount} title="Export these requests to Excel" />
      </Toolbar>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <Th sortKey="visitor" sort={sort} onSort={onSort}>Visitor</Th>
              <Th sortKey="host" sort={sort} onSort={onSort}>Host</Th>
              <Th sortKey="date" sort={sort} onSort={onSort}>Visit</Th>
              <Th sortKey="status" sort={sort} onSort={onSort}>Status</Th>
              <Th sortKey="pass" sort={sort} onSort={onSort}>Gate pass</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows rows={6} cols={5} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="!p-0">
                  <Empty
                    icon={ClipboardList}
                    title={hasFilters ? "No requests match these filters" : "No visit requests yet"}
                    hint={hasFilters
                      ? "Try another status or date, or clear the filters."
                      : activeTab === "as_visitor"
                        ? "Visits you make to other people appear here once they are requested."
                        : "Requests appear here when a visitor is registered or asks to visit."}
                  />
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const rel = relationTo(r, user);
                const showPass = (canViewPass || rel || user?.role_type === "employee") && r.status === "APPROVED" && r.pass_number;
                return (
                  <tr key={`${r._cross_unit_id ?? "own"}-${r.id}`} className="is-clickable" onClick={() => navigate(detailLink(r))}>
                    <td>
                      <span className="inline-flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium">{r.visitor_name || r.company_name || "—"}</span>
                        {rel === "visitor" && <Tag tone="success">You</Tag>}
                        {r._cross_unit_id && <Tag tone="info">Other unit</Tag>}
                      </span>
                      <span className="cell-sub">{categoryLabel(r)}{r.visitor_phone ? ` · ${r.visitor_phone}` : ""}</span>
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-1.5">
                        {orDash(r.Host?.full_name || r.host_name)}
                        {rel === "host" && <Tag tone="brand">You</Tag>}
                      </span>
                      <span className="cell-sub">{orDash(r.Department?.name || r.department_name)}</span>
                    </td>
                    <td className="tabular whitespace-nowrap">
                      {fmtDate(r.visit_date)}
                      <span className="cell-sub">
                        {r.visit_start_time ? `${fmtTime(r.visit_start_time)}${r.visit_end_time ? `–${fmtTime(r.visit_end_time)}` : ""}` : "Any time"}
                      </span>
                    </td>
                    <td><Status value={r.status} /></td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {showPass ? (
                        <button type="button" className="btn-link mono" onClick={() => navigate(passLink(r))} title="Open the gate pass">
                          {r.pass_number}
                        </button>
                      ) : (
                        <span className="mono text-muted">{r.pass_number || "—"}</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {!loading && (
        <Pagination page={page} totalPages={totalPages} totalCount={totalCount} onPageChange={setPage} />
      )}
    </div>
  );
}
