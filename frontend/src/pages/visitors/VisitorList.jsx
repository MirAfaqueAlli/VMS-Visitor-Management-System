// frontend/src/pages/visitors/VisitorList.jsx
// Visitor directory (DESIGN_RULES §6/§8): title + Register visitor, toolbar
// (count · search · type · export), a plain sortable table; rows open the visitor.
import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Users } from "../../components/icons";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";
import useAuth from "../../hooks/useAuth";
import Select from "../../components/Select";
import Pagination from "../../components/shared/Pagination";
import { PageHeader, Toolbar, SearchInput, Th, SkeletonRows, Tag, Empty, ExportButton } from "../../components/ui";
import useSort from "../../lib/useSort";
import { fmtDate, fmtClock, orDash } from "../../lib/format";
import { downloadXlsx, fetchAllPages } from "../../lib/exportXlsx";

const CREATE_ROLES = ["unit_admin", "employee", "security", "receptionist"];
const typeLabel = (t) => (t === "business" ? "Business" : "Individual");

export default function VisitorList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [visitors, setVisitors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterType, setFilterType] = useState("all"); // 'all' | 'individual' | 'business'
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const limit = 10;

  useEffect(() => {
    const h = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(h);
  }, [search]);

  const fetchVisitors = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiClient.get("/visitors", { params: { search: debouncedSearch, page, limit } });
      setVisitors(res.data.data?.visitors ?? []);
      setTotalPages(res.data.data?.pagination?.pages ?? 1);
      setTotalCount(res.data.data?.pagination?.total ?? 0);
    } catch (err) {
      toast.error(err.response?.data?.message ?? "Failed to fetch visitors");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page]);

  useEffect(() => { fetchVisitors(); }, [fetchVisitors]);

  // Type is filtered on the page that was loaded (the API has no type filter)
  const filtered = filterType === "all"
    ? visitors
    : visitors.filter((v) => (filterType === "business" ? v.visitor_type === "business" : v.visitor_type !== "business"));

  const { rows, sort, onSort } = useSort(filtered, {
    name: (v) => v.full_name,
    contact: (v) => v.phone,
    type: (v) => typeLabel(v.visitor_type),
    registered: (v) => v.created_at,
  });

  const onExport = async () => {
    setExporting(true);
    try {
      const all = await fetchAllPages(async (p) => {
        const res = await apiClient.get("/visitors", { params: { search: debouncedSearch, page: p, limit: 100 } });
        return { rows: res.data?.data?.visitors ?? [], pages: res.data?.data?.pagination?.pages ?? 1 };
      });
      const list = filterType === "all" ? all
        : all.filter((v) => (filterType === "business" ? v.visitor_type === "business" : v.visitor_type !== "business"));
      await downloadXlsx(list, [
        { header: "VISITOR_ID", value: (v) => v.id || v.visitor_id },
        { header: "NAME", value: (v) => v.full_name },
        { header: "COMPANY", value: (v) => v.company_name },
        { header: "PHONE", value: (v) => v.phone },
        { header: "EMAIL", value: (v) => v.email },
        { header: "TYPE", value: (v) => typeLabel(v.visitor_type) },
        { header: "REGISTERED_ON", value: (v) => fmtDate(v.created_at) },
      ], "visitors");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not export the visitors.");
    } finally {
      setExporting(false);
    }
  };

  const hasFilters = !!(search || filterType !== "all");

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Visitors"
        actions={CREATE_ROLES.includes(user?.role_type) && (
          <Link to="/visitors/new" className="btn-primary"><Plus size={14} /> Register visitor</Link>
        )}
      />

      <Toolbar count={loading ? null : totalCount} noun={totalCount === 1 ? "visitor" : "visitors"}>
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search name, phone or email" width={260} />
        <Select value={filterType} onChange={(e) => { setFilterType(e.target.value); setPage(1); }} aria-label="Visitor type" style={{ width: 150 }}>
          <option value="all">All types</option>
          <option value="individual">Individual</option>
          <option value="business">Business</option>
        </Select>
        {hasFilters && (
          <button type="button" className="btn-ghost" onClick={() => { setSearch(""); setFilterType("all"); setPage(1); }}>Clear</button>
        )}
        <ExportButton onClick={onExport} busy={exporting} disabled={!totalCount} title="Export these visitors to Excel" />
      </Toolbar>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <Th sortKey="name" sort={sort} onSort={onSort}>Name</Th>
              <Th sortKey="contact" sort={sort} onSort={onSort}>Contact</Th>
              <Th sortKey="type" sort={sort} onSort={onSort}>Type</Th>
              <Th sortKey="registered" sort={sort} onSort={onSort}>Registered</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows rows={6} cols={4} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="!p-0">
                  <Empty
                    icon={Users}
                    title={hasFilters ? "No visitors match these filters" : "No visitors yet"}
                    hint={hasFilters ? "Try another search or type, or clear the filters." : "Visitors are added here when they are registered or ask to visit."}
                  />
                </td>
              </tr>
            ) : (
              rows.map((v) => {
                const vid = v.id || v.visitor_id;
                return (
                  <tr key={vid} className="is-clickable" onClick={() => navigate(`/visitors/${vid}`)}>
                    <td>
                      <span className="font-medium">{v.full_name}</span>
                      {v.company_name && <span className="cell-sub">{v.company_name}</span>}
                    </td>
                    <td className="tabular">
                      {orDash(v.phone)}
                      {v.email && <span className="cell-sub">{v.email}</span>}
                    </td>
                    <td><Tag tone={v.visitor_type === "business" ? "info" : "neutral"}>{typeLabel(v.visitor_type)}</Tag></td>
                    <td className="tabular whitespace-nowrap">
                      {fmtDate(v.created_at)}
                      <span className="cell-sub">{v.created_at ? fmtClock(v.created_at) : ""}</span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {!loading && <Pagination page={page} totalPages={totalPages} totalCount={totalCount} onPageChange={setPage} />}
    </div>
  );
}
