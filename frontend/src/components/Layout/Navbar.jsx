// frontend/src/components/Layout/Navbar.jsx
// Top bar (DESIGN_RULES §5): one flat --canvas colour. Left to right: ☰ (mobile),
// logo tile, app name + the user's scope, space, quick search, theme, notifications,
// user button (name + role + initials) with its menu.
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../../api/axios';
import toast from 'react-hot-toast';
import useAuth from '../../hooks/useAuth';
import useSocketEvent from '../../hooks/useSocketEvent';
import useTheme from '../../context/ThemeContext';
import { initials as toInitials, fmtDate, fmtTime, relTime } from '../../lib/format';
import {
  Bell, Check, X, ChevronRight, ChevronDown, Menu, Sun, Moon, Search, User, LogOut, QrCode, CheckCircle,
  ClipboardList,
} from '../icons';

// Roles that have an approvals inbox (same as the /approvals route guard in App.jsx)
const APPROVER_ROLES = ['unit_admin', 'employee'];
// Central users live outside the unit DBs, so they have no unit notifications
const CENTRAL_ROLES  = ['super_admin', 'global_auditor'];
// Roles that can open Visit Requests (quick search target)
const REQUEST_ROLES  = ['unit_admin', 'employee', 'receptionist', 'security'];

const CATEGORY_LABELS = {
  EMPLOYEE_VISIT: 'Employee visit',
  VENDOR:         'Vendor',
  SPOT:           'Walk-in',
  PERSONAL_VISIT: 'Personal visit',
};

const ROLE_LABELS = {
  super_admin: 'Super admin', global_auditor: 'Global auditor', unit_admin: 'Unit admin',
  unit_auditor: 'Unit auditor', employee: 'Employee', security: 'Security', receptionist: 'Receptionist',
};

