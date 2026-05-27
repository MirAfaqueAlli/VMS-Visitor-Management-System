import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
 Search,
 Plus,
 Eye,
 Calendar,
 UserCheck,
 ChevronLeft,
 ChevronRight,
 Filter,
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

export default function RequestList() {
 const [requests, setRequests] = useState([]);
 const [loading, setLoading] = useState(true);

 // Filters
 const [statusFilter, setStatusFilter] = useState("");
 const [dateFilter, setDateFilter] = useState("");
 const [search, setSearch] = useState("");
 const [debouncedSearch, setDebouncedSearch] = useState("");

 // Pagination
 const [page, setPage] = useState(1);
 const [totalPages, setTotalPages] = useState(1);
 const limit = 10;

 const navigate = useNavigate();

 // Debounce search
 useEffect(() => {
 const handler = setTimeout(() => setDebouncedSearch(search), 300);
 return () => clearTimeout(handler);
 }, [search]);

 const fetchRequests = useCallback(async () => {
 try {
 setLoading(true);
 const params = { page, limit };
 if (statusFilter) params.status = statusFilter;
 if (dateFilter) params.visit_date = dateFilter;
 // Note: Search by name isn't explicitly in backend requirements for this endpoint,
 // but passing it in case it's supported or we filter client-side later if needed.
 if (debouncedSearch) params.search = debouncedSearch;

 const response = await apiClient.get("/visit-requests", { params });
 setRequests(response.data.data?.requests || response.data.data || []);
 setTotalPages(response.data.data?.pagination?.pages || 1);
 } catch (error) {
 toast.error(
 error.response?.data?.message || "Failed to fetch visit requests",
 );
 } finally {
 setLoading(false);
 }
 }, [page, statusFilter, dateFilter, debouncedSearch]);

 useEffect(() => {
 fetchRequests();
 }, [fetchRequests]);

 return (
 <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 animate-fade-in">
 <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
 <div>
 <h1 className="text-2xl font-bold text-loud">
 Visit <em className="italic">Requests</em>
 </h1>
 <p className="text-muted mt-2">
 Manage and monitor all visit requests.
 </p>
 </div>
 <Link
 to="/requests/new"
 className="btn-primary px-4 py-2 text-xs"
 >
 <Plus className="w-4 h-4" />
 New Request
 </Link>
 </div>

 <div className="vms-card rounded-md p-6 mb-8 shadow-card">
 {/* Filters */}
 <div className="flex flex-col md:flex-row gap-4 mb-6 pb-6 border-b border-subtle">
 <div className="flex-1 relative">
 <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
 <Search
 className="h-5 w-5 text-accent"
 strokeWidth={1.5}
 />
 </div>
 <input
 type="text"
 className="block w-full pl-11 pr-4 py-3 bg-bg-primary border border-subtle rounded-full text-loud placeholder-faint focus:outline-none focus:ring-2 focus:ring-accent transition-all duration-300"
 placeholder="Search..."
 value={search}
 onChange={(e) => {
 setSearch(e.target.value);
 setPage(1);
 }}
 />
 </div>

 <div className="flex flex-col sm:flex-row gap-4">
 <div className="relative">
 <select
 value={statusFilter}
 onChange={(e) => {
 setStatusFilter(e.target.value);
 setPage(1);
 }}
 className="block w-full sm:w-48 pl-4 pr-10 py-3 bg-bg-primary border border-subtle rounded-full text-loud focus:outline-none focus:ring-2 focus:ring-accent appearance-none cursor-pointer"
 >
  <option value="">All Statuses</option>
  <option value="PENDING">Pending</option>
  <option value="APPROVED">Approved</option>
  <option value="REJECTED">Rejected</option>
  <option value="COMPLETED">Completed</option>
  <option value="CANCELLED">Cancelled</option>
 </select>
 <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none">
 <Filter className="h-4 w-4 text-faint" />
 </div>
 </div>

 <input
 type="date"
 value={dateFilter}
 onChange={(e) => {
 setDateFilter(e.target.value);
 setPage(1);
 }}
 className="block w-full sm:w-48 px-4 py-3 bg-bg-primary border border-subtle rounded-full text-loud focus:outline-none focus:ring-2 focus:ring-accent"
 />
 </div>
 </div>

 {/* Table */}
 <div className="overflow-x-auto">
 <table className="w-full text-left border-collapse">
 <thead>
 <tr className="border-b border-subtle text-muted text-sm uppercase tracking-wider">
 <th className="py-4 px-4 font-medium">Visitor</th>
 <th className="py-4 px-4 font-medium">Host & Dept</th>
 <th className="py-4 px-4 font-medium">Date</th>
 <th className="py-4 px-4 font-medium">Status</th>
 <th className="py-4 px-4 font-medium text-right">Actions</th>
 </tr>
 </thead>
 <tbody>
 {loading ? (
 <tr>
 <td
 colSpan="5"
 className="text-center py-12 text-faint italic"
 >
 Loading requests...
 </td>
 </tr>
 ) : requests.length === 0 ? (
 <tr>
 <td
 colSpan="5"
 className="text-center py-12 text-faint italic"
 >
 No visit requests found.
 </td>
 </tr>
 ) : (
 requests.map((request) => (
 <tr
 key={request.id}
 className="border-b border-subtle hover:bg-bg-primary/50 transition-colors duration-300"
 >
  <td className="py-4 px-4">
  <div className="font-medium text-loud">
  {request.visitor_name || request.company_name || "N/A"}
  </div>
  {request.visitor_phone && (
  <div className="text-xs text-faint mt-0.5">{request.visitor_phone}</div>
  )}
  <div className="mt-1">
  <span
    className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider"
    style={{ background: 'var(--color-info-bg)', color: 'var(--color-info)' }}
  >
    {CATEGORY_LABELS[request.visit_category] ?? request.visit_category}
  </span>
  </div>
  </td>
 <td className="py-4 px-4">
 <div className="text-loud flex items-center gap-1.5">
 <UserCheck
 className="w-4 h-4 text-accent"
 strokeWidth={1.5}
 />
 {request.Host?.full_name || request.host_name || "N/A"}
 </div>
 <div className="text-sm text-muted mt-1 pl-5.5">
 {request.Department?.name ||
 request.department_name ||
 "N/A"}
 </div>
 </td>
 <td className="py-4 px-4">
 <div className="text-loud flex items-center gap-1.5">
 <Calendar
 className="w-4 h-4 text-accent"
 strokeWidth={1.5}
 />
 {new Date(request.visit_date).toLocaleDateString()}
 </div>
 <div className="text-sm text-muted mt-1 pl-5.5">
 {request.visit_start_time
 ? request.visit_start_time.substring(0, 5)
 : "Any time"}
 </div>
 </td>
 <td className="py-4 px-4">
 <StatusBadge status={request.status} />
 </td>
 <td className="py-4 px-4 text-right">
 <div className="flex justify-end gap-2">
 {request.status === "APPROVED" &&
 request.pass_number && (
 <button
 onClick={() =>
 navigate(`/gate/pass/${request.pass_number}`)
 }
 className="inline-flex items-center justify-center px-3 h-8 rounded-full bg-mixed-bg text-accent hover:bg-accent hover:text-white transition-colors duration-300 text-xs font-semibold uppercase tracking-wider"
 title="View Gate Pass"
 >
 Pass
 </button>
 )}
 <button
 onClick={() => navigate(`/requests/${request.id}`)}
 className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-bg-primary text-muted hover:bg-accent hover:text-white transition-colors duration-300"
 title="View Details"
 >
 <Eye className="w-4 h-4" strokeWidth={1.5} />
 </button>
 </div>
 </td>
 </tr>
 ))
 )}
 </tbody>
 </table>
 </div>

 {/* Pagination */}
 {!loading && totalPages > 1 && (
 <div className="flex items-center justify-between mt-8 pt-6 border-t border-subtle">
 <span className="text-sm text-muted">
 Page {page} of {totalPages}
 </span>
 <div className="flex items-center gap-2">
 <button
 onClick={() => setPage((p) => Math.max(1, p - 1))}
 disabled={page === 1}
 className="p-2 rounded-full border border-subtle text-loud disabled:opacity-50 disabled:cursor-not-allowed hover:bg-bg-primary transition-colors duration-300"
 >
 <ChevronLeft className="w-5 h-5" strokeWidth={1.5} />
 </button>
 <button
 onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
 disabled={page === totalPages}
 className="p-2 rounded-full border border-subtle text-loud disabled:opacity-50 disabled:cursor-not-allowed hover:bg-bg-primary transition-colors duration-300"
 >
 <ChevronRight className="w-5 h-5" strokeWidth={1.5} />
 </button>
 </div>
 </div>
 )}
 </div>
 </div>
 );
}
