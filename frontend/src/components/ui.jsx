// frontend/src/components/ui.jsx
// Building blocks for every page (DESIGN_RULES §6–12, 15–16). Pages compose these
// instead of styling raw markup, so the whole app stays on the same tokens.
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import useAuth from '../hooks/useAuth';
import { navSections, crumbsFor } from '../lib/nav';
import { describe } from '../lib/status';
import { drawerOpened, drawerClosed } from '../lib/drawerBus';
import useDocumentTitle from '../lib/useDocumentTitle';
import { ChevronRight as CaretRightIcon, Search as SearchIcon, X as XIcon, ChevronUp, ChevronDown, Loader2, Inbox } from './icons';

/* ── Page header ─────────────────────────────────────────────────────────────── */

/** Home › Group › Page, generated from the nav (lib/nav.js). Hidden on the dashboard. */
export function Breadcrumb({ crumbs }) {
  const { user, isSuperAdmin, isGlobalAuditor, activeUnit } = useAuth();
  const { pathname } = useLocation();
  const trail = useMemo(() => crumbs ?? crumbsFor(pathname, navSections({
    role: user?.role_type, isSuperAdmin, isGlobalAuditor, activeUnit,
  })), [crumbs, pathname, user?.role_type, isSuperAdmin, isGlobalAuditor, activeUnit]);
  if (!trail.length) return null;
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {trail.map((c, i) => (
        <span key={`${c.label}-${i}`} className="inline-flex items-center gap-1.5">
          {i > 0 && <CaretRightIcon size={10} aria-hidden="true" />}
          {c.to ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
        </span>
      ))}
    </nav>
  );
}

