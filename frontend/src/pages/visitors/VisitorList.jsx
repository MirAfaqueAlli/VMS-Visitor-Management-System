import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search, Eye, Phone, Mail, Calendar, User, Briefcase,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Filter,
  ArrowUpDown, ChevronDown, Check,
} from "lucide-react";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";

/* ── Avatar with initials ──────────────────────────────────────────────────── */
const AVATAR_COLORS = [
  ['#dbeafe', '#1d4ed8'],
  ['#dcfce7', '#15803d'],
  ['#fce7f3', '#be185d'],
  ['#fef9c3', '#a16207'],
  ['#ede9fe', '#6d28d9'],
  ['#ffedd5', '#c2410c'],
  ['#cffafe', '#0e7490'],
];
function VisitorAvatar({ name }) {
  const initials = name
    ?.split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) ?? '?';
  const idx = name ? name.charCodeAt(0) % AVATAR_COLORS.length : 0;
  const [bg, color] = AVATAR_COLORS[idx];
  return (
    <div style={{
      width: '36px', height: '36px', borderRadius: '50%',
      background: bg, color, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '12px', fontWeight: 700, letterSpacing: '0.02em',
      border: `1.5px solid ${color}30`,
    }}>
      {initials}
    </div>
  );
}

/* ── Type badge ───────────────────────────────────────────────────────────── */
function TypeBadge({ type }) {
  const isIndividual = type !== 'business';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '3px 10px', borderRadius: '999px',
      fontSize: '11px', fontWeight: 600,
      background: isIndividual ? '#eff6ff' : '#f5f3ff',
      color:      isIndividual ? '#2563eb' : '#6d28d9',
      border:     `1px solid ${isIndividual ? '#bfdbfe' : '#ddd6fe'}`,
    }}>
      {isIndividual
        ? <User size={10} strokeWidth={2} />
        : <Briefcase size={10} strokeWidth={2} />}
      {type === 'business' ? 'Business' : 'Individual'}
    </span>
  );
}

