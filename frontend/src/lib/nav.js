// frontend/src/lib/nav.js
// One navigation definition drives the sidebar and the breadcrumbs (DESIGN_RULES §5–6).
// Groups are named by workflow, not by data type.

/** @typedef {{ label: string, to: string, end?: boolean, roles?: string[], countKey?: string }} NavLink */
/** @typedef {{ group: string, items: NavLink[] }} NavGroup */

const UNIT_NAV = [
  { label: 'Dashboard', to: '/dashboard' },
  { group: 'Visits', items: [
    // Security works from Gate Security (walk-ins are registered there), not these lists
    { label: 'Visit Requests', to: '/requests', roles: ['unit_admin', 'employee', 'receptionist'] },
    { label: 'Visitors',       to: '/visitors', roles: ['unit_admin', 'employee', 'receptionist'] },
  ] },
  { group: 'Approval', items: [
    { label: 'Approvals', to: '/approvals', roles: ['unit_admin', 'employee'], countKey: 'approvals' },
  ] },
  { group: 'Gate', items: [
    { label: 'Gate Security', to: '/gate', end: true, roles: ['security', 'receptionist', 'unit_admin'] },
    { label: 'Spot Visits',   to: '/gate/walk-ins', roles: ['security', 'receptionist'] },
  ] },
  { group: 'Report', items: [
    { label: 'Reports',    to: '/reports',    roles: ['unit_admin', 'unit_auditor'] },
    { label: 'Audit Logs', to: '/audit-logs', roles: ['unit_admin', 'unit_auditor'] },
  ] },
  { group: 'Masters', items: [
    { label: 'Employees',            to: '/admin/employees',   roles: ['unit_admin'] },
    { label: 'Security & Reception', to: '/admin/security',    roles: ['unit_admin'] },
    { label: 'Departments',          to: '/admin/departments', roles: ['unit_admin'] },
  ] },
];

const CENTRAL_NAV = [
  { label: 'Dashboard', to: '/dashboard' },
  { group: 'Masters', items: [
    { label: 'Units',        to: '/super/units' },
    { label: 'Global Users', to: '/super/users' },
  ] },
  { group: 'Report', items: [
    { label: 'Global Reports', to: '/reports' },
    { label: 'Audit Logs',     to: '/audit-logs' },
  ] },
];

// A super admin managing one unit: oversight only (no gate, no approvals)
const MANAGED_UNIT_NAV = [
  { label: 'Unit Dashboard', to: '/unit-dashboard' },
  { group: 'Visits', items: [
    { label: 'Visit Requests', to: '/requests' },
    { label: 'Visitors',       to: '/visitors' },
  ] },
  { group: 'Masters', items: [
    { label: 'Employees',            to: '/admin/employees' },
    { label: 'Security & Reception', to: '/admin/security' },
    { label: 'Departments',          to: '/admin/departments' },
  ] },
];

const AUDITOR_NAV = [
  { label: 'Dashboard', to: '/dashboard' },
  { group: 'Report', items: [
    { label: 'Reports',    to: '/reports' },
    { label: 'Audit Logs', to: '/audit-logs' },
  ] },
];

const allowed = (item, role) => !item.roles || item.roles.includes(role);

/**
 * The nav sections for the signed-in user: [{ title?, entries: (NavLink|NavGroup)[] }].
 * Entries a role can't open are dropped, and so are groups left empty.
 */
export function navSections({ role, isSuperAdmin, isGlobalAuditor, activeUnit }) {
  const filter = (entries) => entries
    .map((e) => (e.group ? { ...e, items: e.items.filter((i) => allowed(i, role)) } : e))
    .filter((e) => (e.group ? e.items.length > 0 : allowed(e, role)));

  if (isSuperAdmin && activeUnit) {
    return [
      { title: 'Central', entries: filter(CENTRAL_NAV) },
      { title: activeUnit.name, entries: filter(MANAGED_UNIT_NAV) },
    ];
  }
  if (isSuperAdmin) return [{ entries: filter(CENTRAL_NAV) }];
  if (isGlobalAuditor) return [{ entries: filter(AUDITOR_NAV) }];
  return [{ entries: filter(UNIT_NAV) }];
}

/** Does `pathname` belong to this link? (prefix match unless the link is `end`) */
export function isCurrent(link, pathname) {
  if (link.end) return pathname === link.to;
  return pathname === link.to || pathname.startsWith(`${link.to}/`);
}

/**
 * Breadcrumb trail for a path: [{ label, to? }]. Home › Group › Page, where the
 * page links back when the screen is a sub-screen of it (e.g. a record).
 * The dashboard has no breadcrumb.
 */
export function crumbsFor(pathname, sections) {
  let best = null;
  for (const section of sections) {
    for (const entry of section.entries) {
      const links = entry.group ? entry.items.map((l) => ({ ...l, group: entry.group })) : [entry];
      for (const l of links) {
        // `end` links highlight only on their own page, but still head their sub-pages' breadcrumbs
        const under = isCurrent(l, pathname) || (l.end && pathname.startsWith(`${l.to}/`));
        if (under && (!best || l.to.length > best.to.length)) best = l;
      }
    }
  }
  if (!best || best.to === '/dashboard' || best.to === '/unit-dashboard') return [];
  const trail = [{ label: 'Home', to: '/dashboard' }];
  if (best.group) trail.push({ label: best.group });
  trail.push({ label: best.label, to: pathname === best.to ? undefined : best.to });
  return trail;
}
