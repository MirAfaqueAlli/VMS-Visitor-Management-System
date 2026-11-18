// frontend/src/pages/visitors/VisitorLog.jsx
// Visitors who actually checked in (employee_visitor_log).
// Unit admins see the whole unit (with an employee filter); a super admin's
// personal page sees only visitors who came to see them.
import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { Users } from "../../components/icons";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";
import useAuth from "../../hooks/useAuth";
import Select from "../../components/Select";
import Pagination from "../../components/shared/Pagination";
import { PageHeader, Toolbar, Th, SkeletonRows, Tag, Empty } from "../../components/ui";
import useSort from "../../lib/useSort";
import { fmtDate, fmtTime, orDash } from "../../lib/format";

export default function VisitorLog({ personal = false, unitWide = false } = {}) {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [unitEmployees, setUnitEmployees] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const limit = 20;

  const showEmployeeFilter = unitWide && !personal;

  useEffect(() => {
    if (!showEmployeeFilter) return;
    let cancelled = false;
    apiClient.get("/users/hosts", { params: { include_all: "true", roles: "employee,unit_admin" } })
      .then((res) => { if (!cancelled) setUnitEmployees(res.data?.data ?? []); })
      .catch(() => { if (!cancelled) setUnitEmployees([]); });
    return () => { cancelled = true; };
  }, [showEmployeeFilter]);

  const fetchVisitors = useCallback(async () => {
    try {
      setLoading(true);
      const params = { page, limit };
      if (personal) params.personal = 1;
      if (unitWide) params.all = 1;
      if (employeeFilter) params.employee_id = employeeFilter;
      const res = await apiClient.get("/visit-requests/my-visitors", { params });
      setRows(res.data?.data?.visitors ?? []);
      setTotalPages(res.data?.data?.pagination?.pages ?? 1);
      setTotalCount(res.data?.data?.pagination?.total ?? 0);
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to fetch visitors.");
    } finally {
      setLoading(false);
    }
  }, [page, personal, unitWide, employeeFilter]);

  useEffect(() => { fetchVisitors(); }, [fetchVisitors]);

  const { rows: sortedRows, sort, onSort } = useSort(rows, {
    visitor: (v) => v.visitor_name,
    host: (v) => v.host_name,
    checkedIn: (v) => v.checked_in_at,
    department: (v) => v.department_name,
  });

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={personal ? "My Visitors" : "Visitors"}
        meta={unitWide ? "Checked in to this unit" : undefined}
        actions={unitWide && <Link to="/visitors" className="btn-outline">Visitor directory</Link>}
      />
      <Toolbar count={loading ? null : totalCount} noun={totalCount === 1 ? "visitor" : "visitors"}>
        {showEmployeeFilter && (
          <Select value={employeeFilter} onChange={(e) => { setEmployeeFilter(e.target.value); setPage(1); }}
            aria-label="Employee" style={{ width: 220 }}>
            <option value="">All employees</option>
            {unitEmployees.map((emp) => {
              const isMe = emp.id === user?.id || (emp.email && user?.email && emp.email.toLowerCase() === user.email.toLowerCase());
              return (
                <option key={emp.id} value={emp.id}>
                  {emp.full_name}{isMe ? " (you)" : ""}{emp.department_name ? ` · ${emp.department_name}` : ""}
                </option>
              );
            })}
          </Select>
        )}
      </Toolbar>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <Th sortKey="visitor" sort={sort} onSort={onSort}>Visitor</Th>
              <Th sortKey="host" sort={sort} onSort={onSort}>Host</Th>
              <Th sortKey="department" sort={sort} onSort={onSort}>Department</Th>
              <Th sortKey="checkedIn" sort={sort} onSort={onSort}>Check-in</Th>
              <th>Status</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows rows={6} cols={6} />
            ) : sortedRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="!p-0">
                  <Empty icon={Users} title="No visitors yet" hint="Visitors appear here once the gate checks them in." />
                </td>
              </tr>
            ) : sortedRows.map((v) => (
              <tr key={v.id}>
                <td>
                  <span className="font-medium">{orDash(v.visitor_name)}</span>
                  <span className="cell-sub">{v.visitor_phone}</span>
                </td>
                <td>{orDash(v.host_name)}</td>
                <td>{orDash(v.department_name)}</td>
                <td className="tabular whitespace-nowrap">
                  {fmtDate(v.checked_in_at)}
                  <span className="cell-sub">{fmtTime(v.checked_in_at)}</span>
                </td>
                <td>
                  {v.check_out_at ? (
                    <>
                      <Tag tone="neutral">Checked out</Tag>
                      <span className="cell-sub">{fmtTime(v.check_out_at)}</span>
                    </>
                  ) : (
                    <Tag tone="success">Inside</Tag>
                  )}
                </td>
                <td className="max-w-[260px] truncate">{orDash(v.purpose)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && <Pagination page={page} totalPages={totalPages} totalCount={totalCount} onPageChange={setPage} />}
    </div>
  );
}
