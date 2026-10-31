// frontend/src/components/Layout/Sidebar.jsx
// Sidebar (DESIGN_RULES §5): --canvas, hidden scrollbar, one shared icon for every
// link, collapsible workflow groups with ring-dot sub-links, counts of waiting
// work, and a 64px rail mode. The nav itself comes from lib/nav.js.
import { Fragment, useCallback, useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import apiClient from '../../api/axios';
import useAuth from '../../hooks/useAuth';
import useSocketEvent from '../../hooks/useSocketEvent';
import { navSections, isCurrent } from '../../lib/nav';
import { NavIcon, ChevronRight, SidebarToggle } from '../icons';

const APPROVER_ROLES = ['unit_admin', 'employee'];

function Count({ n }) {
  if (!n) return null;
  return <span className="nav-count">{n > 99 ? '99+' : n}</span>;
}

function Link({ link, rail, sub, counts, onNavigate }) {
  const n = link.countKey ? counts[link.countKey] : 0;
  return (
    <NavLink
      to={link.to}
      end={!!link.end}
      title={rail ? link.label : undefined}
      aria-label={rail ? link.label : undefined}
      onClick={onNavigate}
      className={({ isActive }) => `nav-link${sub && !rail ? ' nav-sublink' : ''}${isActive ? ' active' : ''}`}
    >
      {sub && !rail ? <span className="nav-ring" aria-hidden="true" /> : <NavIcon size={18} duo className="shrink-0" />}
      {!rail && <span className="nav-label">{link.label}</span>}
      <Count n={n} />
    </NavLink>
  );
}

export default function Sidebar({ rail, onToggleRail, mobileOpen, onNavigate }) {
  const { user, isSuperAdmin, isGlobalAuditor, activeUnit, setActiveUnit } = useAuth();
  const { pathname } = useLocation();
  const role = user?.role_type;
  const sections = navSections({ role, isSuperAdmin, isGlobalAuditor, activeUnit });

  // Groups the user opened / closed; otherwise a group is open when it holds the current page
  const [manual, setManual] = useState({});
  const groupKey = (si, g) => `${si}:${g}`;

  // Count of visit requests waiting for this user's decision
  const [counts, setCounts] = useState({ approvals: 0 });
  const canApprove = APPROVER_ROLES.includes(role) && !isSuperAdmin;
  const loadCounts = useCallback(() => {
    if (!canApprove) return;
    apiClient.get('/approvals/inbox', { params: { page: 1, limit: 1 } })
      .then((res) => setCounts({ approvals: res.data?.data?.pagination?.total ?? 0 }))
      .catch(() => { /* count is a convenience */ });
  }, [canApprove]);
  useEffect(() => { loadCounts(); }, [loadCounts]);
  useSocketEvent('visit:request:new', loadCounts, [loadCounts]);
  useSocketEvent('visit:actioned', loadCounts, [loadCounts]);

  // On a phone the full sidebar slides in as a drawer, never as a rail
  const asRail = rail && !mobileOpen;

  return (
    <aside
      className={`sidebar${asRail ? ' is-rail' : ''}${mobileOpen ? ' is-open' : ''}`}
      aria-label="Main navigation"
    >
      <nav className="flex-1 overflow-y-auto no-scrollbar px-2 pt-2 pb-3">
        {sections.map((section, si) => (
          <div key={si} className={si > 0 ? 'mt-3 pt-3 border-t border-line' : ''}>
            {section.title && !asRail && (
              <div className="flex items-center justify-between gap-2 px-2.5 pb-1.5">
                <span className="group-heading truncate">{section.title}</span>
                {si > 0 && isSuperAdmin && activeUnit && (
                  <button
                    type="button"
                    className="btn-link text-[11px]"
                    onClick={() => { setActiveUnit(null); toast.success('Back to the central view.'); }}
                  >
                    Switch back
                  </button>
                )}
              </div>
            )}

            {section.entries.map((entry, ei) => {
              if (!entry.group) {
                return <Link key={entry.to} link={entry} rail={asRail} counts={counts} onNavigate={onNavigate} />;
              }
              const key = groupKey(si, entry.group);
              const holdsCurrent = entry.items.some((l) => isCurrent(l, pathname));
              const open = manual[key] ?? holdsCurrent;
              const total = entry.items.reduce((s, l) => s + (l.countKey ? counts[l.countKey] || 0 : 0), 0);

              if (asRail) {
                // Rail: icons only, a hairline between groups
                return (
                  <Fragment key={key}>
                    {ei > 0 && <div className="mx-3 my-1.5 border-t border-line" aria-hidden="true" />}
                    {entry.items.map((l) => <Link key={l.to} link={l} rail counts={counts} onNavigate={onNavigate} />)}
                  </Fragment>
                );
              }

              return (
                <div key={key}>
                  <button
                    type="button"
                    className={`nav-group${holdsCurrent ? ' has-current' : ''}`}
                    aria-expanded={open}
                    onClick={() => setManual((m) => ({ ...m, [key]: !open }))}
                  >
                    <NavIcon size={18} duo className="shrink-0" />
                    <span className="nav-label">{entry.group}</span>
                    {!open && <Count n={total} />}
                    <ChevronRight size={13} className="nav-chevron" />
                  </button>
                  <div className={`nav-sub${open ? ' is-open' : ''}`}>
                    <div inert={!open}>
                      {entry.items.map((l) => <Link key={l.to} link={l} sub counts={counts} onNavigate={onNavigate} />)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer: collapse / expand + app note */}
      <div className={`flex items-center gap-2 h-11 shrink-0 ${asRail ? 'justify-center px-2' : 'px-3.5'}`}>
        <button
          type="button"
          className="btn-icon hidden lg:inline-flex"
          onClick={onToggleRail}
          aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'}
          title={rail ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <SidebarToggle size={17} />
        </button>
        {!asRail && <span className="text-[11px] text-muted truncate">OHPC Visitor Management</span>}
      </div>
    </aside>
  );
}
