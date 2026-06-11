// frontend/src/components/Layout/AppLayout.jsx
import { useState, useCallback, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Navbar from './Navbar';
import NotificationManager from '../NotificationManager';

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [bannerVisible, setBannerVisible] = useState(false);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const toggleSidebar = useCallback(() => setSidebarOpen(o => !o), []);

  // Lock body scroll when mobile sidebar is open
  useEffect(() => {
    if (sidebarOpen) {
      document.body.classList.add('sidebar-overlay-open');
    } else {
      document.body.classList.remove('sidebar-overlay-open');
    }
    return () => document.body.classList.remove('sidebar-overlay-open');
  }, [sidebarOpen]);

  // Close sidebar on desktop resize (avoids stuck-open state)
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 1024) setSidebarOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-bg-primary)' }}>
      {/* Invisible push-notification watcher */}
      <NotificationManager />

      {/* Mobile backdrop — tapping it closes the sidebar */}
      <div
        className={`fixed inset-0 z-20 lg:hidden transition-opacity duration-250 ${
          sidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        style={{ background: 'rgba(0,0,0,0.5)' }}
        onClick={closeSidebar}
        aria-hidden="true"
      />

      <Sidebar isOpen={sidebarOpen} onClose={closeSidebar} />

      {/*
        On desktop (lg+): offset by sidebar width via inline style.
        On mobile: CSS rule makes margin-left: 0 override the inline style.
      */}
      <div
        className="main-content-area"
        style={{ marginLeft: 'var(--sidebar-width, 220px)' }}
      >
        <Navbar onMenuToggle={toggleSidebar} onBannerChange={setBannerVisible} />
        {/* pt-14 = navbar (40px). Extra space when banner is visible to avoid overlap. */}
        <main className={`${bannerVisible ? 'pt-20' : 'pt-14'} px-4 sm:px-5 pb-8 min-h-screen transition-[padding] duration-200`}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
