// frontend/src/pages/audit/AuditLog.jsx
// Audit trail (DESIGN_RULES §6/§8): title + Refresh, toolbar (count · search ·
// module · unit), a plain sortable table. Actions are hairline tags.
import { useState, useEffect, useCallback } from "react";
import { ShieldAlert, RefreshCw, Loader2, FileText } from "../../components/icons";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";
import useAuth from "../../hooks/useAuth";
import Select from "../../components/Select";
import Pagination from "../../components/shared/Pagination";
import { PageHeader, Toolbar, SearchInput, Th, SkeletonRows, Tag, Empty, ExcelIcon } from "../../components/ui";
import { exportExcel, exportPDF } from "../../lib/officialReport";
import { fetchAllPages } from "../../lib/exportXlsx";
import useSort from "../../lib/useSort";
import { fmtDate, fmtClock, orDash } from "../../lib/format";

// Action verb → tag tone (first word of the action, e.g. APPROVE_REQUEST → APPROVE)
const ACTION_TONES = {
  CREATE: "success", APPROVE: "success",
  UPDATE: "info", CHECKIN: "info", CHECKOUT: "info",
  DELETE: "danger", REJECT: "danger", DEACTIVATE: "danger",
  LOGIN: "neutral", LOGOUT: "neutral",
};
const actionTone = (action) => {
  const key = action?.split("_")[0]?.toUpperCase() ?? "";
  return ACTION_TONES[key] ?? ACTION_TONES[action?.toUpperCase()] ?? "neutral";
};

const MODULES = [
  'AUTH', 'USER', 'VISIT_REQUEST', 'GATE', 'APPROVAL',
  'DEPARTMENT', 'UNIT', 'DESIGNATION', 'REPORT', 'ADMIN',
];
const moduleLabel = (m) => m.charAt(0) + m.slice(1).toLowerCase().replace(/_/g, " ");
/** Who did it — "Unknown user" when no user is known (e.g. a failed sign-in). */
const userLabel = (log) => log.user_name ?? (log.user_id ? `#${log.user_id}` : "Unknown user");
/** The record an entry is about, e.g. "VISIT_REQUEST #12". */
const recordLabel = (log) => [log.record_type, log.record_id ? `#${log.record_id}` : null].filter(Boolean).join(" ");

