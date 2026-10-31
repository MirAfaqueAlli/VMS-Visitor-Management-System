// frontend/src/pages/reports/Reports.jsx
// Reports (DESIGN_RULES §6/§8/§14): title, collapsible overview, underline tabs;
// each tab has a filter toolbar (scope · dates · type · search · export) above a
// plain table. Charts use the --chart / --ramp tokens.
import { useState, useEffect, useCallback } from 'react';
import {
  BarChart2, Users, Building2, Building, ShieldOff, Activity,
  Clock, RefreshCw, FileText, ChevronDown, Loader2, UserX, Filter,
} from '../../components/icons';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line,
} from 'recharts';
import apiClient from '../../api/axios';
import toast from 'react-hot-toast';
import useAuth from '../../hooks/useAuth';
import { OFFICE_TYPES, officeTypeLabel } from '../../utils/officeTypes';
import Select from '../../components/Select';
import Pagination from '../../components/shared/Pagination';
import {
  PageHeader, Tabs, StatStrip, Stat, SearchInput, SkeletonRows, Status, Empty, ExcelIcon,
} from '../../components/ui';

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


// Chart series colours come from the theme tokens (light / dark aware)
const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--ramp-2)', 'var(--chart-muted)', 'var(--ramp-4)', 'var(--ramp-1)', 'var(--ramp-3)'];
const MONTH_NAMES  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const VISITOR_TYPES = [
  { value: '',               label: 'All types' },
  { value: 'EMPLOYEE_VISIT', label: 'Employee visit' },
  { value: 'VENDOR',         label: 'Vendor' },
  { value: 'SPOT',           label: 'Walk-in' },
  { value: 'PERSONAL_VISIT', label: 'Personal visit' },
];

const VISIT_STATUSES = [
  { value: '', label: 'All statuses' },
  { value: 'APPROVED',    label: 'Approved' },
  { value: 'PENDING',     label: 'Pending' },
  { value: 'REJECTED',    label: 'Rejected' },
  { value: 'COMPLETED',   label: 'Completed' },
  { value: 'CANCELLED',   label: 'Cancelled' },
  { value: 'NOT_ALLOWED', label: 'Not allowed' },
];

// Rejected tab: REJECTED = declined by host/admin, NOT_ALLOWED = refused at the gate
const REJECTION_STATUSES = [
  { value: '',            label: 'All outcomes' },
  { value: 'REJECTED',    label: 'Rejected by host' },
  { value: 'NOT_ALLOWED', label: 'Not allowed at gate' },
  { value: 'CANCELLED',   label: 'Cancelled' },
];

// Debarred tab: ACTIVE = currently debarred, LIFTED = debarment lifted
const DEBAR_STATUSES = [
  { value: '',       label: 'All debarments' },
  { value: 'ACTIVE', label: 'Currently debarred' },
  { value: 'LIFTED', label: 'Lifted' },
];

// ─────────────────────────── helpers ─────────────────────────────────────────
const fmt = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtTime = (t) => t ? t.substring(0, 5) : '—';

function SBadge({ status }) {
  return <Status value={status} />;
}

function CatBadge({ cat }) {
  return <Status value={cat} />;
}

/** Excel + PDF icon buttons for one row / scope. */
function DownloadPair({ label, onExcel, onPdf, busyExcel, busyPdf, disabled }) {
  return (
    <div className="flex items-center gap-0.5 whitespace-nowrap">
      <button type="button" className="btn-icon" onClick={onExcel} disabled={disabled || busyExcel}
        title={`Excel: ${label}`} aria-label={`Download ${label} as Excel`}>
        {busyExcel ? <Loader2 size={14} className="animate-spin" /> : <ExcelIcon size={17} />}
      </button>
      <button type="button" className="btn-icon" onClick={onPdf} disabled={disabled || busyPdf}
        title={`PDF: ${label}`} aria-label={`Download ${label} as PDF`}>
        {busyPdf ? <Loader2 size={14} className="animate-spin" /> : <FileText size={16} />}
      </button>
    </div>
  );
}

