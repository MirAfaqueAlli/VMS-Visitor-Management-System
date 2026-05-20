// frontend/src/components/Layout/Sidebar.jsx
import { NavLink, useNavigate } from 'react-router-dom';
import {
 LayoutDashboard, Users, ClipboardList, CheckSquare,
 Shield, BarChart3, Settings, LogOut,
} from 'lucide-react';
import useAuth from '../../hooks/useAuth';

const navItems = [
  { label: 'Dashboard',     icon: LayoutDashboard, path: '/dashboard', roles: null },
  {
    label: 'Visitors',
    icon: Users,
    path: '/visitors',
    roles: ['org_admin', 'dept_admin', 'employee', 'receptionist', 'security'],
  },
  {
    label: 'Visit Requests',
    icon: ClipboardList,
    path: '/requests',
    roles: ['org_admin', 'dept_admin', 'employee', 'receptionist', 'security'],
  },
  {
    label: 'Approvals',
    icon: CheckSquare,
    path: '/approvals',
    roles: ['org_admin', 'dept_admin', 'employee'],
  },
  {
    label: 'Gate Security',
    icon: Shield,
    path: '/gate',
    roles: ['security', 'receptionist', 'org_admin', 'dept_admin'],
  },
  {
    label: 'Reports',
    icon: BarChart3,
    path: '/reports',
    roles: ['org_admin', 'dept_admin'],
  },
  {
    label: 'User Management',
    icon: Settings,
    path: '/admin',
    roles: ['org_admin', 'dept_admin'],
  },
];

export default function Sidebar() {
  const { user, hasRole, logout, isOrgAdmin, isDeptAdmin } = useAuth();
  const navigate = useNavigate();

 const initials = user?.full_name
 ?.split(' ')
 .map((n) => n[0])
 .join('')
 .toUpperCase()
 .slice(0, 2) ?? '?';

 return (
 <aside
 className="fixed left-0 top-0 h-screen flex flex-col z-30"
 style={{
 width: 'var(--sidebar-width, 220px)',
 background: 'var(--sidebar-bg)',
 borderRight: '1px solid var(--sidebar-border)',
 }}
 >
  {/* ── Logo ────────────────────────────────────────────────────── */}
  <div className="px-4 h-16 pt-6 flex items-center gap-2.5 shrink-0"
    style={{ borderBottom: '1px solid var(--sidebar-border)' }}>
    <div
      className="w-6 h-6 rounded flex items-center justify-center shrink-0"
      style={{ background: 'var(--sidebar-active-bg)' }}
    >
      <Shield size={13} style={{ color: 'var(--sidebar-active-text)' }} strokeWidth={2.2} />
    </div>
    <div>
      <p className="text-white font-semibold text-[13px] leading-none tracking-tight">VMS</p>
      <p className="text-[10px] mt-0.5" style={{ color: 'var(--sidebar-text)' }}>
        {user?.organization_name || 'Visitor Management'}
      </p>
    </div>
  </div>

  {/* ── Navigation ──────────────────────────────────────────────── */}
  <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
    <p
      className="text-[10px] font-semibold uppercase tracking-widest px-2 pb-1.5 pt-1"
      style={{ color: 'var(--sidebar-text)', opacity: 0.5 }}
    >
      Main Menu
    </p>
    {navItems.map(({ label, icon: Icon, path, roles }) => {
      if (roles && !hasRole(...roles)) return null;
      return (
        <NavLink
          key={path}
          to={path}
          className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
        >
          <Icon size={15} strokeWidth={1.8} className="shrink-0" />
          <span>{label}</span>
        </NavLink>
      );
    })}
    {/* Departments — org_admin only */}
    {isOrgAdmin && (
      <NavLink
        to="/admin/departments"
        className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
      >
        <Settings size={15} strokeWidth={1.8} className="shrink-0" />
        <span>Departments</span>
      </NavLink>
    )}
  </nav>

 {/* ── User card ────────────────────────────────────────────────── */}
 <div className="px-2 py-2 shrink-0"
 style={{ borderTop: '1px solid var(--sidebar-border)' }}>
 <div className="flex items-center gap-2.5 px-2 py-2 rounded"
 style={{ borderRadius: 'var(--radius-sm)' }}>
 {/* Avatar */}
 <button
 onClick={() => navigate('/profile')}
 className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold"
 style={{ background: 'var(--sidebar-active-bg)', color: 'var(--sidebar-active-text)' }}
 title="My Profile"
 >
 {initials}
 </button>

    {/* Name + role + dept */}
    <button onClick={() => navigate('/profile')} className="flex-1 min-w-0 text-left">
      <p className="text-white text-[12px] font-medium truncate leading-tight">
        {user?.full_name}
      </p>
      <p className="text-[10px] capitalize truncate mt-0.5"
        style={{ color: 'var(--sidebar-text)' }}>
        {user?.role_type?.replace(/_/g, ' ')}
        {isDeptAdmin && user?.department_name ? ` · ${user.department_name}` : ''}
      </p>
    </button>

 {/* Logout */}
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
