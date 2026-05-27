// frontend/src/pages/admin/ArchiveManagement.jsx
import { useState, useEffect, useCallback } from "react";
import {
  Archive, Download, Trash2, PlayCircle, AlertTriangle,
  CheckCircle2, Clock, Database, Shield, ChevronRight,
  RefreshCw, Info, X, Loader2, FileArchive, Lock,
} from "lucide-react";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";

// ── Status badge ──────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  NOT_STARTED: { label: "Not Started",  color: "#64748b", bg: "rgba(100,116,139,0.12)", icon: Clock },
  PENDING:     { label: "In Progress",  color: "#f59e0b", bg: "rgba(245,158,11,0.12)",  icon: Loader2 },
  COMPLETED:   { label: "Archived",     color: "#22c55e", bg: "rgba(34,197,94,0.12)",   icon: CheckCircle2 },
  PURGED:      { label: "Purged",       color: "#6366f1", bg: "rgba(99,102,241,0.12)",  icon: Lock },
};

function StatusChip({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.NOT_STARTED;
  const Icon = cfg.icon;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wider"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      <Icon size={11} className={status === "PENDING" ? "animate-spin" : ""} />
      {cfg.label}
    </span>
  );
}

// ── Confirmation Modal ────────────────────────────────────────────────────────
function ConfirmModal({ open, title, description, warning, confirmLabel, confirmClass, onConfirm, onClose, loading }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative vms-card rounded-2xl p-8 w-full max-w-md shadow-2xl animate-fade-in"
        style={{ zIndex: 51 }}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-faint hover:text-muted transition-colors"
        >
          <X size={18} />
        </button>

        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
          style={{ background: "var(--color-warning-bg)" }}
        >
          <AlertTriangle size={26} style={{ color: "var(--color-warning)" }} />
        </div>

        <h2 className="text-xl font-bold text-loud mb-2">{title}</h2>
        <p className="text-muted text-sm leading-relaxed mb-4">{description}</p>

        {warning && (
          <div
            className="flex items-start gap-2 p-3 rounded-lg text-sm mb-6"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "#ef4444" }}
          >
            <AlertTriangle size={15} className="shrink-0 mt-0.5" />
            <span>{warning}</span>
          </div>
        )}

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 btn-secondary text-muted"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg font-semibold text-sm transition-all duration-200 ${confirmClass}`}
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            {loading ? "Processing…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── FY Row Card ───────────────────────────────────────────────────────────────
function FYCard({ item, onArchive, onDownload, onPurge }) {
  const canArchive  = item.archive_status === "NOT_STARTED" && item.live_records > 0;
  const canDownload = item.archive_status === "COMPLETED";
  const canPurge    = item.archive_status === "COMPLETED";
  const isPurged    = item.archive_status === "PURGED";

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
  const fmtNum  = (n) => Number(n).toLocaleString();

  return (
    <div
      className="vms-card rounded-xl p-5 transition-all duration-200 hover:shadow-hover"
      style={{ borderLeft: `3px solid ${STATUS_CONFIG[item.archive_status]?.color ?? "#64748b"}` }}
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">

        {/* Left: FY info */}
        <div className="flex items-center gap-4 flex-1">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "var(--color-mixed-bg)" }}
          >
            <FileArchive size={22} style={{ color: "var(--color-accent)" }} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-loud text-lg">FY {item.financial_year}</h3>
              <StatusChip status={item.archive_status} />
            </div>
            <p className="text-xs text-faint mt-0.5">
              {item.fy_start} → {item.fy_end}
            </p>
          </div>
        </div>

        {/* Middle: stats */}
        <div className="flex items-center gap-6 sm:gap-8 text-center">
          <div>
            <p className="text-[10px] text-faint uppercase tracking-wider mb-0.5">Live Records</p>
            <p className="font-bold text-loud text-lg">{isPurged ? "—" : fmtNum(item.live_records)}</p>
          </div>
          <div>
            <p className="text-[10px] text-faint uppercase tracking-wider mb-0.5">Archived</p>
            <p className="font-bold text-loud text-lg">{fmtNum(item.total_records)}</p>
          </div>
          <div>
            <p className="text-[10px] text-faint uppercase tracking-wider mb-0.5">Archived On</p>
            <p className="text-sm text-muted">{fmtDate(item.archived_at)}</p>
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2 shrink-0">
          {canArchive && (
            <button
              onClick={() => onArchive(item.financial_year)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all duration-200 hover:scale-105 active:scale-95"
              style={{ background: "var(--color-accent)" }}
              title="Run archive for this FY"
            >
              <PlayCircle size={14} />
              Archive
            </button>
          )}
          {item.archive_status === "NOT_STARTED" && item.live_records === 0 && (
            <span className="text-xs text-faint italic">No data</span>
          )}
          {canDownload && (
            <button
              onClick={() => onDownload(item.financial_year)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border transition-all duration-200 hover:bg-mixed-bg"
              style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
              title="Download JSON backup"
            >
              <Download size={14} />
              Download
            </button>
          )}
          {canPurge && (
            <button
              onClick={() => onPurge(item.financial_year, item.total_records)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border border-red-200 text-red-500 hover:bg-red-50 transition-all duration-200"
              title="Permanently delete from live DB"
            >
              <Trash2 size={14} />
              Purge
            </button>
          )}
          {isPurged && (
            <div className="flex items-center gap-1.5 text-xs text-faint">
              <Lock size={12} />
              Purged {fmtDate(item.purged_at)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ArchiveManagement() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  // Modal state
  const [modal, setModal] = useState(null); // { type: 'archive'|'purge', fy, records }
  const [busy,  setBusy]  = useState(false);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get("/archive");
      setData(res.data?.data ?? null);
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to load archive status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleArchive = (fy) => setModal({ type: "archive", fy });
  const handlePurge   = (fy, records) => setModal({ type: "purge", fy, records });

  const handleDownload = async (fy) => {
    try {
      const res = await apiClient.get(`/archive/${fy}/download`, { responseType: "blob" });
      const url  = URL.createObjectURL(new Blob([res.data], { type: "application/json" }));
      const link = document.createElement("a");
      link.href     = url;
      link.download = `VMS_Archive_${fy.replace("-", "_")}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success(`Downloaded FY ${fy} archive.`);
    } catch (err) {
      toast.error(err.response?.data?.message || "Download failed.");
    }
  };

  const handleConfirm = async () => {
    if (!modal) return;
    setBusy(true);
    try {
      if (modal.type === "archive") {
        await apiClient.post("/archive/run", { financial_year: modal.fy });
        toast.success(`FY ${modal.fy} archived successfully!`);
      } else if (modal.type === "purge") {
        await apiClient.delete(`/archive/${modal.fy}/purge`);
        toast.success(`FY ${modal.fy} records purged from live database.`);
      }
      setModal(null);
      fetchStatus();
    } catch (err) {
      toast.error(err.response?.data?.message || "Operation failed.");
    } finally {
      setBusy(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-5xl mx-auto py-8 px-4 sm:px-6 lg:px-8 animate-fade-in">

      {/* ── Page Header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: "var(--color-mixed-bg)" }}
            >
              <Archive size={18} style={{ color: "var(--color-accent)" }} />
            </div>
            <h1 className="text-2xl font-bold text-loud">
              Financial Year <em className="italic">Archive</em>
            </h1>
          </div>
          <p className="text-muted text-sm ml-12">
            Backup and purge historical visitor data by financial year (April – March).
          </p>
        </div>
        <button
          onClick={fetchStatus}
          disabled={loading}
          className="flex items-center gap-2 btn-secondary text-muted text-sm hover:bg-bg-primary hover:border-border transition-all duration-300 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* ── Info Banner ──────────────────────────────────────────────────── */}
      <div
        className="flex items-start gap-3 p-4 rounded-xl mb-8 text-sm"
        style={{
          background:  "rgba(99,102,241,0.07)",
          border:      "1px solid rgba(99,102,241,0.2)",
          color:       "var(--color-muted)",
        }}
      >
        <Info size={16} className="shrink-0 mt-0.5" style={{ color: "#6366f1" }} />
        <div className="leading-relaxed">
          <strong style={{ color: "#6366f1" }}>How it works:</strong>{" "}
          <strong>1. Archive</strong> — snapshots all visitor records for that FY into a JSON backup stored securely.{" "}
          <strong>2. Download</strong> — save the JSON file to your local machine or hand it over to the department.{" "}
          <strong>3. Purge</strong> — permanently removes old records from the live database to keep it lean.{" "}
          Purge is irreversible; always download first.
        </div>
      </div>

      {/* ── Current FY chip ───────────────────────────────────────────────── */}
      {data?.current_fy && (
        <div className="flex items-center gap-2 mb-6">
          <Shield size={13} style={{ color: "var(--color-accent)" }} />
          <span className="text-xs text-muted">
            Current financial year:{" "}
            <span className="font-semibold text-loud">FY {data.current_fy}</span>
            {" "}— cannot be archived until it is complete.
          </span>
        </div>
      )}

      {/* ── Content ──────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3, 4].map(n => (
            <div key={n} className="vms-card rounded-xl p-5 animate-pulse">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-border" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-border rounded-full w-1/4" />
                  <div className="h-3 bg-border rounded-full w-1/3" />
                </div>
                <div className="h-8 bg-border rounded-lg w-24" />
              </div>
            </div>
          ))}
        </div>
      ) : !data?.archives?.length ? (
        <div className="vms-card rounded-xl py-20 flex flex-col items-center justify-center text-center gap-4">
          <Database size={40} className="text-muted" />
          <p className="text-loud font-semibold">No financial year data found.</p>
          <p className="text-faint text-sm max-w-xs">
            Archive records will appear here once visit data exists for past financial years.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.archives.map(item => (
            <FYCard
              key={item.financial_year}
              item={item}
              onArchive={handleArchive}
              onDownload={handleDownload}
              onPurge={handlePurge}
            />
          ))}
        </div>
      )}

      {/* ── How-to steps footer ───────────────────────────────────────────── */}
      <div
        className="mt-10 rounded-xl p-6 grid sm:grid-cols-3 gap-4"
        style={{ background: "var(--color-mixed-bg)", border: "1px solid var(--color-border)" }}
      >
        {[
          {
            icon: PlayCircle,
            title: "Step 1 — Archive",
            desc: "Click Archive on any completed FY to create a full data snapshot. This does not delete any records.",
            color: "var(--color-accent)",
          },
          {
            icon: Download,
            title: "Step 2 — Download",
            desc: "Download the JSON backup and store it securely or hand it to the department as per policy.",
            color: "#22c55e",
          },
          {
            icon: Trash2,
            title: "Step 3 — Purge",
            desc: "After downloading, purge old records to free up live database space. This action is permanent.",
            color: "#ef4444",
          },
        ].map(({ icon: Icon, title, desc, color }) => (
          <div key={title} className="flex gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
              style={{ background: `${color}15` }}
            >
              <Icon size={15} style={{ color }} />
            </div>
            <div>
              <p className="text-sm font-semibold text-loud mb-1">{title}</p>
              <p className="text-xs text-faint leading-relaxed">{desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Confirmation Modal ────────────────────────────────────────────── */}
      <ConfirmModal
        open={!!modal}
        loading={busy}
        onClose={() => !busy && setModal(null)}
        onConfirm={handleConfirm}
        title={
          modal?.type === "archive"
            ? `Archive FY ${modal?.fy}?`
            : `Purge FY ${modal?.fy}?`
        }
        description={
          modal?.type === "archive"
            ? `This will create a full JSON backup of all visit records for FY ${modal?.fy} and store it securely. No records will be deleted.`
            : `This will permanently delete ${Number(modal?.records || 0).toLocaleString()} visit records for FY ${modal?.fy} from the live database. This cannot be undone.`
        }
        warning={
          modal?.type === "purge"
            ? "Ensure you have downloaded the archive backup before proceeding. Purged data cannot be recovered."
            : undefined
        }
        confirmLabel={modal?.type === "archive" ? "Yes, Archive Now" : "Yes, Purge Permanently"}
        confirmClass={
          modal?.type === "archive"
            ? "text-white"
            : "bg-red-600 hover:bg-red-700 text-white"
        }
      />
    </div>
  );
}