/* ── Main Component ──────────────────────────────────────────────────────── */
export default function VisitorList() {
  const [visitors,       setVisitors]       = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [search,         setSearch]         = useState("");
  const [debouncedSearch,setDebouncedSearch] = useState("");
  const [page,           setPage]           = useState(1);
  const [totalPages,     setTotalPages]     = useState(1);
  const [totalCount,     setTotalCount]     = useState(0);
  const limit = 10;
  const navigate = useNavigate();

  // ── Filter state ────────────────────────────────────────────────────────
  const [filterOpen,    setFilterOpen]    = useState(false);
  const [filterType,    setFilterType]    = useState('all'); // 'all' | 'individual' | 'business'
  const filterRef = useRef(null);

  // Close filter dropdown on outside click
  useEffect(() => {
    if (!filterOpen) return;
    const handler = (e) => {
      if (filterRef.current && !filterRef.current.contains(e.target)) setFilterOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [filterOpen]);

  // Reset page when filter changes
  useEffect(() => { setPage(1); }, [filterType]);

  useEffect(() => {
    const h = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(h);
  }, [search]);

  const fetchVisitors = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiClient.get("/visitors", { params: { search: debouncedSearch, page, limit } });
      setVisitors(res.data.data?.visitors ?? []);
      setTotalPages(res.data.data?.pagination?.pages ?? 1);
      setTotalCount(res.data.data?.pagination?.total ?? 0);
    } catch (err) {
      toast.error(err.response?.data?.message ?? "Failed to fetch visitors");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page]);

  useEffect(() => { fetchVisitors(); }, [fetchVisitors]);

  // ── Client-side filtering ───────────────────────────────────────────────
  const filteredVisitors = filterType === 'all'
    ? visitors
    : visitors.filter(v =>
        filterType === 'business'
          ? v.visitor_type === 'business'
          : v.visitor_type !== 'business'
      );

  const from = totalCount === 0 ? 0 : (page - 1) * limit + 1;
  const to   = Math.min(page * limit, totalCount);

  const FILTER_OPTIONS = [
    { value: 'all',        label: 'All Types' },
    { value: 'individual', label: 'Individual' },
    { value: 'business',   label: 'Business' },
  ];

  return (
    <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 animate-fade-in">

      {/* ── Page Header ── */}
      <div className="mb-6">
        <p className="text-[11px] font-bold uppercase tracking-widest text-accent mb-1">Visitors</p>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-loud">
              Visitor <em className="italic" style={{ color: 'var(--color-accent)' }}>Directory</em>
            </h1>
            <p className="text-muted text-sm mt-1">Manage all registered visitors.</p>
          </div>
        </div>
      </div>

      {/* ── Table Card ── */}
      <div className="vms-card overflow-hidden">

        {/* Search + Filter row */}
        <div
          className="px-4 sm:px-5 py-4 flex flex-wrap items-center gap-3"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <div className="relative flex-1 min-w-[180px]">
            <Search
              size={14} strokeWidth={1.8}
              className="absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--color-text-faint)' }}
            />
            <input
              type="text"
              placeholder="Search name, phone, email…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="vms-input pl-9 text-[13px] w-full"
              style={{ paddingLeft: '34px' }}
            />
          </div>
          {/* ── Filter Dropdown ── */}
          <div ref={filterRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setFilterOpen(o => !o)}
              className="btn-secondary flex items-center gap-2 text-[13px] px-3 py-2 shrink-0"
              style={{
                background: filterType !== 'all' ? 'var(--color-accent)' : undefined,
                color: filterType !== 'all' ? '#fff' : undefined,
                borderColor: filterType !== 'all' ? 'var(--color-accent)' : undefined,
              }}
            >
              <Filter size={13} strokeWidth={1.8} />
              <span className="hidden sm:inline">
                {filterType === 'all' ? 'Filter' : FILTER_OPTIONS.find(o => o.value === filterType)?.label}
              </span>
              <ChevronDown size={11} strokeWidth={2} className={`transition-transform duration-200 ${filterOpen ? 'rotate-180' : ''}`} />
            </button>

            {filterOpen && (
              <div
                style={{
                  position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 50,
                  background: 'var(--color-bg-primary)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md, 10px)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                  minWidth: '160px',
                  overflow: 'hidden',
                }}
              >
                <p style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-faint)', padding: '10px 14px 6px' }}>
                  Visitor Type
                </p>
                {FILTER_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => { setFilterType(opt.value); setFilterOpen(false); }}
                    style={{
                      width: '100%', textAlign: 'left', padding: '8px 14px',
                      fontSize: '13px', cursor: 'pointer', border: 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
                      background: filterType === opt.value ? 'var(--color-accent)' : 'transparent',
                      color: filterType === opt.value ? '#fff' : 'var(--color-text)',
                      transition: 'background 120ms',
                    }}
                    onMouseEnter={e => { if (filterType !== opt.value) e.currentTarget.style.background = 'var(--color-surface-hover)'; }}
                    onMouseLeave={e => { if (filterType !== opt.value) e.currentTarget.style.background = 'transparent'; }}
                  >
                    {opt.label}
                    {filterType === opt.value && <Check size={12} strokeWidth={2.5} />}
                  </button>
                ))}
                {filterType !== 'all' && (
                  <div style={{ padding: '6px 8px', borderTop: '1px solid var(--color-border)' }}>
                    <button
                      onClick={() => { setFilterType('all'); setFilterOpen(false); }}
                      style={{
                        width: '100%', fontSize: '11px', padding: '5px 8px',
                        borderRadius: '6px', border: '1px solid var(--color-border)',
                        background: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)',
                        cursor: 'pointer',
                      }}
                    >
                      Clear filter
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Table ── */}
        <div className="overflow-x-auto">
          <table className="w-full text-left" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg-primary)', borderBottom: '1px solid var(--color-border)' }}>
                {['NAME', 'CONTACT', 'TYPE', 'REGISTERED', 'ACTIONS'].map((col, i) => (
                  <th
                    key={col}
                    className="px-5 py-3 text-[11px] font-semibold tracking-wider whitespace-nowrap"
                    style={{ color: 'var(--color-text-faint)' }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      {col}
                      {(col === 'NAME' || col === 'REGISTERED') && (
                        <ArrowUpDown size={10} strokeWidth={2} style={{ opacity: 0.5 }} />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: '60px 0', color: 'var(--color-text-faint)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                      <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
                           style={{ borderColor: 'var(--color-border)', borderTopColor: 'var(--color-accent)' }} />
                      <span style={{ fontSize: '12px' }}>Loading visitors…</span>
                    </div>
                  </td>
                </tr>
              ) : visitors.length === 0 ? (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: '60px 0' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                      <div style={{
                        width: '44px', height: '44px', borderRadius: '12px',
                        background: 'var(--color-lightColor)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <User size={20} style={{ color: 'var(--color-text-faint)' }} strokeWidth={1.5} />
                      </div>
                      <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', fontWeight: 500 }}>No visitors found</p>
                      <p style={{ fontSize: '12px', color: 'var(--color-text-faint)' }}>Try adjusting your search</p>
                    </div>
                  </td>
                </tr>
              ) : filteredVisitors.length === 0 ? (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: '60px 0' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                      <div style={{
                        width: '44px', height: '44px', borderRadius: '12px',
                        background: 'var(--color-lightColor)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Filter size={18} style={{ color: 'var(--color-text-faint)' }} strokeWidth={1.5} />
                      </div>
                      <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', fontWeight: 500 }}>No visitors match this filter</p>
                      <button
                        onClick={() => setFilterType('all')}
                        style={{ fontSize: '12px', color: 'var(--color-accent)', background: 'none', border: 'none', cursor: 'pointer' }}
                      >
                        Clear filter
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredVisitors.map(visitor => {
                  const vid = visitor.id || visitor.visitor_id;
                  const date = visitor.created_at ? new Date(visitor.created_at) : null;
                  const dateStr = date?.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
                  const timeStr = date?.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
                  return (
                    <tr
                      key={vid}
                      style={{ borderBottom: '1px solid var(--color-border)', transition: 'background 150ms' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--color-surface-hover)'}
                      onMouseLeave={e => e.currentTarget.style.background = ''}
                    >
                      {/* NAME */}
                      <td className="px-5 py-3.5">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <VisitorAvatar name={visitor.full_name} />
                          <div>
                            <p style={{ fontWeight: 600, fontSize: '13px', color: 'var(--color-text)', lineHeight: 1.3 }}>
                              {visitor.full_name}
                            </p>
                            {visitor.company_name && (
                              <p style={{ fontSize: '11px', color: 'var(--color-text-faint)', marginTop: '2px' }}>
                                {visitor.company_name}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* CONTACT */}
                      <td className="px-5 py-3.5">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                          {visitor.phone && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                              <Phone size={10} strokeWidth={2} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
                              {visitor.phone}
                            </div>
                          )}
                          {visitor.email && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--color-text-faint)' }}>
                              <Mail size={10} strokeWidth={2} style={{ color: 'var(--color-text-faint)', flexShrink: 0 }} />
                              {visitor.email}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* TYPE */}
                      <td className="px-5 py-3.5">
                        <TypeBadge type={visitor.visitor_type} />
                      </td>

                      {/* REGISTERED */}
                      <td className="px-5 py-3.5">
                        {date ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--color-text-muted)', fontWeight: 500 }}>
                              <Calendar size={10} strokeWidth={2} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
                              {dateStr}
                            </div>
                            <p style={{ fontSize: '11px', color: 'var(--color-text-faint)', paddingLeft: '15px' }}>{timeStr}</p>
                          </div>
                        ) : '—'}
                      </td>

                      {/* ACTIONS */}
                      <td className="px-5 py-3.5">
                        <button
                          onClick={() => navigate(`/visitors/${vid}`)}
                          title="View Details"
                          style={{
                            width: '32px', height: '32px', borderRadius: '8px',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: 'var(--color-bg-primary)',
                            border: '1px solid var(--color-border)',
                            color: 'var(--color-accent)',
                            cursor: 'pointer',
                            transition: 'all 150ms',
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.background = 'var(--color-accent)';
                            e.currentTarget.style.color = 'white';
                            e.currentTarget.style.borderColor = 'var(--color-accent)';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.background = 'var(--color-bg-primary)';
                            e.currentTarget.style.color = 'var(--color-accent)';
                            e.currentTarget.style.borderColor = 'var(--color-border)';
                          }}
                        >
                          <Eye size={14} strokeWidth={1.8} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── Footer: count + pagination ── */}
        {!loading && totalCount > 0 && (
          <div
            className="px-5 py-3.5 flex items-center justify-between flex-wrap gap-3"
            style={{ borderTop: '1px solid var(--color-border)' }}
          >
            <p style={{ fontSize: '12px', color: 'var(--color-text-faint)' }}>
              Showing {from} to {to} of {totalCount} visitor{totalCount !== 1 ? 's' : ''}
            </p>

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {/* First */}
              <PagBtn onClick={() => setPage(1)} disabled={page === 1} title="First page">
                <ChevronsLeft size={13} strokeWidth={2} />
              </PagBtn>
              {/* Prev */}
              <PagBtn onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} title="Previous">
                <ChevronLeft size={13} strokeWidth={2} />
              </PagBtn>

              {/* Page numbers */}
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                let pg = i + 1;
                if (totalPages > 5) {
                  if (page <= 3) pg = i + 1;
                  else if (page >= totalPages - 2) pg = totalPages - 4 + i;
                  else pg = page - 2 + i;
                }
                return (
                  <button
                    key={pg}
                    onClick={() => setPage(pg)}
                    style={{
                      width: '30px', height: '30px', borderRadius: '6px',
                      fontSize: '12px', fontWeight: 600,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', border: 'none', transition: 'all 150ms',
                      background: pg === page ? 'var(--color-accent)' : 'transparent',
                      color: pg === page ? 'white' : 'var(--color-text-muted)',
                    }}
                    onMouseEnter={e => { if (pg !== page) e.currentTarget.style.background = 'var(--color-surface-hover)'; }}
                    onMouseLeave={e => { if (pg !== page) e.currentTarget.style.background = 'transparent'; }}
                  >
                    {pg}
                  </button>
                );
              })}

              {/* Next */}
              <PagBtn onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} title="Next">
                <ChevronRight size={13} strokeWidth={2} />
              </PagBtn>
              {/* Last */}
              <PagBtn onClick={() => setPage(totalPages)} disabled={page === totalPages} title="Last page">
                <ChevronsRight size={13} strokeWidth={2} />
              </PagBtn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Pagination button helper ──────────────────────────────────────────────── */
function PagBtn({ children, onClick, disabled, title }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: '30px', height: '30px', borderRadius: '6px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--color-bg-primary)',
        border: '1px solid var(--color-border)',
        color: disabled ? 'var(--color-text-faint)' : 'var(--color-text-muted)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'all 150ms',
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'var(--color-surface-hover)'; }}
      onMouseLeave={e => { if (!disabled) e.currentTarget.style.background = 'var(--color-bg-primary)'; }}
    >
      {children}
    </button>
  );
}
