// frontend/src/components/Layout/Navbar.jsx
import { Bell, RefreshCw } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import apiClient from '../../api/axios';
import toast from 'react-hot-toast';
import useAuth from '../../hooks/useAuth';

const PAGE_NAMES = {
 '/dashboard': 'Dashboard',
 '/visitors': 'Visitors',
 '/requests': 'Visit Requests',
 '/approvals': 'Approvals',
 '/gate': 'Gate Security',
 '/reports': 'Reports',
 '/admin': 'Admin Panel',
 '/profile': 'My Profile',
};

export default function Navbar() {
 const { user } = useAuth();
 const location = useLocation();
 const navigate = useNavigate();
 const [notifCount, setNotifCount] = useState(0);
  const prevCountRef = useRef(0);

  useEffect(() => {
    if (!user) return;
    const checkInbox = async () => {
      try {
        const res = await apiClient.get('/approvals/inbox');
        const count = res.data?.data?.length || 0;
        if (count > prevCountRef.current) {
          toast.success('You have a new visit request waiting for approval!', { icon: '🔔', duration: 5000 });
        }
        prevCountRef.current = count;
        setNotifCount(count);
      } catch (err) {}
    };
    checkInbox();
    const intervalId = setInterval(checkInbox, 15000);
    return () => clearInterval(intervalId);
  }, [user]);

 // Resolve page title from current path
 const pageTitle =
 Object.entries(PAGE_NAMES).find(([key]) =>
 location.pathname.startsWith(key)
 )?.[1] ?? 'VMS';

 const todayStr = new Date().toLocaleDateString('en-IN', {
 weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
 });

 return (
 <header
 className="fixed top-0 right-0 h-10 flex items-center justify-between px-4 z-20"
 style={{
 left: 'var(--sidebar-width, 220px)',
 background: 'var(--color-bg-primary)',
 borderBottom: '1px solid var(--color-border)',
 }}
 >
 {/* ── Left — Page title ───────────────────────────────────────── */}
 <div className="flex items-center gap-2">
 <h1 className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>
 {pageTitle}
 </h1>
 <span className="text-[11px] hidden sm:block" style={{ color: 'var(--color-text-faint)' }}>
 — {todayStr}
 </span>
 </div>

 {/* ── Right — User + Bell ──────────────────────────────────────── */}
 <div className="flex items-center gap-1.5">
 {/* Notification bell */}
 <button
 className="w-7 h-7 flex items-center justify-center transition-colors relative"
 style={{
 borderRadius: 'var(--radius-sm)',
 color: 'var(--color-text-faint)',
 }}
 title="Approvals Inbox"
  onClick={() => navigate('/approvals')}
 onMouseEnter={e => {
 e.currentTarget.style.background = 'var(--color-surface-hover)';
 e.currentTarget.style.color = 'var(--color-text)';
 }}
 onMouseLeave={e => {
 e.currentTarget.style.background = 'transparent';
 e.currentTarget.style.color = 'var(--color-text-faint)';
 }}
 >
 <Bell size={15} strokeWidth={1.8} />
 {notifCount > 0 && (
  <span
  className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full border border-bg-primary"
  style={{ background: 'var(--color-accent)' }}
  />
  )}
 </button>

 {/* Divider */}
 <div className="w-px h-4 mx-1" style={{ background: 'var(--color-border)' }} />

 {/* User info pill */}
 <button
 onClick={() => navigate('/profile')}
 className="flex items-center gap-1.5 px-2 py-1 cursor-pointer hover:bg-surface-hover transition-colors"
 style={{
 border: '1px solid var(--color-border)',
 borderRadius: 'var(--radius-sm)',
 background: 'var(--color-bg-secondary)',
 }}
 >
 <div
 className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
 style={{
 background: 'rgba(245,158,11,0.15)',
 color: 'var(--color-accent)',
 }}
 >
 {user?.full_name?.charAt(0) ?? '?'}
 </div>
 <span className="text-[12px] font-medium max-w-[100px] truncate hidden sm:block"
 style={{ color: 'var(--color-text)' }}>
 {user?.full_name?.split(' ')[0]}
 </span>
 <span
 className="text-[10px] px-1 py-0.5 rounded hidden sm:block"
 style={{
 background: 'rgba(245,158,11,0.1)',
 color: 'var(--color-accent)',
 borderRadius: '4px',
 }}
 >
 {user?.role_type}
 </span>
 </button>
 </div>
 </header>
 );
}
