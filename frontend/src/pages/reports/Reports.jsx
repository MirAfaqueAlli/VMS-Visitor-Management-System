import { useState, useEffect, useCallback, useRef } from 'react';
import {
  BarChart2, Users, Building2, Building, ShieldOff, Activity,
  Clock, Download, Filter, Search, ChevronLeft, ChevronRight,
  RefreshCw, FileSpreadsheet, FileText, ChevronDown, Loader2,
  TrendingUp, Eye,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from 'recharts';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import apiClient from '../../api/axios';
import toast from 'react-hot-toast';
import useAuth from '../../hooks/useAuth';

// ─────────────────────────── constants ───────────────────────────────────────
// All employee-type variants map to the same label.
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

const STATUS_BADGE = {
  APPROVED:    { bg: 'var(--color-success-bg)', color: 'var(--color-success)' },
  PENDING:     { bg: 'var(--color-warning-bg)', color: 'var(--color-warning)' },
  REJECTED:    { bg: 'var(--color-error-bg)',   color: 'var(--color-error)'   },
  COMPLETED:   { bg: 'var(--color-info-bg)',    color: 'var(--color-info)'    },
  CANCELLED:   { bg: 'var(--color-muted-bg)',   color: 'var(--color-muted)'   },
  NOT_ALLOWED: { bg: 'var(--color-error-bg)',   color: 'var(--color-error)'   },
  ACTIVE:      { bg: 'var(--color-success-bg)', color: 'var(--color-success)' },
  EXPECTED:    { bg: 'var(--color-info-bg)',    color: 'var(--color-info)'    },
};

const CHART_COLORS = ['#6366f1', '#22d3ee', '#f59e0b', '#10b981', '#f43f5e', '#a78bfa', '#34d399'];
const MONTH_NAMES  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const VISITOR_TYPES = [
  { value: '',               label: 'All Types' },
  { value: 'EMPLOYEE_VISIT', label: 'Employee Visit' },
  { value: 'VENDOR',         label: 'Vendor' },
  { value: 'PRIOR',          label: 'Prior Approval' },
  { value: 'SPOT',           label: 'Walk-in' },
  { value: 'PERSONAL_VISIT', label: 'Personal Visit' },
];

const VISIT_STATUSES = [
  { value: '', label: 'All Statuses' },
  { value: 'APPROVED',    label: 'Approved' },
  { value: 'PENDING',     label: 'Pending' },
  { value: 'REJECTED',    label: 'Rejected' },
  { value: 'COMPLETED',   label: 'Completed' },
  { value: 'CANCELLED',   label: 'Cancelled' },
  { value: 'NOT_ALLOWED', label: 'Not Allowed' },
];

// ─────────────────────────── helpers ─────────────────────────────────────────
const fmt = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtTime = (t) => t ? t.substring(0, 5) : '—';

function SBadge({ status }) {
  const s = STATUS_BADGE[status] || { bg: 'var(--color-muted-bg)', color: 'var(--color-muted)' };
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider"
      style={{ background: s.bg, color: s.color }}>
      {status?.replace(/_/g, ' ') || '—'}
    </span>
  );
}

function CatBadge({ cat }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider"
      style={{ background: 'var(--color-info-bg)', color: 'var(--color-info)' }}>
      {CATEGORY_LABELS[cat] ?? cat ?? '—'}
    </span>
  );
}

// ─────────────────────────── cascading filter hook ───────────────────────────
/**
 * Provides cascading Unit → Department → Employee dropdowns.
 * For global users (super_admin / global_auditor):
 *   1. Units fetched on mount
 *   2. Departments fetched when a unit is selected
 *   3. Employees fetched when unit (+ optional dept) is set
 * For unit-level users (unit_admin / unit_auditor):
 *   1. No unit selector (they're always scoped to their own unit)
 *   2. Departments fetched on mount
 *   3. Employees fetched when dept (optionally) changes
 */
function useCascadeFilters(isCentral) {
  const [units,    setUnits]    = useState([]);
  const [selUnit,  setSelUnit]  = useState('');   // unit_db value
  const [depts,    setDepts]    = useState([]);
  const [selDept,  setSelDept]  = useState('');   // dept id
  const [employees, setEmployees] = useState([]);
  const [selEmp,   setSelEmp]   = useState('');   // user id
  const [loadingDepts, setLoadingDepts] = useState(false);
  const [loadingEmps,  setLoadingEmps]  = useState(false);

  // ── Units (global only) ───────────────────────────────────────────────────
  useEffect(() => {
    if (!isCentral) return;
    apiClient.get('/reports/meta/units')
      .then(r => setUnits(r.data?.data ?? []))
      .catch(e => toast.error('Failed to load units: ' + (e?.response?.data?.message || e.message)));
  }, [isCentral]);

  // ── Departments ───────────────────────────────────────────────────────────
  useEffect(() => {
    setDepts([]);
    setSelDept('');
    setEmployees([]);
    setSelEmp('');

    // Global: need a unit selected first
    if (isCentral && !selUnit) return;

    const params = selUnit ? { unit_db: selUnit } : {};
    setLoadingDepts(true);
    apiClient.get('/reports/meta/departments', { params })
      .then(r => setDepts(r.data?.data ?? []))
      .catch(e => toast.error('Failed to load departments: ' + (e?.response?.data?.message || e.message)))
      .finally(() => setLoadingDepts(false));
  }, [isCentral, selUnit]);

  // ── Employees ─────────────────────────────────────────────────────────────
  useEffect(() => {
    setEmployees([]);
    setSelEmp('');

    // Global users: need a unit selected before loading employees
    if (isCentral && !selUnit) return;

    const params = {};
    if (selUnit) params.unit_db = selUnit;
    if (selDept) params.department_id = selDept;

    setLoadingEmps(true);
    apiClient.get('/reports/meta/employees', { params })
      .then(r => setEmployees(r.data?.data ?? []))
      .catch(e => toast.error('Failed to load employees: ' + (e?.response?.data?.message || e.message)))
      .finally(() => setLoadingEmps(false));
  }, [isCentral, selUnit, selDept]);


  return {
    units, selUnit, setSelUnit,
    depts, selDept, setSelDept, loadingDepts,
    employees, selEmp, setSelEmp, loadingEmps,
  };
}

