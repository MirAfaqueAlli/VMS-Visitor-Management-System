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
  ArrowUpRight,
  Layers,
  QrCode,
  User,
} from "lucide-react";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";
import StatusBadge from "../../components/shared/StatusBadge";
import useAuth from "../../hooks/useAuth";

const CATEGORY_LABELS = {
  EMPLOYEE_VISIT: 'Employee Visit',
  VENDOR: 'Vendor',
  SPOT: 'Walk-in',
  PERSONAL_VISIT: 'Personal Visit',
};

// Show 'Public Request' when the record came from the public self-registration form
function getCategoryLabel(request) {
  if (request.request_source === 'PUBLIC') return 'Public Request';
  return CATEGORY_LABELS[request.visit_category] ?? request.visit_category;
}

export default function RequestList() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  // Role permissions
  const canViewPass = ['security', 'unit_admin', 'receptionist'].includes(user?.role_type);
  const canCreate   = ['unit_admin', 'employee', 'security', 'receptionist'].includes(user?.role_type);

  // Tabs: 'as_host' (Visitors to Me), 'as_visitor' (My Visits as Visitor), 'all' (All)
  const [activeTab, setActiveTab] = useState(user?.role_type === "employee" ? "as_host" : "all");

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
      if (activeTab && activeTab !== "all") params.tab = activeTab;
      if (statusFilter) params.status = statusFilter;
      if (dateFilter) params.visit_date = dateFilter;
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
  }, [page, activeTab, statusFilter, dateFilter, debouncedSearch]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  return (
    <div className="max-w-7xl mx-auto  animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-xl font-bold text-loud">
            Visit Requests
          </h1>
        </div>
        {canCreate && (
          <Link
            to="/requests/new"
            className="btn-primary px-4 py-2 text-xs"
          >
            <Plus className="w-4 h-4" />
            New Request
          </Link>
        )}
      </div>

      <div className="vms-card border-none  rounded-md  mb-8 ">
        {/* Tab Switcher */}
        <div className="flex items-center gap-2 mb-6 border-b border-subtle pb-4 overflow-x-auto">
          <button
            type="button"
            onClick={() => { setActiveTab("as_host"); setPage(1); }}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer ${
              activeTab === "as_host"
                ? "bg-accent text-white shadow-sm shadow-accent/20"
                : "bg-bg-primary text-muted hover:text-loud hover:bg-bg-subtle border border-subtle"
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>Visitors to Me</span>
          </button>

          <button
            type="button"
            onClick={() => { setActiveTab("as_visitor"); setPage(1); }}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer ${
              activeTab === "as_visitor"
                ? "bg-accent text-white shadow-sm shadow-accent/20"
                : "bg-bg-primary text-muted hover:text-loud hover:bg-bg-subtle border border-subtle"
            }`}
          >
            <ArrowUpRight className="w-3.5 h-3.5" />
            <span>My Visits (As Visitor)</span>
          </button>

          <button
            type="button"
            onClick={() => { setActiveTab("all"); setPage(1); }}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer ${
              activeTab === "all"
                ? "bg-accent text-white shadow-sm shadow-accent/20"
                : "bg-bg-primary text-muted hover:text-loud hover:bg-bg-subtle border border-subtle"
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>All Requests</span>
          </button>
        </div>

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
              className="block w-full pl-11 pr-4 py-2 bg-bg-primary border border-subtle rounded-full text-loud placeholder-faint focus:outline-none focus:ring-2 focus:ring-accent transition-all duration-300"
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
                className="block w-full sm:w-48 pl-4 pr-10 py-2 bg-bg-primary border border-subtle rounded-full text-loud focus:outline-none focus:ring-2 focus:ring-accent appearance-none cursor-pointer"
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
              className="block w-full sm:w-48 px-4 py-2 bg-bg-primary border border-subtle rounded-full text-loud focus:outline-none focus:ring-2 focus:ring-accent"
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
                    {activeTab === 'as_visitor'
                      ? 'No visit requests found where you are the visitor.'
                      : activeTab === 'as_host'
                      ? 'No visitor requests to you found.'
                      : 'No visit requests found.'}
                  </td>
                </tr>
              ) : (
                requests.map((request) => (
                  <tr
                    key={`${request._cross_unit_id ?? "own"}-${request.id}`}
                    className="border-b border-subtle hover:bg-bg-primary/50 transition-colors duration-300"
                  >
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <div className="font-medium text-loud">
                          {request.visitor_name || request.company_name || "N/A"}
                        </div>
                        {request.my_role === 'VISITOR' && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border"
                            style={{ background: 'var(--color-success-bg)', color: 'var(--color-success)', borderColor: 'var(--color-success)' }}>
                            You (Visitor)
                          </span>
                        )}
                      </div>
                      {request.visitor_phone && (
                        <div className="text-xs text-faint mt-0.5">{request.visitor_phone}</div>
                      )}
                      <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider"
                          style={{ background: 'var(--color-info-bg)', color: 'var(--color-info)' }}
                        >
                          {getCategoryLabel(request)}
                        </span>
                        {request._cross_unit_id && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border"
                            style={{ background: 'var(--color-mixed-bg)', color: 'var(--color-mixed)', borderColor: 'var(--color-mixed)' }}>
                            Cross-Unit
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="text-loud flex items-center gap-1.5 flex-wrap">
                        <UserCheck
                          className="w-4 h-4 text-accent shrink-0"
                          strokeWidth={1.5}
                        />
                        <span>{request.Host?.full_name || request.host_name || "N/A"}</span>
                        {request.my_role === 'HOST' && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border"
                            style={{ background: 'var(--color-info-bg)', color: 'var(--color-info)', borderColor: 'var(--color-info)' }}>
                            You (Host)
                          </span>
                        )}
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
                        {(canViewPass || request.my_role === 'VISITOR' || user?.role_type === 'employee') &&
                          request.status === "APPROVED" &&
                          request.pass_number && (
                            <button
                              onClick={() =>
                                navigate(`/gate/pass/${request.pass_number}`)
                              }
                              className="inline-flex items-center gap-1 justify-center px-3 h-8 rounded-full bg-mixed-bg text-accent hover:bg-accent hover:text-white transition-colors duration-300 text-xs font-semibold uppercase tracking-wider"
                              title="View Gate Pass"
                            >
                              <QrCode className="w-3.5 h-3.5" />
                              Pass
                            </button>
                          )}
                        <button
                          onClick={() => navigate(
                            // Cross-unit rows live in another unit's DB — tell the detail page which one
                            request._cross_unit_id
                              ? `/requests/${request.id}?unit_id=${request._cross_unit_id}`
                              : `/requests/${request.id}`
                          )}
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
