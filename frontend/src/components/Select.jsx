// frontend/src/components/Select.jsx
// The app's dropdown — never a native <select> (DESIGN_RULES §11).
// Same API as <select>: value, onChange(e) with e.target.value / e.target.name,
// name, disabled, required, id, aria-label, and <option> (and <optgroup>) children.
//
// Lists with 8+ options (or `searchable`) become type-to-search: the field is the
// input, typing filters (matches in bold), Enter picks, Escape restores the
// previous value, and Enter never submits the form.
import { Children, isValidElement, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from './icons';

const SEARCH_FROM = 8;
const MENU_MAX = 280;

const textOf = (node) => {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf(node.props.children);
  return '';
};

/** Flattens <option>/<optgroup> (and fragments / arrays) into [{ value, label, disabled, group }]. */
function readOptions(children, group = null, out = []) {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === 'option') {
      const label = textOf(child.props.children);
      out.push({ value: String(child.props.value ?? label), label, disabled: !!child.props.disabled, group });
    } else if (child.type === 'optgroup') {
      readOptions(child.props.children, child.props.label, out);
    } else if (child.props?.children) {
      readOptions(child.props.children, group, out);
    }
  });
  return out;
}

function Highlight({ text, query }) {
  if (!query) return text;
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return text;
  return <>{text.slice(0, i)}<b>{text.slice(i, i + query.length)}</b>{text.slice(i + query.length)}</>;
}

export default function Select({
  value, onChange, name, id, disabled, required, children, className = '', style,
  placeholder, searchable, 'aria-label': ariaLabel, 'aria-invalid': ariaInvalid,
}) {
  const options = useMemo(() => readOptions(children), [children]);
  const current = String(value ?? '');
  const selected = options.find((o) => o.value === current);
  const search = searchable ?? options.length >= SEARCH_FROM;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const listId = useId();

  const visible = useMemo(() => {
    if (!search || !query) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query, search]);

  const place = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    const up = below < Math.min(MENU_MAX, 40 + options.length * 28) && r.top > below;
    // The menu is portalled to <body>; carry over the theme of the trigger's subtree
    // (auth pages are always light, whatever the app theme)
    const theme = triggerRef.current.closest('[data-theme]')?.getAttribute('data-theme') || undefined;
    setPos({ left: r.left, width: r.width, top: up ? undefined : r.bottom + 4, bottom: up ? window.innerHeight - r.top + 4 : undefined, theme });
  }, [options.length]);

  const openMenu = () => {
    if (disabled) return;
    place();
    setQuery('');
    setActive(Math.max(0, options.findIndex((o) => o.value === current)));
    setOpen(true);
  };
  const closeMenu = () => { setOpen(false); setQuery(''); };

  const pick = (opt) => {
    if (!opt || opt.disabled) return;
    if (opt.value !== current) onChange?.({ target: { value: opt.value, name }, currentTarget: { value: opt.value, name } });
    closeMenu();
  };

  // Close on outside click; keep the menu attached on scroll / resize
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (triggerRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false); setQuery('');
    };
    const onMove = (e) => { if (!menuRef.current?.contains(e.target)) place(); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, place]);

  // Keep the active option in view
  useEffect(() => {
    if (!open || active < 0) return;
    menuRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const move = (delta) => {
    if (!visible.length) return;
    let i = active;
    for (let n = 0; n < visible.length; n++) {
      i = (i + delta + visible.length) % visible.length;
      if (!visible[i].disabled) break;
    }
    setActive(i);
  };

  const onKeyDown = (e) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key) && !(search && e.key === ' ')) { e.preventDefault(); openMenu(); }
      return;
    }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); move(1); break;
      case 'ArrowUp':   e.preventDefault(); move(-1); break;
      case 'Home':      if (!search) { e.preventDefault(); setActive(0); } break;
      case 'End':       if (!search) { e.preventDefault(); setActive(visible.length - 1); } break;
      case 'Enter':     e.preventDefault(); pick(visible[active]); break;   // never submits the form
      case 'Escape':    e.preventDefault(); closeMenu(); break;            // restores the previous value
      case 'Tab':       closeMenu(); break;
      default: break;
    }
  };

  const triggerCls = `select-trigger ${className}`;
  const label = selected?.label ?? placeholder ?? '';
  const isPlaceholder = !selected || selected.value === '';

  return (
    <>
      {search ? (
        <div className="relative" style={style}>
          <input
            ref={triggerRef}
            id={id}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-label={ariaLabel}
            aria-invalid={ariaInvalid}
            disabled={disabled}
            className={`${triggerCls} cursor-text`}
            value={open ? query : label}
            placeholder={open ? label || 'Type to search' : placeholder}
            onFocus={() => { if (!open) openMenu(); }}
            onClick={() => { if (!open) openMenu(); }}
            onChange={(e) => { if (!open) openMenu(); setQuery(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
            style={{ color: !open && isPlaceholder ? 'var(--muted)' : undefined }}
            autoComplete="off"
          />
          <ChevronDown size={13} className="caret absolute right-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        </div>
      ) : (
        <button
          ref={triggerRef}
          id={id}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid}
          disabled={disabled}
          className={triggerCls}
          style={style}
          onClick={() => (open ? closeMenu() : openMenu())}
          onKeyDown={onKeyDown}
        >
          <span className="truncate" style={{ color: isPlaceholder ? 'var(--muted)' : undefined }}>{label || ' '}</span>
          <ChevronDown size={13} className="caret" />
        </button>
      )}
      {/* Native required-field validation still works */}
      {required && <input tabIndex={-1} aria-hidden="true" className="sr-only" required value={current} onChange={() => {}} name={name ? `${name}__check` : undefined} />}

      {open && pos && createPortal(
        <div
          ref={menuRef}
          id={listId}
          role="listbox"
          data-theme={pos.theme}
          className="select-menu text-ink"
          style={{ left: pos.left, top: pos.top, bottom: pos.bottom, minWidth: pos.width, maxWidth: Math.max(pos.width, 360) }}
        >
          {visible.length === 0 && <div className="select-empty">No match for “{query}”</div>}
          {visible.map((o, i) => (
            <div key={`${o.group ?? ''}-${o.value}-${i}`}>
              {o.group && (i === 0 || visible[i - 1].group !== o.group) && (
                <div className="px-2 pt-2 pb-1 group-heading">{o.group}</div>
              )}
              <div
                data-index={i}
                role="option"
                aria-selected={o.value === current}
                aria-disabled={o.disabled || undefined}
                className={`select-option${i === active ? ' is-active' : ''}${o.disabled ? ' is-disabled' : ''}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => { e.preventDefault(); pick(o); }}
              >
                <span className="min-w-0 flex-1" style={{ color: o.value === '' ? 'var(--muted)' : undefined }}>
                  <Highlight text={o.label} query={query} />
                </span>
                {o.value === current && o.value !== '' && <Check size={13} weight="bold" className="check" />}
              </div>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
