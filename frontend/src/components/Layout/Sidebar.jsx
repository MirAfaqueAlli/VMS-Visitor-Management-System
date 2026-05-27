// frontend/src/components/Layout/Sidebar.jsx
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, ClipboardList, CheckSquare,
  Shield, BarChart3, Settings, LogOut, Building2, Globe, ShieldAlert, X, UserCheck, FileArchive,
} from 'lucide-react';

import useAuth from '../../hooks/useAuth';
import toast from 'react-hot-toast';

// ── Nav item sets ─────────────────────────────────────────────────────────────
const unitNavItems = [
  { label: 'Dashboard',      icon: LayoutDashboard, path: '/dashboard', roles: null },
  { label: 'Visitors',       icon: Users,           path: '/visitors',  roles: ['unit_admin', 'employee', 'receptionist', 'security'] },
  { label: 'Visit Requests', icon: ClipboardList,   path: '/requests',  roles: ['unit_admin', 'employee', 'receptionist', 'security'] },
  { label: 'Approvals',      icon: CheckSquare,     path: '/approvals', roles: ['unit_admin', 'employee'] },
  { label: 'Gate Security',  icon: Shield,          path: '/gate',      roles: ['security', 'receptionist', 'unit_admin'] },
  { label: 'Reports',        icon: BarChart3,       path: '/reports',   roles: ['unit_admin', 'unit_auditor'] },
  { label: 'Audit Logs',     icon: ShieldAlert,     path: '/audit-logs',roles: ['unit_admin', 'unit_auditor'] },
  { label: 'User Management',icon: Settings,        path: '/admin',     roles: ['unit_admin'] },
];

// Central (super admin-only) links
const superAdminCentralItems = [
  { label: 'Dashboard',       icon: LayoutDashboard, path: '/dashboard' },
  { label: 'Unit Management', icon: Building2,       path: '/super/units' },
  { label: 'Global Users',    icon: UserCheck,       path: '/super/users' },
  { label: 'Global Reports',  icon: BarChart3,       path: '/reports' },
  { label: 'Audit Logs',      icon: ShieldAlert,     path: '/audit-logs' },
  { label: 'FY Archive',      icon: FileArchive,     path: '/admin/archive' },
];

// Unit-level links shown to super admin when they are managing a unit
const superAdminUnitItems = [
  { label: 'Visitors',        icon: Users,         path: '/visitors' },
  { label: 'Visit Requests',  icon: ClipboardList, path: '/requests' },
  { label: 'Gate Security',   icon: Shield,        path: '/gate' },
  { label: 'User Management', icon: Settings,      path: '/admin' },
];

const auditorNavItems = [
  { label: 'Dashboard',    icon: LayoutDashboard, path: '/dashboard' },
  { label: 'Reports',      icon: BarChart3,       path: '/reports' },
  { label: 'Audit Logs',   icon: ShieldAlert,     path: '/audit-logs' },
];

// ── Reusable NavItem ──────────────────────────────────────────────────────────
function NavItem({ label, icon: Icon, path }) {
  return (
    <NavLink
      to={path}
      className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
    >
      <Icon size={15} strokeWidth={1.8} className="shrink-0" />
      <span>{label}</span>
    </NavLink>
  );
}

// ── Section header label ──────────────────────────────────────────────────────
function SectionLabel({ children, color }) {
  return (
    <p
      className="text-[10px] font-bold uppercase tracking-widest px-2 pb-1.5 pt-1"
      style={{ color: color ?? 'var(--sidebar-text)', opacity: color ? 1 : 0.5 }}
    >
      {children}
    </p>
  );
}

