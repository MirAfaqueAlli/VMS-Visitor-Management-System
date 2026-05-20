import { useState, useEffect, useCallback } from "react";
import {
 BarChart,
 Bar,
 XAxis,
 YAxis,
 Tooltip,
 ResponsiveContainer,
 PieChart,
 Pie,
 Cell,
 Legend,
} from "recharts";
import { Activity, CheckCircle2, Clock, XCircle } from "lucide-react";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";

// ── Botanical palette ─────────────────────────────────────────────────────
const COLORS = ["#8C9A84", "#C27B66", "#A89F88", "#5C7A6A"];
const MONTH_NAMES = [
 "Jan",
 "Feb",
 "Mar",
 "Apr",
 "May",
 "Jun",
 "Jul",
 "Aug",
 "Sep",
 "Oct",
 "Nov",
 "Dec",
];

// ── Helpers ──────────────────────────────────────────────────────────────
function today() {
 return new Date().toISOString().slice(0, 10);
}
function monthStart() {
 const d = new Date();
 return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function MetricCard({ icon: Icon, label, value, accent }) {
 return (
 <div className="vms-card p-6 flex items-center gap-5">
 <div
 className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${accent}`}
 >
 <Icon strokeWidth={1.5} size={22} />
 </div>
 <div>
 <p className="text-3xl font-bold text-loud leading-none">
 {value ?? 0}
 </p>
 <p className="text-xs tracking-widest uppercase text-faint mt-1.5">
 {label}
 </p>
 </div>
 </div>
 );
}

const CustomTooltip = ({ active, payload, label }) => {
 if (!active || !payload?.length) return null;
 return (
 <div className="bg-bg-primary border border-subtle rounded-xl px-4 py-3 shadow-md text-sm">
 <p className="font-semibold text-loud mb-1">{label}</p>
 <p className="text-accent">{payload[0].value} visits</p>
 </div>
 );
};

export default function Reports() {
 const [from, setFrom] = useState(monthStart());
 const [to, setTo] = useState(today());
 const [appliedFrom, setAppliedFrom] = useState(monthStart());
 const [appliedTo, setAppliedTo] = useState(today());

 const [statusData, setStatusData] = useState([]);
 const [monthlySummary, setMonthlySummary] = useState([]);
 const [typeData, setTypeData] = useState([]);
 const [deptData, setDeptData] = useState([]);
 const [loading, setLoading] = useState(true);

 const fetchAll = useCallback(async (f, t) => {
 setLoading(true);
 try {
 const params = {};
 if (f) params.from = f;
 if (t) params.to = t;

 const [statusRes, monthlyRes, typeRes, deptRes] = await Promise.all([
 apiClient.get("/reports/by-status", { params }),
 apiClient.get("/reports/visitor-summary"), // always full year
 apiClient.get("/reports/visitor-type", { params }),
 apiClient.get("/reports/by-department", { params }),
 ]);

 setStatusData(statusRes.data?.data ?? []);
 setMonthlySummary(monthlyRes.data?.data ?? []);
 setTypeData(typeRes.data?.data ?? []);
 setDeptData(deptRes.data?.data ?? []);
 } catch (err) {
 toast.error(err?.response?.data?.message || "Failed to load reports.");
 } finally {
 setLoading(false);
 }
 }, []);

 useEffect(() => {
 fetchAll(appliedFrom, appliedTo);
 }, [fetchAll, appliedFrom, appliedTo]);

 const applyFilter = () => {
 setAppliedFrom(from);
 setAppliedTo(to);
 };
 const resetFilter = () => {
 const f = monthStart(),
 t = today();
 setFrom(f);
 setTo(t);
 setAppliedFrom(f);
 setAppliedTo(t);
 };

 // Derived metrics from statusData
 const getCount = (status) =>
 statusData.find((r) => r.status === status)?.count ?? 0;
 const totalVisits = statusData.reduce((a, r) => a + Number(r.count), 0);
 const completedCount = getCount("COMPLETED");
 const pendingCount = getCount("PENDING");
 const rejectedCount = getCount("REJECTED");

 // Monthly bar data — fill gaps so all 12 months appear
 const barData = MONTH_NAMES.map((name, idx) => {
 const found = monthlySummary.find((r) => Number(r.month) === idx + 1);
 return { name, visits: found ? Number(found.count) : 0 };
 });

 // Pie data
 const pieData = typeData.map((r) => ({
 name: r.category,
 value: Number(r.count),
 }));

 // Dept total for % calc
 const deptTotal = deptData.reduce((a, r) => a + Number(r.visit_count), 0);

 return (
 <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 animate-fade-in">
 {/* Page Header */}
 <div className="mb-8">
 <p className="text-[11px] tracking-widest uppercase text-accent mb-1">
 Admin Module
 </p>
 <h1 className="text-2xl font-bold text-loud">
 Visit <em className="italic">Reports</em>
 </h1>
 <p className="text-faint mt-2">
 Aggregated analytics across your organisation.
 </p>
 </div>

 {/* Filter Bar */}
 <div className="vms-card p-5 mb-8 flex flex-wrap items-end gap-4">
 <div className="flex flex-col gap-1">
 <label className="text-xs text-faint uppercase tracking-widest">
 From
 </label>
 <input
 type="date"
 value={from}
 onChange={(e) => setFrom(e.target.value)}
 className="px-3 py-2 rounded-xl border border-subtle bg-bg-primary text-loud text-sm focus:outline-none focus:ring-2 focus:ring-accent"
 />
 </div>
 <div className="flex flex-col gap-1">
 <label className="text-xs text-faint uppercase tracking-widest">
 To
 </label>
 <input
 type="date"
 value={to}
 onChange={(e) => setTo(e.target.value)}
 className="px-3 py-2 rounded-xl border border-subtle bg-bg-primary text-loud text-sm focus:outline-none focus:ring-2 focus:ring-accent"
 />
 </div>
 <button
 onClick={applyFilter}
 className="btn-primary text-white text-sm uppercase tracking-widest hover:bg-accent transition-colors duration-300"
 >
 Apply Filter
 </button>
 <button
 onClick={resetFilter}
 className="btn-secondary text-loud text-sm uppercase tracking-widest hover:bg-bg-primary transition-colors duration-300"
 >
 This Month
 </button>
 {loading && (
 <div className="w-5 h-5 rounded-full border-2 border-border border-t-transparent animate-spin ml-2" />
 )}
 </div>

 {/* Metric Cards */}
 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
 <MetricCard
 icon={Activity}
 label="Total Visits"
 value={totalVisits}
 accent="bg-lightColor text-loud"
 />
 <MetricCard
 icon={CheckCircle2}
 label="Completed"
 value={completedCount}
 accent="bg-mixed-bg text-accent"
 />
 <MetricCard
 icon={Clock}
 label="Pending"
 value={pendingCount}
 accent="bg-amber-50 text-amber-600"
 />
 <MetricCard
 icon={XCircle}
 label="Rejected"
 value={rejectedCount}
 accent="bg-red-50 text-red-500"
 />
 </div>

 {/* Charts row */}
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
 {/* Monthly Bar Chart */}
 <div className="vms-card p-6">
 <h2 className="text-[14px] font-semibold text-loud mb-1">
 Monthly Visit Trend
 </h2>
 <p className="text-xs text-faint mb-6 uppercase tracking-widest">
 Current year — all months
 </p>
 <ResponsiveContainer width="100%" height={240}>
 <BarChart data={barData} barCategoryGap="30%">
 <XAxis
 dataKey="name"
 tick={{ fontSize: 11, fill: "#8C9A84" }}
 axisLine={false}
 tickLine={false}
 />
 <YAxis
 tick={{ fontSize: 11, fill: "#8C9A84" }}
 axisLine={false}
 tickLine={false}
 allowDecimals={false}
 />
 <Tooltip
 content={<CustomTooltip />}
 cursor={{ fill: "rgba(140,154,132,0.08)" }}
 />
 <Bar dataKey="visits" fill="#8C9A84" radius={[6, 6, 0, 0]} />
 </BarChart>
 </ResponsiveContainer>
 </div>

 {/* Visitor Type Donut */}
 <div className="vms-card p-6">
 <h2 className="text-[14px] font-semibold text-loud mb-1">
 Visitor Type Breakdown
 </h2>
 <p className="text-xs text-faint mb-6 uppercase tracking-widest">
 Selected date range
 </p>
 {pieData.length === 0 ? (
 <div className="flex items-center justify-center h-[240px] text-faint italic">
 No data for period
 </div>
 ) : (
 <ResponsiveContainer width="100%" height={240}>
 <PieChart>
 <Pie
 data={pieData}
 cx="50%"
 cy="50%"
 innerRadius={60}
 outerRadius={95}
 paddingAngle={3}
 dataKey="value"
 label={({ name, percent }) =>
 `${name} ${(percent * 100).toFixed(0)}%`
 }
 labelLine={false}
 >
 {pieData.map((_, idx) => (
 <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
 ))}
 </Pie>
 <Legend
 formatter={(value) => (
 <span style={{ color: "#2D3A31", fontSize: 12 }}>
 {value}
 </span>
 )}
 />
 <Tooltip formatter={(value) => [`${value} visits`, ""]} />
 </PieChart>
 </ResponsiveContainer>
 )}
 </div>
 </div>

 {/* Department Table */}
 <div className="vms-card overflow-hidden">
 <div className="px-6 py-5 border-b border-subtle">
 <h2 className="text-[14px] font-semibold text-loud">
 Visits by Department
 </h2>
 <p className="text-xs text-faint mt-1 uppercase tracking-widest">
 Selected date range
 </p>
 </div>
 {deptData.length === 0 ? (
 <div className="py-12 text-center text-faint italic">
 No department data for the selected period.
 </div>
 ) : (
 <div className="overflow-x-auto">
 <table className="w-full text-sm font-sans">
 <thead>
 <tr className="border-b border-subtle">
 {["Department", "Visit Count", "% of Total"].map((c) => (
 <th
 key={c}
 className="px-5 py-3 text-left text-xs font-semibold tracking-widest uppercase text-faint"
 >
 {c}
 </th>
 ))}
 </tr>
 </thead>
 <tbody className="divide-y divide-[var(--color-border)]">
 {deptData.map((r, i) => (
 <tr
 key={i}
 className="hover:bg-surface-hover transition-colors"
 >
 <td className="px-5 py-3 font-medium text-loud">
 {r.department_name}
 </td>
 <td className="px-5 py-3 text-muted">
 {r.visit_count}
 </td>
 <td className="px-5 py-3">
 <div className="flex items-center gap-3">
 <div className="flex-1 max-w-[120px] h-1.5 rounded-full bg-border overflow-hidden">
 <div
 className="h-full bg-accent rounded-full"
 style={{
 width: `${deptTotal ? (r.visit_count / deptTotal) * 100 : 0}%`,
 }}
 />
 </div>
 <span className="text-muted text-xs">
 {deptTotal
 ? ((r.visit_count / deptTotal) * 100).toFixed(1)
 : 0}
 %
 </span>
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
 );
}