/** Breadcrumb + title (title only — no description) + the page's main action on the right. */
export function PageHeader({ title, crumbs, actions, meta }) {
  useDocumentTitle(typeof title === 'string' ? title : undefined);   // tab: "<title> | OHPC VMS"
  return (
    <header>
      <Breadcrumb crumbs={crumbs} />
      <div className="page-head">
        <h1 className="page-title">
          {title}
          {meta && <span className="ml-2 text-[13px] font-normal text-muted">{meta}</span>}
        </h1>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** Live state — a pulsing green dot: on the premises right now. */
export function Live({ children = 'Inside now', title = 'Checked in and not yet out' }) {
  return <span className="live-state" title={title}><span className="live-dot" aria-hidden="true" />{children}</span>;
}

/** Section title (14px/650) with an optional Settings-style head-icon chip and muted meta. */
export function SectionTitle({ icon: Icon, tone = 'brand', title, meta, actions }) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      {Icon && <span className={`head-chip tone-${tone}`}><Icon size={15} duo /></span>}
      <h2 className="section-title">{title}</h2>
      {meta && <span className="text-[11.5px] text-muted">{meta}</span>}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ── Stat strip ──────────────────────────────────────────────────────────────── */

export function StatStrip({ children, cols = 4 }) {
  return <div className="stat-strip" style={{ '--stat-cols': cols }}>{children}</div>;
}

/** label → number (+unit) → one-line hint. Colour the number only when it needs action. */
export function Stat({ label, value, unit, hint, tone, loading }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value${tone ? ` is-${tone}` : ''}`}>
        {loading ? <span className="inline-block h-6 w-10 rounded bg-line animate-pulse align-middle" /> : value}
        {unit && !loading && <span className="stat-unit">{unit}</span>}
      </div>
      {hint && <div className="stat-hint" title={typeof hint === 'string' ? hint : undefined}>{hint}</div>}
    </div>
  );
}

/* ── Toolbar ─────────────────────────────────────────────────────────────────── */

/** Count on the left (number in ink, noun muted), filters on the right. */
export function Toolbar({ count, noun, children }) {
  return (
    <div className="toolbar">
      <div className="toolbar-count">
        {count !== undefined && count !== null && (
          <><b>{Number(count).toLocaleString('en-IN')}</b> {noun}</>
        )}
      </div>
      {children}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search', width = 240, ...rest }) {
  return (
    <div className="control-wrap" style={{ width }}>
      <SearchIcon size={14} className="control-icon" aria-hidden="true" />
      <input
        type="search"
        className="control"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        {...rest}
      />
    </div>
  );
}

/* ── Table ───────────────────────────────────────────────────────────────────── */

/** Sortable header cell. Pass `sort` + `onSort` from lib/useSort; omit sortKey for a plain header. */
export function Th({ sortKey, sort, onSort, align, children, className = '', style }) {
  const cls = `${align === 'right' ? 'num' : ''} ${className}`.trim();
  if (!sortKey || !onSort) return <th className={cls} style={style}>{children}</th>;
  const active = sort?.key === sortKey ? sort.dir : null;
  return (
    <th className={cls} style={style} aria-sort={active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : 'none'}>
      <button type="button" className="sort-btn" onClick={() => onSort(sortKey)}>
        {children}
        <span className="sort-glyph" aria-hidden="true">
          <ChevronUp size={8} weight="bold" className={active === 'asc' ? 'on' : ''} />
          <ChevronDown size={8} weight="bold" className={active === 'desc' ? 'on' : ''} />
        </span>
      </button>
    </th>
  );
}

/** Placeholder rows while a table loads. */
export function SkeletonRows({ rows = 5, cols = 5 }) {
  return Array.from({ length: rows }, (_, r) => (
    <tr key={r}>
      {Array.from({ length: cols }, (__, c) => (
        <td key={c}><span className="block h-3 rounded bg-line animate-pulse" style={{ width: `${45 + ((r * 7 + c * 13) % 45)}%` }} /></td>
      ))}
    </tr>
  ));
}

/* ── Statuses (no pills) ─────────────────────────────────────────────────────── */

/** Stage tracker ▬▬▭▭ Approved */
export function StatusTracker({ label, tone, step = 1, steps = 4 }) {
  return (
    <span className={`status tone-${tone}`}>
      <span className="status-track" aria-hidden="true">
        {Array.from({ length: steps }, (_, i) => (
          <span key={i} className="status-seg" style={i < step ? { background: 'var(--tone)' } : undefined} />
        ))}
      </span>
      <span className="status-label">{label}</span>
    </span>
  );
}

/** Ring dot ◉ Issued */
export function State({ tone = 'neutral', children }) {
  return (
    <span className={`state tone-${tone}`}>
      <span className="state-dot" style={{ background: 'var(--tone)', outline: '2px solid var(--tone-soft)' }} aria-hidden="true" />
      {children}
    </span>
  );
}

/** Hairline tag  HIGH */
export function Tag({ tone = 'neutral', children, title }) {
  return <span className={`tag tone-${tone}`} title={title}>{children}</span>;
}

/** Any status / type value, shown the way lib/status.js says (tracker, dot or tag). */
export function Status({ value }) {
  if (!value) return <span className="text-muted">—</span>;
  const d = describe(value);
  if (d.kind === 'workflow') return <StatusTracker label={d.label} tone={d.tone} step={d.step} steps={d.steps} />;
  if (d.kind === 'state') return <State tone={d.tone}>{d.label}</State>;
  return <Tag tone={d.tone}>{d.label}</Tag>;
}

/* ── Empty state ─────────────────────────────────────────────────────────────── */

export function Empty({ icon: Icon = Inbox, title, hint, action }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon size={22} duo /></span>
      <p className="empty-title">{title}</p>
      {hint && <p className="empty-hint">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ── Key-value ───────────────────────────────────────────────────────────────── */

/** items: [[label, value], …] — empty values show "—". */
export function KV({ items, className = '' }) {
  return (
    <dl className={`kv ${className}`}>
      {items.filter(Boolean).map(([k, v]) => (
        <div key={k} className="contents">
          <dt>{k}</dt>
          <dd>{v === null || v === undefined || v === '' ? '—' : v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ── Field ───────────────────────────────────────────────────────────────────── */

/** Label (12px/560) + control + hint, or a danger message replacing the hint. */
export function Field({ label, htmlFor, required, hint, error, children, className = '' }) {
  return (
    <div className={className}>
      {label && (
        <label htmlFor={htmlFor} className="field-label">
          {label}{required && <span className="req" aria-hidden="true">*</span>}
        </label>
      )}
      {children}
      {error ? <p className="field-error" role="alert">{error}</p> : hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}

/* ── Tabs ────────────────────────────────────────────────────────────────────── */

/** Underline tabs. tabs: [{ id, label, count?, icon? }] */
export function Tabs({ tabs, value, onChange, className = '' }) {
  return (
    <div className={`tabs ${className}`} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          className={`tab${value === t.id ? ' active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.icon && <t.icon size={14} />}
          {t.label}
          {t.count !== undefined && t.count !== null && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Segmented control. options: [{ id, label }] */
export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id}
          className={`seg-item${value === o.id ? ' active' : ''}`} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ── Export ──────────────────────────────────────────────────────────────────── */

/** Spreadsheet glyph: dark-green tile with a white X over a green sheet ("Excel" everywhere). */
export function ExcelIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="3" width="14" height="18" rx="2" fill="#21A366" />
      <path d="M7 9h14M7 15h14M14 3v18" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="1" />
      <rect x="2" y="6" width="11" height="12" rx="1.5" fill="#107C41" />
      <path d="M5 9l5 6M10 9l-5 6" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** Bare spreadsheet icon in a 30px hit area — no label (DESIGN_RULES §10). */
export function ExportButton({ onClick, disabled, title = 'Export to Excel', busy }) {
  return (
    <button type="button" className="export-btn" onClick={onClick} disabled={disabled || busy} title={title} aria-label={title}>
      {busy ? <Loader2 size={16} className="animate-spin text-muted" /> : <ExcelIcon />}
    </button>
  );
}

/* ── Spinner ─────────────────────────────────────────────────────────────────── */

export function Spinner({ label = 'Loading…', className = '' }) {
  return (
    <div className={`flex items-center justify-center gap-2 py-12 text-muted text-[12.5px] ${className}`}>
      <Loader2 size={16} className="animate-spin" /> {label}
    </div>
  );
}

/* ── Drawer & modal ──────────────────────────────────────────────────────────── */

function useEscape(onEscape) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onEscape(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onEscape]);
}

function DrawerPanel({ onClose, title, subtitle, icon: Icon, tone = 'brand', width = 720, footer, children, busy }) {
  const [closing, setClosing] = useState(false);
  // ✕ / Escape / backdrop: slide out first, then tell the parent
  const requestClose = () => {
    if (busy || closing) return;
    setClosing(true);
    setTimeout(onClose, 220);
  };
  useEscape(requestClose);
  // Fold the sidebar to its rail while a drawer is open; lock page scroll
  useEffect(() => {
    drawerOpened();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { drawerClosed(); document.body.style.overflow = prev; };
  }, []);

  return createPortal(
    <>
      <div className={`overlay${closing ? ' is-closing' : ''}`} onClick={requestClose} aria-hidden="true" />
      <aside role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}
        className={`drawer${closing ? ' is-closing' : ''}`} style={{ '--drawer-w': `${width}px` }}>
        <div className="drawer-head">
          {Icon && <span className={`head-chip tone-${tone}`}><Icon size={15} duo /></span>}
          <div className="flex-1 min-w-0">
            <div className="drawer-title">{title}</div>
            {subtitle && <div className="drawer-sub">{subtitle}</div>}
          </div>
          <button type="button" className="btn-icon" onClick={requestClose} aria-label="Close" title="Close">
            <XIcon size={16} />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </aside>
    </>,
    document.body,
  );
}

/**
 * Right-side drawer (DESIGN_RULES §12): white header with icon chip, tinted body,
 * white footer. width: 520 | 640 | 720 | 760 | 820. Slides in 0.30s / out 0.22s.
 */
export function Drawer({ open, ...props }) {
  if (!open) return null;
  return <DrawerPanel {...props} />;
}

function ModalPanel({ onClose, title, footer, children, width = 480, busy }) {
  const requestClose = () => { if (!busy) onClose(); };
  useEscape(requestClose);
  return createPortal(
    <>
      <div className="overlay" onClick={requestClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}
        className="modal" style={{ '--modal-w': `${width}px` }}>
        {title && <div className="modal-head"><h2 className="text-[14.5px] font-semibold">{title}</h2></div>}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}

/** Centered modal for confirmations and short input (420–520px). */
export function Modal({ open, ...props }) {
  if (!open) return null;
  return <ModalPanel {...props} />;
}

/* ── Choice cards & scanner ──────────────────────────────────────────────────── */

/** Row of selectable cards. options: [{ id, label, desc?, icon? }] */
export function ChoiceCards({ options, value, onPick, cols = 3, label }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" className={`choice${value === o.id ? ' is-on' : ''}`}
          aria-pressed={value === o.id} onClick={() => onPick(o.id)}>
          {o.icon && <o.icon size={18} duo className="text-primary-strong mb-1" />}
          <span className="choice-title">{o.label}</span>
          {o.desc && <span className="choice-desc">{o.desc}</span>}
        </button>
      ))}
    </div>
  );
}

/** Corner brackets + sweeping line over a live camera (place inside .scan-stage). */
export function ScanOverlay({ label = 'Scanning…' }) {
  return (
    <>
      <div className="scan-frame" aria-hidden="true">
        <div className="scan-box"><i /><i /><i /><i /><div className="scan-line" /></div>
      </div>
      <div className="scan-chip"><span />{label}</div>
    </>
  );
}

/* ── Inline note ─────────────────────────────────────────────────────────────── */

export function Note({ tone = 'info', icon: Icon, children, className = '' }) {
  return (
    <p className={`note tone-${tone} ${className}`}>
      {Icon && <Icon size={14} className="mt-[1px] shrink-0" />}
      <span>{children}</span>
    </p>
  );
}