export default function Sidebar() {
  const {
    user, hasRole, logout,
    isSuperAdmin, isUnitAdmin, isGlobalAuditor,
    activeUnit, setActiveUnit,
  } = useAuth();
  const navigate = useNavigate();

  const initials = user?.full_name
    ?.split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) ?? '?';

  return (
    <aside
      className="fixed left-0 top-0 h-screen flex flex-col z-30"
      style={{
        width:       'var(--sidebar-width, 220px)',
        background:  'var(--sidebar-bg)',
        borderRight: '1px solid var(--sidebar-border)',
      }}
    >
      {/* ── Logo ─────────────────────────────────────────────────────── */}
      <div
        className="px-4 h-16 flex items-center gap-2.5 shrink-0"
        style={{ borderBottom: '1px solid var(--sidebar-border)' }}
      >
        <div
          className="w-6 h-6 rounded flex items-center justify-center shrink-0"
          style={{ background: 'var(--sidebar-active-bg)' }}
        >
          <Shield size={13} style={{ color: 'var(--sidebar-active-text)' }} strokeWidth={2.2} />
        </div>
        <div className="min-w-0">
          <p className="text-white font-semibold text-[13px] leading-none tracking-tight">VMS</p>
          <p className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--sidebar-text)' }}>
            {isSuperAdmin
              ? (activeUnit ? `Managing: ${activeUnit.name}` : 'Super Admin — Central')
              : (user?.unit_name || user?.organization_name || 'Visitor Management')}
          </p>
        </div>
      </div>

      {/* ── Active Unit banner ────────────────────────────────────────── */}
      {(isSuperAdmin || isGlobalAuditor) && activeUnit && (
        <div className="px-3 py-2.5 mx-2.5 mt-3 bg-amber-500/10 border border-amber-500/20 rounded flex flex-col gap-1.5 shrink-0">
          <p className="text-[9px] text-amber-500 uppercase font-bold tracking-widest leading-none">Active Unit</p>
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-[11px] text-white font-semibold truncate leading-none">{activeUnit.name}</span>
            <button
              onClick={() => {
                setActiveUnit(null);
                toast.success('Cleared unit context — back to central view');
              }}
              className="p-0.5 rounded-full hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
              title="Leave Unit View"
            >
              <X size={11} />
            </button>
          </div>
        </div>
      )}

      {/* ── Navigation ───────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">

        {/* ══ SUPER ADMIN + active unit → TWO grouped sections ════════ */}
        {isSuperAdmin && activeUnit ? (
          <>
            {/* Section 1 — Central */}
            <SectionLabel>Central Admin</SectionLabel>
            {superAdminCentralItems.map(item => (
              <NavItem key={item.path} {...item} />
            ))}

            {/* Amber divider with unit name */}
            <div className="px-2 pt-3 pb-1">
              <div
                className="flex items-center gap-2"
                style={{ borderTop: '1px solid rgba(245,158,11,0.3)' }}
              >
                <span
                  className="text-[9px] font-bold uppercase tracking-widest whitespace-nowrap pt-2 flex items-center gap-1"
                  style={{ color: '#f59e0b' }}
                >
                  <Building2 size={9} />
                  {activeUnit.name}
                </span>
              </div>
            </div>

            {/* Section 2 — Unit items */}
            {superAdminUnitItems.map(item => (
              <NavItem key={item.path} {...item} />
            ))}
            <NavLink
              to="/admin/departments"
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <Settings size={15} strokeWidth={1.8} className="shrink-0" />
              <span>Departments</span>
            </NavLink>
            <NavLink
              to="/admin/archive"
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <FileArchive size={15} strokeWidth={1.8} className="shrink-0" />
              <span>FY Archive</span>
            </NavLink>
          </>

        /* ══ SUPER ADMIN — no active unit ═══════════════════════════ */
        ) : isSuperAdmin ? (
          <>
            <SectionLabel>Super Admin</SectionLabel>
            {superAdminCentralItems.map(item => (
              <NavItem key={item.path} {...item} />
            ))}
          </>

        /* ══ GLOBAL AUDITOR ══════════════════════════════════════════ */
        ) : isGlobalAuditor ? (
          <>
            <SectionLabel>Auditor</SectionLabel>
            {auditorNavItems.map(item => (
              <NavItem key={item.path} {...item} />
            ))}
          </>

        /* ══ REGULAR UNIT USERS ══════════════════════════════════════ */
        ) : (
          <>
            <SectionLabel>Main Menu</SectionLabel>
            {unitNavItems.map(({ label, icon, path, roles }) => {
              if (roles && !hasRole(...roles)) return null;
              return <NavItem key={path} label={label} icon={icon} path={path} />;
            })}
            {isUnitAdmin && (
              <>
                <NavLink
                  to="/admin/departments"
                  className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                >
                  <Settings size={15} strokeWidth={1.8} className="shrink-0" />
                  <span>Departments</span>
                </NavLink>
                <NavLink
                  to="/admin/archive"
                  className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                >
                  <FileArchive size={15} strokeWidth={1.8} className="shrink-0" />
                  <span>FY Archive</span>
                </NavLink>
              </>
            )}
          </>
        )}
      </nav>

      {/* ── User card ────────────────────────────────────────────────── */}
      <div className="px-2 py-2 shrink-0" style={{ borderTop: '1px solid var(--sidebar-border)' }}>
        <div className="flex items-center gap-2.5 px-2 py-2" style={{ borderRadius: 'var(--radius-sm)' }}>
          <button
            onClick={() => navigate('/profile')}
            className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold"
            style={{ background: 'var(--sidebar-active-bg)', color: 'var(--sidebar-active-text)' }}
            title="My Profile"
          >
            {initials}
          </button>

          <button onClick={() => navigate('/profile')} className="flex-1 min-w-0 text-left">
            <p className="text-white text-[12px] font-medium truncate leading-tight">
              {user?.full_name}
            </p>
            <p className="text-[10px] capitalize truncate mt-0.5" style={{ color: 'var(--sidebar-text)' }}>
              {user?.role_type?.replace(/_/g, ' ')}
              {isUnitAdmin && user?.unit_name ? ` · ${user.unit_name}` : ''}
            </p>
          </button>

          <button
            onClick={logout}
            title="Sign out"
            className="p-1 shrink-0 transition-colors duration-150"
            style={{ color: 'var(--sidebar-text)' }}
            onMouseEnter={e => e.currentTarget.style.color = '#ffffff'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--sidebar-text)'}
          >
            <LogOut size={14} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </aside>
  );
}