/** Tile offering the full report for the selected employee / department / unit. */
function ScopeDownload({ title, meta, hint, onExcel, onPdf, busyExcel, busyPdf, disabled }) {
  return (
    <div className="tile flex flex-wrap items-center justify-between gap-3 mb-4 animate-fade-in">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-ink">
          {title}
          {meta && <span className="ml-2 text-[12px] font-normal text-muted">{meta}</span>}
        </p>
        {hint && <p className="text-[12px] text-muted mt-0.5">{hint}</p>}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onExcel} disabled={disabled} className="btn-outline btn-sm">
          {busyExcel ? <Loader2 size={13} className="animate-spin" /> : <ExcelIcon size={15} />} Excel
        </button>
        <button type="button" onClick={onPdf} disabled={disabled} className="btn-outline btn-sm">
          {busyPdf ? <Loader2 size={13} className="animate-spin" /> : <FileText size={14} />} PDF
        </button>
      </div>
    </div>
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
function CascadeFilters({ isCentral, filters, showDept = false, showEmp = false }) {
  const { units, selUnit, setSelUnit, depts, selDept, setSelDept, loadingDepts, employees, selEmp, setSelEmp, loadingEmps } = filters;

  return (
    <>
      {/* Unit selector — global users only */}
      {isCentral && (
        <Select value={selUnit} onChange={e => setSelUnit(e.target.value)} id="cascade-unit" aria-label="Unit" style={{ width: 180 }}>
          <option value="">All units</option>
          {units.map(u => <option key={u.db_name} value={u.db_name}>{u.name}</option>)}
        </Select>
      )}

      {/* Department selector — shown when applicable */}
      {showDept && (
        <Select
          value={selDept}
          onChange={e => setSelDept(e.target.value)}
          disabled={isCentral ? !selUnit : false}
          id="cascade-dept"
          aria-label="Department"
          style={{ width: 180 }}
        >
          <option value="">{loadingDepts ? 'Loading…' : (isCentral && !selUnit ? 'Choose a unit first' : 'All departments')}</option>
          {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
      )}

      {/* Employee selector — only for employee-wise report */}
      {showEmp && (
        <Select
          value={selEmp}
          onChange={e => setSelEmp(e.target.value)}
          disabled={isCentral ? !selUnit : false}
          id="cascade-emp"
          aria-label="Employee"
          style={{ width: 200 }}
        >
          <option value="">{loadingEmps ? 'Loading…' : (isCentral && !selUnit ? 'Choose a unit first' : 'All employees')}</option>
          {employees.map(e => (
            <option key={e.id} value={e.id}>
              {e.full_name}{e.employee_code ? ` (${e.employee_code})` : ''}
            </option>
          ))}
        </Select>
      )}
    </>
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
function ReportTable({ cols, rows, loading, page, setPage, totalPages, total, emptyMsg = 'No records for these filters.' }) {
  return (
    <div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              {cols.map(c => <th key={c.key} className={`whitespace-nowrap${c.align === 'right' ? ' num' : ''}`}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows rows={6} cols={cols.length} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={cols.length} className="!p-0">
                  <Empty icon={BarChart2} title={emptyMsg} hint="Change the dates, scope or search, or clear them." />
                </td>
              </tr>
            ) : rows.map((row, i) => (
              <tr key={row.id ?? i}>
                {cols.map(c => (
                  <td key={c.key} className={c.align === 'right' ? 'num' : undefined}>
                    {typeof c.render === 'function' ? c.render(row) : (row[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && <Pagination page={page} totalPages={totalPages} totalCount={total} onPageChange={setPage} />}
    </div>
  );
}

// ─────────────────────────── common filter bar ───────────────────────────────
function FilterBar({ from, setFrom, to, setTo, visitorType, setVisitorType, search, setSearch,
  status, setStatus, showStatus = false, statusOptions = VISIT_STATUSES, showVisitorType = true,
  onApply, loading,
  cascadeFilters, isCentral, showDept = false, showEmp = false,
  onExcelExport, onPdfExport, exporting = false, count }) {
  return (
    <div className="toolbar mb-0">
      <div className="toolbar-count basis-full sm:basis-auto">
        {count !== undefined && count !== null && !loading && (
          <><b>{Number(count).toLocaleString('en-IN')}</b> {Number(count) === 1 ? 'record' : 'records'}</>
        )}
      </div>

      {/* Scope (Unit → Dept → Employee) */}
      <CascadeFilters isCentral={isCentral} filters={cascadeFilters} showDept={showDept} showEmp={showEmp} />

      <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="control tabular" style={{ width: 140 }}
        aria-label="From date" title="From" />
      <input type="date" value={to} onChange={e => setTo(e.target.value)} className="control tabular" style={{ width: 140 }}
        aria-label="To date" title="To" />

      {showVisitorType && (
        <Select value={visitorType} onChange={e => setVisitorType(e.target.value)} aria-label="Visit type" style={{ width: 150 }}>
          {VISITOR_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>
      )}

      {showStatus && (
        <Select value={status} onChange={e => setStatus(e.target.value)} aria-label="Status" style={{ width: 170 }}>
          {statusOptions.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </Select>
      )}

      <SearchInput value={search} onChange={setSearch} placeholder="Search" width={180} />

      <button type="button" onClick={onApply} disabled={loading} className="btn-outline" title="Run the report again">
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Filter size={14} />}
        Apply
      </button>

      <DownloadPair label="the full report" onExcel={onExcelExport} onPdf={onPdfExport}
        busyExcel={exporting} busyPdf={exporting} disabled={exporting} />
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
    isCentral && { key: 'unit_name', label: 'Unit', render: r => <span className="text-ink-2">{r.unit_name || '—'}</span> },
    { key: 'host_name',       label: 'Host Employee', render: r => <div><div className="font-medium">{r.host_name || '—'}</div><div className="cell-sub">{r.employee_code}</div></div> },
    { key: 'department_name', label: 'Department' },
    { key: 'visitor_name',    label: 'Visitor', render: r => <div><div>{r.visitor_name || '—'}</div><div className="cell-sub">{r.visitor_phone}</div></div> },
    { key: 'visit_category',  label: 'Type', render: r => <CatBadge cat={r.visit_category} /> },
    { key: 'visit_date',      label: 'Date', render: r => fmt(r.visit_date) },
    { key: 'status',          label: 'Status', render: r => <SBadge status={r.status} /> },
    {
      key: 'actions',
      label: 'Report',
      render: r => (
        <DownloadPair
          label={`visits hosted by ${r.host_name || 'this employee'}`}
          onExcel={() => handleDownloadEmployee(r, 'excel')}
          onPdf={() => handleDownloadEmployee(r, 'pdf')}
          busyExcel={downloadingKey === `excel-${r.host_id || r.employee_code || r.host_name}`}
          busyPdf={downloadingKey === `pdf-${r.host_id || r.employee_code || r.host_name}`}
        />
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
        count={total}
      />

      {selectedEmpObj && (
        <ScopeDownload
          title={selectedEmpObj.full_name}
          meta={[selectedEmpObj.employee_code, cf.depts.find(d => String(d.id) === String(cf.selDept))?.name].filter(Boolean).join(' · ')}
          hint="Every visit this employee hosted, for the dates above."
          onExcel={() => handleDownloadEmployee(selectedEmpObj, 'excel')}
          onPdf={() => handleDownloadEmployee(selectedEmpObj, 'pdf')}
          busyExcel={downloadingKey === `excel-${selectedEmpObj.id}`}
          busyPdf={downloadingKey === `pdf-${selectedEmpObj.id}`}
          disabled={!!downloadingKey}
        />
      )}

      <ReportTable cols={cols} rows={rows} loading={loading}
        page={page} setPage={setPage} totalPages={Math.ceil(total / limit)} total={total} />
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
    isCentral && { key: 'unit_name', label: 'Unit', render: r => <span className="text-ink-2">{r.unit_name || '—'}</span> },
    { key: 'department_name', label: 'Department', render: r => <span className="font-medium">{r.department_name || 'N/A'}</span> },
    { key: 'host_name',       label: 'Host',       render: r => r.host_name || '—' },
    { key: 'visitor_name',    label: 'Visitor',    render: r => <div><div>{r.visitor_name}</div><div className="cell-sub">{r.visitor_phone}</div></div> },
    { key: 'visit_category',  label: 'Type',       render: r => <CatBadge cat={r.visit_category} /> },
    { key: 'visit_date',      label: 'Date',       render: r => fmt(r.visit_date) },
    { key: 'status',          label: 'Status',     render: r => <SBadge status={r.status} /> },
    {
      key: 'actions',
      label: 'Report',
      render: r => (
        <DownloadPair
          label={`visits to ${r.department_name || 'this department'}`}
          onExcel={() => handleDownloadDept(r, 'excel')}
          onPdf={() => handleDownloadDept(r, 'pdf')}
          busyExcel={downloadingKey === `excel-${r.department_id || r.department_name}`}
          busyPdf={downloadingKey === `pdf-${r.department_id || r.department_name}`}
        />
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
        count={total}
      />

      {selectedDeptObj && (
        <ScopeDownload
          title={selectedDeptObj.name}
          meta={cf.units.find(u => u.db_name === cf.selUnit)?.name}
          hint="Every visit to this department, for the dates above."
          onExcel={() => handleDownloadDept(selectedDeptObj, 'excel')}
          onPdf={() => handleDownloadDept(selectedDeptObj, 'pdf')}
          busyExcel={downloadingKey === `excel-${selectedDeptObj.id}`}
          busyPdf={downloadingKey === `pdf-${selectedDeptObj.id}`}
          disabled={!!downloadingKey}
        />
      )}

      <ReportTable cols={cols} rows={rows} loading={loading}
        page={page} setPage={setPage} totalPages={Math.ceil(total / limit)} total={total} />
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
      { key: 'count',           label: 'Visits',     align: 'right', render: r => <span className="font-semibold">{r.count}</span> },
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

        <ScopeDownload
          title="All visits in your unit"
          hint="Each visit with its times, department and host."
          onExcel={() => handleDownloadUnitVisits({ unit_name: 'Unit_Visits' }, 'excel')}
          onPdf={() => handleDownloadUnitVisits({ unit_name: 'Unit_Visits' }, 'pdf')}
          busyExcel={downloadingKey.startsWith('unit-excel-')}
          busyPdf={downloadingKey.startsWith('unit-pdf-')}
          disabled={!!downloadingKey}
        />

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
      <FilterBar
        from={from} setFrom={setFrom} to={to} setTo={setTo}
        visitorType={visitorType} setVisitorType={setVisitorType}
        search={search} setSearch={setSearch}
        onApply={fetch} loading={loading}
        cascadeFilters={cf} isCentral
        count={unitRows.length}
        onExcelExport={() => exportExcel(unitRows, expCols, 'unit_wise_report_summary', { title: 'Unit-wise Visit Summary Report' })}
        onPdfExport={() => exportPDF(unitRows, expCols, 'Unit-wise Visit Report', 'unit_wise_report_summary')}
      />
      <div className="flex items-center gap-2 py-3">
        <Select value={officeType} onChange={e => setOfficeType(e.target.value)} aria-label="Office type" style={{ width: 200 }}>
          <option value="">All office types</option>
          {OFFICE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>
      </div>

      {selectedUnitObj && (
        <ScopeDownload
          title={selectedUnitObj.name}
          meta={officeTypeLabel(selectedUnitObj.type || selectedUnitObj.office_type)}
          hint="Each visit in this unit, for the dates above."
          onExcel={() => handleDownloadUnitVisits({ unit_db: selectedUnitObj.db_name, unit_name: selectedUnitObj.name, office_type: selectedUnitObj.type }, 'excel')}
          onPdf={() => handleDownloadUnitVisits({ unit_db: selectedUnitObj.db_name, unit_name: selectedUnitObj.name, office_type: selectedUnitObj.type }, 'pdf')}
          busyExcel={downloadingKey === `unit-excel-${selectedUnitObj.db_name}`}
          busyPdf={downloadingKey === `unit-pdf-${selectedUnitObj.db_name}`}
          disabled={!!downloadingKey}
        />
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {[0, 1, 2].map(i => <div key={i} className="tile h-40 animate-pulse" />)}
        </div>
      ) : unitRows.length === 0 ? (
        <Empty icon={Building} title="No visits for these filters" hint="Change the dates, unit or office type." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {unitRows.map((u, i) => (
            <div key={u.unit_name || i} className="tile flex flex-col">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <h4 className="text-[13px] font-semibold text-ink truncate">{u.unit_name}</h4>
                  <p className="text-[11.5px] text-muted">{officeTypeLabel(u.office_type)}</p>
                </div>
                <span className="text-[22px] font-semibold tabular text-ink leading-none">{u.total}</span>
              </div>
              <div className="space-y-1.5 flex-1">
                {(u.breakdown ?? []).map((b, j) => (
                  <div key={j} className="flex items-center justify-between gap-2 text-[12px]">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <CatBadge cat={b.visit_category} />
                      <SBadge status={b.status} />
                    </div>
                    <span className="tabular font-medium text-ink-2">{b.count}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-2 border-t border-line flex items-center justify-between gap-2">
                <span className="text-[11.5px] text-muted">Each visit</span>
                <DownloadPair
                  label={`visits in ${u.unit_name}`}
                  onExcel={() => handleDownloadUnitVisits(u, 'excel')}
                  onPdf={() => handleDownloadUnitVisits(u, 'pdf')}
                  busyExcel={downloadingKey === `unit-excel-${u.unit_db || u.unit_name}`}
                  busyPdf={downloadingKey === `unit-pdf-${u.unit_db || u.unit_name}`}
                />
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
    isCentral && { key: 'unit_name', label: 'Unit', render: r => <span className="text-ink-2">{r.unit_name}</span> },
    { key: 'visitor_name',    label: 'Visitor',    render: r => <div><div>{r.visitor_name}</div><div className="cell-sub">{r.visitor_phone}</div></div> },
    { key: 'department_name', label: 'Department', render: r => r.department_name || '—' },
    { key: 'host_name',       label: 'Host',       render: r => r.host_name || '—' },
    { key: 'visit_category',  label: 'Type',       render: r => <CatBadge cat={r.visit_category} /> },
    { key: 'visit_date',      label: 'Date',       render: r => fmt(r.visit_date) },
    { key: 'status',          label: 'Status',     render: r => <SBadge status={r.status} /> },
    { key: 'rejection_reason', label: 'Reason',    render: r => <span className="block text-[12px] text-ink-2 max-w-[220px] line-clamp-2">{r.rejection_reason || '—'}</span> },
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
        count={total}
      />
      <ReportTable cols={cols} rows={rows} loading={loading}
        page={page} setPage={setPage} totalPages={Math.ceil(total / limit)} total={total} />
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
    isCentral && { key: 'unit_name', label: 'Unit', render: r => <span className="text-ink-2">{r.unit_name}</span> },
    { key: 'visitor_name',     label: 'Visitor',     render: r => <div><div>{r.visitor_name}</div><div className="cell-sub">{r.visitor_phone}</div></div> },
    { key: 'reason',           label: 'Reason',      render: r => <span className="block text-[12px] text-ink-2 max-w-[220px] line-clamp-2">{r.reason || '—'}</span> },
    { key: 'blacklisted_at',   label: 'Debarred On', render: r => fmt(r.blacklisted_at) },
    { key: 'debarred_by_name', label: 'Debarred By', render: r => r.debarred_by_name || '—' },
    { key: 'status',           label: 'Status',      render: r => <SBadge status={r.status === 'ACTIVE' ? 'DEBARRED' : 'LIFTED'} /> },
    { key: 'lifted_at',        label: 'Lifted',      render: r => r.lifted_at ? <div><div>{fmt(r.lifted_at)}</div><div className="cell-sub line-clamp-1">{r.lift_reason || ''}</div></div> : '—' },
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
        count={total}
      />
      <ReportTable cols={cols} rows={rows} loading={loading}
        page={page} setPage={setPage} totalPages={Math.ceil(total / limit)} total={total}
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
    isCentral && { key: 'unit_name', label: 'Unit', render: r => <span className="text-ink-2">{r.unit_name}</span> },
    { key: 'visitor_name',    label: 'Visitor',     render: r => <div><div>{r.visitor_name}</div><div className="cell-sub">{r.visitor_phone}</div></div> },
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
      <div className="toolbar mb-0">
        <div className="toolbar-count basis-full sm:basis-auto">
          {!loading && <><b>{expected.length.toLocaleString('en-IN')}</b> expected</>}
        </div>
        <CascadeFilters isCentral={isCentral} filters={cf} showDept />
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className="control tabular"
          style={{ width: 140 }} aria-label="Date" />
        <Select value={visitorType} onChange={e => setVisitorType(e.target.value)} aria-label="Visit type" style={{ width: 150 }}>
          {VISITOR_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>
        <SearchInput value={search} onChange={setSearch} placeholder="Search" width={180} />
        <button type="button" onClick={fetch} disabled={loading} className="btn-outline">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Filter size={14} />}
          Apply
        </button>
        <DownloadPair label="the expected visitors" onExcel={() => handleExport('excel')} onPdf={() => handleExport('pdf')} />
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
    isCentral && { key: 'unit_name', label: 'Unit', render: r => <span className="text-ink-2">{r.unit_name}</span> },
    { key: 'visitor_name',    label: 'Visitor',    render: r => <div><div>{r.visitor_name}</div><div className="cell-sub">{r.visitor_phone}</div></div> },
    { key: 'host_name',       label: 'Host',       render: r => <div><div>{r.host_name}</div><div className="cell-sub">{r.department_name}</div></div> },
    { key: 'visit_category',  label: 'Type',       render: r => <CatBadge cat={r.visit_category} /> },
    { key: 'visit_date',      label: 'Date',       render: r => fmt(r.visit_date) },
    { key: 'check_in_time',   label: 'In',         render: r => fmtTime(r.check_in_time) },
    { key: 'check_out_time',  label: 'Out',        render: r => fmtTime(r.check_out_time) },
    { key: 'status',          label: 'Status',     render: r => <SBadge status={r.status} /> },
    {
      key: 'actions',
      label: 'History',
      render: r => (
        <DownloadPair
          label={`all visits of ${r.visitor_name || 'this visitor'}`}
          onExcel={() => handleDownloadSingleHistory(r, 'excel')}
          onPdf={() => handleDownloadSingleHistory(r, 'pdf')}
          busyExcel={downloadingKey === `excel-${r.visitor_phone || r.id}`}
          busyPdf={downloadingKey === `pdf-${r.visitor_phone || r.id}`}
        />
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
        count={total}
      />
      <ReportTable cols={cols} rows={rows} loading={loading}
        page={page} setPage={setPage} totalPages={Math.ceil(total / limit)} total={total} />
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

  const tooltipStyle = {
    background: 'var(--surface)', border: '1px solid var(--line-strong)', borderRadius: 6, fontSize: 12, color: 'var(--ink)',
  };

  return (
    <section className="mb-6">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="flex items-center gap-2.5 w-full text-left py-1">
        <span className="head-chip tone-brand"><BarChart2 size={15} duo /></span>
        <span className="section-title">Overview</span>
        <span className="text-[11.5px] text-muted">{open ? 'Totals and trends for the dates below' : 'Show totals and trends'}</span>
        <ChevronDown size={14} className={`ml-auto text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-3 space-y-4 animate-fade-in">
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={from} onChange={e => onFromChange(e.target.value)} className="control tabular"
              style={{ width: 140 }} aria-label="From date" />
            <input type="date" value={to} onChange={e => onToChange(e.target.value)} className="control tabular"
              style={{ width: 140 }} aria-label="To date" />
            <button type="button" onClick={load} disabled={loading} className="btn-outline">
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Refresh
            </button>
          </div>

          <StatStrip cols={4}>
            <Stat label="Visits" value={data?.summary?.total ?? 0} loading={loading || !data} />
            <Stat label="Approved" value={data?.summary?.approved ?? 0} loading={loading || !data} />
            <Stat label="Pending" value={data?.summary?.pending ?? 0} tone={data?.summary?.pending ? 'warning' : undefined} loading={loading || !data} />
            <Stat label="Rejected" value={data?.summary?.rejected ?? 0} tone={data?.summary?.rejected ? 'danger' : undefined} loading={loading || !data} />
          </StatStrip>

          {data && !loading && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {data.daily.length > 0 && (
                <div className="tile">
                  <p className="group-heading mb-3">Daily visits · last 14 days</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={data.daily.slice(-14)}>
                      <CartesianGrid vertical={false} stroke="var(--line)" />
                      <XAxis dataKey="date" tickFormatter={d => { const dt = new Date(d); return `${dt.getDate()} ${MONTH_NAMES[dt.getMonth()]}`; }}
                        tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={{ stroke: 'var(--line-strong)' }} tickLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={28} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Line type="monotone" dataKey="total" name="Visits" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {data.byStatus.length > 0 && (
                <div className="tile">
                  <p className="group-heading mb-3">By status</p>
                  <div className="flex items-center gap-4">
                    <ResponsiveContainer width="55%" height={200}>
                      <PieChart>
                        <Pie data={data.byStatus} dataKey="count" nameKey="status" cx="50%" cy="50%"
                          innerRadius={52} outerRadius={80} paddingAngle={1} stroke="var(--tile)">
                          {data.byStatus.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                    <ul className="flex-1 space-y-1.5 text-[12px]">
                      {data.byStatus.map((s, i) => (
                        <li key={s.status ?? i} className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                          <span className="text-ink-2 flex-1 truncate">{String(s.status ?? '—').replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase())}</span>
                          <span className="tabular font-medium text-ink">{s.count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ═══════════════════════════ MAIN PAGE ════════════════════════════════════════
const TABS = [
  { id: 'employee', label: 'Employee-wise', icon: Users },
  { id: 'dept',     label: 'Department-wise', icon: Building2 },
  { id: 'unit',     label: 'Unit / office', icon: Building },
  { id: 'rejected', label: 'Rejected',      icon: ShieldOff },
  { id: 'debarred', label: 'Debarred',      icon: UserX },
  { id: 'active',   label: 'Expected visitors', icon: Activity },
  { id: 'history',  label: 'Visit history', icon: Clock },
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
      <>
        <PageHeader title="Reports" />
        <Empty icon={ShieldOff} title="Reports are for admins and auditors" hint="Ask your unit admin if you need a report." />
      </>
    );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader title="Reports" />

      <OverviewCharts
        from={chartFrom} to={chartTo}
        onFromChange={setChartFrom} onToChange={setChartTo}
      />

      <Tabs tabs={TABS} value={activeTab} onChange={setActiveTab} className="mb-4 overflow-x-auto no-scrollbar" />

      {activeTab === 'employee' && <EmployeeReport   isCentral={isCentral} />}
      {activeTab === 'dept'     && <DepartmentReport isCentral={isCentral} />}
      {activeTab === 'unit'     && <UnitReport       isCentral={isCentral} />}
      {activeTab === 'rejected' && <RejectedReport   isCentral={isCentral} />}
      {activeTab === 'debarred' && <DebarredReport   isCentral={isCentral} />}
      {activeTab === 'active'   && <ActiveExpectedReport isCentral={isCentral} />}
      {activeTab === 'history'  && <VisitHistoryReport   isCentral={isCentral} />}
    </div>
  );
}
