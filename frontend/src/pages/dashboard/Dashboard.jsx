import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
 Clock,
 UserCheck,
 CheckCircle2,
 AlertCircle,
 Calendar,
 Check,
 X,
 Plus,
 UserPlus,
 ClipboardList,
 Activity,
 Users,
 Building2,
 TrendingUp,
} from "lucide-react";
import { toast } from "react-hot-toast";
import apiClient from "../../api/axios";
import useAuth from "../../hooks/useAuth";
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

/* ─── Shared Utilities ───────────────────────────────────────────────────── */
function StatCard({ icon: Icon, label, value, accentBg, className = "", onClick }) {
  return (
    <div
      className={`vms-card p-5 flex flex-col gap-3 ${onClick ? 'cursor-pointer hover-lift' : ''} ${className}`}
      onClick={onClick}
    >
      <div
        className="w-9 h-9 rounded flex items-center justify-center shrink-0"
        style={{
          background: accentBg ?? 'var(--color-lightColor)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        <Icon strokeWidth={1.75} size={17} style={{ color: 'var(--color-text-muted)' }} />
      </div>
      <div>
        <p className="text-2xl font-bold text-loud leading-none">{value ?? "—"}</p>
        <p className="text-[11px] uppercase tracking-wider text-faint mt-1">{label}</p>
      </div>
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div className="py-14 flex flex-col items-center justify-center text-center">
      <div className="w-10 h-10 rounded flex items-center justify-center mb-3 bg-lightColor"
           style={{ borderRadius: 'var(--radius-sm)' }}>
        <Calendar strokeWidth={1.75} size={18} className="text-faint" />
      </div>
      <p className="text-muted text-sm">{message}</p>
    </div>
  );
}

function TableHead({ cols }) {
  return (
    <thead>
      <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-primary)' }}>
        {cols.map((c) => (
          <th
            key={c}
            className="px-5 py-3 text-left text-[11px] font-semibold tracking-wider uppercase text-faint whitespace-nowrap"
          >
            {c}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function fmtTime(d) {
 if (!d) return "—";
 return new Date(d).toLocaleTimeString("en-IN", {
 hour: "2-digit",
 minute: "2-digit",
 hour12: true,
 });
}
function fmtDate(d) {
 if (!d) return "—";
 return new Date(d).toLocaleDateString("en-IN", {
 day: "2-digit",
 month: "short",
 year: "numeric",
 });
}

function Spinner() {
 return (
 <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
 <div className="w-9 h-9 rounded-full border-2 border-border border-t-transparent animate-spin" />
 <p className="text-faint text-xs tracking-widest uppercase">
 Loading dashboard
 </p>
 </div>
 );
}

/* ─── Sub-Component A: Security / Receptionist Dashboard ─────────────────── */
function SecurityDashboard() {
 const navigate = useNavigate();
 const { hasRole } = useAuth();
 const [dashData, setDashData] = useState(null);
 const [loading, setLoading] = useState(true);

 const fetchData = useCallback(async () => {
 setLoading(true);
 try {
 const res = await apiClient.get("/gate/dashboard");
 setDashData(res.data?.data ?? res.data);
 } catch (err) {
 toast.error(err?.response?.data?.message || "Failed to load gate data.");
 } finally {
 setLoading(false);
 }
 }, []);

 useEffect(() => {
 fetchData();
 }, [fetchData]);

 if (loading) return <Spinner />;

 const summary = dashData?.summary ?? {};
 const yetToCome = dashData?.yet_to_come ?? [];
 const active = dashData?.active ?? [];

 return (
 <div>
 <div className="mb-10">
 <p className="text-[11px] tracking-widest uppercase text-accent mb-1 font-sans">
 Security Overview
 </p>
 <h1 className="text-2xl font-bold text-loud">
 Today&apos;s <em className="italic">Visitor</em> Activity
 </h1>
 </div>

 {/* Quick Actions */}
 <div className="vms-card p-6 mb-8 flex flex-wrap gap-4 items-center justify-between">
 <div>
 <h2 className="text-[16px] font-semibold text-loud">
 Gate <em className="italic">Actions</em>
 </h2>
 <p className="text-faint text-sm mt-1">
 Register a visitor or log a walk-in instantly.
 </p>
 </div>
 <div className="flex gap-3 flex-wrap">
 <button
 onClick={() => navigate("/requests/new?category=SPOT")}
 className="btn-primary text-white text-sm uppercase tracking-widest hover:bg-accent transition-colors duration-300 flex items-center gap-2"
 >
 <Plus strokeWidth={1.5} size={15} />
 Spot Walk-in
 </button>
 <button
 onClick={() => navigate("/visitors/new")}
 className="btn-secondary text-accent text-sm uppercase tracking-widest hover:bg-mixed-bg transition-colors duration-300 flex items-center gap-2"
 >
 <UserPlus strokeWidth={1.5} size={15} />
 New Visitor
 </button>
 </div>
 </div>

 {/* Stat Cards */}
 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
 <StatCard
 icon={Clock}
 label="Expected Today"
 value={summary.yet_to_come_count ?? yetToCome.length}
 />
 <StatCard
 icon={UserCheck}
 label="Inside Now"
 value={summary.active_count ?? active.length}
 />
 <StatCard
 icon={CheckCircle2}
 label="Completed Today"
 value={summary.completed_today_count ?? 0}
 />
 </div>

 {/* Expected Today */}
 <div className="vms-card overflow-hidden mb-5">
 <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border)' }}>
 <div className="flex items-center gap-3">
 <Clock
 strokeWidth={1.5}
 size={17}
 className="text-accent"
 />
 <h2 className="text-[14px] font-semibold text-loud">
 Expected Today
 </h2>
 </div>
 <span className="badge badge-scheduled">
 {yetToCome.length} visitor{yetToCome.length !== 1 ? "s" : ""}
 </span>
 </div>
 {yetToCome.length === 0 ? (
 <EmptyState message="No visitors expected today" />
 ) : (
 <div className="overflow-x-auto">
 <table className="w-full text-sm font-sans">
 <TableHead
 cols={[
 "Visitor",
 "Type",
 "Host",
 "Department",
 "Scheduled Time",
 "Actions",
 ]}
 />
 <tbody className="divide-y divide-[var(--color-border)]">
 {yetToCome.map((v, i) => (
 <tr
 key={v.id ?? i}
 className="hover:bg-surface-hover transition-colors"
 >
 <td className="px-5 py-3 font-medium text-loud whitespace-nowrap">
 {v.visitor_name ?? "—"}
 </td>
 <td className="px-5 py-3">
 <StatusBadge status={v.visitor_type_code} />
 </td>
 <td className="px-5 py-3 text-muted whitespace-nowrap">
 {v.host_name ?? "—"}
 </td>
 <td className="px-5 py-3 text-muted whitespace-nowrap">
 {v.department_name ?? v.department ?? v.dept_name ?? "—"}
 </td>
 <td className="px-5 py-3 text-faint whitespace-nowrap">
 {v.visit_start_time
 ? v.visit_start_time
 : fmtTime(v.visit_date)}
 </td>
 <td className="px-5 py-3">
 {hasRole("security", "receptionist") && v.id && (
 <button
 onClick={() => navigate(`/gate/checkin/${v.id}`)}
 className="inline-flex items-center gap-1.5 text-xs px-4 py-1.5 rounded-full bg-accent text-white hover:bg-accent transition-colors duration-300 font-semibold tracking-wide uppercase"
 >
 <Check strokeWidth={1.5} size={12} /> Check In
 </button>
 )}
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </div>

 {/* Currently Inside */}
 <div className="vms-card overflow-hidden mb-5">
 <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border)' }}>
 <div className="flex items-center gap-3">
 <UserCheck
 strokeWidth={1.5}
 size={17}
 className="text-accent"
 />
 <h2 className="text-[14px] font-semibold text-loud">
 Currently Inside
 </h2>
 </div>
 <span className="badge badge-active">{active.length} active</span>
 </div>
 {active.length === 0 ? (
 <EmptyState message="No visitors currently on the premises" />
 ) : (
 <div className="overflow-x-auto">
 <table className="w-full text-sm font-sans">
 <TableHead cols={["Visitor", "Host", "Check-in Time"]} />
 <tbody className="divide-y divide-[var(--color-border)]">
 {active.map((v, i) => (
 <tr
 key={v.id ?? i}
 className="hover:bg-surface-hover transition-colors"
 >
 <td className="px-5 py-3 font-medium text-loud whitespace-nowrap">
 <span className="pulse-dot" />
 {v.visitor_name ?? "—"}
 </td>
 <td className="px-5 py-3 text-muted whitespace-nowrap">
 {v.host_name ?? "—"}
 </td>
 <td className="px-5 py-3 text-faint whitespace-nowrap">
 {fmtTime(v.check_in_time ?? v.checked_in_at)}
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </div>
 </div>
 );
}

/* ─── Sub-Component B: Employee Dashboard ────────────────────────────────── */
function EmployeeDashboard() {
 const navigate = useNavigate();
 const { user } = useAuth();
 const [inbox, setInbox] = useState([]);
 const [upcomingVisits, setUpcomingVisits] = useState([]);
 const [myTotal, setMyTotal] = useState(0);
 const [loading, setLoading] = useState(true);

 const hour = new Date().getHours();
 const greeting =
 hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

 const fetchData = useCallback(async () => {
 setLoading(true);
 try {
 const [inboxRes, upcomingRes, totalRes] = await Promise.all([
 apiClient.get("/approvals/inbox"),
 apiClient.get("/visit-requests/my?upcoming=true&limit=5"),
 apiClient.get("/visit-requests/my?limit=1"),
 ]);
 setInbox(inboxRes.data?.data ?? []);
 setUpcomingVisits(upcomingRes.data?.data?.requests ?? []);
 setMyTotal(totalRes.data?.data?.pagination?.total ?? 0);
 } catch (err) {
 toast.error(err?.response?.data?.message || "Failed to load dashboard.");
 } finally {
 setLoading(false);
 }
 }, []);

 useEffect(() => {
 fetchData();
 }, [fetchData]);

 const handleApprove = async (id) => {
 const remarks = window.prompt("Approval remarks (optional):") ?? "";
 try {
 await apiClient.put(`/approvals/${id}/approve`, { remarks });
 toast.success("Request approved.");
 fetchData();
 } catch (err) {
 toast.error(err?.response?.data?.message || "Failed to approve.");
 }
 };

 const handleReject = async (id) => {
 const remarks = window.prompt("Rejection reason:");
 if (remarks === null) return;
 try {
 await apiClient.put(`/approvals/${id}/reject`, { remarks });
 toast.success("Request rejected.");
 fetchData();
 } catch (err) {
 toast.error(err?.response?.data?.message || "Failed to reject.");
 }
 };

 if (loading) return <Spinner />;

 return (
 <div>
 {/* Header */}
 <div className="mb-10">
 <p className="text-[11px] tracking-widest uppercase text-accent mb-1">
 {greeting} — {user?.full_name?.split(" ")[0]}
 </p>
 <h1 className="text-2xl font-bold text-loud">
 Your <em className="italic">Workspace</em>
 </h1>
 <p className="text-faint mt-2">
 Here&apos;s what needs your attention today.
 </p>
 </div>

 {/* Stat Cards */}
 <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-10">
 <StatCard
 icon={AlertCircle}
 label="Pending Approvals"
 value={inbox.length}
 onClick={() => navigate("/approvals")}
 />
 <StatCard
 icon={Calendar}
 label="Upcoming Visits"
 value={upcomingVisits.length}
 />
 <StatCard
 icon={ClipboardList}
 label="My Total Requests"
 value={myTotal}
 onClick={() => navigate("/requests")}
 />
 </div>

 {/* Pending Approvals mini-section */}
 <div className="vms-card overflow-hidden mb-5">
 <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border)' }}>
 <div className="flex items-center gap-3">
 <AlertCircle
 strokeWidth={1.5}
 size={17}
 className="text-warning"
 />
 <h2 className="text-[14px] font-semibold text-loud">
 Needs Your Approval
 </h2>
 {inbox.length > 0 && (
 <span className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-accent text-white text-xs font-bold">
 {inbox.length}
 </span>
 )}
 </div>
 <button
 onClick={() => navigate("/approvals")}
 className="text-xs text-accent hover:underline"
 >
 View All Approvals →
 </button>
 </div>
 {inbox.length === 0 ? (
 <div className="px-6 py-8 flex items-center gap-2 text-accent">
 <CheckCircle2 strokeWidth={1.5} size={16} />
 <span className="text-sm font-medium">
 You&apos;re all caught up!
 </span>
 </div>
 ) : (
 <div className="overflow-x-auto">
 <table className="w-full text-sm font-sans">
 <TableHead cols={["Visitor", "Visit Date", "Actions"]} />
 <tbody className="divide-y divide-[var(--color-border)]">
 {inbox.slice(0, 3).map((row, i) => (
 <tr
 key={row.id ?? i}
 className="hover:bg-surface-hover transition-colors"
 >
 <td className="px-5 py-3 font-medium text-loud">
 {row.visitor_name ?? "—"}
 </td>
 <td className="px-5 py-3 text-muted">
 {fmtDate(row.visit_date)}
 </td>
 <td className="px-5 py-3">
 <div className="flex items-center gap-2">
 <button
 onClick={() =>
 handleApprove(row.visit_request_id ?? row.id)
 }
 className="btn-dark text-xs py-1.5 px-3 font-semibold tracking-wide uppercase"
 >
 <Check strokeWidth={1.5} size={12} /> Approve
 </button>
 <button
 onClick={() =>
 handleReject(row.visit_request_id ?? row.id)
 }
 className="btn-secondary text-xs py-1.5 px-3 font-semibold tracking-wide uppercase"
 >
 <X strokeWidth={1.5} size={12} /> Reject
 </button>
 </div>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </div>

 {/* Upcoming Visits */}
 <div className="vms-card overflow-hidden mb-5">
 <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border)' }}>
 <div className="flex items-center gap-3">
 <Calendar
 strokeWidth={1.5}
 size={17}
 className="text-accent"
 />
 <h2 className="text-[14px] font-semibold text-loud">
 Upcoming Visits
 </h2>
 </div>
 <button
 onClick={() => navigate("/requests")}
 className="text-xs text-accent hover:underline"
 >
 View All Requests →
 </button>
 </div>
 {upcomingVisits.length === 0 ? (
 <EmptyState message="No upcoming approved visits scheduled." />
 ) : (
 <div className="overflow-x-auto">
 <table className="w-full text-sm font-sans">
 <TableHead
 cols={["Visitor", "Category", "Visit Date", "Purpose"]}
 />
 <tbody className="divide-y divide-[var(--color-border)]">
 {upcomingVisits.map((v, i) => (
 <tr
 key={v.id ?? i}
 className="hover:bg-surface-hover transition-colors"
 >
 <td className="px-5 py-3 font-medium text-loud">
 {v.visitor_name ?? "—"}
 </td>
 <td className="px-5 py-3">
 <StatusBadge status={v.visitor_type_code} />
 </td>
 <td className="px-5 py-3 text-muted whitespace-nowrap">
 {fmtDate(v.visit_date)}
 </td>
 <td className="px-5 py-3 text-muted max-w-xs truncate">
 {v.purpose ?? "—"}
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </div>
 </div>
 );
}

/* ─── Sub-Component C: Admin Dashboard ───────────────────────────────────── */
function AdminDashboard() {
 const navigate = useNavigate();
 const [dashData, setDashData] = useState(null);
 const [inbox, setInbox] = useState([]);
 const [pendingCount, setPendingCount] = useState(0);
 const [loading, setLoading] = useState(true);

 const fetchData = useCallback(async () => {
 setLoading(true);
 try {
 const [dashRes, inboxRes, pendingRes] = await Promise.all([
 apiClient.get("/gate/dashboard"),
 apiClient.get("/approvals/inbox"),
 apiClient.get("/visit-requests?status=PENDING&limit=1"),
 ]);
 setDashData(dashRes.data?.data ?? dashRes.data);
 const ib = inboxRes.data?.data ?? [];
 setInbox(Array.isArray(ib) ? ib : []);
 setPendingCount(pendingRes.data?.data?.pagination?.total ?? 0);
 } catch (err) {
 toast.error(err?.response?.data?.message || "Failed to load dashboard.");
 } finally {
 setLoading(false);
 }
 }, []);

 useEffect(() => {
 fetchData();
 }, [fetchData]);

 const handleApprove = async (id) => {
 const remarks = window.prompt("Approval remarks (optional):") ?? "";
 try {
 await apiClient.put(`/approvals/${id}/approve`, { remarks });
 toast.success("Approved.");
 fetchData();
 } catch (err) {
 toast.error(err?.response?.data?.message || "Failed.");
 }
 };

 const handleReject = async (id) => {
 const remarks = window.prompt("Rejection reason:");
 if (remarks === null) return;
 try {
 await apiClient.put(`/approvals/${id}/reject`, { remarks });
 toast.success("Rejected.");
 fetchData();
 } catch (err) {
 toast.error(err?.response?.data?.message || "Failed.");
 }
 };

 if (loading) return <Spinner />;

 const summary = dashData?.summary ?? {};
 const yetToCome = dashData?.yet_to_come ?? [];

 return (
 <div>
 <div className="mb-10">
 <p className="text-[11px] tracking-widest uppercase text-accent mb-1 font-sans">
 Admin Overview
 </p>
 <h1 className="text-2xl font-bold text-loud">
 Operations <em className="italic">Command</em>
 </h1>
 <p className="text-faint mt-2">
 System-wide activity at a glance.
 </p>
 </div>

 {/* Gate Summary */}
 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
 <StatCard
 icon={Clock}
 label="Expected Today"
 value={summary.yet_to_come_count ?? yetToCome.length}
 />
 <StatCard
 icon={UserCheck}
 label="Currently Inside"
 value={summary.active_count ?? 0}
 />
 <StatCard
 icon={CheckCircle2}
 label="Completed Today"
 value={summary.completed_today_count ?? 0}
 />
 <StatCard
 icon={AlertCircle}
 label="System Pending"
 value={pendingCount}
 onClick={() => navigate("/requests?status=PENDING")}
 />
 </div>

 {/* Two-column tables */}
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
 {/* Expected Today (compact) */}
 <div className="vms-card overflow-hidden">
 <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border)' }}>
 <div className="flex items-center gap-3">
 <Clock
 strokeWidth={1.5}
 size={17}
 className="text-accent"
 />
 <h2 className="text-[14px] font-semibold text-loud">
 Expected Today
 </h2>
 </div>
 <span className="badge badge-scheduled">{yetToCome.length}</span>
 </div>
 {yetToCome.length === 0 ? (
 <EmptyState message="No visitors expected today" />
 ) : (
 <div className="overflow-x-auto">
 <table className="w-full text-sm font-sans">
 <TableHead cols={["Visitor", "Host", "Time"]} />
 <tbody className="divide-y divide-[var(--color-border)]">
 {yetToCome.slice(0, 8).map((v, i) => (
 <tr
 key={v.id ?? i}
 className="hover:bg-surface-hover transition-colors"
 >
 <td className="px-6 py-3 font-medium text-loud whitespace-nowrap">
 {v.visitor_name ?? "—"}
 </td>
 <td className="px-6 py-3 text-muted whitespace-nowrap">
 {v.host_name ?? "—"}
 </td>
 <td className="px-6 py-3 text-faint whitespace-nowrap">
 {v.visit_start_time
 ? v.visit_start_time
 : fmtTime(v.visit_date)}
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </div>

 {/* Pending Approvals */}
 <div className="vms-card overflow-hidden">
 <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border)' }}>
 <div className="flex items-center gap-3">
 <AlertCircle
 strokeWidth={1.5}
 size={17}
 className="text-warning"
 />
 <h2 className="text-[14px] font-semibold text-loud">
 Pending Approvals
 </h2>
 </div>
 {inbox.length > 0 && (
 <span className="badge badge-pending">
 {inbox.length} pending
 </span>
 )}
 </div>
 {inbox.length === 0 ? (
 <EmptyState message="No pending approvals — all caught up" />
 ) : (
 <div className="overflow-x-auto">
 <table className="w-full text-sm font-sans">
 <TableHead cols={["Visitor", "Date", "Actions"]} />
 <tbody className="divide-y divide-[var(--color-border)]">
 {inbox.map((row, i) => (
 <tr
 key={row.id ?? i}
 className="hover:bg-surface-hover transition-colors"
 >
 <td className="px-6 py-3 font-medium text-loud whitespace-nowrap">
 {row.visitor_name ?? "—"}
 </td>
 <td className="px-6 py-3 text-muted whitespace-nowrap">
 {fmtDate(row.visit_date)}
 </td>
 <td className="px-6 py-3">
 <div className="flex items-center gap-2">
 <button
 onClick={() =>
 handleApprove(row.visit_request_id ?? row.id)
 }
 className="inline-flex items-center gap-1 text-xs btn-primary text-white hover:bg-accent transition-colors font-semibold uppercase"
 >
 <Check strokeWidth={1.5} size={11} /> OK
 </button>
 <button
 onClick={() =>
 handleReject(row.visit_request_id ?? row.id)
 }
 className="inline-flex items-center gap-1 text-xs btn-secondary text-warning hover:bg-accent hover:text-white transition-colors font-semibold uppercase"
 >
 <X strokeWidth={1.5} size={11} /> No
 </button>
 </div>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </div>
 </div>

 {/* Quick links */}
 <div className="mt-8 flex flex-wrap gap-3">
 <button
  onClick={() => navigate("/reports")}
  className="btn-primary text-white text-sm uppercase tracking-widest hover:bg-accent transition-colors flex items-center gap-2"
 >
  <Activity strokeWidth={1.5} size={14} /> View Reports
  </button>
  <button
  onClick={() => navigate("/admin")}
  className="btn-secondary text-accent text-sm uppercase tracking-widest hover:bg-mixed-bg transition-colors"
 >
  Manage Users
  </button>
  </div>
  </div>
 );
}

function SuperAdminDashboard() {
  const navigate  = useNavigate();
  const { user, isGlobalAuditor, setActiveUnit } = useAuth();
  const [units,   setUnits]   = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [unitsRes, summaryRes] = await Promise.all([
        apiClient.get('/units'),
        apiClient.get('/reports/global-summary'),
      ]);
      setUnits(unitsRes.data?.data ?? []);
      setSummary(summaryRes.data?.data ?? {});
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  if (loading) return <Spinner />;

  const hour     = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const s = summary ?? {};

  return (
    <div>
      {/* Header */}
      <div className="mb-10">
        <p className="text-[11px] tracking-widest uppercase text-accent mb-1">
          {greeting} — {user?.full_name?.split(' ')[0] ?? 'Admin'}
        </p>
        <h1 className="text-2xl font-bold text-loud">System <em className="italic">Overview</em></h1>
        <p className="text-faint mt-2">Live statistics across all units and branches.</p>
      </div>

      {/* ── Stat Cards ── */}
      {/* Row 1: Units */}
      <p className="text-[10px] uppercase tracking-widest text-faint mb-3 font-semibold">Units</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-5 mb-8">
        <StatCard icon={Building2}    label="Total Units"     value={s.total_units ?? units.length}
          onClick={isGlobalAuditor ? null : () => navigate('/super/units')} />
        <StatCard icon={CheckCircle2} label="Active Units"    value={s.active_units ?? 0}
          onClick={isGlobalAuditor ? null : () => navigate('/super/units')} />
        <StatCard icon={AlertCircle}  label="Provisioning"   value={s.provisioning_units ?? 0} />
      </div>

      {/* Row 2: Visits */}
      <p className="text-[10px] uppercase tracking-widest text-faint mb-3 font-semibold">Visits</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-5 mb-10">
        <StatCard icon={TrendingUp}  label="Total Visits"       value={s.total_visits?.toLocaleString() ?? 0} />
        <StatCard icon={Calendar}    label="This Month"         value={s.this_month_visits?.toLocaleString() ?? 0} />
        <StatCard icon={Clock}       label="Today&apos;s Visits" value={s.today_visits ?? 0} />
        <StatCard icon={UserCheck}   label="Currently Inside"   value={s.currently_inside ?? 0} />
      </div>

      {/* ── Units table (compact) ── */}
      <div className="vms-card overflow-hidden mb-6">
        <div className="px-5 py-4 flex items-center justify-between"
             style={{ borderBottom: '1px solid var(--color-border)' }}>
          <h2 className="text-[14px] font-semibold text-loud flex items-center gap-2">
            <Building2 strokeWidth={1.5} size={16} className="text-accent" />
            Units / Branches
          </h2>
          {!isGlobalAuditor && (
            <button onClick={() => navigate('/super/units')}
              className="text-xs text-accent hover:underline">
              Manage All →
            </button>
          )}
        </div>
        {units.length === 0 ? (
          <EmptyState message="No units created yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-sans">
              <TableHead cols={['Unit', 'Code', 'Type', 'DB Status', 'Actions']} />
              <tbody className="divide-y divide-[var(--color-border)]">
                {units.slice(0, 8).map((u, i) => (
                  <tr key={u.id ?? i} className="hover:bg-surface-hover transition-colors">
                    <td className="px-5 py-3 font-medium text-loud whitespace-nowrap">{u.name}</td>
                    <td className="px-5 py-3 text-faint font-mono">{u.code}</td>
                    <td className="px-5 py-3 text-muted">{u.type}</td>
                    <td className="px-5 py-3">
                      <span className={`text-[10px] px-2 py-0.5 rounded font-semibold uppercase tracking-wider ${
                        u.db_status === 'ACTIVE'       ? 'text-green-700 bg-green-100' :
                        u.db_status === 'PROVISIONING' ? 'text-amber-700 bg-amber-100' :
                                                         'text-red-700 bg-red-100'
                      }`}>
                        {u.db_status}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <button onClick={() => {
                        if (isGlobalAuditor) {
                          setActiveUnit({ id: u.id, name: u.name, db_name: u.db_name });
                          toast.success(`Entering audit context for: ${u.name}`);
                        } else {
                          navigate('/super/units');
                        }
                      }}
                        className="text-xs text-accent hover:underline">
                        {isGlobalAuditor ? 'Audit Unit' : 'Manage'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-3">
        {!isGlobalAuditor && (
          <button onClick={() => navigate('/super/units')}
            className="btn-primary text-white text-sm uppercase tracking-widest flex items-center gap-2">
            <Plus strokeWidth={1.5} size={14} /> Add New Unit
          </button>
        )}
        <button onClick={() => navigate('/reports')}
          className="btn-secondary text-accent text-sm uppercase tracking-widest flex items-center gap-2">
          <Activity strokeWidth={1.5} size={14} /> View Reports
        </button>
        <button onClick={() => navigate('/audit-logs')}
          className="btn-secondary text-accent text-sm uppercase tracking-widest flex items-center gap-2">
          <ClipboardList strokeWidth={1.5} size={14} /> Audit Logs
        </button>
      </div>
    </div>
  );
}


/* ─── Root Dashboard Router ──────────────────────────────────────────────── */
export default function Dashboard() {
  const { hasRole, isSuperAdmin, isGlobalAuditor, activeUnit } = useAuth();
  if ((isSuperAdmin || isGlobalAuditor) && !activeUnit) return <SuperAdminDashboard />;
  if (hasRole("security", "receptionist"))              return <SecurityDashboard />;
  if (hasRole("employee"))                              return <EmployeeDashboard />;
  return <AdminDashboard />;
}


