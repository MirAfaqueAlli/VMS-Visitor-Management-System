// frontend/src/pages/audit/AuditLog.jsx
import { useState, useEffect, useCallback } from "react";
import { ShieldAlert, Search, RefreshCw, ChevronLeft, ChevronRight, Building2 } from "lucide-react";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";
import useAuth from "../../hooks/useAuth";

function fmtDateTime(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

const ACTION_COLORS = {
  CREATE:   { bg: '#dcfce7', text: '#166534' },
  UPDATE:   { bg: '#dbeafe', text: '#1e40af' },
  DELETE:   { bg: '#fee2e2', text: '#991b1b' },
  LOGIN:    { bg: '#fef9c3', text: '#854d0e' },
  LOGOUT:   { bg: '#f3f4f6', text: '#374151' },
  APPROVE:  { bg: '#dcfce7', text: '#166534' },
  REJECT:   { bg: '#fee2e2', text: '#991b1b' },
  CHECKIN:  { bg: '#ede9fe', text: '#5b21b6' },
  CHECKOUT: { bg: '#ede9fe', text: '#5b21b6' },
  DEACTIVATE: { bg: '#fee2e2', text: '#991b1b' },
};

function ActionBadge({ action }) {
  const key    = action?.split('_')[0]?.toUpperCase() ?? '';
  const colors = ACTION_COLORS[key] ?? ACTION_COLORS[action?.toUpperCase()] ?? { bg: '#f3f4f6', text: '#374151' };
  return (
    <span
      className="text-[10px] px-2 py-0.5 rounded font-semibold uppercase tracking-wider"
      style={{ background: colors.bg, color: colors.text }}
    >
      {action}
    </span>
  );
}

const MODULES = [
  'AUTH', 'USER', 'VISIT_REQUEST', 'GATE', 'APPROVAL',
  'DEPARTMENT', 'UNIT', 'DESIGNATION', 'REPORT', 'ADMIN',
];

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

  // Reset page when filters change
  const onSearch = (v) => { setSearch(v); setPage(1); };
  const onModule = (v) => { setModule(v); setPage(1); };
  const onUnit   = (v) => { setUnitDb(v); setPage(1); };

  return (
    <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <p className="text-[11px] tracking-widest uppercase text-accent mb-1">
            {isCentral ? 'Global' : 'Unit'} Audit
          </p>
          <h1 className="text-2xl font-bold text-loud">
            Audit <em className="italic">Logs</em>
          </h1>
          <p className="text-faint mt-1 text-sm">
            {isCentral
              ? `Immutable record of all actions across every unit. ${totalLogs > 0 ? `${totalLogs.toLocaleString()} entries found.` : ''}`
              : 'Immutable record of all system actions.'}
          </p>
        </div>
        <button
          onClick={fetchLogs}
          disabled={loading}
          className="flex items-center gap-2 btn-secondary text-muted text-sm disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="vms-card p-4 mb-6 flex flex-wrap gap-3 items-center">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            type="text"
            placeholder="Search by user, action, record…"
            value={search}
            onChange={e => onSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-sm bg-bg-primary border border-subtle rounded-full text-loud focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        {/* Module filter */}
        <select
          value={module}
          onChange={e => onModule(e.target.value)}
          className="px-4 py-2 text-sm bg-bg-primary border border-subtle rounded-full text-loud focus:outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="">All Modules</option>
          {MODULES.map(m => <option key={m} value={m}>{m}</option>)}
        </select>

        {/* Unit filter — super admin / global auditor only */}
        {isCentral && units.length > 0 && (
          <select
            value={unitDb}
            onChange={e => onUnit(e.target.value)}
            className="px-4 py-2 text-sm bg-bg-primary border border-subtle rounded-full text-loud focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="">All Units</option>
            <option value="central">Central Admin</option>
            {units.map(u => (
              <option key={u.db_name} value={u.db_name}>{u.unit_name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Table */}
      <div className="vms-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-primary)' }}>
                {[
                  'When', 'User',
                  ...(isCentral ? ['Unit'] : []),
                  'Module', 'Action', 'Record', 'IP',
                ].map(col => (
                  <th
                    key={col}
                    className="px-5 py-3 text-left text-[11px] font-semibold tracking-wider uppercase text-faint whitespace-nowrap"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {loading ? (
                <tr>
                  <td colSpan={isCentral ? 7 : 6} className="px-5 py-12 text-center text-faint italic">
                    <div className="flex flex-col items-center gap-3">
                      <div
                        className="w-6 h-6 rounded-full border-2 animate-spin"
                        style={{ borderColor: 'var(--color-border)', borderTopColor: 'var(--color-accent)' }}
                      />
                      {isCentral ? 'Collecting logs from all units…' : 'Loading audit logs…'}
                    </div>
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={isCentral ? 7 : 6} className="px-5 py-12 text-center text-faint italic">
                    No audit logs found.
                  </td>
                </tr>
              ) : logs.map((log, i) => (
                <tr key={`${log.unit_db}-${log.id}-${i}`} className="hover:bg-surface-hover transition-colors">
                  {/* When */}
                  <td className="px-5 py-3 text-faint whitespace-nowrap text-[12px]">
                    {fmtDateTime(log.created_at)}
                  </td>

                  {/* User */}
                  <td className="px-5 py-3 whitespace-nowrap">
                    <p className="font-medium text-loud text-[12px]">
                      {log.user_name ?? `#${log.user_id}`}
                    </p>
                  </td>

                  {/* Unit — super admin only */}
                  {isCentral && (
                    <td className="px-5 py-3 whitespace-nowrap">
                      <span
                        className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
                        style={{
                          background: log.log_source === 'central' ? '#ede9fe' : '#dbeafe',
                          color:      log.log_source === 'central' ? '#5b21b6' : '#1e40af',
                        }}
                      >
                        <Building2 size={10} />
                        {log.unit_name ?? log.unit_db ?? '—'}
                      </span>
                    </td>
                  )}

                  {/* Module */}
                  <td className="px-5 py-3">
                    <span className="text-[11px] text-muted font-mono">{log.module ?? '—'}</span>
                  </td>

                  {/* Action */}
                  <td className="px-5 py-3">
                    <ActionBadge action={log.action} />
                  </td>

                  {/* Record */}
                  <td className="px-5 py-3 text-muted text-[12px] max-w-[180px] truncate">
                    {log.record_type && (
                      <span className="font-mono">{log.record_type}</span>
                    )}
                    {log.record_id && (
                      <span className="text-faint"> #{log.record_id}</span>
                    )}
                  </td>

                  {/* IP */}
                  <td className="px-5 py-3 text-faint text-[11px] font-mono whitespace-nowrap">
                    {log.ip_address ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div
            className="flex items-center justify-between px-5 py-4"
            style={{ borderTop: '1px solid var(--color-border)' }}
          >
            <span className="text-sm text-muted">
              Page {page} of {totalPages}
              {totalLogs > 0 && ` · ${totalLogs.toLocaleString()} total logs`}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-2 rounded-full border border-subtle text-loud disabled:opacity-40 hover:bg-bg-primary transition-colors"
              >
                <ChevronLeft size={16} strokeWidth={1.5} />
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-2 rounded-full border border-subtle text-loud disabled:opacity-40 hover:bg-bg-primary transition-colors"
              >
                <ChevronRight size={16} strokeWidth={1.5} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