// ─────────────────────────── CascadeFilters UI component ─────────────────────
/**
 * Renders the contextual scoping dropdowns (Unit / Dept / Employee)
 * based on role level and which levels are needed for the current report.
 *
 * showUnit: boolean (only for global, always true for global, hidden for unit-level)
 * showDept: boolean
 * showEmp:  boolean
 */
function CascadeFilters({ isCentral, filters, showDept = false, showEmp = false, compact = false }) {
  const { units, selUnit, setSelUnit, depts, selDept, setSelDept, loadingDepts, employees, selEmp, setSelEmp, loadingEmps } = filters;

  const selClass = `block w-full pl-3 pr-8 py-2 bg-bg-primary border border-subtle rounded-lg text-sm text-loud focus:outline-none focus:ring-2 focus:ring-accent/50 appearance-none cursor-pointer disabled:opacity-50`;
  const wrap = compact ? 'flex flex-wrap gap-2' : 'flex flex-wrap gap-3';

  return (
    <div className={wrap}>
      {/* Unit selector — global users only */}
      {isCentral && (
        <div className="relative min-w-[160px] flex-1">
          <select value={selUnit} onChange={e => setSelUnit(e.target.value)} className={selClass} id="cascade-unit">
            <option value="">All Units</option>
            {units.map(u => <option key={u.db_name} value={u.db_name}>{u.name}</option>)}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-faint pointer-events-none" />
        </div>
      )}

      {/* Department selector — shown when applicable */}
      {showDept && (
        <div className="relative min-w-[160px] flex-1">
          <select
            value={selDept}
            onChange={e => setSelDept(e.target.value)}
            disabled={isCentral ? !selUnit : false}
            className={selClass}
            id="cascade-dept"
          >
            <option value="">{loadingDepts ? 'Loading…' : (isCentral && !selUnit ? 'Select unit first' : 'All Departments')}</option>
            {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-faint pointer-events-none" />
        </div>
      )}

      {/* Employee selector — only for employee-wise report */}
      {showEmp && (
        <div className="relative min-w-[180px] flex-1">
          <select
            value={selEmp}
            onChange={e => setSelEmp(e.target.value)}
            disabled={isCentral ? !selUnit : false}
            className={selClass}
            id="cascade-emp"
          >
            <option value="">
              {loadingEmps ? 'Loading…' : (isCentral && !selUnit ? 'Select unit first' : 'All Employees')}
            </option>
            {employees.map(e => (
              <option key={e.id} value={e.id}>
                {e.full_name}{e.employee_code ? ` (${e.employee_code})` : ''}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-faint pointer-events-none" />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── export helpers ───────────────────────────────────
function exportExcel(rows, columns, filename) {
  const ws = XLSX.utils.json_to_sheet(rows.map(r => {
    const o = {};
    columns.forEach(c => { o[c.header] = c.accessor(r) ?? ''; });
    return o;
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

function exportPDF(rows, columns, title, filename) {
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(14);
  doc.text(title, 14, 16);
  doc.setFontSize(9);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 23);
  autoTable(doc, {
    startY: 28,
    head: [columns.map(c => c.header)],
    body: rows.map(r => columns.map(c => c.accessor(r) ?? '')),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [99, 102, 241] },
    alternateRowStyles: { fillColor: [245, 247, 255] },
  });
  doc.save(`${filename}.pdf`);
}

// ─────────────────────────── reusable table + pagination ─────────────────────
function ReportTable({ cols, rows, loading, page, setPage, totalPages, emptyMsg = 'No data found.' }) {
  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-subtle">
        <table className="w-full text-left text-sm border-collapse">
          <thead>
            <tr className="border-b border-subtle bg-bg-primary text-muted text-xs uppercase tracking-wider">
              {cols.map(c => <th key={c.key} className="py-3 px-4 font-medium whitespace-nowrap">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={cols.length} className="py-12 text-center text-faint italic">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={cols.length} className="py-12 text-center text-faint italic">{emptyMsg}</td></tr>
            ) : rows.map((row, i) => (
              <tr key={row.id ?? i} className="border-b border-subtle hover:bg-bg-primary/60 transition-colors">
                {cols.map(c => (
                  <td key={c.key} className="py-3 px-4 text-loud">
                    {typeof c.render === 'function' ? c.render(row) : (row[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-subtle">
          <span className="text-xs text-muted">Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="p-1.5 rounded-full border border-subtle text-muted disabled:opacity-40 hover:bg-bg-primary">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="p-1.5 rounded-full border border-subtle text-muted disabled:opacity-40 hover:bg-bg-primary">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── common filter bar ───────────────────────────────
function FilterBar({ from, setFrom, to, setTo, visitorType, setVisitorType, search, setSearch,
  status, setStatus, showStatus = false, onApply, loading,
  cascadeFilters, isCentral, showDept = false, showEmp = false,
  onExcelExport, onPdfExport }) {
  return (
    <div className="space-y-3 mb-4 p-4 bg-bg-primary/50 rounded-lg border border-subtle">
      {/* Cascade Filters (Unit → Dept → Employee) */}
      <CascadeFilters isCentral={isCentral} filters={cascadeFilters} showDept={showDept} showEmp={showEmp} />

      {/* Standard filters row */}
      <div className="flex flex-wrap gap-2">
        <input type="date" value={from} onChange={e => setFrom(e.target.value)}
          className="flex-1 min-w-[130px] px-3 py-2 bg-bg-primary border border-subtle rounded-lg text-sm text-loud focus:outline-none focus:ring-2 focus:ring-accent/50" />
        <input type="date" value={to} onChange={e => setTo(e.target.value)}
          className="flex-1 min-w-[130px] px-3 py-2 bg-bg-primary border border-subtle rounded-lg text-sm text-loud focus:outline-none focus:ring-2 focus:ring-accent/50" />

        <div className="relative flex-1 min-w-[140px]">
          <select value={visitorType} onChange={e => setVisitorType(e.target.value)}
            className="block w-full pl-3 pr-8 py-2 bg-bg-primary border border-subtle rounded-lg text-sm text-loud focus:outline-none focus:ring-2 focus:ring-accent/50 appearance-none cursor-pointer">
            {VISITOR_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-faint pointer-events-none" />
        </div>

        {showStatus && (
          <div className="relative flex-1 min-w-[140px]">
            <select value={status} onChange={e => setStatus(e.target.value)}
              className="block w-full pl-3 pr-8 py-2 bg-bg-primary border border-subtle rounded-lg text-sm text-loud focus:outline-none focus:ring-2 focus:ring-accent/50 appearance-none cursor-pointer">
              {VISIT_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-faint pointer-events-none" />
          </div>
        )}

        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-faint" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
            className="block w-full pl-8 pr-3 py-2 bg-bg-primary border border-subtle rounded-lg text-sm text-loud placeholder-faint focus:outline-none focus:ring-2 focus:ring-accent/50" />
        </div>

        <button onClick={onApply} disabled={loading}
          className="flex items-center gap-1.5 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Filter className="w-3.5 h-3.5" />}
          Apply
        </button>
      </div>

      {/* Export buttons */}
      <div className="flex gap-2 justify-end">
        <button onClick={onExcelExport}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-subtle rounded-lg text-xs text-muted hover:bg-bg-primary hover:text-loud transition-colors">
          <FileSpreadsheet className="w-3.5 h-3.5 text-green-500" /> Excel
        </button>
        <button onClick={onPdfExport}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-subtle rounded-lg text-xs text-muted hover:bg-bg-primary hover:text-loud transition-colors">
          <FileText className="w-3.5 h-3.5 text-red-500" /> PDF
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════ TAB COMPONENTS ═══════════════════════════════════

// ─── Employee-wise Report ─────────────────────────────────────────────────────
function EmployeeReport({ isCentral }) {
  const cf = useCascadeFilters(isCentral);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [visitorType, setVisitorType] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 50;

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit };
      if (from) params.from = from;
      if (to)   params.to   = to;
      if (visitorType)  params.visitor_type  = visitorType;
      if (search)       params.search        = search;
      if (cf.selUnit)   params.unit_db       = cf.selUnit;
      if (cf.selDept)   params.department_id = cf.selDept;
      if (cf.selEmp)    params.host_user_id  = cf.selEmp;
      const r = await apiClient.get('/reports/employee-wise', { params });
      setRows(r.data?.data?.rows ?? []);
      setTotal(r.data?.data?.total ?? 0);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load employee report.');
    } finally {
      setLoading(false);
    }
  }, [page, from, to, visitorType, search, cf.selUnit, cf.selDept, cf.selEmp]);

  useEffect(() => { fetch(); }, [fetch]);

  const cols = [
    isCentral && { key: 'unit_name', label: 'Unit', render: r => <span className="text-muted">{r.unit_name || '—'}</span> },
    { key: 'host_name',       label: 'Host Employee', render: r => <div><div className="font-medium text-loud">{r.host_name || '—'}</div><div className="text-xs text-faint">{r.employee_code}</div></div> },
    { key: 'department_name', label: 'Department' },
    { key: 'visitor_name',    label: 'Visitor', render: r => <div><div>{r.visitor_name || '—'}</div><div className="text-xs text-faint">{r.visitor_phone}</div></div> },
    { key: 'visit_category',  label: 'Type', render: r => <CatBadge cat={r.visit_category} /> },
    { key: 'visit_date',      label: 'Date', render: r => fmt(r.visit_date) },
    { key: 'status',          label: 'Status', render: r => <SBadge status={r.status} /> },
  ].filter(Boolean);

  const expCols = [
    isCentral && { header: 'Unit', accessor: r => r.unit_name },
    { header: 'Host Employee', accessor: r => r.host_name },
    { header: 'Employee Code', accessor: r => r.employee_code },
    { header: 'Department',    accessor: r => r.department_name },
    { header: 'Visitor Name',  accessor: r => r.visitor_name },
    { header: 'Visitor Phone', accessor: r => r.visitor_phone },
    { header: 'Type',          accessor: r => CATEGORY_LABELS[r.visit_category] ?? r.visit_category },
    { header: 'Date',          accessor: r => fmt(r.visit_date) },
    { header: 'Status',        accessor: r => r.status },
    { header: 'Purpose',       accessor: r => r.purpose },
  ].filter(Boolean);

  return (
    <div>
      <FilterBar
        from={from} setFrom={setFrom} to={to} setTo={setTo}
        visitorType={visitorType} setVisitorType={setVisitorType}
        search={search} setSearch={setSearch}
        onApply={() => { setPage(1); fetch(); }} loading={loading}
        cascadeFilters={cf} isCentral={isCentral} showDept showEmp
        onExcelExport={() => exportExcel(rows, expCols, 'employee_wise_report')}
        onPdfExport={() => exportPDF(rows, expCols, 'Employee-wise Visitor Report', 'employee_wise_report')}
      />
      <p className="text-xs text-muted mb-3">{total} records total</p>
      <ReportTable cols={cols} rows={rows} loading={loading}
        page={page} setPage={setPage} totalPages={Math.ceil(total / limit)} />
    </div>
  );
}

// ─── Department-wise Report ───────────────────────────────────────────────────
function DepartmentReport({ isCentral }) {
  const cf = useCascadeFilters(isCentral);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [visitorType, setVisitorType] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 50;

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit };
      if (from) params.from = from;
      if (to)   params.to   = to;
      if (visitorType) params.visitor_type  = visitorType;
      if (search)      params.search        = search;
      if (cf.selUnit)  params.unit_db       = cf.selUnit;
      if (cf.selDept)  params.department_id = cf.selDept;
      const r = await apiClient.get('/reports/department-wise', { params });
      setRows(r.data?.data?.rows ?? []);
      setTotal(r.data?.data?.total ?? 0);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load department report.');
    } finally {
      setLoading(false);
    }
  }, [page, from, to, visitorType, search, cf.selUnit, cf.selDept]);

  useEffect(() => { fetch(); }, [fetch]);

  const cols = [
    isCentral && { key: 'unit_name', label: 'Unit', render: r => <span className="text-muted">{r.unit_name || '—'}</span> },
    { key: 'department_name', label: 'Department', render: r => <span className="font-medium">{r.department_name || 'N/A'}</span> },
    { key: 'host_name',       label: 'Host',       render: r => r.host_name || '—' },
    { key: 'visitor_name',    label: 'Visitor',    render: r => <div><div>{r.visitor_name}</div><div className="text-xs text-faint">{r.visitor_phone}</div></div> },
    { key: 'visit_category',  label: 'Type',       render: r => <CatBadge cat={r.visit_category} /> },
    { key: 'visit_date',      label: 'Date',       render: r => fmt(r.visit_date) },
    { key: 'status',          label: 'Status',     render: r => <SBadge status={r.status} /> },
  ].filter(Boolean);

  const expCols = [
    isCentral && { header: 'Unit',        accessor: r => r.unit_name },
    { header: 'Department',  accessor: r => r.department_name },
    { header: 'Host',        accessor: r => r.host_name },
    { header: 'Visitor',     accessor: r => r.visitor_name },
    { header: 'Phone',       accessor: r => r.visitor_phone },
    { header: 'Type',        accessor: r => CATEGORY_LABELS[r.visit_category] ?? r.visit_category },
    { header: 'Date',        accessor: r => fmt(r.visit_date) },
    { header: 'Status',      accessor: r => r.status },
    { header: 'Purpose',     accessor: r => r.purpose },
  ].filter(Boolean);

  return (
    <div>
      <FilterBar
        from={from} setFrom={setFrom} to={to} setTo={setTo}
        visitorType={visitorType} setVisitorType={setVisitorType}
        search={search} setSearch={setSearch}
        onApply={() => { setPage(1); fetch(); }} loading={loading}
        cascadeFilters={cf} isCentral={isCentral} showDept
        onExcelExport={() => exportExcel(rows, expCols, 'department_wise_report')}
        onPdfExport={() => exportPDF(rows, expCols, 'Department-wise Visitor Report', 'department_wise_report')}
      />
      <p className="text-xs text-muted mb-3">{total} records total</p>
      <ReportTable cols={cols} rows={rows} loading={loading}
        page={page} setPage={setPage} totalPages={Math.ceil(total / limit)} />
    </div>
  );
}

// ─── Unit-wise Report ─────────────────────────────────────────────────────────
function UnitReport({ isCentral }) {
  const cf = useCascadeFilters(isCentral);
  const [from, setFrom]   = useState('');
  const [to,   setTo]     = useState('');
  const [visitorType, setVisitorType] = useState('');
  const [search, setSearch] = useState('');
  const [data,    setData]    = useState(null);   // { rows: [], units: [] }
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (from) params.from = from;
      if (to)   params.to   = to;
      if (visitorType) params.visitor_type = visitorType;
      if (cf.selUnit)  params.unit_db = cf.selUnit;
      const r = await apiClient.get('/reports/unit-wise', { params });
      setData(r.data?.data);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load unit-wise report.');
    } finally {
      setLoading(false);
    }
  }, [from, to, visitorType, cf.selUnit]);

  useEffect(() => { fetch(); }, [fetch]);

  // Unit-level: show their own breakdown as dept table
  if (!isCentral) {
    const rows = data?.rows ?? [];
    const cols = [
      { key: 'department_name', label: 'Department', render: r => <span className="font-medium">{r.department_name || 'N/A'}</span> },
      { key: 'visit_category',  label: 'Type',       render: r => <CatBadge cat={r.visit_category} /> },
      { key: 'status',          label: 'Status',     render: r => <SBadge status={r.status} /> },
      { key: 'count',           label: 'Count',      render: r => <span className="font-bold text-accent">{r.count}</span> },
    ];
    const expCols = [
      { header: 'Department', accessor: r => r.department_name },
      { header: 'Type',       accessor: r => CATEGORY_LABELS[r.visit_category] ?? r.visit_category },
      { header: 'Status',     accessor: r => r.status },
      { header: 'Count',      accessor: r => r.count },
    ];
    return (
      <div>
        <FilterBar
          from={from} setFrom={setFrom} to={to} setTo={setTo}
          visitorType={visitorType} setVisitorType={setVisitorType}
          search={search} setSearch={setSearch}
          onApply={fetch} loading={loading}
          cascadeFilters={cf} isCentral={false}
          onExcelExport={() => exportExcel(rows, expCols, 'unit_dept_breakdown')}
          onPdfExport={() => exportPDF(rows, expCols, 'Unit Breakdown by Department', 'unit_dept_breakdown')}
        />
        <ReportTable cols={cols} rows={rows} loading={loading}
          page={1} setPage={() => {}} totalPages={1}
          emptyMsg="No breakdown data found." />
      </div>
    );
  }

  // Global: unit cards
  const unitRows = data?.rows ?? [];
  const expCols = [
    { header: 'Unit',  accessor: r => r.unit_name },
    { header: 'Total', accessor: r => r.total },
  ];

  return (
    <div>
      <FilterBar
        from={from} setFrom={setFrom} to={to} setTo={setTo}
        visitorType={visitorType} setVisitorType={setVisitorType}
        search={search} setSearch={setSearch}
        onApply={fetch} loading={loading}
        cascadeFilters={cf} isCentral
        onExcelExport={() => exportExcel(unitRows, expCols, 'unit_wise_report')}
        onPdfExport={() => exportPDF(unitRows, expCols, 'Unit-wise Visit Report', 'unit_wise_report')}
      />
      {loading ? (
        <div className="py-12 text-center text-faint italic">Loading…</div>
      ) : unitRows.length === 0 ? (
        <div className="py-12 text-center text-faint italic">No data found.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {unitRows.map((u, i) => (
            <div key={u.unit_name} className="vms-card rounded-lg p-5">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold text-loud text-sm">{u.unit_name}</h4>
                <span className="text-2xl font-bold text-accent">{u.total}</span>
              </div>
              <div className="space-y-1.5">
                {(u.breakdown ?? []).map((b, j) => (
                  <div key={j} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <CatBadge cat={b.visit_category} />
                      <SBadge status={b.status} />
                    </div>
                    <span className="font-semibold text-muted">{b.count}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Rejected Report ──────────────────────────────────────────────────────────
function RejectedReport({ isCentral }) {
  const cf = useCascadeFilters(isCentral);
  const [from, setFrom]   = useState('');
  const [to,   setTo]     = useState('');
  const [visitorType, setVisitorType] = useState('');
  const [search, setSearch] = useState('');
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage]   = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 50;

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit };
      if (from) params.from = from;
      if (to)   params.to   = to;
      if (visitorType) params.visitor_type  = visitorType;
      if (search)      params.search        = search;
      if (cf.selUnit)  params.unit_db       = cf.selUnit;
      if (cf.selDept)  params.department_id = cf.selDept;
      const r = await apiClient.get('/reports/rejected', { params });
      setRows(r.data?.data?.rows ?? []);
      setTotal(r.data?.data?.total ?? 0);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load rejected report.');
    } finally {
      setLoading(false);
    }
  }, [page, from, to, visitorType, search, cf.selUnit, cf.selDept]);

  useEffect(() => { fetch(); }, [fetch]);

  const cols = [
    isCentral && { key: 'unit_name', label: 'Unit', render: r => <span className="text-muted text-xs">{r.unit_name}</span> },
    { key: 'visitor_name',    label: 'Visitor',    render: r => <div><div>{r.visitor_name}</div><div className="text-xs text-faint">{r.visitor_phone}</div></div> },
    { key: 'department_name', label: 'Department', render: r => r.department_name || '—' },
    { key: 'host_name',       label: 'Host',       render: r => r.host_name || '—' },
    { key: 'visit_category',  label: 'Type',       render: r => <CatBadge cat={r.visit_category} /> },
    { key: 'visit_date',      label: 'Date',       render: r => fmt(r.visit_date) },
    { key: 'status',          label: 'Status',     render: r => <SBadge status={r.status} /> },
    { key: 'rejection_reason', label: 'Reason',    render: r => <span className="text-xs text-muted max-w-[200px] line-clamp-2">{r.purpose || '—'}</span> },
  ].filter(Boolean);

  const expCols = [
    isCentral && { header: 'Unit', accessor: r => r.unit_name },
    { header: 'Visitor Name',     accessor: r => r.visitor_name },
    { header: 'Visitor Phone',    accessor: r => r.visitor_phone },
    { header: 'Department',       accessor: r => r.department_name },
    { header: 'Host',             accessor: r => r.host_name },
    { header: 'Type',             accessor: r => CATEGORY_LABELS[r.visit_category] ?? r.visit_category },
    { header: 'Date',             accessor: r => fmt(r.visit_date) },
    { header: 'Status',           accessor: r => r.status },
    { header: 'Purpose',            accessor: r => r.purpose },
  ].filter(Boolean);

  return (
    <div>
      <FilterBar
        from={from} setFrom={setFrom} to={to} setTo={setTo}
        visitorType={visitorType} setVisitorType={setVisitorType}
        search={search} setSearch={setSearch}
        onApply={() => { setPage(1); fetch(); }} loading={loading}
        cascadeFilters={cf} isCentral={isCentral} showDept
        onExcelExport={() => exportExcel(rows, expCols, 'rejected_report')}
        onPdfExport={() => exportPDF(rows, expCols, 'Rejected / Not Allowed Visitors', 'rejected_report')}
      />
      <p className="text-xs text-muted mb-3">{total} records total</p>
      <ReportTable cols={cols} rows={rows} loading={loading}
        page={page} setPage={setPage} totalPages={Math.ceil(total / limit)} />
    </div>
  );
}

// ─── Active & Expected Report ─────────────────────────────────────────────────
function ActiveExpectedReport({ isCentral }) {
  const cf = useCascadeFilters(isCentral);
  const [date, setDate]     = useState(new Date().toISOString().slice(0, 10));
  const [visitorType, setVisitorType] = useState('');
  const [search, setSearch] = useState('');
  const [active,    setActive]    = useState([]);
  const [expected,  setExpected]  = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [subTab,    setSubTab]    = useState('active');

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const params = { date };
      if (visitorType) params.visitor_type  = visitorType;
      if (search)      params.search        = search;
      if (cf.selUnit)  params.unit_db       = cf.selUnit;
      if (cf.selDept)  params.department_id = cf.selDept;
      const r = await apiClient.get('/reports/active-expected', { params });
      setActive(r.data?.data?.active ?? []);
      setExpected(r.data?.data?.expected ?? []);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load active/expected report.');
    } finally {
      setLoading(false);
    }
  }, [date, visitorType, search, cf.selUnit, cf.selDept]);

  useEffect(() => { fetch(); }, [fetch]);

  const activeCols = [
    isCentral && { key: 'unit_name', label: 'Unit',  render: r => <span className="text-muted text-xs">{r.unit_name}</span> },
    { key: 'visitor_name',    label: 'Visitor',     render: r => <div><div>{r.visitor_name}</div><div className="text-xs text-faint">{r.visitor_phone}</div></div> },
    { key: 'department_name', label: 'Department',  render: r => r.department_name || '—' },
    { key: 'host_name',       label: 'Host',        render: r => r.host_name || '—' },
    { key: 'visit_category',  label: 'Type',        render: r => <CatBadge cat={r.visit_category} /> },
    { key: 'check_in_time',   label: 'Checked In',  render: r => fmtTime(r.check_in_time) },
    { key: 'gate_name',       label: 'Gate',        render: r => r.gate_name || '—' },
    { key: 'report_status',   label: 'Status',      render: r => <SBadge status={r.report_status} /> },
  ].filter(Boolean);

  const expectedCols = [
    isCentral && { key: 'unit_name', label: 'Unit', render: r => <span className="text-muted text-xs">{r.unit_name}</span> },
    { key: 'visitor_name',    label: 'Visitor',     render: r => <div><div>{r.visitor_name}</div><div className="text-xs text-faint">{r.visitor_phone}</div></div> },
    { key: 'department_name', label: 'Department',  render: r => r.department_name || '—' },
    { key: 'host_name',       label: 'Host',        render: r => r.host_name || '—' },
    { key: 'visit_category',  label: 'Type',        render: r => <CatBadge cat={r.visit_category} /> },
    { key: 'check_in_time',   label: 'Expected At', render: r => fmtTime(r.check_in_time) },
    { key: 'report_status',   label: 'Status',      render: r => <SBadge status={r.report_status} /> },
  ].filter(Boolean);

  const expColsActive = [
    isCentral && { header: 'Unit', accessor: r => r.unit_name },
    { header: 'Visitor',    accessor: r => r.visitor_name },
    { header: 'Phone',      accessor: r => r.visitor_phone },
    { header: 'Department', accessor: r => r.department_name },
    { header: 'Host',       accessor: r => r.host_name },
    { header: 'Type',       accessor: r => CATEGORY_LABELS[r.visit_category] ?? r.visit_category },
    { header: 'Checked In', accessor: r => fmtTime(r.check_in_time) },
    { header: 'Gate',       accessor: r => r.gate_name },
  ].filter(Boolean);

  const expColsExpected = [
    isCentral && { header: 'Unit', accessor: r => r.unit_name },
    { header: 'Visitor',     accessor: r => r.visitor_name },
    { header: 'Phone',       accessor: r => r.visitor_phone },
    { header: 'Department',  accessor: r => r.department_name },
    { header: 'Host',        accessor: r => r.host_name },
    { header: 'Type',        accessor: r => CATEGORY_LABELS[r.visit_category] ?? r.visit_category },
    { header: 'Expected At', accessor: r => fmtTime(r.check_in_time) },
  ].filter(Boolean);

  const curRows  = subTab === 'active' ? active : expected;
  const curCols  = subTab === 'active' ? activeCols : expectedCols;
  const curExpCols = subTab === 'active' ? expColsActive : expColsExpected;
  const curFName = subTab === 'active' ? 'active_visitors' : 'expected_visitors';

  return (
    <div>
      {/* Filter bar — date replaces from/to */}
      <div className="space-y-3 mb-4 p-4 bg-bg-primary/50 rounded-lg border border-subtle">
        <CascadeFilters isCentral={isCentral} filters={cf} showDept />
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted font-medium">Date:</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="px-3 py-2 bg-bg-primary border border-subtle rounded-lg text-sm text-loud focus:outline-none focus:ring-2 focus:ring-accent/50" />
          </div>
          <div className="relative min-w-[140px]">
            <select value={visitorType} onChange={e => setVisitorType(e.target.value)}
              className="block w-full pl-3 pr-8 py-2 bg-bg-primary border border-subtle rounded-lg text-sm text-loud focus:outline-none focus:ring-2 focus:ring-accent/50 appearance-none cursor-pointer">
              {VISITOR_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-faint pointer-events-none" />
          </div>
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-faint" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
              className="block w-full pl-8 pr-3 py-2 bg-bg-primary border border-subtle rounded-lg text-sm text-loud placeholder-faint focus:outline-none focus:ring-2 focus:ring-accent/50" />
          </div>
          <button onClick={fetch} disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Filter className="w-3.5 h-3.5" />}
            Apply
          </button>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={() => exportExcel(curRows, curExpCols, curFName)}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-subtle rounded-lg text-xs text-muted hover:bg-bg-primary hover:text-loud transition-colors">
            <FileSpreadsheet className="w-3.5 h-3.5 text-green-500" /> Excel
          </button>
          <button onClick={() => exportPDF(curRows, curExpCols, subTab === 'active' ? 'Active Visitors' : 'Expected Visitors', curFName)}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-subtle rounded-lg text-xs text-muted hover:bg-bg-primary hover:text-loud transition-colors">
            <FileText className="w-3.5 h-3.5 text-red-500" /> PDF
          </button>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 mb-4 p-1 bg-bg-primary/50 rounded-xl border border-subtle w-fit">
        {[
          { id: 'active',   label: `Currently Inside (${active.length})` },
          { id: 'expected', label: `Expected Today (${expected.length})` },
        ].map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${subTab === t.id ? 'bg-accent text-white shadow-sm' : 'text-muted hover:text-loud'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <ReportTable cols={curCols} rows={curRows} loading={loading}
        page={1} setPage={() => {}} totalPages={1}
        emptyMsg={`No ${subTab} visitors found.`} />
    </div>
  );
}

// ─── Visit History Report ─────────────────────────────────────────────────────
function VisitHistoryReport({ isCentral }) {
  const cf = useCascadeFilters(isCentral);
  const [from, setFrom]   = useState('');
  const [to,   setTo]     = useState('');
  const [visitorType, setVisitorType] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage]   = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 50;

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit };
      if (from) params.from = from;
      if (to)   params.to   = to;
      if (visitorType) params.visitor_type  = visitorType;
      if (status)      params.status        = status;
      if (search)      params.search        = search;
      if (cf.selUnit)  params.unit_db       = cf.selUnit;
      if (cf.selDept)  params.department_id = cf.selDept;
      const r = await apiClient.get('/reports/visit-history', { params });
      setRows(r.data?.data?.rows ?? []);
      setTotal(r.data?.data?.total ?? 0);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load visit history.');
    } finally {
      setLoading(false);
    }
  }, [page, from, to, visitorType, status, search, cf.selUnit, cf.selDept]);

  useEffect(() => { fetch(); }, [fetch]);

  const cols = [
    isCentral && { key: 'unit_name', label: 'Unit', render: r => <span className="text-muted text-xs">{r.unit_name}</span> },
    { key: 'visitor_name',    label: 'Visitor',    render: r => <div><div>{r.visitor_name}</div><div className="text-xs text-faint">{r.visitor_phone}</div></div> },
    { key: 'host_name',       label: 'Host',       render: r => <div><div>{r.host_name}</div><div className="text-xs text-faint">{r.department_name}</div></div> },
    { key: 'visit_category',  label: 'Type',       render: r => <CatBadge cat={r.visit_category} /> },
    { key: 'visit_date',      label: 'Date',       render: r => fmt(r.visit_date) },
    { key: 'check_in_time',   label: 'In',         render: r => fmtTime(r.check_in_time) },
    { key: 'check_out_time',  label: 'Out',        render: r => fmtTime(r.check_out_time) },
    { key: 'status',          label: 'Status',     render: r => <SBadge status={r.status} /> },
  ].filter(Boolean);

  const expCols = [
    isCentral && { header: 'Unit',        accessor: r => r.unit_name },
    { header: 'Visitor Name',  accessor: r => r.visitor_name },
    { header: 'Visitor Phone', accessor: r => r.visitor_phone },
    { header: 'Host',          accessor: r => r.host_name },
    { header: 'Department',    accessor: r => r.department_name },
    { header: 'Type',          accessor: r => CATEGORY_LABELS[r.visit_category] ?? r.visit_category },
    { header: 'Date',          accessor: r => fmt(r.visit_date) },
    { header: 'Check In',      accessor: r => fmtTime(r.check_in_time) },
    { header: 'Check Out',     accessor: r => fmtTime(r.check_out_time) },
    { header: 'Gate',          accessor: r => r.gate_name },
    { header: 'Status',        accessor: r => r.status },
    { header: 'Rejection Reason', accessor: r => r.rejection_reason },
  ].filter(Boolean);

  return (
    <div>
      <FilterBar
        from={from} setFrom={setFrom} to={to} setTo={setTo}
        visitorType={visitorType} setVisitorType={setVisitorType}
        search={search} setSearch={setSearch}
        showStatus status={status} setStatus={setStatus}
        onApply={() => { setPage(1); fetch(); }} loading={loading}
        cascadeFilters={cf} isCentral={isCentral} showDept
        onExcelExport={() => exportExcel(rows, expCols, 'visit_history')}
        onPdfExport={() => exportPDF(rows, expCols, 'Detailed Visit History', 'visit_history')}
      />
      <p className="text-xs text-muted mb-3">{total} records total</p>
      <ReportTable cols={cols} rows={rows} loading={loading}
        page={page} setPage={setPage} totalPages={Math.ceil(total / limit)} />
    </div>
  );
}

// ═══════════════════════════ OVERVIEW CHARTS (collapsed) ══════════════════════
function OverviewCharts({ from, to, onFromChange, onToChange }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen]   = useState(false);

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      const params = {};
      if (from) params.from = from;
      if (to)   params.to   = to;
      const [summary, byStatus, byDept, byType, daily, hosts] = await Promise.all([
        apiClient.get('/reports/visitor-summary', { params }),
        apiClient.get('/reports/by-status',       { params }),
        apiClient.get('/reports/by-department',   { params }),
        apiClient.get('/reports/visitor-type',    { params }),
        apiClient.get('/reports/daily-traffic',   { params }),
        apiClient.get('/reports/top-hosts',       { params }),
      ]);
      setData({
        summary:   summary.data?.data,          // { monthly, total, approved, pending, rejected }
        byStatus:  byStatus.data?.data ?? [],
        byDept:    byDept.data?.data ?? [],
        byType:    byType.data?.data ?? [],
        daily:     daily.data?.data ?? [],
        hosts:     hosts.data?.data ?? [],
      });
    } catch (e) {
      toast.error('Failed to load overview charts.');
    } finally {
      setLoading(false);
    }
  }, [open, from, to]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="vms-card rounded-xl mb-6 overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-bg-primary/40 transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
            <BarChart2 className="w-4 h-4 text-accent" />
          </div>
          <span className="font-semibold text-loud">Overview Charts</span>
        </div>
        <ChevronDown className={`w-4 h-4 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-6 pb-6 space-y-6 border-t border-subtle animate-fade-in">
          {/* Date filter */}
          <div className="flex flex-wrap gap-3 pt-4">
            <input type="date" value={from} onChange={e => onFromChange(e.target.value)}
              className="px-3 py-1.5 bg-bg-primary border border-subtle rounded-lg text-sm text-loud focus:outline-none focus:ring-2 focus:ring-accent/50" />
            <input type="date" value={to} onChange={e => onToChange(e.target.value)}
              className="px-3 py-1.5 bg-bg-primary border border-subtle rounded-lg text-sm text-loud focus:outline-none focus:ring-2 focus:ring-accent/50" />
            <button onClick={load} disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent/90 disabled:opacity-50">
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Refresh
            </button>
          </div>

          {loading && <div className="py-8 text-center text-muted animate-pulse">Loading charts…</div>}

          {data && !loading && (
            <>
              {/* Stat cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: 'Total Visits',   value: data.summary?.total    ?? 0, color: '#6366f1' },
                  { label: 'Approved',       value: data.summary?.approved ?? 0, color: '#10b981' },
                  { label: 'Pending',        value: data.summary?.pending  ?? 0, color: '#f59e0b' },
                  { label: 'Rejected',       value: data.summary?.rejected ?? 0, color: '#f43f5e' },
                ].map(s => (
                  <div key={s.label} className="rounded-xl p-4 border border-subtle bg-bg-primary/60">
                    <p className="text-xs text-muted mb-1">{s.label}</p>
                    <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Charts grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Daily traffic */}
                {data.daily.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Daily Traffic</p>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={data.daily.slice(-14)}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                        <XAxis dataKey="date" tickFormatter={d => { const dt = new Date(d); return `${dt.getDate()} ${MONTH_NAMES[dt.getMonth()]}`; }} tick={{ fontSize: 10, fill: 'var(--color-muted)' }} />
                        <YAxis tick={{ fontSize: 10, fill: 'var(--color-muted)' }} />
                        <Tooltip contentStyle={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }} />
                        <Line type="monotone" dataKey="total" stroke="#6366f1" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* By status (pie) */}
                {data.byStatus.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">By Status</p>
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={data.byStatus} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={75}
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}
                          style={{ fontSize: 11 }}>
                          {data.byStatus.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* By visitor type (bar) */}
                {data.byType.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">By Visit Type</p>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={data.byType}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                        <XAxis dataKey="visit_category" tickFormatter={c => CATEGORY_LABELS[c] ?? c} tick={{ fontSize: 10, fill: 'var(--color-muted)' }} />
                        <YAxis tick={{ fontSize: 10, fill: 'var(--color-muted)' }} />
                        <Tooltip formatter={(v, n, p) => [v, CATEGORY_LABELS[p.payload.visit_category] ?? p.payload.visit_category]} contentStyle={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }} />
                        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                          {data.byType.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Top hosts */}
                {data.hosts.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Top Hosts</p>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={data.hosts.slice(0, 8)} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                        <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--color-muted)' }} />
                        <YAxis dataKey="host_name" type="category" width={100} tick={{ fontSize: 10, fill: 'var(--color-muted)' }} />
                        <Tooltip contentStyle={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }} />
                        <Bar dataKey="visit_count" fill="#6366f1" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════ MAIN PAGE ════════════════════════════════════════
const TABS = [
  { id: 'employee', label: 'Employee-wise', icon: Users },
  { id: 'dept',     label: 'Dept-wise',     icon: Building2 },
  { id: 'unit',     label: 'Unit/Office',   icon: Building },
  { id: 'rejected', label: 'Rejected',      icon: ShieldOff },
  { id: 'active',   label: 'Active & Expected', icon: Activity },
  { id: 'history',  label: 'Visit History', icon: Clock },
];

export default function Reports() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('employee');
  const [chartFrom, setChartFrom] = useState('');
  const [chartTo,   setChartTo]   = useState('');

  const role = user?.role_type;
  const isCentral = role === 'super_admin' || role === 'global_auditor';
  const isAdminOrAuditor = ['super_admin', 'global_auditor', 'unit_admin', 'unit_auditor'].includes(role);

  if (!isAdminOrAuditor) {
    return (
      <div className="max-w-2xl mx-auto py-20 px-6 text-center">
        <ShieldOff className="w-12 h-12 text-muted mx-auto mb-4" />
        <h2 className="text-xl font-bold text-loud mb-2">Access Restricted</h2>
        <p className="text-muted">Reports are available to admins and auditors only.</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 animate-fade-in">
      {/* ── Page Header ─────────────────────────────────────────────────── */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-loud flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center">
            <BarChart2 className="w-5 h-5 text-accent" />
          </div>
          Reports &amp; <em className="italic">Analytics</em>
        </h1>
        <p className="text-muted mt-1.5 text-sm">
          {isCentral
            ? 'System-wide reports across all units. Use the Unit filter to scope to a specific unit.'
            : 'Unit-level reports. Use the Department filter to scope by department.'}
        </p>
      </div>

      {/* ── Overview Charts (collapsible) ─────────────────────────────── */}
      <OverviewCharts
        from={chartFrom} to={chartTo}
        onFromChange={setChartFrom} onToChange={setChartTo}
      />

      {/* ── Tab Navigation ───────────────────────────────────────────── */}
      <div className="vms-card rounded-xl overflow-hidden">
        <div className="flex overflow-x-auto border-b border-subtle">
          {TABS.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium whitespace-nowrap border-b-2 transition-all flex-shrink-0 ${
                  activeTab === t.id
                    ? 'border-accent text-accent bg-accent/5'
                    : 'border-transparent text-muted hover:text-loud hover:bg-bg-primary/60'
                }`}
              >
                <Icon className="w-4 h-4" />
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="p-6">
          {activeTab === 'employee' && <EmployeeReport   isCentral={isCentral} />}
          {activeTab === 'dept'     && <DepartmentReport isCentral={isCentral} />}
          {activeTab === 'unit'     && <UnitReport       isCentral={isCentral} />}
          {activeTab === 'rejected' && <RejectedReport   isCentral={isCentral} />}
          {activeTab === 'active'   && <ActiveExpectedReport isCentral={isCentral} />}
          {activeTab === 'history'  && <VisitHistoryReport   isCentral={isCentral} />}
        </div>
      </div>
    </div>
  );
}