export default function AuditLog() {
  const { isSuperAdmin, isGlobalAuditor } = useAuth();
  const isCentral = isSuperAdmin || isGlobalAuditor;

  const [logs,       setLogs]       = useState([]);
  const [units,      setUnits]      = useState([]); // for super admin unit filter
  const [loading,    setLoading]    = useState(true);
  const [page,       setPage]       = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalLogs,  setTotalLogs]  = useState(0);
  const [search,     setSearch]     = useState("");
  const [module,     setModule]     = useState("");
  const [unitDb,     setUnitDb]     = useState(""); // super admin only
  const [exporting,  setExporting]  = useState("");  // "" | "excel" | "pdf"

  const limit = 20;

  const endpoint = isCentral
    ? '/reports/audit-logs/global'
    : '/reports/audit-logs';

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit };
      if (search.trim()) params.search = search.trim();
      if (module)        params.module  = module;
      if (unitDb && isCentral) params.unit_db = unitDb;

      const res = await apiClient.get(endpoint, { params });
      const data = res.data?.data;

      setLogs(data?.logs ?? data ?? []);
      setTotalPages(data?.pagination?.pages ?? 1);
      setTotalLogs(data?.pagination?.total ?? 0);

      // Populate unit list from response (super admin global endpoint)
      if (data?.units && data.units.length > 0) {
        setUnits(data.units);
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load audit logs.");
    } finally {
      setLoading(false);
    }
  }, [page, search, module, unitDb, endpoint, isCentral]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const exportAll = async (format) => {
    setExporting(format);
    try {
      const filters = {};
      if (search.trim()) filters.search = search.trim();
      if (module)        filters.module = module;
      if (unitDb && isCentral) filters.unit_db = unitDb;
      const all = await fetchAllPages(async (p) => {
        const res = await apiClient.get(endpoint, { params: { ...filters, page: p, limit: 100 } });
        const data = res.data?.data;
        return { rows: data?.logs ?? data ?? [], pages: data?.pagination?.pages ?? 1 };
      }, 100);
      if (!all.length) { toast.error("No audit entries to export for these filters."); return; }

      const columns = [
        { header: "Date",       accessor: (l) => fmtDate(l.created_at) },
        { header: "Time",       accessor: (l) => (l.created_at ? fmtClock(l.created_at) : "") },
        { header: "User",       accessor: (l) => userLabel(l) },
        ...(isCentral ? [{ header: "Unit", accessor: (l) => (l.log_source === "central" ? "Central admin" : (l.unit_name ?? l.unit_db ?? "")) }] : []),
        { header: "Module",     accessor: (l) => l.module ?? "" },
        { header: "Action",     accessor: (l) => l.action ?? "" },
        { header: "Record",     accessor: (l) => recordLabel(l) },
        { header: "IP address", accessor: (l) => l.ip_address ?? "" },
      ];
      const unitName = !isCentral ? "All Units"
        : unitDb === "central" ? "Central admin"
        : (units.find((u) => u.db_name === unitDb)?.unit_name || (unitDb ? unitDb : "All Units"));
      const metadata = {
        Unit: unitName,
        Module: module ? moduleLabel(module) : "All modules",
        Search: search.trim() || undefined,
        "Total Records": all.length,
      };
      const name = `audit_log_${new Date().toISOString().slice(0, 10)}`;
      if (format === "excel") await exportExcel(all, columns, name, { title: "Audit Log Report", metadata });
      else await exportPDF(all, columns, "Audit Log Report", name, { metadata });
      toast.success(`${all.length.toLocaleString("en-IN")} audit entries exported.`);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not export the audit log.");
    } finally {
      setExporting("");
    }
  };

  // Reset page when filters change
  const onSearch = (v) => { setSearch(v); setPage(1); };
  const onModule = (v) => { setModule(v); setPage(1); };
  const onUnit   = (v) => { setUnitDb(v); setPage(1); };

  const { rows, sort, onSort } = useSort(logs, {
    when: (l) => l.created_at,
    user: (l) => l.user_name,
    unit: (l) => l.unit_name ?? l.unit_db,
    module: (l) => l.module,
    action: (l) => l.action,
  });

  const cols = isCentral ? 7 : 6;
  const hasFilters = !!(search || module || unitDb);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Audit logs"
        actions={(
          <>
            {/* Every entry matching the filters below, as an official report */}
            <button type="button" onClick={() => exportAll("excel")} disabled={!!exporting || loading || !totalLogs}
              className="btn-outline" title="Export the filtered audit log to Excel">
              {exporting === "excel" ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={15} />} Excel
            </button>
            <button type="button" onClick={() => exportAll("pdf")} disabled={!!exporting || loading || !totalLogs}
              className="btn-outline" title="Export the filtered audit log to PDF">
              {exporting === "pdf" ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} PDF
            </button>
            <button type="button" onClick={fetchLogs} disabled={loading} className="btn-outline">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
            </button>
          </>
        )}
      />

      <Toolbar count={loading ? null : totalLogs} noun={totalLogs === 1 ? "entry" : "entries"}>
        <SearchInput value={search} onChange={onSearch} placeholder="Search user, action or record" width={260} />
        <Select value={module} onChange={e => onModule(e.target.value)} aria-label="Module" style={{ width: 170 }}>
          <option value="">All modules</option>
          {MODULES.map(m => <option key={m} value={m}>{moduleLabel(m)}</option>)}
        </Select>
        {isCentral && units.length > 0 && (
          <Select searchable value={unitDb} onChange={e => onUnit(e.target.value)} aria-label="Unit" style={{ width: 190 }}>
            <option value="">All units</option>
            <option value="central">Central admin</option>
            {units.map(u => <option key={u.db_name} value={u.db_name}>{u.unit_name}</option>)}
          </Select>
        )}
        {hasFilters && (
          <button type="button" className="btn-ghost" onClick={() => { setSearch(""); setModule(""); setUnitDb(""); setPage(1); }}>
            Clear
          </button>
        )}
      </Toolbar>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <Th sortKey="when" sort={sort} onSort={onSort}>When</Th>
              <Th sortKey="user" sort={sort} onSort={onSort}>User</Th>
              {isCentral && <Th sortKey="unit" sort={sort} onSort={onSort}>Unit</Th>}
              <Th sortKey="module" sort={sort} onSort={onSort}>Module</Th>
              <Th sortKey="action" sort={sort} onSort={onSort}>Action</Th>
              <th>Record</th>
              <th>IP address</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows rows={8} cols={cols} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={cols} className="!p-0">
                  <Empty
                    icon={ShieldAlert}
                    title={hasFilters ? "No entries match these filters" : "No audit entries yet"}
                    hint={hasFilters ? "Try another search, module or unit." : "Sign-ins, approvals and changes are recorded here."}
                  />
                </td>
              </tr>
            ) : rows.map((log, i) => (
              <tr key={`${log.unit_db}-${log.id}-${i}`}>
                <td className="tabular whitespace-nowrap">
                  {fmtDate(log.created_at)}
                  <span className="cell-sub">{log.created_at ? fmtClock(log.created_at) : ""}</span>
                </td>
                <td className="whitespace-nowrap font-medium">{userLabel(log)}</td>
                {isCentral && (
                  <td className="whitespace-nowrap">
                    {orDash(log.unit_name ?? log.unit_db)}
                    {log.log_source === "central" && <span className="cell-sub">Central</span>}
                  </td>
                )}
                <td className="mono text-ink-2">{orDash(log.module)}</td>
                <td><Tag tone={actionTone(log.action)}>{log.action}</Tag></td>
                <td className="max-w-[200px] truncate text-ink-2">
                  {log.record_type || log.record_id ? (
                    <>
                      {log.record_type && <span className="mono">{log.record_type}</span>}
                      {log.record_id && <span className="text-muted"> #{log.record_id}</span>}
                    </>
                  ) : "—"}
                </td>
                <td className="mono text-muted whitespace-nowrap">{orDash(log.ip_address)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && <Pagination page={page} totalPages={totalPages} totalCount={totalLogs} onPageChange={setPage} />}
    </div>
  );
}