/* ── Notification panel (popover card) ──────────────────────────────────── */
function NotificationPanel({ notifications, loading, onAction, onClose, navigate, canApprove }) {
  const [activeAction, setActiveAction] = useState(null); // { id, mode, remarks }

  const confirmAction = () => {
    if (!activeAction) return;
    if (activeAction.mode === 'reject' && !activeAction.remarks.trim()) return;
    onAction(activeAction.id, activeAction.mode, activeAction.remarks.trim());
    setActiveAction(null);
  };
  const go = (to) => { navigate(to); onClose(); };

  return (
    <div className="card flex flex-col overflow-hidden" style={{ width: 'min(360px, calc(100vw - 16px))', maxHeight: 520 }}>
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-line">
        <span className="text-[13px] font-semibold">Notifications</span>
        {notifications.length > 0 && <span className="text-[11.5px] text-muted tabular">{notifications.length}</span>}
        {canApprove && (
          <button type="button" className="btn-link ml-auto text-[12px]" onClick={() => go('/approvals')}>
            Open approvals
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="px-4 py-8 text-center text-[12px] text-muted">Loading…</p>
        ) : notifications.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-[13px] font-semibold">You’re all caught up</p>
            <p className="mt-1 text-[12px] text-muted">New approval requests and visit updates appear here.</p>
          </div>
        ) : (
          <ul>
            {notifications.map((n, i) => {
              const nid = n.visit_request_id ?? n.id;
              const acting = activeAction?.id === nid;
              const Icon = n.is_informational ? CheckCircle : ClipboardList;
              return (
                <li key={nid ?? i} className="px-3.5 py-3 border-b border-line last:border-b-0 hover:bg-surface-alt">
                  <div className="flex gap-2.5 items-start">
                    <span className={`head-chip ${n.is_informational ? 'tone-success' : ''}`}><Icon size={14} duo /></span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <p className="text-[12.5px] font-semibold flex-1 min-w-0 truncate">
                          {n.is_hosted ? 'Hosted visit' : n.is_informational ? (n.title || 'Visit update') : 'Approval request'}
                        </p>
                        <span className="text-[11px] text-muted shrink-0">{relTime(n.assigned_at)}</span>
                      </div>
                      <p className="text-[12px] text-ink-2 mt-0.5">
                        {n.is_hosted ? <>Hosted by <b>{n.visitor_name}</b></> : <><b>{n.visitor_name ?? 'Visitor'}</b>{n.company_name ? ` · ${n.company_name}` : ''}</>}
                      </p>
                      {n.message && n.is_informational && <p className="text-[12px] text-ink-2 mt-0.5">{n.message}</p>}
                      <p className="text-[11px] text-muted mt-0.5">
                        {CATEGORY_LABELS[n.visit_category] ?? n.visit_category}
                        {n.visit_date ? ` · ${fmtDate(n.visit_date)}` : ''}
                        {n.visit_start_time ? ` · ${fmtTime(n.visit_start_time)}` : ''}
                        {n.pass_number && <> · <span className="mono text-ink">{n.pass_number}</span></>}
                      </p>

                      {n.is_informational ? (
                        (n.pass_number || n.visit_request_id) && (
                          <div className="mt-2">
                            {n.pass_number ? (
                              <button type="button" className="btn-outline btn-sm"
                                onClick={() => go(`/passes/pass/${n.pass_number}${n.cross_unit_id ? `?unit_id=${n.cross_unit_id}` : ''}`)}>
                                <QrCode size={13} /> Open gate pass
                              </button>
                            ) : (
                              <button type="button" className="btn-outline btn-sm"
                                onClick={() => go(`/requests/${n.visit_request_id}${n.cross_unit_id ? `?unit_id=${n.cross_unit_id}` : ''}`)}>
                                Open request <ChevronRight size={12} />
                              </button>
                            )}
                          </div>
                        )
                      ) : acting ? (
                        <div className="mt-2">
                          <textarea
                            rows={2}
                            autoFocus
                            className="control"
                            placeholder={activeAction.mode === 'approve' ? 'Remarks (optional)' : 'Reason for rejecting (required)'}
                            value={activeAction.remarks}
                            onChange={(e) => setActiveAction((a) => ({ ...a, remarks: e.target.value }))}
                          />
                          <div className="flex justify-end gap-1.5 mt-1.5">
                            <button type="button" className="btn-outline btn-sm" onClick={() => setActiveAction(null)}>Cancel</button>
                            <button
                              type="button"
                              className={activeAction.mode === 'approve' ? 'btn-primary btn-sm' : 'btn-danger btn-sm'}
                              onClick={confirmAction}
                              disabled={activeAction.mode === 'reject' && !activeAction.remarks.trim()}
                              title={activeAction.mode === 'reject' && !activeAction.remarks.trim() ? 'Enter a reason first' : undefined}
                            >
                              {activeAction.mode === 'approve' ? 'Approve request' : 'Reject request'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-1.5 mt-2">
                          <button type="button" className="btn-danger btn-sm" onClick={() => setActiveAction({ id: nid, mode: 'reject', remarks: '' })}>
                            <X size={12} /> Reject
                          </button>
                          <button type="button" className="btn-primary btn-sm" onClick={() => setActiveAction({ id: nid, mode: 'approve', remarks: '' })}>
                            <Check size={12} /> Approve
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ── Top bar ─────────────────────────────────────────────────────────────── */
export default function Navbar({ onMenuToggle }) {
  const { user, logout, isSuperAdmin, activeUnit } = useAuth();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();

  const [notifCount,    setNotifCount]    = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [panelOpen,     setPanelOpen]     = useState(false);
  const [panelLoading,  setPanelLoading]  = useState(false);
  const [menuOpen,      setMenuOpen]      = useState(false);
  const [query,         setQuery]         = useState('');

  const role       = user?.role_type || user?.role;
  const canApprove = APPROVER_ROLES.includes(role);
  const hasBell    = !CENTRAL_ROLES.includes(role);   // central users have no unit notifications
  const canSearch  = REQUEST_ROLES.includes(role) || (isSuperAdmin && !!activeUnit);

  const scope = isSuperAdmin
    ? (activeUnit ? `Managing ${activeUnit.name}` : 'Central')
    : (user?.unit_name || user?.organization_name || 'Visitor Management');

  // Informational notifications have no read flag in the DB, so the badge counts
  // only those newer than the last time this user opened the panel
  const seenKey  = `vms_notif_seen_${user?.unit_db}_${user?.id}`;
  const markSeen = () => { try { localStorage.setItem(seenKey, String(Date.now())); } catch { /* storage blocked */ } };

  const prevCountRef = useRef(0);
  const bellRef      = useRef(null);
  const panelRef     = useRef(null);
  const menuRef      = useRef(null);

  /* ── Fetch inbox & notifications ─────────────────────────────────────── */
  const fetchInbox = useCallback(async (showLoading = false) => {
    if (!hasBell) return;
    if (showLoading) setPanelLoading(true);
    try {
      const promises = [apiClient.get('/approvals/notifications').catch(() => ({ data: { data: [] } }))];
      if (canApprove) {
        promises.push(apiClient.get('/approvals/inbox').catch(() => ({ data: { data: { items: [] } } })));
      }
      const results = await Promise.allSettled(promises);
      let notifList = [];
      let inboxList = [];

      if (results[0].status === 'fulfilled') {
        const rawNotifs = results[0].value.data?.data ?? [];
        notifList = rawNotifs.map((n) => ({
          id: `notif-${n.id}`,
          visit_request_id: n.visit_request_id,
          is_hosted: n.message?.toLowerCase().includes('hosted you'),
          is_informational: true,
          action: 'APPROVED',
          title: n.message?.toLowerCase().includes('hosted you') ? 'Hosted as visitor' : 'Visit update',
          visitor_name: n.subject || (n.message?.toLowerCase().includes('hosted you') ? 'Host' : 'VMS'),
          visit_category: n.visit_category || 'EMPLOYEE_VISIT',
          visit_date: n.visit_date,
          visit_start_time: n.visit_start_time,
          pass_number: n.pass_number,
          message: n.message,
          assigned_at: n.created_at,
        }));
      }

      if (canApprove && results[1]?.status === 'fulfilled') {
        inboxList = results[1].value.data?.data?.items ?? results[1].value.data?.data ?? [];
        if (inboxList.length > prevCountRef.current) {
          toast.success('A visit request is waiting for your approval.', { duration: 5000 });
        }
        prevCountRef.current = inboxList.length;
      }

      let seenAt = 0;
      try { seenAt = Number(localStorage.getItem(seenKey)) || 0; } catch { /* storage blocked */ }
      const unseen = notifList.filter((n) => new Date(n.assigned_at).getTime() > seenAt).length;

      setNotifCount(inboxList.length + unseen);
      setNotifications([...inboxList, ...notifList]);
    } catch { /* silent */ }
    finally { if (showLoading) setPanelLoading(false); }
  }, [canApprove, hasBell, seenKey]);

  /* Initial load only — socket keeps it live after that */
  useEffect(() => { fetchInbox(); }, [fetchInbox]);

  /* Socket: a new request for me */
  useSocketEvent('visit:request:new', (data) => {
    setNotifications((prev) => {
      if (prev.some((n) => (n.visit_request_id ?? n.id) === data.visit_request_id)) return prev;
      return [{ ...data, assigned_at: data.created_at }, ...prev];
    });
    setNotifCount((prev) => prev + 1);
    toast.success(`New visit request from ${data.visitor_name || 'a visitor'}.`, { duration: 6000 });
  }, []);

  /* Socket: my request was approved, or I was hosted */
  useSocketEvent('visit:approved', (data) => {
    const by   = data.approved_by || data.host_name ? ` by ${data.approved_by || data.host_name}` : '';
    const date = data.visit_date  ? ` on ${data.visit_date}` : '';
    const pass = data.pass_number ? ` — gate pass ${data.pass_number}` : '';
    const msg  = data.is_hosted
      ? `${data.approved_by || data.host_name || 'A colleague'} hosted you as a visitor${date}${pass}`
      : `Your visit request${date} was approved${by}${pass}`;

    toast.success(msg, { duration: 10000, id: `approved-${data.visit_request_id || Date.now()}` });

    setNotifications((prev) => {
      const nid = data.visit_request_id ?? Date.now();
      if (prev.some((n) => (n.visit_request_id ?? n.id) === nid)) return prev;
      return [{
        id: `socket-${nid}`,
        visit_request_id: data.visit_request_id,
        is_hosted: data.is_hosted,
        is_informational: true,
        action: 'APPROVED',
        title: data.is_hosted ? 'Hosted as visitor' : 'Visit approved',
        visitor_name: data.host_name || data.approved_by || 'Host',
        visit_category: data.visit_category || 'EMPLOYEE_VISIT',
        visit_date: data.visit_date,
        visit_start_time: data.visit_start_time,
        pass_number: data.pass_number,
        cross_unit_id: data.cross_unit_id ?? null,   // request lives in another unit's DB
        message: data.message || msg,
        assigned_at: new Date().toISOString(),
      }, ...prev];
    });
    setNotifCount((prev) => prev + 1);
  }, []);

  /* Socket: my request was rejected */
  useSocketEvent('visit:rejected', (data) => {
    const by     = data.rejected_by ? ` by ${data.rejected_by}` : '';
    const reason = data.remarks ? ` — reason: “${data.remarks}”` : '';
    toast.error(`Your visit request was declined${by}${reason}`, { duration: 12000, id: `rejected-${data.visit_request_id}` });
  }, []);

  /* Socket: decided elsewhere (an admin, another tab), a visitor came / left, a visit was
     cancelled — resync the bell from the server */
  useSocketEvent('visit:actioned', () => { fetchInbox(); }, [fetchInbox]);
  useSocketEvent('visit:checkin', () => { fetchInbox(); }, [fetchInbox]);
  useSocketEvent('visit:checkout', () => { fetchInbox(); }, [fetchInbox]);
  useSocketEvent('visit:cancelled', () => { fetchInbox(); }, [fetchInbox]);

  /* Socket: the host already has a visitor with them */
  useSocketEvent('visit:conflict:meeting', (data) => {
    toast.error(
      `Schedule conflict: ${data.host_name || 'the host'} is already meeting ${data.conflicting_visitor_name} — ${data.new_visitor_name} has just checked in.`,
      { duration: 12000 },
    );
  }, []);

  /* ── Close popovers on outside click / Escape ────────────────────────── */
  useEffect(() => {
    if (!panelOpen && !menuOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { setPanelOpen(false); setMenuOpen(false); } };
    const onDown = (e) => {
      if (panelOpen && !panelRef.current?.contains(e.target) && !bellRef.current?.contains(e.target)) setPanelOpen(false);
      if (menuOpen && !menuRef.current?.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [panelOpen, menuOpen]);

  /* ── Approve / reject from the panel ─────────────────────────────────── */
  const handleAction = async (id, mode, remarks) => {
    try {
      if (mode === 'approve') {
        await apiClient.put(`/approvals/${id}/approve`, { remarks });
        toast.success('Request approved — the gate pass has been sent to the visitor.');
      } else {
        await apiClient.put(`/approvals/${id}/reject`, { remarks });
        toast.success('Request rejected — the visitor has been told.');
      }
      fetchInbox(false);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not update the request.');
    }
  };

  const togglePanel = () => {
    const next = !panelOpen;
    setPanelOpen(next);
    setMenuOpen(false);
    if (next) { markSeen(); fetchInbox(true); }
  };

  const submitSearch = (e) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    navigate(`/requests?search=${encodeURIComponent(q)}`);
    setQuery('');
  };

  return (
    <header className="topbar">
      <button type="button" className="btn-icon lg:hidden" onClick={onMenuToggle} aria-label="Open menu" title="Menu">
        <Menu size={18} />
      </button>

      {/* Logo + app name + scope */}
      <button type="button" onClick={() => navigate('/dashboard')} className="flex items-center gap-2.5 min-w-0 text-left">
        <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 overflow-hidden" style={{ background: 'var(--surface)' }}>
          <img src="/brand/ohpc-emblem.svg" alt="OHPC" className="brand-on-light h-7 w-auto" />
          <img src="/brand/ohpc-emblem-white.svg" alt="OHPC" className="brand-on-dark h-7 w-auto" />
        </span>
        <span className="min-w-0">
          <span className="block text-[13.5px] font-semibold leading-tight">OHPC VMS</span>
          <span className="block text-[11px] text-muted leading-tight truncate max-w-[220px]">{scope}</span>
        </span>
      </button>

      <div className="flex-1" />

      {/* Quick search → Visit Requests */}
      {canSearch && (
        <form onSubmit={submitSearch} className="control-wrap hidden md:block" style={{ width: 240 }} role="search">
          <Search size={14} className="control-icon" aria-hidden="true" />
          <input
            type="search"
            className="control"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find pass, visitor or phone"
            aria-label="Find pass, visitor or phone"
          />
        </form>
      )}

      <button type="button" className="btn-icon" onClick={toggleTheme}
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
        {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
      </button>

      {hasBell && (
        <div className="relative">
          <button ref={bellRef} type="button" className="btn-icon relative" onClick={togglePanel}
            aria-label={`Notifications${notifCount ? ` (${notifCount} new)` : ''}`} title="Notifications" aria-expanded={panelOpen}>
            <Bell size={17} />
            {notifCount > 0 && (
              <span className="nav-count absolute -top-0.5 -right-0.5" style={{ minWidth: 15, height: 15, fontSize: 9, padding: '0 3px' }}>
                {notifCount > 99 ? '99+' : notifCount}
              </span>
            )}
          </button>
          {panelOpen && (
            <div ref={panelRef} className="absolute right-0 top-full mt-2 z-50 animate-dropdown">
              <NotificationPanel
                notifications={notifications}
                loading={panelLoading}
                onAction={handleAction}
                onClose={() => setPanelOpen(false)}
                navigate={navigate}
                canApprove={canApprove}
              />
            </div>
          )}
        </div>
      )}

      {/* User button + menu */}
      <div className="relative" ref={menuRef}>
        <button type="button" className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-[var(--sidebar-hover)]"
          onClick={() => { setMenuOpen((o) => !o); setPanelOpen(false); }} aria-expanded={menuOpen} aria-haspopup="menu">
          <span className="text-right hidden sm:block">
            <span className="block text-[12.5px] font-medium leading-tight max-w-[160px] truncate">{user?.full_name}</span>
            <span className="block text-[11px] text-muted leading-tight">{ROLE_LABELS[role] ?? role}</span>
          </span>
          <span className="avatar">{toInitials(user?.full_name)}</span>
          <ChevronDown size={12} className="text-muted hidden sm:block" />
        </button>
        {menuOpen && (
          <div role="menu" className="card absolute right-0 top-full mt-2 z-50 p-1 w-52 animate-dropdown" style={{ color: 'var(--ink)' }}>
            <div className="px-2.5 py-2 border-b border-line mb-1">
              <p className="text-[12.5px] font-semibold truncate">{user?.full_name}</p>
              <p className="text-[11px] text-muted truncate">{user?.email}</p>
            </div>
            <button type="button" role="menuitem" className="menu-item" onClick={() => { setMenuOpen(false); navigate('/profile'); }}>
              <User size={14} /> My profile
            </button>
            <button type="button" role="menuitem" className="menu-item" onClick={() => { setMenuOpen(false); logout(); }}>
              <LogOut size={14} /> Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
