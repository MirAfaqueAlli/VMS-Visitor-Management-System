// frontend/src/pages/super/SuperArchiveManagement.jsx
import { useState, useEffect, useCallback } from 'react';
import {
  Archive, Download, Trash2, PlayCircle, AlertTriangle,
  CheckCircle2, Clock, Database, Shield, ChevronDown, ChevronRight,
  RefreshCw, Info, X, Loader2, FileArchive, Lock, Building2,
  Globe, CheckCheck,
} from 'lucide-react';
import apiClient from '../../api/axios';
import toast from 'react-hot-toast';

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_CFG = {
  NOT_STARTED:  { label: 'Not Started',  color: '#64748b', bg: 'rgba(100,116,139,0.12)', Icon: Clock },
  PENDING:      { label: 'In Progress',  color: '#3b82f6', bg: 'rgba(59,130,246,0.12)',  Icon: Loader2 },
  COMPLETED:    { label: 'Archived',     color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   Icon: CheckCircle2 },
  PURGED:       { label: 'Purged',       color: '#6366f1', bg: 'rgba(99,102,241,0.12)',  Icon: Lock },
  UNAVAILABLE:  { label: 'Unavailable',  color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   Icon: AlertTriangle },
};

function StatusChip({ status, small = false }) {
  const cfg = STATUS_CFG[status] || STATUS_CFG.NOT_STARTED;
  const { Icon } = cfg;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold uppercase tracking-wider ${small ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]'}`}
      style={{ background: cfg.bg, color: cfg.color }}
    >
      <Icon size={small ? 9 : 11} className={status === 'PENDING' ? 'animate-spin' : ''} />
      {cfg.label}
    </span>
  );
}

// Derive a rolled-up status for a FY from all its units
function deriveFYStatus(units) {
  const statuses = units.map(u => u.archive_status);
  if (statuses.every(s => s === 'PURGED'))    return 'PURGED';
  if (statuses.every(s => s === 'COMPLETED' || s === 'PURGED')) return 'COMPLETED';
  if (statuses.some(s => s === 'COMPLETED'))  return 'PARTIAL';
  if (statuses.some(s => s === 'PENDING'))    return 'PENDING';
  return 'NOT_STARTED';
}

