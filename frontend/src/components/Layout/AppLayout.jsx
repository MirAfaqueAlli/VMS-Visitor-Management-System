// frontend/src/components/Layout/AppLayout.jsx
// App shell (DESIGN_RULES §5): flat top bar + sidebar on --canvas, and the page on
// a white sheet with a rounded top-left corner. The sidebar collapses to a rail
// (remembered) and folds automatically while any side drawer is open.
import { useState, useCallback, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Navbar from './Navbar';
import NotifyPermissionBar from './NotifyPermissionBar';
import NotificationManager from '../NotificationManager';
import { onDrawerChange, anyDrawerOpen } from '../../lib/drawerBus';

const RAIL_KEY = 'vms_sidebar_rail';
const readRail = () => { try { return localStorage.getItem(RAIL_KEY) === '1'; } catch { return false; } };

export default function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [rail, setRail] = useState(readRail);              // the user's saved choice
  const [drawerOpen, setDrawerOpen] = useState(anyDrawerOpen);
  const { pathname } = useLocation();

  // Auto-fold while a drawer is open — never changes the saved choice
  useEffect(() => onDrawerChange(setDrawerOpen), []);

  const toggleRail = useCallback(() => {
    setRail((r) => {
      try { localStorage.setItem(RAIL_KEY, r ? '0' : '1'); } catch { /* storage blocked */ }
      return !r;
    });
  }, []);

  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const isRail = rail || drawerOpen;

  return (
    <div className="app-shell">
      {/* Invisible push-notification watcher */}
      <NotificationManager />

      <Navbar onMenuToggle={() => setMobileOpen((o) => !o)} />

      <div className={`sidebar-backdrop lg:hidden${mobileOpen ? ' is-open' : ''}`} onClick={closeMobile} aria-hidden="true" />
      <Sidebar rail={isRail} onToggleRail={toggleRail} mobileOpen={mobileOpen} onNavigate={closeMobile} />

      <div className={`sheet-wrap${isRail ? ' is-rail' : ''}`}>
        <main className="sheet">
          <div className="page" key={pathname}>
            <NotifyPermissionBar />
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
