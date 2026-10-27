import { useState, useEffect, useCallback, useRef } from 'react';
import {
  BarChart2, Users, Building2, Building, ShieldOff, Activity,
  Clock, Download, Filter, Search, ChevronLeft, ChevronRight,
  RefreshCw, FileSpreadsheet, FileText, ChevronDown, Loader2,
  TrendingUp, Eye, UserX,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from 'recharts';
import apiClient from '../../api/axios';
import toast from 'react-hot-toast';
import useAuth from '../../hooks/useAuth';
import { OFFICE_TYPES, officeTypeLabel } from '../../utils/officeTypes';

const getISTDateString = (d = new Date()) => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
};

// ─────────────────────────── constants ───────────────────────────────────────
// All employee-type variants map to the same label.
const CATEGORY_LABELS = {
  EMPLOYEE_VISIT:    'Employee Visit',
  VENDOR:            'Vendor',
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
  DEBARRED:    { bg: 'var(--color-error-bg)',   color: 'var(--color-error)'   },
  LIFTED:      { bg: 'var(--color-muted-bg)',   color: 'var(--color-muted)'   },
};

const CHART_COLORS = ['#6366f1', '#22d3ee', '#f59e0b', '#10b981', '#f43f5e', '#a78bfa', '#34d399'];
const MONTH_NAMES  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const VISITOR_TYPES = [
  { value: '',               label: 'All Types' },
  { value: 'EMPLOYEE_VISIT', label: 'Employee Visit' },
  { value: 'VENDOR',         label: 'Vendor' },
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

// Rejected tab: REJECTED = declined by host/admin, NOT_ALLOWED = refused at the gate
const REJECTION_STATUSES = [
  { value: '',            label: 'All' },
  { value: 'REJECTED',    label: 'Rejected by Host' },
  { value: 'NOT_ALLOWED', label: 'Not Allowed (Gate)' },
  { value: 'CANCELLED',   label: 'Cancelled' },
];

// Debarred tab: ACTIVE = currently debarred, LIFTED = debarment lifted
const DEBAR_STATUSES = [
  { value: '',       label: 'All' },
  { value: 'ACTIVE', label: 'Currently Debarred' },
  { value: 'LIFTED', label: 'Lifted' },
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
async function fetchAllReportRows(endpoint, params = {}) {
  const res = await apiClient.get(endpoint, {
    params: {
      ...params,
      all: 'true',
      export: 'true',
      limit: 10000,
    }
  });
  const data = res.data?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.rows)) return data.rows;
  return [];
}