// ── Confirm Modal ─────────────────────────────────────────────────────────────
function ConfirmModal({ open, title, description, warning, confirmLabel, onConfirm, onClose, loading, isDanger }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative vms-card rounded-2xl p-8 w-full max-w-md shadow-2xl animate-fade-in" style={{ zIndex: 51 }}>
        <button onClick={onClose} className="absolute top-4 right-4 text-faint hover:text-muted transition-colors">
          <X size={18} />
        </button>
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
          style={{ background: isDanger ? 'rgba(239,68,68,0.1)' : 'var(--color-warning-bg)' }}>
          <AlertTriangle size={26} style={{ color: isDanger ? '#ef4444' : 'var(--color-warning)' }} />
        </div>
        <h2 className="text-xl font-bold text-loud mb-2">{title}</h2>
        <p className="text-muted text-sm leading-relaxed mb-4">{description}</p>
        {warning && (
          <div className="flex items-start gap-2 p-3 rounded-lg text-sm mb-6"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444' }}>
            <AlertTriangle size={15} className="shrink-0 mt-0.5" />
            <span>{warning}</span>
          </div>
        )}
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} disabled={loading} className="flex-1 btn-secondary text-muted">Cancel</button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg font-semibold text-sm text-white transition-all duration-200 disabled:opacity-60"
            style={{ background: isDanger ? '#dc2626' : 'var(--color-accent)' }}
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            {loading ? 'Processing…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Per-unit row inside expanded FY ──────────────────────────────────────────
function UnitRow({ unit, fy, onDownload, onPurge }) {
  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const canDownload = unit.archive_status === 'COMPLETED';
  const canPurge    = unit.archive_status === 'COMPLETED';
  const isPurged    = unit.archive_status === 'PURGED';

  return (
    <div className="flex flex-wrap items-center gap-3 py-3 px-4 rounded-lg transition-colors hover:bg-mixed-bg"
      style={{ borderBottom: '1px solid var(--color-border)' }}>
      {/* Unit name */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: 'var(--color-mixed-bg)' }}>
          <Building2 size={13} style={{ color: 'var(--color-accent)' }} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-loud truncate">{unit.unit_name}</p>
          <p className="text-[11px] text-faint">{unit.unit_code}</p>
        </div>
      </div>

      {/* Live / Archived counts */}
      <div className="flex items-center gap-5 text-center shrink-0">
        <div>
          <p className="text-[10px] text-faint uppercase tracking-wider">Live</p>
          <p className="text-sm font-bold text-loud">{isPurged ? '—' : unit.live_records.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-[10px] text-faint uppercase tracking-wider">Archived</p>
          <p className="text-sm font-bold text-loud">{unit.total_records.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-[10px] text-faint uppercase tracking-wider">Archived On</p>
          <p className="text-xs text-muted">{fmtDate(unit.archived_at)}</p>
        </div>
      </div>

      {/* Status + actions */}
      <div className="flex items-center gap-2 shrink-0">
        <StatusChip status={unit.archive_status} small />
        {unit.error && <span className="text-[10px] text-red-400" title={unit.error}>Error</span>}
        {canDownload && (
          <button
            onClick={() => onDownload(fy, unit)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all hover:bg-mixed-bg"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
            title="Download this unit's JSON backup"
          >
            <Download size={11} /> Download
          </button>
        )}
        {canPurge && (
          <button
            onClick={() => onPurge(fy, unit)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-red-200 text-red-500 hover:bg-red-50 transition-all"
            title="Purge this unit's data"
          >
            <Trash2 size={11} /> Purge
          </button>
        )}
        {isPurged && (
          <span className="flex items-center gap-1 text-[10px] text-faint">
            <Lock size={10} /> Purged {fmtDate(unit.purged_at)}
          </span>
        )}
      </div>
    </div>
  );
}

// ── FY Card ───────────────────────────────────────────────────────────────────
function FYCard({ item, onArchiveAll, onDownloadAll, onDownloadUnit, onPurgeUnit }) {
  const [expanded, setExpanded] = useState(false);

  const fyStatus    = deriveFYStatus(item.units);
  const cfg         = STATUS_CFG[fyStatus] || STATUS_CFG.NOT_STARTED;
  const borderColor = fyStatus === 'PARTIAL' ? '#f59e0b' : cfg.color;

  const canArchiveAll  = item.units.some(u => u.archive_status === 'NOT_STARTED' && u.live_records > 0);
  const canDownloadAll = item.units.some(u => u.archive_status === 'COMPLETED');

  const fmtNum = n => Number(n).toLocaleString();

  return (
    <div className="vms-card rounded-xl overflow-hidden transition-all duration-200 hover:shadow-hover"
      style={{ borderLeft: `3px solid ${borderColor}` }}>
      {/* ── Header row ── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-5">
        {/* Left: FY info */}
        <div className="flex items-center gap-4 flex-1">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'var(--color-mixed-bg)' }}>
            <FileArchive size={22} style={{ color: 'var(--color-accent)' }} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-loud text-lg">FY {item.financial_year}</h3>
              {fyStatus === 'PARTIAL' ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wider"
                  style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
                  <Clock size={11} /> Partial
                </span>
              ) : (
                <StatusChip status={fyStatus} />
              )}
            </div>
            <p className="text-xs text-faint mt-0.5">{item.fy_start} → {item.fy_end}</p>
          </div>
        </div>

        {/* Middle: aggregate stats */}
        <div className="flex items-center gap-6 sm:gap-8 text-center">
          <div>
            <p className="text-[10px] text-faint uppercase tracking-wider mb-0.5">Units</p>
            <p className="font-bold text-loud text-lg">{item.units.length}</p>
          </div>
          <div>
            <p className="text-[10px] text-faint uppercase tracking-wider mb-0.5">Live Records</p>
            <p className="font-bold text-loud text-lg">{fmtNum(item.total_live)}</p>
          </div>
          <div>
            <p className="text-[10px] text-faint uppercase tracking-wider mb-0.5">Archived</p>
            <p className="font-bold text-loud text-lg">{fmtNum(item.total_archived)}</p>
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {canArchiveAll && (
            <button
              onClick={() => onArchiveAll(item.financial_year)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-white transition-all hover:scale-105 active:scale-95"
              style={{ background: 'var(--color-accent)' }}
              title="Archive all units for this FY"
            >
              <PlayCircle size={14} /> Archive All
            </button>
          )}
          {canDownloadAll && (
            <button
              onClick={() => onDownloadAll(item.financial_year)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-all hover:bg-mixed-bg"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              title="Download combined JSON for all archived units"
            >
              <Download size={14} /> Download All
            </button>
          )}
          {/* Expand/collapse toggle */}
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-all hover:bg-mixed-bg"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {expanded ? 'Hide' : 'Units'}
          </button>
        </div>
      </div>

      {/* ── Per-unit breakdown ── */}
      {expanded && (
        <div className="border-t border-subtle animate-fade-in">
          <div className="px-5 py-3">
            <p className="text-[11px] font-semibold text-faint uppercase tracking-wider mb-2">Per-Unit Breakdown</p>
            <div className="space-y-0.5">
              {item.units.map(unit => (
                <UnitRow
                  key={unit.unit_id}
                  unit={unit}
                  fy={item.financial_year}
                  onDownload={onDownloadUnit}
                  onPurge={onPurgeUnit}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function SuperArchiveManagement() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(null); // { type, fy, unit? }
  const [busy,    setBusy]    = useState(false);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/archive/global');
      setData(res.data?.data ?? null);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load global archive status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // ── Download handlers ──────────────────────────────────────────────────────
  const triggerDownload = (blob, filename) => {
    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = filename;
    document.body.appendChild(link); link.click();
    document.body.removeChild(link); URL.revokeObjectURL(url);
  };

  const handleDownloadAll = async (fy) => {
    try {
      const res = await apiClient.get(`/archive/global/${fy}/download`, { responseType: 'blob' });
      triggerDownload(new Blob([res.data], { type: 'application/json' }), `VMS_Global_Archive_${fy.replace('-', '_')}.json`);
      toast.success(`Downloaded global FY ${fy} archive.`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Download failed.');
    }
  };

  const handleDownloadUnit = async (fy, unit) => {
    try {
      // Use the per-unit endpoint with X-Unit-Db header
      const res = await apiClient.get(`/archive/${fy}/download`, {
        responseType: 'blob',
        headers: { 'X-Unit-Db': unit.db_name },
      });
      triggerDownload(new Blob([res.data], { type: 'application/json' }), `VMS_Archive_${unit.unit_code}_${fy.replace('-', '_')}.json`);
      toast.success(`Downloaded ${unit.unit_name} FY ${fy} archive.`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Download failed.');
    }
  };

  // ── Confirm handler ────────────────────────────────────────────────────────
  const handleConfirm = async () => {
    if (!modal) return;
    setBusy(true);
    try {
      if (modal.type === 'archive-all') {
        const res = await apiClient.post('/archive/global/run', { financial_year: modal.fy });
        const { succeeded, skipped, failed } = res.data?.data || {};
        toast.success(`FY ${modal.fy}: ${succeeded} units archived, ${skipped} skipped${failed ? `, ${failed} failed` : ''}.`);
      } else if (modal.type === 'purge-unit') {
        await apiClient.delete(`/archive/global/${modal.fy}/purge`, {
          data: { unit_ids: [modal.unit.unit_id] },
        });
        toast.success(`${modal.unit.unit_name} FY ${modal.fy} data purged.`);
      }
      setModal(null);
      fetchStatus();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Operation failed.');
    } finally {
      setBusy(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-6xl mx-auto py-8 px-4 sm:px-6 lg:px-8 animate-fade-in">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'var(--color-mixed-bg)' }}>
              <Globe size={18} style={{ color: 'var(--color-accent)' }} />
            </div>
            <h1 className="text-2xl font-bold text-loud">
              Global FY <em className="italic">Archives</em>
            </h1>
          </div>
          <p className="text-muted text-sm ml-12">
            Archive, download and purge visitor data across all units by financial year.
          </p>
        </div>
        <button
          onClick={fetchStatus}
          disabled={loading}
          className="flex items-center gap-2 btn-secondary text-muted text-sm hover:bg-bg-primary hover:border-border transition-all duration-300 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* ── Info banner ── */}
      <div className="flex items-start gap-3 p-4 rounded-xl mb-6 text-sm"
        style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)', color: 'var(--color-muted)' }}>
        <Info size={16} className="shrink-0 mt-0.5" style={{ color: '#6366f1' }} />
        <div className="leading-relaxed">
          <strong style={{ color: '#6366f1' }}>How it works: </strong>
          Each FY row shows data from <strong>all units combined</strong>.{' '}
          <strong>Archive All</strong> — snapshots every unit for that year.{' '}
          <strong>Download All</strong> — one combined JSON with all units.{' '}
          Expand any FY to see per-unit status and download or purge individual units.{' '}
          <strong>Purge is irreversible</strong> — always download first.
        </div>
      </div>

      {/* ── Current FY chip ── */}
      {data?.current_fy && (
        <div className="flex items-center gap-2 mb-6">
          <Shield size={13} style={{ color: 'var(--color-accent)' }} />
          <span className="text-xs text-muted">
            Current financial year:{' '}
            <span className="font-semibold text-loud">FY {data.current_fy}</span>
            {' '}— cannot be archived until it is complete.
          </span>
        </div>
      )}

      {/* ── Content ── */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(n => (
            <div key={n} className="vms-card rounded-xl p-5 animate-pulse">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-border" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-border rounded-full w-1/4" />
                  <div className="h-3 bg-border rounded-full w-1/3" />
                </div>
                <div className="h-8 bg-border rounded-lg w-28" />
              </div>
            </div>
          ))}
        </div>
      ) : !data?.fys?.length ? (
        <div className="vms-card rounded-xl py-20 flex flex-col items-center justify-center text-center gap-4">
          <Database size={40} className="text-muted" />
          <p className="text-loud font-semibold">No financial year data found across any unit.</p>
          <p className="text-faint text-sm max-w-xs">
            Archive rows appear here once any unit has visit data for a completed financial year.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {data.fys.map(item => (
            <FYCard
              key={item.financial_year}
              item={item}
              onArchiveAll={(fy) => setModal({ type: 'archive-all', fy })}
              onDownloadAll={handleDownloadAll}
              onDownloadUnit={handleDownloadUnit}
              onPurgeUnit={(fy, unit) => setModal({ type: 'purge-unit', fy, unit })}
            />
          ))}
        </div>
      )}

      {/* ── How-to footer ── */}
      <div className="mt-10 rounded-xl p-6 grid sm:grid-cols-3 gap-4"
        style={{ background: 'var(--color-mixed-bg)', border: '1px solid var(--color-border)' }}>
        {[
          {
            Icon: PlayCircle, color: 'var(--color-accent)',
            title: 'Step 1 — Archive All',
            desc: 'Click "Archive All" on any completed FY. Snapshots every unit\'s data simultaneously. No records are deleted.',
          },
          {
            Icon: Download, color: '#22c55e',
            title: 'Step 2 — Download',
            desc: '"Download All" gives a single combined JSON. Or expand a FY and download per-unit individually.',
          },
          {
            Icon: Trash2, color: '#ef4444',
            title: 'Step 3 — Purge',
            desc: 'Purge individual units after downloading to free live DB space. Each unit can be purged independently.',
          },
        ].map(({ Icon, color, title, desc }) => (
          <div key={title} className="flex gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
              style={{ background: `${color}15` }}>
              <Icon size={15} style={{ color }} />
            </div>
            <div>
              <p className="text-sm font-semibold text-loud mb-1">{title}</p>
              <p className="text-xs text-faint leading-relaxed">{desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Confirm modal ── */}
      <ConfirmModal
        open={!!modal}
        loading={busy}
        onClose={() => !busy && setModal(null)}
        onConfirm={handleConfirm}
        isDanger={modal?.type === 'purge-unit'}
        title={
          modal?.type === 'archive-all'
            ? `Archive All Units — FY ${modal?.fy}?`
            : `Purge ${modal?.unit?.unit_name} — FY ${modal?.fy}?`
        }
        description={
          modal?.type === 'archive-all'
            ? `This will create a full JSON backup of all visit records across every unit for FY ${modal?.fy}. No records will be deleted. Units already archived will be skipped.`
            : `This will permanently delete all visit records for FY ${modal?.fy} from ${modal?.unit?.unit_name} (${modal?.unit?.unit_code}). This cannot be undone.`
        }
        warning={
          modal?.type === 'purge-unit'
            ? 'Ensure you have downloaded the archive backup for this unit before proceeding. Purged data cannot be recovered.'
            : undefined
        }
        confirmLabel={modal?.type === 'archive-all' ? 'Yes, Archive All Units' : 'Yes, Purge Permanently'}
      />
    </div>
  );
}
