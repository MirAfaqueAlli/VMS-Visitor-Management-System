// frontend/src/pages/gate/MyWalkIns.jsx
// Spot visits (walk-ins) this security / reception user registered — today and
// upcoming, expired ones left out — with the host's decision, the gate pass and
// a Check in button once the host has approved.
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { Plus, Check, RefreshCw, UserPlus } from "../../components/icons";
import apiClient from "../../api/axios";
import useSocketEvent from "../../hooks/useSocketEvent";
import { PageHeader, Toolbar, SearchInput, Th, SkeletonRows, Status, Tag, Empty } from "../../components/ui";
import Pagination from "../../components/shared/Pagination";
import { fmtDate, fmtTime, orDash } from "../../lib/format";

const PAGE_SIZE = 25;

export default function MyWalkIns() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get("/visit-requests/my-walkins", {
        params: { page, limit: PAGE_SIZE, search: search.trim() || undefined },
      });
      setRows(data.data.requests || []);
      setTotal(data.data.pagination?.total || 0);
    } catch {
      toast.error("Could not load your walk-in visits.");
    } finally { setLoading(false); }
  }, [page, search]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);   // wait for typing to stop
    return () => clearTimeout(t);
  }, [load, search]);

  // The host decided, or the visitor was checked in / out — refresh
  useSocketEvent("visit:approved:today", load, [load]);
  useSocketEvent("visit:rejected", load, [load]);
  useSocketEvent("visit:checkin", load, [load]);
  useSocketEvent("visit:checkout", load, [load]);
  useSocketEvent("visit:cancelled", load, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Spot visits"
        meta="Walk-ins you registered · today and upcoming"
        actions={(
          <>
            <button type="button" onClick={load} disabled={loading} className="btn-outline">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
            </button>
            <button type="button" onClick={() => navigate("/requests/new?category=SPOT")} className="btn-primary">
              <Plus size={14} /> Register walk-in
            </button>
          </>
        )}
      />

      <Toolbar count={loading ? null : total} noun={total === 1 ? "walk-in" : "walk-ins"}>
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }}
          placeholder="Search visitor, phone, host or pass" width={280} />
      </Toolbar>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <Th>Visitor</Th>
              <Th>Host</Th>
              <Th>Visit</Th>
              <Th>Status</Th>
              <Th>Gate pass</Th>
              <Th align="right">Action</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows rows={5} cols={6} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="!p-0">
                  <Empty
                    icon={UserPlus}
                    title={search ? "No walk-ins match this search" : "No walk-ins for today or later"}
                    hint={search ? "Try another name, number or pass." : "Walk-ins you register appear here until their visit date has passed."}
                  />
                </td>
              </tr>
            ) : rows.map((r) => {
              const inside = r.gate_status === "ACTIVE";
              const canCheckIn = r.status === "APPROVED" && r.visit_day === "today" && !r.gate_status && r.pass_status === "ISSUED";
              return (
                <tr key={r.id}>
                  <td>
                    <span className="font-medium">{r.visitor_name || r.company_name || "—"}</span>
                    <span className="cell-sub">{r.company_name && r.visitor_name ? `${r.company_name} · ` : ""}{orDash(r.visitor_phone)}</span>
                  </td>
                  <td>
                    {orDash(r.host_name)}
                    <span className="cell-sub">{orDash(r.department_name)}</span>
                  </td>
                  <td className="tabular whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      {fmtDate(r.visit_date)}
                      {r.visit_day === "today" && <Tag tone="brand">Today</Tag>}
                    </span>
                    <span className="cell-sub">
                      {r.visit_start_time ? `${fmtTime(r.visit_start_time)}${r.visit_end_time ? `–${fmtTime(r.visit_end_time)}` : ""}` : "Any time"}
                    </span>
                  </td>
                  <td><Status value={inside ? "CHECKED_IN" : r.gate_status === "GATE_REJECTED" ? "GATE_REJECTED" : r.status} /></td>
                  <td>
                    {r.pass_number ? (
                      <Link to={`/gate/pass/${encodeURIComponent(r.pass_number)}`} className="mono text-link" title="Open and print the gate pass">
                        {r.pass_number}
                      </Link>
                    ) : <span className="text-muted">{r.status === "PENDING" ? "After the host approves" : "—"}</span>}
                  </td>
                  <td className="num">
                    {canCheckIn && (
                      <button type="button" onClick={() => navigate(`/gate/checkin/${r.id}`)} className="btn-primary btn-sm">
                        <Check size={13} /> Check in
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!loading && total > PAGE_SIZE && (
        <Pagination page={page} totalPages={totalPages} totalCount={total} onPageChange={setPage} />
      )}
    </div>
  );
}