// The Excel / PDF libraries are large (~1 MB together), so they are loaded only
// when an export is actually made — not with the Reports page.
async function exportExcel(rows, columns, filename, { title, metadata } = {}) {
  let XLSX;
  try {
    XLSX = await import('xlsx');
  } catch (err) {
    console.error('[Reports] Could not load the Excel exporter:', err);
    toast.error('Could not create the Excel file. Please try again.');
    return;
  }
  const headerRows = [];
  if (title) headerRows.push([title]);
  headerRows.push([`Generated: ${new Date().toLocaleString('en-GB')}`]);
  if (metadata && typeof metadata === 'object') {
    Object.entries(metadata).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        headerRows.push([`${k}:`, v]);
      }
    });
  }
  if (headerRows.length > 0) {
    headerRows.push([]); // blank separator before headers
  }

  const tableData = rows.map(r => {
    const o = {};
    columns.forEach(c => { o[c.header] = c.accessor(r) ?? ''; });
    return o;
  });

  const ws = XLSX.utils.aoa_to_sheet(headerRows);
  XLSX.utils.sheet_add_json(ws, tableData, {
    origin: headerRows.length > 0 ? `A${headerRows.length + 1}` : 'A1'
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  const cleanFilename = (filename || 'report').replace(/[^a-zA-Z0-9_-]/g, '_');
  XLSX.writeFile(wb, `${cleanFilename}.xlsx`);
}

async function exportPDF(rows, columns, title, filename, { metadata } = {}) {
  let jsPDF, autoTable;
  try {
    [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  } catch (err) {
    console.error('[Reports] Could not load the PDF exporter:', err);
    toast.error('Could not create the PDF file. Please try again.');
    return;
  }
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(14);
  doc.text(title, 14, 16);
  doc.setFontSize(9);
  doc.setTextColor(100);
  let y = 22;
  doc.text(`Generated: ${new Date().toLocaleString('en-GB')}`, 14, y);

  if (metadata && typeof metadata === 'object') {
    const metaEntries = Object.entries(metadata).filter(([_, v]) => v !== undefined && v !== null && v !== '');
    if (metaEntries.length > 0) {
      y += 5;
      const metaText = metaEntries.map(([k, v]) => `${k}: ${v}`).join('   |   ');
      doc.setFontSize(8);
      doc.setTextColor(70);
      doc.text(metaText, 14, y);
    }
  }

  autoTable(doc, {
    startY: y + 5,
    head: [columns.map(c => c.header)],
    body: rows.map(r => columns.map(c => c.accessor(r) ?? '')),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [99, 102, 241], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 249, 253] },
  });
  const cleanFilename = (filename || 'report').replace(/[^a-zA-Z0-9_-]/g, '_');
  doc.save(`${cleanFilename}.pdf`);
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
  status, setStatus, showStatus = false, statusOptions = VISIT_STATUSES, showVisitorType = true,
  onApply, loading,
  cascadeFilters, isCentral, showDept = false, showEmp = false,
  onExcelExport, onPdfExport, exporting = false }) {
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

        {showVisitorType && (
          <div className="relative flex-1 min-w-[140px]">
            <select value={visitorType} onChange={e => setVisitorType(e.target.value)}
              className="block w-full pl-3 pr-8 py-2 bg-bg-primary border border-subtle rounded-lg text-sm text-loud focus:outline-none focus:ring-2 focus:ring-accent/50 appearance-none cursor-pointer">
              {VISITOR_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-faint pointer-events-none" />
          </div>
        )}

        {showStatus && (
          <div className="relative flex-1 min-w-[140px]">
            <select value={status} onChange={e => setStatus(e.target.value)}
              className="block w-full pl-3 pr-8 py-2 bg-bg-primary border border-subtle rounded-lg text-sm text-loud focus:outline-none focus:ring-2 focus:ring-accent/50 appearance-none cursor-pointer">
              {statusOptions.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
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
      <div className="flex items-center gap-2 justify-end pt-1 border-t border-subtle/50">
        <span className="text-xs text-muted font-medium mr-1">Export Full Report:</span>
        <button onClick={onExcelExport} disabled={exporting}
          title="Download complete report across all pages in Excel"
          className="flex items-center gap-1.5 px-3 py-1.5 border border-subtle rounded-lg text-xs font-medium text-muted hover:bg-bg-primary hover:text-loud hover:border-green-500/50 transition-colors disabled:opacity-50">
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin text-green-500" /> : <FileSpreadsheet className="w-3.5 h-3.5 text-green-500" />}
          Excel
        </button>
        <button onClick={onPdfExport} disabled={exporting}
          title="Download complete report across all pages in PDF"
          className="flex items-center gap-1.5 px-3 py-1.5 border border-subtle rounded-lg text-xs font-medium text-muted hover:bg-bg-primary hover:text-loud hover:border-red-500/50 transition-colors disabled:opacity-50">
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin text-red-500" /> : <FileText className="w-3.5 h-3.5 text-red-500" />}
          PDF
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
  const [exportingAll, setExportingAll] = useState(false);
  const [downloadingKey, setDownloadingKey] = useState('');
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

  // Download entire report across all employees
  const handleExportAll = async (format) => {
    try {
      setExportingAll(true);
      const params = {};
      if (from) params.from = from;
      if (to) params.to = to;
      if (visitorType) params.visitor_type = visitorType;
      if (search) params.search = search;
      if (cf.selUnit) params.unit_db = cf.selUnit;
      if (cf.selDept) params.department_id = cf.selDept;
      if (cf.selEmp) params.host_user_id = cf.selEmp;

      toast.loading('Preparing complete employee-wise report...', { id: 'emp-all-export' });
      const allRows = await fetchAllReportRows('/reports/employee-wise', params);
      toast.dismiss('emp-all-export');

      if (!allRows || allRows.length === 0) {
        toast.error('No matching records found to export.');
        return;
      }

      const meta = {
        'Report Name': 'Employee-Wise Visitor Report (All Records)',
        'Unit': cf.units.find(u => u.db_name === cf.selUnit)?.name || (cf.selUnit ? cf.selUnit : 'All Units'),
        'Department': cf.depts.find(d => String(d.id) === String(cf.selDept))?.name || (cf.selDept ? cf.selDept : 'All Departments'),
        'Employee': cf.employees.find(e => String(e.id) === String(cf.selEmp))?.full_name || 'All Employees',
        'Date Range': (from || to) ? `${from || 'Start'} to ${to || 'Present'}` : 'All Time',
        'Total Records': allRows.length,
      };

      if (format === 'excel') {
        exportExcel(allRows, expCols, 'employee_wise_report_all', { title: 'Employee-wise Visitor Report', metadata: meta });
      } else {
        exportPDF(allRows, expCols, 'Employee-wise Visitor Report', 'employee_wise_report_all', { metadata: meta });
      }
      toast.success(`Exported ${allRows.length} records successfully.`);
    } catch (e) {
      toast.dismiss('emp-all-export');
      toast.error('Failed to export employee report: ' + (e?.message || 'Error'));
    } finally {
      setExportingAll(false);
    }
  };

  // Download complete report of a particular employee
  const handleDownloadEmployee = async (emp, format) => {
    const hostId = emp.host_id || emp.id;
    const hostCode = emp.employee_code || '';
    const hostName = emp.host_name || emp.full_name || 'Employee';
    const deptName = emp.department_name || (cf.depts.find(d => String(d.id) === String(cf.selDept))?.name) || '';
    const unitDb = emp.unit_db || cf.selUnit;
    const unitName = emp.unit_name || cf.units.find(u => u.db_name === cf.selUnit)?.name || '';

    const key = `${format}-${hostId || hostCode || hostName}`;
    try {
      setDownloadingKey(key);
      toast.loading(`Fetching full report for ${hostName}...`, { id: 'single-emp-dl' });

      const params = {};
      if (from) params.from = from;
      if (to) params.to = to;
      if (visitorType) params.visitor_type = visitorType;
      if (hostId) params.host_user_id = hostId;
      if (hostCode) params.employee_code = hostCode;
      if (unitDb) params.unit_db = unitDb;

      const singleRows = await fetchAllReportRows('/reports/employee-wise', params);
      toast.dismiss('single-emp-dl');

      if (!singleRows || singleRows.length === 0) {
        toast.error(`No visit records found for ${hostName}.`);
        return;
      }

      const cleanName = hostName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const cleanCode = (hostCode || 'EMP').replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `Employee_Report_${cleanName}_${cleanCode}`;

      const meta = {
        'Report Type': 'Individual Employee Visit Report',
        'Host Employee': `${hostName} (${hostCode || 'N/A'})`,
        'Department': deptName || 'General',
        'Unit': unitName || 'All Units',
        'Date Range': (from || to) ? `${from || 'Start'} to ${to || 'Present'}` : 'All Time',
        'Total Visits': singleRows.length,
      };

      if (format === 'excel') {
        exportExcel(singleRows, expCols, filename, { title: `Employee Visit Report - ${hostName}`, metadata: meta });
      } else {
        exportPDF(singleRows, expCols, `Employee Visit Report - ${hostName}`, filename, { metadata: meta });
      }
      toast.success(`Downloaded complete report for ${hostName} (${singleRows.length} visits).`);
    } catch (e) {
      toast.dismiss('single-emp-dl');
      toast.error('Failed to download employee report: ' + (e?.message || 'Error'));
    } finally {
      setDownloadingKey('');
    }
  };

  const selectedEmpObj = cf.employees.find(e => String(e.id) === String(cf.selEmp));

  const cols = [
    isCentral && { key: 'unit_name', label: 'Unit', render: r => <span className="text-muted">{r.unit_name || '—'}</span> },
    { key: 'host_name',       label: 'Host Employee', render: r => <div><div className="font-medium text-loud">{r.host_name || '—'}</div><div className="text-xs text-faint">{r.employee_code}</div></div> },
    { key: 'department_name', label: 'Department' },
    { key: 'visitor_name',    label: 'Visitor', render: r => <div><div>{r.visitor_name || '—'}</div><div className="text-xs text-faint">{r.visitor_phone}</div></div> },
    { key: 'visit_category',  label: 'Type', render: r => <CatBadge cat={r.visit_category} /> },
    { key: 'visit_date',      label: 'Date', render: r => fmt(r.visit_date) },
    { key: 'status',          label: 'Status', render: r => <SBadge status={r.status} /> },
    {
      key: 'actions',
      label: 'Download Individual',
      render: r => (
        <div className="flex items-center gap-1.5 whitespace-nowrap">
          <button
            type="button"
            title={`Download complete Excel report for ${r.host_name || 'this employee'}`}
            onClick={() => handleDownloadEmployee(r, 'excel')}
            disabled={downloadingKey === `excel-${r.host_id || r.employee_code || r.host_name}`}
            className="px-2 py-1 text-xs border border-subtle rounded flex items-center gap-1 hover:bg-bg-primary hover:border-green-500 text-loud hover:text-green-600 transition-colors disabled:opacity-50"
          >
            {downloadingKey === `excel-${r.host_id || r.employee_code || r.host_name}` ? (
              <Loader2 className="w-3 h-3 animate-spin text-green-600" />
            ) : (
              <FileSpreadsheet className="w-3 h-3 text-green-600" />
            )}
            <span className="text-[11px] font-medium">Excel</span>
          </button>
          <button
            type="button"
            title={`Download complete PDF report for ${r.host_name || 'this employee'}`}
            onClick={() => handleDownloadEmployee(r, 'pdf')}
            disabled={downloadingKey === `pdf-${r.host_id || r.employee_code || r.host_name}`}
            className="px-2 py-1 text-xs border border-subtle rounded flex items-center gap-1 hover:bg-bg-primary hover:border-red-500 text-loud hover:text-red-600 transition-colors disabled:opacity-50"
          >
            {downloadingKey === `pdf-${r.host_id || r.employee_code || r.host_name}` ? (
              <Loader2 className="w-3 h-3 animate-spin text-red-600" />
            ) : (
              <FileText className="w-3 h-3 text-red-600" />
            )}
            <span className="text-[11px] font-medium">PDF</span>
          </button>
        </div>
      ),
    },
  ].filter(Boolean);

  return (
    <div>
      <FilterBar
        from={from} setFrom={setFrom} to={to} setTo={setTo}
        visitorType={visitorType} setVisitorType={setVisitorType}
        search={search} setSearch={setSearch}
        onApply={() => { setPage(1); fetch(); }} loading={loading}
        cascadeFilters={cf} isCentral={isCentral} showDept showEmp
        onExcelExport={() => handleExportAll('excel')}
        onPdfExport={() => handleExportAll('pdf')}
        exporting={exportingAll}
      />

      {/* Contextual Individual Employee Download Banner when selected in Filter */}
      {selectedEmpObj && (
        <div className="mb-4 p-4 rounded-xl border border-accent/30 bg-accent/5 flex flex-wrap items-center justify-between gap-3 animate-fade-in">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center text-accent">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-loud text-sm">{selectedEmpObj.full_name}</span>
                {selectedEmpObj.employee_code && (
                  <span className="text-xs px-2 py-0.5 rounded bg-subtle text-muted font-mono">
                    {selectedEmpObj.employee_code}
                  </span>
                )}
                <span className="text-xs text-muted">
                  ({cf.depts.find(d => String(d.id) === String(cf.selDept))?.name || 'Department'})
                </span>
              </div>
              <p className="text-xs text-muted mt-0.5">
                Download entire visit history report exclusively for this employee
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleDownloadEmployee(selectedEmpObj, 'excel')}
              disabled={!!downloadingKey}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-primary border border-subtle rounded-lg text-xs font-medium text-loud hover:border-green-500 hover:text-green-600 transition-colors shadow-sm disabled:opacity-50"
            >
              {downloadingKey === `excel-${selectedEmpObj.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin text-green-500" /> : <FileSpreadsheet className="w-3.5 h-3.5 text-green-500" />}
              Download Excel
            </button>
            <button
              onClick={() => handleDownloadEmployee(selectedEmpObj, 'pdf')}
              disabled={!!downloadingKey}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-primary border border-subtle rounded-lg text-xs font-medium text-loud hover:border-red-500 hover:text-red-600 transition-colors shadow-sm disabled:opacity-50"
            >
              {downloadingKey === `pdf-${selectedEmpObj.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin text-red-500" /> : <FileText className="w-3.5 h-3.5 text-red-500" />}
              Download PDF
            </button>
          </div>
        </div>
      )}

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
  const [exportingAll, setExportingAll] = useState(false);
  const [downloadingKey, setDownloadingKey] = useState('');
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

  // Download entire department report across all departments
  const handleExportAll = async (format) => {
    try {
      setExportingAll(true);
      const params = {};
      if (from) params.from = from;
      if (to) params.to = to;
      if (visitorType) params.visitor_type = visitorType;
      if (search) params.search = search;
      if (cf.selUnit) params.unit_db = cf.selUnit;
      if (cf.selDept) params.department_id = cf.selDept;

      toast.loading('Preparing complete department-wise report...', { id: 'dept-all-export' });
      const allRows = await fetchAllReportRows('/reports/department-wise', params);
      toast.dismiss('dept-all-export');

      if (!allRows || allRows.length === 0) {
        toast.error('No matching records found to export.');
        return;
      }

      const meta = {
        'Report Name': 'Department-Wise Visitor Report (All Records)',
        'Unit': cf.units.find(u => u.db_name === cf.selUnit)?.name || (cf.selUnit ? cf.selUnit : 'All Units'),
        'Department': cf.depts.find(d => String(d.id) === String(cf.selDept))?.name || (cf.selDept ? cf.selDept : 'All Departments'),
        'Date Range': (from || to) ? `${from || 'Start'} to ${to || 'Present'}` : 'All Time',
        'Total Records': allRows.length,
      };

      if (format === 'excel') {
        exportExcel(allRows, expCols, 'department_wise_report_all', { title: 'Department-wise Visitor Report', metadata: meta });
      } else {
        exportPDF(allRows, expCols, 'Department-wise Visitor Report', 'department_wise_report_all', { metadata: meta });
      }
      toast.success(`Exported ${allRows.length} records successfully.`);
    } catch (e) {
      toast.dismiss('dept-all-export');
      toast.error('Failed to export department report: ' + (e?.message || 'Error'));
    } finally {
      setExportingAll(false);
    }
  };

  // Download complete report of a particular department of a particular unit
  const handleDownloadDept = async (dept, format) => {
    const deptId = dept.department_id || dept.id;
    const deptName = dept.department_name || dept.name || 'Department';
    const unitDb = dept.unit_db || cf.selUnit;
    const unitName = dept.unit_name || cf.units.find(u => u.db_name === cf.selUnit)?.name || '';

    const key = `${format}-${deptId || deptName}`;
    try {
      setDownloadingKey(key);
      toast.loading(`Fetching report for ${deptName}...`, { id: 'single-dept-dl' });

      const params = {};
      if (from) params.from = from;
      if (to) params.to = to;
      if (visitorType) params.visitor_type = visitorType;
      if (deptId) params.department_id = deptId;
      if (deptName) params.department_name = deptName;
      if (unitDb) params.unit_db = unitDb;

      const singleRows = await fetchAllReportRows('/reports/department-wise', params);
      toast.dismiss('single-dept-dl');

      if (!singleRows || singleRows.length === 0) {
        toast.error(`No visit records found for ${deptName}.`);
        return;
      }

      const cleanDept = deptName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const cleanUnit = (unitName || 'AllUnits').replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `Department_Report_${cleanDept}_${cleanUnit}`;

      const meta = {
        'Report Type': 'Department-Wise Visit Report',
        'Department': deptName,
        'Unit': unitName || 'All Units',
        'Date Range': (from || to) ? `${from || 'Start'} to ${to || 'Present'}` : 'All Time',
        'Total Visits': singleRows.length,
      };

      if (format === 'excel') {
        exportExcel(singleRows, expCols, filename, { title: `Department Visit Report - ${deptName}`, metadata: meta });
      } else {
        exportPDF(singleRows, expCols, `Department Visit Report - ${deptName}`, filename, { metadata: meta });
      }
      toast.success(`Downloaded complete report for ${deptName} (${singleRows.length} visits).`);
    } catch (e) {
      toast.dismiss('single-dept-dl');
      toast.error('Failed to download department report: ' + (e?.message || 'Error'));
    } finally {
      setDownloadingKey('');
    }
  };

  const selectedDeptObj = cf.depts.find(d => String(d.id) === String(cf.selDept));

  const cols = [
    isCentral && { key: 'unit_name', label: 'Unit', render: r => <span className="text-muted">{r.unit_name || '—'}</span> },
    { key: 'department_name', label: 'Department', render: r => <span className="font-medium">{r.department_name || 'N/A'}</span> },
    { key: 'host_name',       label: 'Host',       render: r => r.host_name || '—' },
    { key: 'visitor_name',    label: 'Visitor',    render: r => <div><div>{r.visitor_name}</div><div className="text-xs text-faint">{r.visitor_phone}</div></div> },
    { key: 'visit_category',  label: 'Type',       render: r => <CatBadge cat={r.visit_category} /> },
    { key: 'visit_date',      label: 'Date',       render: r => fmt(r.visit_date) },
    { key: 'status',          label: 'Status',     render: r => <SBadge status={r.status} /> },
    {
      key: 'actions',
      label: 'Download Dept',
      render: r => (
        <div className="flex items-center gap-1.5 whitespace-nowrap">
          <button
            type="button"
            title={`Download complete Excel report for ${r.department_name || 'this department'}`}
            onClick={() => handleDownloadDept(r, 'excel')}
            disabled={downloadingKey === `excel-${r.department_id || r.department_name}`}
            className="px-2 py-1 text-xs border border-subtle rounded flex items-center gap-1 hover:bg-bg-primary hover:border-green-500 text-loud hover:text-green-600 transition-colors disabled:opacity-50"
          >
            {downloadingKey === `excel-${r.department_id || r.department_name}` ? (
              <Loader2 className="w-3 h-3 animate-spin text-green-600" />
            ) : (
              <FileSpreadsheet className="w-3 h-3 text-green-600" />
            )}
            <span className="text-[11px] font-medium">Excel</span>
          </button>
          <button
            type="button"
            title={`Download complete PDF report for ${r.department_name || 'this department'}`}
            onClick={() => handleDownloadDept(r, 'pdf')}
            disabled={downloadingKey === `pdf-${r.department_id || r.department_name}`}
            className="px-2 py-1 text-xs border border-subtle rounded flex items-center gap-1 hover:bg-bg-primary hover:border-red-500 text-loud hover:text-red-600 transition-colors disabled:opacity-50"
          >
            {downloadingKey === `pdf-${r.department_id || r.department_name}` ? (
              <Loader2 className="w-3 h-3 animate-spin text-red-600" />
            ) : (
              <FileText className="w-3 h-3 text-red-600" />
            )}
            <span className="text-[11px] font-medium">PDF</span>
          </button>
        </div>
      ),
    },
  ].filter(Boolean);

  return (
    <div>
      <FilterBar
        from={from} setFrom={setFrom} to={to} setTo={setTo}
        visitorType={visitorType} setVisitorType={setVisitorType}
        search={search} setSearch={setSearch}
        onApply={() => { setPage(1); fetch(); }} loading={loading}
        cascadeFilters={cf} isCentral={isCentral} showDept
        onExcelExport={() => handleExportAll('excel')}
        onPdfExport={() => handleExportAll('pdf')}
        exporting={exportingAll}
      />

      {/* Contextual Individual Department Download Banner when selected in Filter */}
      {selectedDeptObj && (
        <div className="mb-4 p-4 rounded-xl border border-accent/30 bg-accent/5 flex flex-wrap items-center justify-between gap-3 animate-fade-in">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center text-accent">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-loud text-sm">{selectedDeptObj.name}</span>
                <span className="text-xs text-muted">
                  ({cf.units.find(u => u.db_name === cf.selUnit)?.name || 'Selected Unit'})
                </span>
              </div>
              <p className="text-xs text-muted mt-0.5">
                Download entire visit report separated for this specific department
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleDownloadDept(selectedDeptObj, 'excel')}
              disabled={!!downloadingKey}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-primary border border-subtle rounded-lg text-xs font-medium text-loud hover:border-green-500 hover:text-green-600 transition-colors shadow-sm disabled:opacity-50"
            >
              {downloadingKey === `excel-${selectedDeptObj.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin text-green-500" /> : <FileSpreadsheet className="w-3.5 h-3.5 text-green-500" />}
              Download Excel
            </button>
            <button
              onClick={() => handleDownloadDept(selectedDeptObj, 'pdf')}
              disabled={!!downloadingKey}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-primary border border-subtle rounded-lg text-xs font-medium text-loud hover:border-red-500 hover:text-red-600 transition-colors shadow-sm disabled:opacity-50"
            >
              {downloadingKey === `pdf-${selectedDeptObj.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin text-red-500" /> : <FileText className="w-3.5 h-3.5 text-red-500" />}
              Download PDF
            </button>
          </div>
        </div>
      )}

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
  const [officeType, setOfficeType]   = useState('');   // Unit / Corporate / Training Centre
  const [search, setSearch] = useState('');
  const [data,    setData]    = useState(null);   // { rows: [], units: [] }
  const [loading, setLoading] = useState(false);
  const [downloadingKey, setDownloadingKey] = useState('');

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (from) params.from = from;
      if (to)   params.to   = to;
      if (visitorType) params.visitor_type = visitorType;
      if (officeType)  params.office_type  = officeType;
      if (cf.selUnit)  params.unit_db = cf.selUnit;
      const r = await apiClient.get('/reports/unit-wise', { params });
      setData(r.data?.data);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load unit-wise report.');
    } finally {
      setLoading(false);
    }
  }, [from, to, visitorType, officeType, cf.selUnit]);

  useEffect(() => { fetch(); }, [fetch]);

  const unitVisitsExpCols = [
    { header: 'Unit',         accessor: r => r.unit_name },
    { header: 'Visitor Name', accessor: r => r.visitor_name },
    { header: 'Visitor Phone',accessor: r => r.visitor_phone },
    { header: 'Department',   accessor: r => r.department_name },
    { header: 'Host Employee',accessor: r => r.host_name },
    { header: 'Employee Code',accessor: r => r.employee_code },
    { header: 'Type',         accessor: r => CATEGORY_LABELS[r.visit_category] ?? r.visit_category },
    { header: 'Date',         accessor: r => fmt(r.visit_date) },
    { header: 'Start Time',   accessor: r => fmtTime(r.visit_start_time) },
    { header: 'End Time',     accessor: r => fmtTime(r.visit_end_time) },
    { header: 'Status',       accessor: r => r.status },
    { header: 'Purpose',      accessor: r => r.purpose },
  ];

  // Download all individual visits for a particular unit
  const handleDownloadUnitVisits = async (unitObj, format) => {
    const unitDb = unitObj.unit_db || cf.selUnit;
    const unitName = unitObj.unit_name || cf.units.find(u => u.db_name === cf.selUnit)?.name || 'Unit';
    const key = `unit-${format}-${unitDb || unitName}`;
    try {
      setDownloadingKey(key);
      toast.loading(`Fetching detailed visit report for ${unitName}...`, { id: 'unit-dl' });

      const params = { details: 'true' };
      if (from) params.from = from;
      if (to)   params.to   = to;
      if (visitorType) params.visitor_type = visitorType;
      if (unitDb) params.unit_db = unitDb;

      const visits = await fetchAllReportRows('/reports/unit-wise', params);
      toast.dismiss('unit-dl');

      if (!visits || visits.length === 0) {
        toast.error(`No detailed visit records found for ${unitName}.`);
        return;
      }

      const cleanUnit = unitName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `Unit_Visits_Report_${cleanUnit}`;

      const meta = {
        'Report Type': 'Unit Detailed Visits Report',
        'Unit': unitName,
        'Office Type': officeTypeLabel(unitObj.office_type),
        'Date Range': (from || to) ? `${from || 'Start'} to ${to || 'Present'}` : 'All Time',
        'Total Visits': visits.length,
      };

      if (format === 'excel') {
        exportExcel(visits, unitVisitsExpCols, filename, { title: `Detailed Visits Report - ${unitName}`, metadata: meta });
      } else {
        exportPDF(visits, unitVisitsExpCols, `Detailed Visits Report - ${unitName}`, filename, { metadata: meta });
      }
      toast.success(`Downloaded ${visits.length} visit records for ${unitName}.`);
    } catch (e) {
      toast.dismiss('unit-dl');
      toast.error('Failed to download unit visits report: ' + (e?.message || 'Error'));
    } finally {
      setDownloadingKey('');
    }
  };

  // Unit-level: show their own breakdown as dept table with detailed download option
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
          onExcelExport={() => exportExcel(rows, expCols, 'unit_dept_breakdown', { title: 'Unit Department Breakdown' })}
          onPdfExport={() => exportPDF(rows, expCols, 'Unit Breakdown by Department', 'unit_dept_breakdown')}
        />

        {/* Detailed Visits Download Banner for Unit-level users */}
        <div className="mb-4 p-4 rounded-xl border border-accent/30 bg-accent/5 flex flex-wrap items-center justify-between gap-3 animate-fade-in">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center text-accent">
              <Building className="w-5 h-5" />
            </div>
            <div>
              <span className="font-semibold text-loud text-sm">Download Complete Unit Visits</span>
              <p className="text-xs text-muted mt-0.5">
                Download all individual visitor records with timestamps, departments, and hosts for your unit
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleDownloadUnitVisits({ unit_name: 'Unit_Visits' }, 'excel')}
              disabled={!!downloadingKey}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-primary border border-subtle rounded-lg text-xs font-medium text-loud hover:border-green-500 hover:text-green-600 transition-colors shadow-sm disabled:opacity-50"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-green-500" />
              Detailed Visits (Excel)
            </button>
            <button
              onClick={() => handleDownloadUnitVisits({ unit_name: 'Unit_Visits' }, 'pdf')}
              disabled={!!downloadingKey}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-primary border border-subtle rounded-lg text-xs font-medium text-loud hover:border-red-500 hover:text-red-600 transition-colors shadow-sm disabled:opacity-50"
            >
              <FileText className="w-3.5 h-3.5 text-red-500" />
              Detailed Visits (PDF)
            </button>
          </div>
        </div>

        <ReportTable cols={cols} rows={rows} loading={loading}
          page={1} setPage={() => {}} totalPages={1}
          emptyMsg="No breakdown data found." />
      </div>
    );
  }

  // Global: unit cards with detailed visits download per card + overview summary
  const unitRows = data?.rows ?? [];
  const expCols = [
    { header: 'Unit',        accessor: r => r.unit_name },
    { header: 'Office Type', accessor: r => officeTypeLabel(r.office_type) },
    { header: 'Total',       accessor: r => r.total },
  ];

  const selectedUnitObj = cf.units.find(u => u.db_name === cf.selUnit);

  return (
    <div>
      {/* Office type filter */}
      <div className="relative mb-3 max-w-xs">
        <select value={officeType} onChange={e => setOfficeType(e.target.value)}
          className="block w-full pl-3 pr-8 py-2 bg-bg-primary border border-subtle rounded-lg text-sm text-loud focus:outline-none focus:ring-2 focus:ring-accent/50 appearance-none cursor-pointer">
          <option value="">All Office Types</option>
          {OFFICE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-faint pointer-events-none" />
      </div>

      <FilterBar
        from={from} setFrom={setFrom} to={to} setTo={setTo}
        visitorType={visitorType} setVisitorType={setVisitorType}
        search={search} setSearch={setSearch}
        onApply={fetch} loading={loading}
        cascadeFilters={cf} isCentral
        onExcelExport={() => exportExcel(unitRows, expCols, 'unit_wise_report_summary', { title: 'Unit-wise Visit Summary Report' })}
        onPdfExport={() => exportPDF(unitRows, expCols, 'Unit-wise Visit Report', 'unit_wise_report_summary')}
      />

      {/* Contextual Unit Download Banner when a Unit is Selected in CascadeFilter */}
      {selectedUnitObj && (
        <div className="mb-4 p-4 rounded-xl border border-accent/30 bg-accent/5 flex flex-wrap items-center justify-between gap-3 animate-fade-in">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center text-accent">
              <Building className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-loud text-sm">{selectedUnitObj.name}</span>
                <span className="text-xs px-2 py-0.5 rounded bg-subtle text-muted">
                  {officeTypeLabel(selectedUnitObj.type || selectedUnitObj.office_type)}
                </span>
              </div>
              <p className="text-xs text-muted mt-0.5">
                Download complete individual visit records for this unit
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleDownloadUnitVisits({ unit_db: selectedUnitObj.db_name, unit_name: selectedUnitObj.name, office_type: selectedUnitObj.type }, 'excel')}
              disabled={!!downloadingKey}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-primary border border-subtle rounded-lg text-xs font-medium text-loud hover:border-green-500 hover:text-green-600 transition-colors shadow-sm disabled:opacity-50"
            >
              {downloadingKey === `unit-excel-${selectedUnitObj.db_name}` ? <Loader2 className="w-3.5 h-3.5 animate-spin text-green-500" /> : <FileSpreadsheet className="w-3.5 h-3.5 text-green-500" />}
              Download Unit Visits (Excel)
            </button>
            <button
              onClick={() => handleDownloadUnitVisits({ unit_db: selectedUnitObj.db_name, unit_name: selectedUnitObj.name, office_type: selectedUnitObj.type }, 'pdf')}
              disabled={!!downloadingKey}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-primary border border-subtle rounded-lg text-xs font-medium text-loud hover:border-red-500 hover:text-red-600 transition-colors shadow-sm disabled:opacity-50"
            >
              {downloadingKey === `unit-pdf-${selectedUnitObj.db_name}` ? <Loader2 className="w-3.5 h-3.5 animate-spin text-red-500" /> : <FileText className="w-3.5 h-3.5 text-red-500" />}
              Download Unit Visits (PDF)
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-faint italic">Loading…</div>
      ) : unitRows.length === 0 ? (
        <div className="py-12 text-center text-faint italic">No data found.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {unitRows.map((u, i) => (
            <div key={u.unit_name || i} className="vms-card rounded-lg p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="font-semibold text-loud text-sm">{u.unit_name}</h4>
                    <p className="text-[11px] text-faint">{officeTypeLabel(u.office_type)}</p>
                  </div>
                  <span className="text-2xl font-bold text-accent">{u.total}</span>
                </div>
                <div className="space-y-1.5 mb-3">
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

              {/* Per-Unit Detailed Visits Download Section */}
              <div className="mt-3 pt-3 border-t border-subtle flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted font-medium">Detailed Visits:</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    title={`Download detailed visit report for ${u.unit_name} in Excel`}
                    onClick={() => handleDownloadUnitVisits(u, 'excel')}
                    disabled={downloadingKey === `unit-excel-${u.unit_db || u.unit_name}`}
                    className="px-2 py-1 text-xs border border-subtle rounded flex items-center gap-1 hover:bg-bg-primary hover:border-green-500 text-loud hover:text-green-600 transition-colors disabled:opacity-50"
                  >
                    {downloadingKey === `unit-excel-${u.unit_db || u.unit_name}` ? (
                      <Loader2 className="w-3 h-3 animate-spin text-green-600" />
                    ) : (
                      <FileSpreadsheet className="w-3 h-3 text-green-600" />
                    )}
                    <span className="text-[11px] font-medium">Excel</span>
                  </button>
                  <button
                    type="button"
                    title={`Download detailed visit report for ${u.unit_name} in PDF`}
                    onClick={() => handleDownloadUnitVisits(u, 'pdf')}
                    disabled={downloadingKey === `unit-pdf-${u.unit_db || u.unit_name}`}
                    className="px-2 py-1 text-xs border border-subtle rounded flex items-center gap-1 hover:bg-bg-primary hover:border-red-500 text-loud hover:text-red-600 transition-colors disabled:opacity-50"
                  >
                    {downloadingKey === `unit-pdf-${u.unit_db || u.unit_name}` ? (
                      <Loader2 className="w-3 h-3 animate-spin text-red-600" />
                    ) : (
                      <FileText className="w-3 h-3 text-red-600" />
                    )}
                    <span className="text-[11px] font-medium">PDF</span>
                  </button>
                </div>
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
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(false);
  const [exportingAll, setExportingAll] = useState(false);
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
      const r = await apiClient.get('/reports/rejected', { params });
      setRows(r.data?.data?.rows ?? []);
      setTotal(r.data?.data?.total ?? 0);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load rejected report.');
    } finally {
      setLoading(false);
    }
  }, [page, from, to, visitorType, status, search, cf.selUnit, cf.selDept]);

  useEffect(() => { fetch(); }, [fetch]);

  const cols = [
    isCentral && { key: 'unit_name', label: 'Unit', render: r => <span className="text-muted text-xs">{r.unit_name}</span> },
    { key: 'visitor_name',    label: 'Visitor',    render: r => <div><div>{r.visitor_name}</div><div className="text-xs text-faint">{r.visitor_phone}</div></div> },
    { key: 'department_name', label: 'Department', render: r => r.department_name || '—' },
    { key: 'host_name',       label: 'Host',       render: r => r.host_name || '—' },
    { key: 'visit_category',  label: 'Type',       render: r => <CatBadge cat={r.visit_category} /> },
    { key: 'visit_date',      label: 'Date',       render: r => fmt(r.visit_date) },
    { key: 'status',          label: 'Status',     render: r => <SBadge status={r.status} /> },
    { key: 'rejection_reason', label: 'Reason',    render: r => <span className="text-xs text-muted max-w-[200px] line-clamp-2">{r.rejection_reason || '—'}</span> },
  ].filter(Boolean);

  const expCols = [
    isCentral && { header: 'Unit', accessor: r => r.unit_name },
    { header: 'Visitor Name',     accessor: r => r.visitor_name },
    { header: 'Visitor Phone',    accessor: r => r.visitor_phone },
    { header: 'Department',       accessor: r => r.department_name },
    { header: 'Host',             accessor: r => r.host_name },
    { header: 'Type',             accessor: r => CATEGORY_LABELS[r.visit_category] ?? r.visit_category },
    { header: 'Date',             accessor: r => fmt(r.visit_date) },
    { header: 'Status',           accessor: r => r.status?.replace(/_/g, ' ') },
    { header: 'Reason',           accessor: r => r.rejection_reason },
    { header: 'Purpose',          accessor: r => r.purpose },
  ].filter(Boolean);

  const handleExportAll = async (format) => {
    try {
      setExportingAll(true);
      const params = {};
      if (from) params.from = from;
      if (to)   params.to   = to;
      if (visitorType) params.visitor_type  = visitorType;
      if (status)      params.status        = status;
      if (search)      params.search        = search;
      if (cf.selUnit)  params.unit_db       = cf.selUnit;
      if (cf.selDept)  params.department_id = cf.selDept;

      toast.loading('Preparing rejected visitors report...', { id: 'rej-export' });
      const allRows = await fetchAllReportRows('/reports/rejected', params);
      toast.dismiss('rej-export');

      if (!allRows || allRows.length === 0) {
        toast.error('No matching records found to export.');
        return;
      }

      const meta = {
        'Report Name': 'Rejected / Not Allowed Visitors Report',
        'Unit': cf.units.find(u => u.db_name === cf.selUnit)?.name || (cf.selUnit ? cf.selUnit : 'All Units'),
        'Department': cf.depts.find(d => String(d.id) === String(cf.selDept))?.name || (cf.selDept ? cf.selDept : 'All Departments'),
        'Status Filter': status ? status.replace(/_/g, ' ') : 'All',
        'Date Range': (from || to) ? `${from || 'Start'} to ${to || 'Present'}` : 'All Time',
        'Total Records': allRows.length,
      };

      if (format === 'excel') {
        exportExcel(allRows, expCols, 'rejected_visitors_report_all', { title: 'Rejected Visitors Report', metadata: meta });
      } else {
        exportPDF(allRows, expCols, 'Rejected / Not Allowed Visitors', 'rejected_visitors_report_all', { metadata: meta });
      }
      toast.success(`Exported ${allRows.length} records successfully.`);
    } catch (e) {
      toast.dismiss('rej-export');
      toast.error('Failed to export rejected report: ' + (e?.message || 'Error'));
    } finally {
      setExportingAll(false);
    }
  };

  return (
    <div>
      <FilterBar
        from={from} setFrom={setFrom} to={to} setTo={setTo}
        visitorType={visitorType} setVisitorType={setVisitorType}
        status={status} setStatus={setStatus} showStatus statusOptions={REJECTION_STATUSES}
        search={search} setSearch={setSearch}
        onApply={() => { setPage(1); fetch(); }} loading={loading}
        cascadeFilters={cf} isCentral={isCentral} showDept
        onExcelExport={() => handleExportAll('excel')}
        onPdfExport={() => handleExportAll('pdf')}
        exporting={exportingAll}
      />
      <p className="text-xs text-muted mb-3">{total} records total</p>
      <ReportTable cols={cols} rows={rows} loading={loading}
        page={page} setPage={setPage} totalPages={Math.ceil(total / limit)} />
    </div>
  );
}

// ─── Debarred Visitors Report ─────────────────────────────────────────────────
function DebarredReport({ isCentral }) {
  const cf = useCascadeFilters(isCentral);
  const [from, setFrom]     = useState('');
  const [to,   setTo]       = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [search, setSearch] = useState('');
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(false);
  const [exportingAll, setExportingAll] = useState(false);
  const [page, setPage]   = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 50;

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit };
      if (from)       params.from    = from;
      if (to)         params.to      = to;
      if (status)     params.status  = status;
      if (search)     params.search  = search;
      if (cf.selUnit) params.unit_db = cf.selUnit;
      const r = await apiClient.get('/reports/debarred', { params });
      setRows(r.data?.data?.rows ?? []);
      setTotal(r.data?.data?.total ?? 0);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load debarred visitors.');
    } finally {
      setLoading(false);
    }
  }, [page, from, to, status, search, cf.selUnit]);

  useEffect(() => { fetch(); }, [fetch]);

  const cols = [
    isCentral && { key: 'unit_name', label: 'Unit', render: r => <span className="text-muted text-xs">{r.unit_name}</span> },
    { key: 'visitor_name',     label: 'Visitor',     render: r => <div><div>{r.visitor_name}</div><div className="text-xs text-faint">{r.visitor_phone}</div></div> },
    { key: 'reason',           label: 'Reason',      render: r => <span className="text-xs text-muted max-w-[220px] line-clamp-2">{r.reason || '—'}</span> },
    { key: 'blacklisted_at',   label: 'Debarred On', render: r => fmt(r.blacklisted_at) },
    { key: 'debarred_by_name', label: 'Debarred By', render: r => r.debarred_by_name || '—' },
    { key: 'status',           label: 'Status',      render: r => <SBadge status={r.status === 'ACTIVE' ? 'DEBARRED' : 'LIFTED'} /> },
    { key: 'lifted_at',        label: 'Lifted',      render: r => r.lifted_at ? <div><div>{fmt(r.lifted_at)}</div><div className="text-xs text-faint line-clamp-1">{r.lift_reason || ''}</div></div> : '—' },
  ].filter(Boolean);

  const expCols = [
    isCentral && { header: 'Unit', accessor: r => r.unit_name },
    { header: 'Visitor Name',  accessor: r => r.visitor_name },
    { header: 'Visitor Phone', accessor: r => r.visitor_phone },
    { header: 'Reason',        accessor: r => r.reason },
    { header: 'Debarred On',   accessor: r => fmt(r.blacklisted_at) },
    { header: 'Debarred By',   accessor: r => r.debarred_by_name },
    { header: 'Status',        accessor: r => (r.status === 'ACTIVE' ? 'Debarred' : 'Lifted') },
    { header: 'Lifted On',     accessor: r => (r.lifted_at ? fmt(r.lifted_at) : '') },
    { header: 'Lift Reason',   accessor: r => r.lift_reason },
  ].filter(Boolean);

  const handleExportAll = async (format) => {
    try {
      setExportingAll(true);
      const params = {};
      if (from) params.from = from;
      if (to)   params.to   = to;
      if (status) params.status = status;
      if (search) params.search = search;
      if (cf.selUnit) params.unit_db = cf.selUnit;

      toast.loading('Preparing debarred visitors report...', { id: 'deb-export' });
      const allRows = await fetchAllReportRows('/reports/debarred', params);
      toast.dismiss('deb-export');

      if (!allRows || allRows.length === 0) {
        toast.error('No matching records found to export.');
        return;
      }

      const meta = {
        'Report Name': 'Debarred Visitors Report',
        'Unit': cf.units.find(u => u.db_name === cf.selUnit)?.name || (cf.selUnit ? cf.selUnit : 'All Units'),
        'Status Filter': status === 'ACTIVE' ? 'Currently Debarred' : status === 'LIFTED' ? 'Lifted' : 'All',
        'Date Range': (from || to) ? `${from || 'Start'} to ${to || 'Present'}` : 'All Time',
        'Total Records': allRows.length,
      };

      if (format === 'excel') {
        exportExcel(allRows, expCols, 'debarred_visitors_report_all', { title: 'Debarred Visitors Report', metadata: meta });
      } else {
        exportPDF(allRows, expCols, 'Debarred Visitors', 'debarred_visitors_report_all', { metadata: meta });
      }
      toast.success(`Exported ${allRows.length} records successfully.`);
    } catch (e) {
      toast.dismiss('deb-export');
      toast.error('Failed to export debarred report: ' + (e?.message || 'Error'));
    } finally {
      setExportingAll(false);
    }
  };

  return (
    <div>
      <FilterBar
        from={from} setFrom={setFrom} to={to} setTo={setTo}
        showVisitorType={false}
        status={status} setStatus={setStatus} showStatus statusOptions={DEBAR_STATUSES}
        search={search} setSearch={setSearch}
        onApply={() => { setPage(1); fetch(); }} loading={loading}
        cascadeFilters={cf} isCentral={isCentral}
        onExcelExport={() => handleExportAll('excel')}
        onPdfExport={() => handleExportAll('pdf')}
        exporting={exportingAll}
      />
      <p className="text-xs text-muted mb-3">{total} records total</p>
      <ReportTable cols={cols} rows={rows} loading={loading}
        page={page} setPage={setPage} totalPages={Math.ceil(total / limit)}
        emptyMsg="No debarred visitors." />
    </div>
  );
}

// ─── Expected Visitors Report ─────────────────────────────────────────────────
function ActiveExpectedReport({ isCentral }) {
  const cf = useCascadeFilters(isCentral);
  const [date, setDate]     = useState(() => getISTDateString());
  const [visitorType, setVisitorType] = useState('');
  const [search, setSearch] = useState('');
  const [expected,  setExpected]  = useState([]);
  const [loading,   setLoading]   = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const params = { date };
      if (visitorType) params.visitor_type  = visitorType;
      if (search)      params.search        = search;
      if (cf.selUnit)  params.unit_db       = cf.selUnit;
      if (cf.selDept)  params.department_id = cf.selDept;
      const r = await apiClient.get('/reports/active-expected', { params });
      setExpected(r.data?.data?.expected ?? []);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load expected visitors report.');
    } finally {
      setLoading(false);
    }
  }, [date, visitorType, search, cf.selUnit, cf.selDept]);

  useEffect(() => { fetch(); }, [fetch]);

  const expectedCols = [
    isCentral && { key: 'unit_name', label: 'Unit', render: r => <span className="text-muted text-xs">{r.unit_name}</span> },
    { key: 'visitor_name',    label: 'Visitor',     render: r => <div><div>{r.visitor_name}</div><div className="text-xs text-faint">{r.visitor_phone}</div></div> },
    { key: 'department_name', label: 'Department',  render: r => r.department_name || '—' },
    { key: 'host_name',       label: 'Host',        render: r => r.host_name || '—' },
    { key: 'visit_category',  label: 'Type',        render: r => <CatBadge cat={r.visit_category} /> },
    { key: 'check_in_time',   label: 'Expected At', render: r => fmtTime(r.check_in_time) },
    { key: 'report_status',   label: 'Status',      render: r => <SBadge status={r.report_status} /> },
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

  const handleExport = (format) => {
    const meta = {
      'Report Name': 'Expected Visitors Report',
      'Unit': cf.units.find(u => u.db_name === cf.selUnit)?.name || (cf.selUnit ? cf.selUnit : 'All Units'),
      'Department': cf.depts.find(d => String(d.id) === String(cf.selDept))?.name || (cf.selDept ? cf.selDept : 'All Departments'),
      'Date': date,
      'Total Expected': expected.length,
    };
    if (format === 'excel') {
      exportExcel(expected, expColsExpected, `expected_visitors_${date}`, { title: 'Expected Visitors Report', metadata: meta });
    } else {
      exportPDF(expected, expColsExpected, 'Expected Visitors', `expected_visitors_${date}`, { metadata: meta });
    }
  };

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
        <div className="flex items-center gap-2 justify-end pt-1 border-t border-subtle/50">
          <span className="text-xs text-muted font-medium mr-1">Export:</span>
          <button onClick={() => handleExport('excel')}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-subtle rounded-lg text-xs font-medium text-muted hover:bg-bg-primary hover:text-loud transition-colors">
            <FileSpreadsheet className="w-3.5 h-3.5 text-green-500" /> Excel
          </button>
          <button onClick={() => handleExport('pdf')}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-subtle rounded-lg text-xs font-medium text-muted hover:bg-bg-primary hover:text-loud transition-colors">
            <FileText className="w-3.5 h-3.5 text-red-500" /> PDF
          </button>
        </div>
      </div>

      <ReportTable cols={expectedCols} rows={expected} loading={loading}
        page={1} setPage={() => {}} totalPages={1}
        emptyMsg="No expected visitors found." />
    </div>
  );
}


