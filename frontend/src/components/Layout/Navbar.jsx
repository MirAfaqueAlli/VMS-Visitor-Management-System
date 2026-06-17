// frontend/src/components/Layout/Navbar.jsx
import { Bell, Check, X, ClipboardList, ChevronRight, Clock, Menu, Sun, Moon, BellOff } from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import apiClient from '../../api/axios';
import toast from 'react-hot-toast';
import useAuth from '../../hooks/useAuth';
import useSocketEvent from '../../hooks/useSocketEvent';
import useTheme from '../../context/ThemeContext';
import useWebNotification from '../../hooks/useWebNotification';


const PAGE_NAMES = {
  '/dashboard':    'Dashboard',
  '/visitors':     'Visitors',
  '/requests':     'Visit Requests',
  '/approvals':    'Approvals',
  '/gate':         'Gate Security',
  '/reports':      'Reports',
  '/admin':        'Admin Panel',
  '/profile':      'My Profile',
  '/super/units':  'Unit Management',
  '/super/users':  'Central User Management',
  '/audit-logs':   'Audit Logs',
  '/departments':  'Department Management',
};

const CATEGORY_LABELS = {
  EMPLOYEE_VISIT:    'Employee Visit',
  VENDOR:            'Vendor',
  SPOT:              'Walk-in',
  PERSONAL_VISIT:    'Personal Visit',
};

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* ── Notification Panel ─────────────────────────────────────────────────── */
function NotificationPanel({ notifications, loading, onAction, onClose, navigate }) {
  const [activeAction, setActiveAction] = useState(null); // { id, mode, remarks }

  const startAction = (id, mode) => setActiveAction({ id, mode, remarks: '' });
  const cancelAction = () => setActiveAction(null);
  const confirmAction = () => {
    if (!activeAction) return;
    if (activeAction.mode === 'reject' && !activeAction.remarks.trim()) return;
    onAction(activeAction.id, activeAction.mode, activeAction.remarks.trim());
    setActiveAction(null);
  };

  return (
    <div
      style={{
        width: 'min(360px, calc(100vw - 16px))',
        maxHeight: '520px',
        background: 'var(--color-bg-primary)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md, 10px)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--color-bg-secondary)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Bell size={14} strokeWidth={1.8} style={{ color: 'var(--color-accent)' }} />
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text)' }}>
            Notifications
          </span>
          {notifications.length > 0 && (
            <span
              style={{
                fontSize: '10px', fontWeight: 700,
                background: 'var(--color-accent)', color: '#fff',
                borderRadius: '999px', padding: '1px 7px',
              }}
            >
              {notifications.length}
            </span>
          )}
        </div>
        <button
          onClick={() => { navigate('/approvals'); onClose(); }}
          style={{ fontSize: '11px', color: 'var(--color-accent)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}
        >
          View All <ChevronRight size={11} />
        </button>
      </div>

      {/* Body */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {loading ? (
          <div style={{ padding: '32px', textAlign: 'center' }}>
            <div
              style={{
                width: '24px', height: '24px', borderRadius: '50%',
                border: '2px solid var(--color-border)',
                borderTopColor: 'var(--color-accent)',
                animation: 'spin 0.8s linear infinite',
                margin: '0 auto 8px',
              }}
            />
            <p style={{ fontSize: '12px', color: 'var(--color-text-faint)' }}>Loading…</p>
          </div>
        ) : notifications.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center' }}>
            <div
              style={{
                width: '36px', height: '36px', borderRadius: '8px',
                background: 'var(--color-bg-secondary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 12px',
              }}
            >
              <Bell size={16} strokeWidth={1.5} style={{ color: 'var(--color-text-faint)' }} />
            </div>
            <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '4px' }}>
              All caught up!
            </p>
            <p style={{ fontSize: '12px', color: 'var(--color-text-faint)' }}>
              No pending approvals right now.
            </p>
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {notifications.map((n, i) => {
              const nid = n.visit_request_id ?? n.id;
              const isActive = activeAction?.id === nid;
              return (
                <li
                  key={nid ?? i}
                  style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--color-border)',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--color-surface-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  {/* Row 1: Icon + title */}
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                    <div
                      style={{
                        width: '32px', height: '32px', borderRadius: '8px', flexShrink: 0,
                        background: 'rgba(59,130,246,0.12)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <ClipboardList size={14} strokeWidth={1.8} style={{ color: 'var(--color-accent)' }} />
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '2px', lineHeight: 1.3 }}>
                        Approval Request
                      </p>
                      <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', lineHeight: 1.4, marginBottom: '4px' }}>
                        <strong>{n.visitor_name ?? 'Visitor'}</strong>
                        {n.company_name ? ` · ${n.company_name}` : ''}
                      </p>
                      <p style={{ fontSize: '11px', color: 'var(--color-text-faint)' }}>
                        {CATEGORY_LABELS[n.visit_category] ?? n.visit_category}
                        {n.visit_date ? ` · ${fmtDate(n.visit_date)}` : ''}
                        {n.visit_start_time ? ` at ${n.visit_start_time}` : ''}
                      </p>

                      {/* Inline approve / reject */}
                      {isActive ? (
                        <div style={{ marginTop: '8px' }}>
                          <textarea
                            rows={2}
                            autoFocus
                            placeholder={activeAction.mode === 'approve' ? 'Remarks (optional)…' : 'Reason (required)…'}
                            value={activeAction.remarks}
                            onChange={e => setActiveAction(a => ({ ...a, remarks: e.target.value }))}
                            style={{
                              width: '100%', fontSize: '11px', padding: '6px 8px',
                              borderRadius: '6px', resize: 'none',
                              border: '1px solid var(--color-border)',
                              background: 'var(--color-bg-secondary)',
                              color: 'var(--color-text)',
                              marginBottom: '6px',
                            }}
                          />
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              onClick={confirmAction}
                              style={{
                                fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
                                padding: '4px 10px', borderRadius: '6px', cursor: 'pointer', border: 'none',
                                background: activeAction.mode === 'approve' ? 'var(--color-accent)' : '#ef4444',
                                color: '#fff',
                              }}
                            >
                              {activeAction.mode === 'approve' ? '✓ Confirm' : '✗ Confirm'}
                            </button>
                            <button
                              onClick={cancelAction}
                              style={{
                                fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
                                padding: '4px 10px', borderRadius: '6px', cursor: 'pointer',
                                background: 'var(--color-bg-secondary)',
                                border: '1px solid var(--color-border)',
                                color: 'var(--color-text-muted)',
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                          <button
                            onClick={() => startAction(nid, 'approve')}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '4px',
                              fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                              padding: '4px 10px', borderRadius: '6px', cursor: 'pointer', border: 'none',
                              background: 'var(--color-accent)', color: '#fff',
                              transition: 'opacity 0.15s',
                            }}
                            onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                          >
                            <Check size={10} strokeWidth={2.5} /> Approve
                          </button>
                          <button
                            onClick={() => startAction(nid, 'reject')}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '4px',
                              fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                              padding: '4px 10px', borderRadius: '6px', cursor: 'pointer',
                              background: 'var(--color-bg-secondary)',
                              border: '1px solid var(--color-border)',
                              color: 'var(--color-text-muted)',
                              transition: 'border-color 0.15s, color 0.15s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = '#ef4444'; e.currentTarget.style.color = '#ef4444'; }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}
                          >
                            <X size={10} strokeWidth={2.5} /> Reject
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Time */}
                    <span style={{ fontSize: '10px', color: 'var(--color-text-faint)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <Clock size={9} />
                      {n.assigned_at
                        ? new Date(n.assigned_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
                        : ''}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Footer */}
      {notifications.length > 0 && (
        <div
          style={{
            padding: '10px 16px',
            borderTop: '1px solid var(--color-border)',
            background: 'var(--color-bg-secondary)',
            textAlign: 'center',
          }}
        >
          <button
            onClick={() => { navigate('/approvals'); onClose(); }}
            style={{
              fontSize: '12px', fontWeight: 600, color: 'var(--color-accent)',
              background: 'none', border: 'none', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: '4px',
            }}
          >
            Open full Approvals page <ChevronRight size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Navbar ──────────────────────────────────────────────────────────────── */
export default function Navbar({ onMenuToggle, onBannerChange }) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [notifCount,     setNotifCount]     = useState(0);
  const [notifications,  setNotifications]  = useState([]);
  const [panelOpen,      setPanelOpen]      = useState(false);
  const [panelLoading,   setPanelLoading]   = useState(false);

  const prevCountRef  = useRef(0);
  const bellRef       = useRef(null);
  const panelRef      = useRef(null);

  /* ── Fetch inbox ─────────────────────────────────────────────────────── */
  const fetchInbox = useCallback(async (showLoading = false) => {
    if (!user) return;
    const allowedRoles = ['unit_admin', 'employee'];
    const userRole = user.role_type || user.role;
    if (!allowedRoles.includes(userRole)) return;

    if (showLoading) setPanelLoading(true);
    try {
      const res   = await apiClient.get('/approvals/inbox');
      const items = res.data?.data ?? [];
      if (items.length > prevCountRef.current) {
        toast.success('New visit request waiting for your approval!', { icon: '🔔', duration: 5000 });
      }
      prevCountRef.current = items.length;
      setNotifCount(items.length);
      setNotifications(items);
    } catch { /* silent */ }
    finally { if (showLoading) setPanelLoading(false); }
  }, [user]);

  /* Initial load only — socket keeps it live after that */
  useEffect(() => {
    fetchInbox();
  }, [fetchInbox]);

  /* Socket: instantly push new request into bell without polling */
  useSocketEvent('visit:request:new', (data) => {
    setNotifications(prev => {
      if (prev.some(n => (n.visit_request_id ?? n.id) === data.visit_request_id)) return prev;
      return [{ ...data, assigned_at: data.created_at }, ...prev];
    });
    setNotifCount(prev => prev + 1);
    toast.success(`New visit request from ${data.visitor_name || 'a visitor'}!`, {
      icon: '🔔',
      duration: 6000,
    });
  }, []);

  /* Socket: meeting conflict alert — host is already in a meeting when a new visitor checks in */
  useSocketEvent('visit:conflict:meeting', (data) => {
    const msg = `⚠️ CONFLICT: ${data.host_name || 'Host'} is already in a meeting with "${data.conflicting_visitor_name}" — "${data.new_visitor_name}" just checked in!`;
    toast.error(msg, {
      duration: 12000,
      style: {
        maxWidth: '420px',
        fontWeight: 600,
        fontSize: '13px',
        background: '#7f1d1d',
        color: '#fef2f2',
        border: '1px solid #dc2626',
        borderRadius: '10px',
        padding: '14px 16px',
      },
      icon: '🚨',
    });
  }, []);


  /* ── Close on outside click / Escape ─────────────────────────────────── */
  useEffect(() => {
    if (!panelOpen) return;
    const handleKey = (e) => { if (e.key === 'Escape') setPanelOpen(false); };
    const handleClick = (e) => {
      if (
        panelRef.current  && !panelRef.current.contains(e.target) &&
        bellRef.current   && !bellRef.current.contains(e.target)
      ) {
        setPanelOpen(false);
      }
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [panelOpen]);

  /* ── Action handler (called by NotificationPanel) ──────────────────────── */
  const handleAction = async (id, mode, remarks) => {
    try {
      if (mode === 'approve') {
        await apiClient.put(`/approvals/${id}/approve`, { remarks });
        toast.success('Request approved.');
      } else {
        await apiClient.put(`/approvals/${id}/reject`, { remarks });
        toast.success('Request rejected.');
      }
      fetchInbox(false);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed.');
    }
  };

  /* ── Toggle panel ─────────────────────────────────────────────────────── */
  const togglePanel = () => {
    const next = !panelOpen;
    setPanelOpen(next);
    if (next) fetchInbox(true);
  };

  /* ── Page title ───────────────────────────────────────────────────────── */
  const pageTitle =
    Object.entries(PAGE_NAMES).find(([key]) => location.pathname.startsWith(key))?.[1] ?? 'VMS';

  const todayStr = new Date().toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });

  const { theme, toggleTheme } = useTheme();
  const { permission, requestPermission } = useWebNotification();

  // KEY: 'vms-notif-granted' is set permanently when user grants.
  // Nothing is stored on dismiss — so the banner comes back on every login
  // until the user explicitly enables it.
  const alreadyGranted = localStorage.getItem('vms-notif-granted') === '1';

  // Show banner if:
  //  - browser permission is not yet granted (either 'default' or 'denied')
  //  - AND user hasn't ever clicked Enable successfully
  // Use session-only state for dismiss (no localStorage write on X click)
  const [sessionDismissed, setSessionDismissed] = useState(false);
  const showBanner = !alreadyGranted && permission !== 'granted' && !sessionDismissed;

  const handleEnableNotifications = async () => {
    const result = await requestPermission();
    if (result === 'granted') {
      localStorage.setItem('vms-notif-granted', '1'); // permanent — survives logout
      toast.success('Desktop notifications enabled!', { icon: '🔔' });
    }
    setSessionDismissed(true); // hide for this session regardless
    onBannerChange?.(false);
  };

  const handleDismissBanner = () => {
    // Only hides for this login session — no localStorage write
    // so it reappears after logout → login
    setSessionDismissed(true);
    onBannerChange?.(false);
  };

  // Keep AppLayout in sync with banner visibility
  useEffect(() => { onBannerChange?.(showBanner); }, [showBanner, onBannerChange]);

  /* ── Render ───────────────────────────────────────────────────────────── */
  return (
    <>
      <header
        className="fixed top-0 right-0 h-10 flex items-center justify-between px-4 z-30 navbar-header"
        style={{
          background: 'var(--color-bg-primary)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
      {/* ── Left: hamburger (mobile) + page title ─────────────────────── */}
      <div className="flex items-center gap-2">
        {/* Hamburger — hidden on large screens */}
        <button
          onClick={onMenuToggle}
          className="lg:hidden w-7 h-7 flex items-center justify-center transition-colors"
          style={{
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-faint)',
          }}
          aria-label="Open menu"
        >
          <Menu size={17} strokeWidth={1.8} />
        </button>
        <h1 className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>
          {pageTitle}
        </h1>
        <span className="text-[11px] hidden sm:block" style={{ color: 'var(--color-text-faint)' }}>
          — {todayStr}
        </span>
      </div>

      {/* ── Centre: OHPC branding ─────────────────────────────────────── */}
      <div
        className="absolute left-1/2 -translate-x-1/2 hidden md:flex flex-col items-center pointer-events-none select-none"
        style={{ lineHeight: 1 }}
      >
        <span
          className="text-[11px] font-black uppercase tracking-[0.22em]"
          style={{ color: 'var(--color-accent)', letterSpacing: '0.22em' }}
        >
          OHPC · VMS
        </span>
        <span
          className="text-[9.5px] font-medium tracking-[0.06em] mt-0.5"
          style={{ color: 'var(--color-text-faint)' }}
        >
          Odisha Hydro Power Corporation — Visitor Management
        </span>
      </div>

      {/* ── Right: theme toggle + bell + user pill ───────────────────────── */}
      <div className="flex items-center gap-1.5">

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="w-7 h-7 flex items-center justify-center transition-colors"
          style={{
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-faint)',
            background: 'transparent',
          }}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-surface-hover)'; e.currentTarget.style.color = 'var(--color-text)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-faint)'; }}
        >
          {theme === 'dark'
            ? <Sun size={15} strokeWidth={1.8} />
            : <Moon size={15} strokeWidth={1.8} />}
        </button>

        {/* Bell button + dropdown wrapper — position:relative so the panel stays within viewport */}
        <div style={{ position: 'relative' }}>
          <button
            ref={bellRef}
            onClick={togglePanel}
            className="w-7 h-7 flex items-center justify-center transition-colors relative"
            style={{
              borderRadius: 'var(--radius-sm)',
              color: panelOpen ? 'var(--color-text)' : 'var(--color-text-faint)',
              background: panelOpen ? 'var(--color-surface-hover)' : 'transparent',
            }}
            title="Notifications"
            onMouseEnter={e => { if (!panelOpen) { e.currentTarget.style.background = 'var(--color-surface-hover)'; e.currentTarget.style.color = 'var(--color-text)'; }}}
            onMouseLeave={e => { if (!panelOpen) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-faint)'; }}}
          >
            <Bell size={15} strokeWidth={1.8} />
            {notifCount > 0 && (
              <span
                className="absolute top-0.5 right-0.5 flex items-center justify-center rounded-full border border-bg-primary"
                style={{
                  width: notifCount > 9 ? '15px' : '13px',
                  height: '13px',
                  background: 'var(--color-accent)',
                  fontSize: '8px',
                  fontWeight: 800,
                  color: '#fff',
                  lineHeight: 1,
                }}
              >
                {notifCount > 99 ? '99+' : notifCount}
              </span>
            )}
          </button>

        {/* Notification panel — position relative here so right:0 anchors to this div's right edge */}
          {panelOpen && (
            <div ref={panelRef} data-notif-panel style={{ position: 'absolute', top: '100%', right: 0, zIndex: 9999, marginTop: '8px' }}>
              <NotificationPanel
                notifications={notifications}
                loading={panelLoading}
                onAction={handleAction}
                onClose={() => setPanelOpen(false)}
                navigate={navigate}
              />
            </div>
          )}
        </div>

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
              background: 'rgba(59,130,246,0.15)',
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
              background: 'rgba(59,130,246,0.1)',
              color: 'var(--color-accent)',
              borderRadius: '4px',
            }}
          >
          {user?.role_type}
          </span>
        </button>
      </div>
    </header>

    {/* ── Notification permission banner ──────────────────────────────── */}
    {showBanner && (
      <div
        className="fixed z-20 flex items-center gap-3 px-4 py-2 animate-fade-in navbar-header"
        style={{
          top: '40px',
          right: 0,
          background: 'var(--color-warning-bg)',
          borderBottom: '1px solid var(--color-accent)',
          fontSize: '12px',
          pointerEvents: 'none',       /* ← clicks pass through to page content beneath */
        }}
      >
        <BellOff size={13} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
        <span style={{ color: 'var(--color-text-muted)', flex: 1 }}>
          Enable <strong style={{ color: 'var(--color-text)' }}>desktop notifications</strong> to get alerts even when this tab is minimised.
        </span>
        <button
          onClick={handleEnableNotifications}
          className="btn-primary"
          style={{ fontSize: '11px', padding: '3px 10px', pointerEvents: 'auto' }}
        >
          Enable
        </button>
        <button
          onClick={handleDismissBanner}
          className="btn-secondary"
          style={{ fontSize: '11px', padding: '3px 8px', pointerEvents: 'auto' }}
          title="Dismiss"
        >
          <X size={11} />
        </button>
      </div>
    )}
    </>
  );
}
