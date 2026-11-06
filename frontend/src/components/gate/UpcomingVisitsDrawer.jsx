// frontend/src/components/gate/UpcomingVisitsDrawer.jsx
// The gate's upcoming visits (GET /gate/upcoming): approved visits from today on,
// in tabs — Today, Tomorrow, the next two days, Later — with the details security
// needs at the gate and Check in for today's.
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CalendarDays, Check } from "../icons";
import { Drawer, Tabs, Tag, Empty } from "../ui";
import { describe } from "../../lib/status";
import { fmtDate, fmtTime, orDash } from "../../lib/format";
import { upcomingGroups } from "../../lib/upcomingVisits";

export default function UpcomingVisitsDrawer({ visits, today, onClose, canCheckIn }) {
  const navigate = useNavigate();
  const groups = useMemo(() => upcomingGroups(visits, today), [visits, today]);
  const [tab, setTab] = useState(() => (groups.find((g) => g.rows.length) || groups[0]).id);
  const current = groups.find((g) => g.id === tab) || groups[0];
  const isToday = current.id === today;

  return (
    <Drawer open onClose={onClose} width={1080} icon={CalendarDays}
      title="Upcoming visits" subtitle={`${visits.length} approved visit${visits.length === 1 ? "" : "s"} from today`}>
      <Tabs className="mb-4" value={tab} onChange={setTab}
        tabs={groups.map((g) => ({ id: g.id, label: g.label, count: g.rows.length }))} />

      {current.rows.length === 0 ? (
        <Empty icon={CalendarDays} title={`No visits ${current.id === "later" ? "later on" : current.label === "Today" ? "today" : `on ${current.label}`}`}
          hint="Approved visits appear here as soon as they are approved." />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Visitor</th><th>Host</th><th>{current.id === "later" ? "Date · time" : "Time"}</th><th>Purpose</th><th>Gate pass</th>
                {isToday && canCheckIn && <th className="num">Action</th>}
              </tr>
            </thead>
            <tbody>
              {current.rows.map((v) => (
                <tr key={v.id}>
                  <td>
                    <span className="inline-flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium whitespace-nowrap">{orDash(v.visitor_name || v.company_name)}</span>
                      <Tag tone={describe(v.visit_category).tone}>{describe(v.visit_category).label}</Tag>
                    </span>
                    <span className="cell-sub">
                      {v.company_name && v.visitor_name ? `${v.company_name} · ` : ""}{orDash(v.visitor_phone)}
                      {v.accompanying_count > 0 ? ` · +${v.accompanying_count} with them` : ""}
                    </span>
                  </td>
                  <td className="whitespace-nowrap">
                    {orDash(v.host_name)}
                    <span className="cell-sub">{orDash(v.department_name)}</span>
                  </td>
                  <td className="tabular whitespace-nowrap">
                    {current.id === "later" && <>{fmtDate(v.visit_date)}<br /></>}
                    {v.visit_start_time ? `${fmtTime(v.visit_start_time)}${v.visit_end_time ? `–${fmtTime(v.visit_end_time)}` : ""}` : "Any time"}
                  </td>
                  <td className="max-w-[280px]"><span className="line-clamp-2 break-words">{orDash(v.purpose)}</span></td>
                  <td className="whitespace-nowrap">
                    {v.pass_number
                      ? <Link to={`/gate/pass/${encodeURIComponent(v.pass_number)}`} className="mono text-link" onClick={onClose}>{v.pass_number}</Link>
                      : <span className="text-muted">—</span>}
                  </td>
                  {isToday && canCheckIn && (
                    <td className="num">
                      <button type="button" className="btn-primary btn-sm" onClick={() => { onClose(); navigate(`/gate/checkin/${v.id}`); }}>
                        <Check size={13} /> Check in
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Drawer>
  );
}
