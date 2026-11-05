// frontend/src/pages/gate/CheckOut.jsx
// Gate home (DESIGN_RULES §6/§8): who is on the premises, with direct or QR
// check-out. The QR check-out modal lives in components/gate/QRCheckoutModal.
import { useState, useEffect, useCallback } from "react";
import { LogOut, QrCode, Loader2, RefreshCw, Users } from "../../components/icons";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";
import { getApiErrorMessage } from "../../utils/apiError";
import useSocketEvent from "../../hooks/useSocketEvent";
import {
  PageHeader, SectionTitle, StatStrip, Stat, Th, SkeletonRows, Empty, Field, Modal, Live,
} from "../../components/ui";
import useSort from "../../lib/useSort";
import usePaged from "../../lib/usePaged";
import Pagination from "../../components/shared/Pagination";
import { fmtClock, relTime, orDash } from "../../lib/format";
import PassLookupModal from "../../components/gate/PassLookupModal";
import QRCheckoutModal from "../../components/gate/QRCheckoutModal";

// ─────────────────────────────────────────────────────────────────────────────
// CheckOut — main page
// ─────────────────────────────────────────────────────────────────────────────
export default function CheckOut() {
  const [activeVisitors,  setActiveVisitors]  = useState([]);
  const [approvedToday,   setApprovedToday]   = useState([]);
  const [loading,         setLoading]         = useState(true);

  // Direct checkout modal
  const [directModal,     setDirectModal]     = useState(null); // { visit_log_id }
  const [lookupOpen,      setLookupOpen]      = useState(false);  // "Check in by pass"
  const [directSubmit,    setDirectSubmit]    = useState(false);
  const [remarks,         setRemarks]         = useState("");

  // QR checkout modal
  const [qrModal,         setQrModal]         = useState(null); // visitor object

  const fetchGateDashboard = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiClient.get("/gate/dashboard");
      setActiveVisitors(res.data.data?.active || []);
      setApprovedToday(res.data.data?.yet_to_come || []);
    } catch {
      toast.error("Failed to fetch gate data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchGateDashboard(); }, [fetchGateDashboard]);

  /* ── Socket live events ─────────────────────────────────────────────── */
  useSocketEvent("visit:approved:today", useCallback((data) => {
    setApprovedToday(prev => {
      if (prev.some(v => v.id === data.id)) return prev;
      return [data, ...prev];
    });
    toast.success(`New approved visit: ${data.visitor_name || "Visitor"} arriving today.`, { duration: 7000 });
  }, []), []);

  useSocketEvent("visit:checkin", useCallback((data) => {
    setApprovedToday(prev => prev.filter(v => v.id !== data.visit_request_id));
    setActiveVisitors(prev => {
      if (prev.some(v => v.visit_log_id === data.visit_log_id)) return prev;
      return [data, ...prev];
    });
    toast.success(`${data.visitor_name || "A visitor"} checked in.`);
  }, []), []);

  // A visit expected today was cancelled — reload the lists
  useSocketEvent("visit:cancelled", fetchGateDashboard, [fetchGateDashboard]);

  useSocketEvent("visit:checkout", useCallback((data) => {
    setActiveVisitors(prev => prev.filter(v => v.visit_log_id !== data.visit_log_id));
    const method = data.checkout_method === "QR_SCAN" ? "via QR scan" : "";
    toast(`Visitor checked out ${method}`.trim() + ".", { duration: 4000 });
  }, []), []);

  /* ── Direct checkout handlers ───────────────────────────────────────── */
  const initiateDirectCheckout = (logId) => {
    setRemarks("");
    setDirectModal({ visit_log_id: logId });
  };

  const handleDirectCheckout = async () => {
    setDirectSubmit(true);
    try {
      await apiClient.post(`/gate/checkout/${directModal.visit_log_id}`, {
        visit_log_id: directModal.visit_log_id,
        remarks: remarks || undefined,
      });
      setDirectModal(null);
      fetchGateDashboard();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Checkout failed. Please try again."));
    } finally {
      setDirectSubmit(false);
    }
  };

  /* ── QR checkout handler ────────────────────────────────────────────── */
  const initiateQRCheckout = (visitor) => setQrModal(visitor);

  const { rows: sortedRows, sort, onSort } = useSort(activeVisitors, {
    visitor: (v) => v.visitor_name,
    host: (v) => v.host_name,
    in: (v) => v.check_in_at,
  });
  const paged = usePaged(sortedRows, 20);
  const rows = paged.rows;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Gate security"
        actions={(
          <>
            <button type="button" onClick={fetchGateDashboard} disabled={loading} className="btn-outline">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
            </button>
            <button type="button" onClick={() => setLookupOpen(true)} className="btn-primary">
              <QrCode size={14} /> Check in by pass
            </button>
          </>
        )}
      />
      {lookupOpen && <PassLookupModal onClose={() => setLookupOpen(false)} />}

      <StatStrip cols={2}>
        <Stat label="On premises" value={activeVisitors.length} unit="visitors" loading={loading} />
        <Stat label="Expected today" value={approvedToday.length} unit="not yet arrived" loading={loading} />
      </StatStrip>

      <SectionTitle icon={Users} title="On premises"
        meta={loading ? null : activeVisitors.length ? <span className="inline-flex items-center gap-2">{activeVisitors.length} inside <Live>LIVE</Live></span> : "0 inside"} />
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <Th sortKey="visitor" sort={sort} onSort={onSort}>Visitor</Th>
              <Th sortKey="host" sort={sort} onSort={onSort}>Host</Th>
              <Th sortKey="in" sort={sort} onSort={onSort}>Checked in</Th>
              <th className="text-right">Check out</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows rows={4} cols={4} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="!p-0">
                  <Empty icon={Users} title="No one on the premises" hint="Visitors appear here when they are checked in at the gate." />
                </td>
              </tr>
            ) : rows.map((visitor) => (
              <tr key={visitor.visit_log_id}>
                <td>
                  <span className="font-medium">{visitor.visitor_name}</span>
                  {visitor.visitor_phone && <span className="tabular text-muted"> · {visitor.visitor_phone}</span>}
                  {visitor.purpose && <span className="cell-sub line-clamp-1">{visitor.purpose}</span>}
                </td>
                <td>
                  {orDash(visitor.host_name)}
                  {visitor.department_name && <span className="cell-sub">{visitor.department_name}</span>}
                </td>
                <td className="tabular whitespace-nowrap">
                  <Live>Inside since {fmtClock(visitor.check_in_at)}</Live>
                  <span className="cell-sub">{relTime(visitor.check_in_at)}</span>
                </td>
                <td>
                  <div className="flex gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => initiateDirectCheckout(visitor.visit_log_id)}
                      className="btn-outline btn-sm"
                      title="Check out without scanning; the pass and its QR stop working at once"
                    >
                      <LogOut size={13} /> Direct
                    </button>
                    <button
                      type="button"
                      onClick={() => initiateQRCheckout(visitor)}
                      className="btn-primary btn-sm"
                      title="Scan the pass; its QR stops working at once"
                    >
                      <QrCode size={13} /> By QR
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && <Pagination page={paged.page} totalPages={paged.totalPages} totalCount={paged.total} onPageChange={paged.setPage} />}

      {/* ── Direct check-out ── */}
      <Modal
        open={!!directModal}
        onClose={() => setDirectModal(null)}
        busy={directSubmit}
        width={460}
        title="Check out the visitor?"
        footer={(
          <>
            <button type="button" onClick={() => setDirectModal(null)} disabled={directSubmit} className="btn-outline">Cancel</button>
            <button type="button" onClick={handleDirectCheckout} disabled={directSubmit} className="btn-primary">
              {directSubmit ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
              {directSubmit ? "Checking out…" : "Check out"}
            </button>
          </>
        )}
      >
        <p className="text-[12.5px] text-ink-2 mb-3">
          The gate pass and its QR code expire as soon as the visitor is checked out.
        </p>
        <Field label="Remarks" htmlFor="co-remarks">
          <textarea
            id="co-remarks"
            value={remarks}
            onChange={e => setRemarks(e.target.value)}
            className="control resize-none"
            rows={3}
            placeholder="Optional: anything noted at departure"
          />
        </Field>
      </Modal>

      {qrModal && (
        <QRCheckoutModal
          visitor={qrModal}
          onClose={() => setQrModal(null)}
          onSuccess={fetchGateDashboard}
        />
      )}
    </div>
  );
}