// ─── Visit History Report ─────────────────────────────────────────────────────
function VisitHistoryReport({ isCentral }) {
  const cf = useCascadeFilters(isCentral);
  const [from, setFrom]   = useState('');
  const [to,   setTo]     = useState('');
  const [visitorType, setVisitorType] = useState('');
  const [search, setSearch] = useState('');
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(false);
  const [exportingAll, setExportingAll] = useState(false);
  const [downloadingKey, setDownloadingKey] = useState('');
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
      const r = await apiClient.get('/reports/visit-history', { params });
      setRows(r.data?.data?.rows ?? []);
      setTotal(r.data?.data?.total ?? 0);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load visit history.');
    } finally {
      setLoading(false);
    }
  }, [page, from, to, visitorType, search, cf.selUnit, cf.selDept]);

  useEffect(() => { fetch(); }, [fetch]);

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

  const handleExportAll = async (format) => {
    try {
      setExportingAll(true);
      const params = {};
      if (from) params.from = from;
      if (to)   params.to   = to;
      if (visitorType) params.visitor_type = visitorType;
      if (search) params.search = search;
      if (cf.selUnit) params.unit_db = cf.selUnit;
      if (cf.selDept) params.department_id = cf.selDept;

      toast.loading('Preparing detailed visit history report...', { id: 'hist-export' });
      const allRows = await fetchAllReportRows('/reports/visit-history', params);
      toast.dismiss('hist-export');

      if (!allRows || allRows.length === 0) {
        toast.error('No matching records found to export.');
        return;
      }

      const meta = {
        'Report Name': 'Detailed Visit History Report (All Records)',
        'Unit': cf.units.find(u => u.db_name === cf.selUnit)?.name || (cf.selUnit ? cf.selUnit : 'All Units'),
        'Department': cf.depts.find(d => String(d.id) === String(cf.selDept))?.name || (cf.selDept ? cf.selDept : 'All Departments'),
        'Date Range': (from || to) ? `${from || 'Start'} to ${to || 'Present'}` : 'All Time',
        'Total Records': allRows.length,
      };

      if (format === 'excel') {
        exportExcel(allRows, expCols, 'detailed_visit_history_all', { title: 'Detailed Visit History Report', metadata: meta });
      } else {
        exportPDF(allRows, expCols, 'Detailed Visit History', 'detailed_visit_history_all', { metadata: meta });
      }
      toast.success(`Exported ${allRows.length} records successfully.`);
    } catch (e) {
      toast.dismiss('hist-export');
      toast.error('Failed to export visit history: ' + (e?.message || 'Error'));
    } finally {
      setExportingAll(false);
    }
  };

  // Download complete visit history for a specific visitor or host in that row
  const handleDownloadSingleHistory = async (row, format) => {
    const visitorPhone = row.visitor_phone;
    const visitorName = row.visitor_name || 'Visitor';
    const key = `${format}-${visitorPhone || row.id}`;
    try {
      setDownloadingKey(key);
      toast.loading(`Fetching history for ${visitorName}...`, { id: 'single-hist-dl' });
      const params = { search: visitorPhone || visitorName };
      if (row.unit_db || cf.selUnit) params.unit_db = row.unit_db || cf.selUnit;

      const singleRows = await fetchAllReportRows('/reports/visit-history', params);
      toast.dismiss('single-hist-dl');

      if (!singleRows || singleRows.length === 0) {
        toast.error(`No history records found for ${visitorName}.`);
        return;
      }

      const cleanName = visitorName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `Visitor_History_${cleanName}`;
      const meta = {
        'Report Type': 'Visitor History Report',
        'Visitor': `${visitorName} (${visitorPhone || 'N/A'})`,
        'Total Visits': singleRows.length,
      };

      if (format === 'excel') {
        exportExcel(singleRows, expCols, filename, { title: `Visitor History - ${visitorName}`, metadata: meta });
      } else {
        exportPDF(singleRows, expCols, `Visitor History - ${visitorName}`, filename, { metadata: meta });
      }
      toast.success(`Downloaded ${singleRows.length} visit records for ${visitorName}.`);
    } catch (e) {
      toast.dismiss('single-hist-dl');
      toast.error('Failed to download visitor history: ' + (e?.message || 'Error'));
    } finally {
      setDownloadingKey('');
    }
  };

  const cols = [
    isCentral && { key: 'unit_name', label: 'Unit', render: r => <span className="text-muted text-xs">{r.unit_name}</span> },
    { key: 'visitor_name',    label: 'Visitor',    render: r => <div><div>{r.visitor_name}</div><div className="text-xs text-faint">{r.visitor_phone}</div></div> },
    { key: 'host_name',       label: 'Host',       render: r => <div><div>{r.host_name}</div><div className="text-xs text-faint">{r.department_name}</div></div> },
    { key: 'visit_category',  label: 'Type',       render: r => <CatBadge cat={r.visit_category} /> },
    { key: 'visit_date',      label: 'Date',       render: r => fmt(r.visit_date) },
    { key: 'check_in_time',   label: 'In',         render: r => fmtTime(r.check_in_time) },
    { key: 'check_out_time',  label: 'Out',        render: r => fmtTime(r.check_out_time) },
    { key: 'status',          label: 'Status',     render: r => <SBadge status={r.status} /> },
    {
      key: 'actions',
      label: 'Visitor Report',
      render: r => (
        <div className="flex items-center gap-1.5 whitespace-nowrap">
          <button
            type="button"
            title={`Download history for ${r.visitor_name} (Excel)`}
            onClick={() => handleDownloadSingleHistory(r, 'excel')}
            disabled={downloadingKey === `excel-${r.visitor_phone || r.id}`}
            className="px-2 py-1 text-xs border border-subtle rounded flex items-center gap-1 hover:bg-bg-primary hover:border-green-500 text-loud hover:text-green-600 transition-colors disabled:opacity-50"
          >
            {downloadingKey === `excel-${r.visitor_phone || r.id}` ? (
              <Loader2 className="w-3 h-3 animate-spin text-green-600" />
            ) : (
              <FileSpreadsheet className="w-3 h-3 text-green-600" />
            )}
            <span className="text-[11px] font-medium">Excel</span>
          </button>
          <button
            type="button"
            title={`Download history for ${r.visitor_name} (PDF)`}
            onClick={() => handleDownloadSingleHistory(r, 'pdf')}
            disabled={downloadingKey === `pdf-${r.visitor_phone || r.id}`}
            className="px-2 py-1 text-xs border border-subtle rounded flex items-center gap-1 hover:bg-bg-primary hover:border-red-500 text-loud hover:text-red-600 transition-colors disabled:opacity-50"
          >
            {downloadingKey === `pdf-${r.visitor_phone || r.id}` ? (
              <Loader2 className="w-3 h-3 animate-spin text-red-600" />
            ) : (
              <FileText className="w-3 h-3 text-red-600" />
            )}
            <span className="text-[11px] font-medium">PDF</span>
          </button>
        </div>
      ),
    },
  ].filter(Boolean);

  return (
    <div>
      <FilterBar
        from={from} setFrom={setFrom} to={to} setTo={setTo}
        visitorType={visitorType} setVisitorType={setVisitorType}
        search={search} setSearch={setSearch}
        onApply={() => { setPage(1); fetch(); }} loading={loading}
        cascadeFilters={cf} isCentral={isCentral} showDept
        onExcelExport={() => handleExportAll('excel')}
        onPdfExport={() => handleExportAll('pdf')}
        exporting={exportingAll}
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
      const [summary, byStatus, byDept, daily] = await Promise.all([
        apiClient.get('/reports/visitor-summary', { params }),
        apiClient.get('/reports/by-status',       { params }),
        apiClient.get('/reports/by-department',   { params }),
        apiClient.get('/reports/daily-traffic',   { params }),
      ]);
      setData({
        summary:   summary.data?.data,
        byStatus:  byStatus.data?.data ?? [],
        byDept:    byDept.data?.data ?? [],
        daily:     daily.data?.data ?? [],
      });
    } catch (e) {
      toast.error('Failed to load overview charts.');
    } finally {
      setLoading(false);
    }
  }, [open, from, to]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="vms-card rounded-md mb-6 overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-bg-primary/40 transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8   flex items-center justify-center">
            <BarChart2 className="w-6 h-6 text-muted" />
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
  { id: 'debarred', label: 'Debarred',      icon: UserX },
  { id: 'active',   label: 'Expected Visitors', icon: Activity },
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
    <div className="max-w-7xl mx-auto  animate-fade-in">
      {/* ── Page Header ─────────────────────────────────────────────────── */}
      <div className="mb-8">
        <h1 className="text-lg font-bold text-loud flex items-center gap-3">
          Reports &amp; <em className="italic">Analytics</em>
        </h1>
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
          {activeTab === 'debarred' && <DebarredReport   isCentral={isCentral} />}
          {activeTab === 'active'   && <ActiveExpectedReport isCentral={isCentral} />}
          {activeTab === 'history'  && <VisitHistoryReport   isCentral={isCentral} />}
        </div>
      </div>
    </div>
  );
}
