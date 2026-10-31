// frontend/src/pages/gate/CheckOut.jsx
// Gate home (DESIGN_RULES §6/§8): who is on the premises, with direct or QR
// check-out. The QR check-out is a two-step modal (verify the pass → confirm).
import { useState, useEffect, useCallback, useRef } from "react";
import {
  LogOut, QrCode, Upload, Keyboard, CheckCircle2, ZoomIn, AlertCircle, AlertTriangle,
  ArrowLeft, ArrowRight, Loader2, RefreshCw, Users,
} from "../../components/icons";
import jsQR from "jsqr";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";
import { getApiErrorMessage } from "../../utils/apiError";
import useSocketEvent from "../../hooks/useSocketEvent";
import {
  PageHeader, SectionTitle, StatStrip, Stat, Th, SkeletonRows, Empty, Field, KV, State, Note, Modal,
  ChoiceCards, ScanOverlay,
} from "../../components/ui";
import useSort from "../../lib/useSort";
import usePaged from "../../lib/usePaged";
import Pagination from "../../components/shared/Pagination";
import { fmtClock, relTime, orDash } from "../../lib/format";

// ── QR scan modes (same as CheckIn) ──────────────────────────────────────────
const VERIFY_MODES = [
  { id: "webcam", label: "Scan with camera", icon: QrCode,   desc: "Hold the QR code up to the camera" },
  { id: "upload", label: "Upload QR image",  icon: Upload,   desc: "A photo or screenshot of the pass" },
  { id: "manual", label: "Type the number",  icon: Keyboard, desc: "Enter the pass number by hand" },
];

// ─────────────────────────────────────────────────────────────────────────────
// QR Checkout Modal — 2 steps: QR verify → Confirm
// ─────────────────────────────────────────────────────────────────────────────
function QRCheckoutModal({ visitor, onClose, onSuccess }) {
  const [step, setStep] = useState(1); // 1 = QR, 2 = Confirm

  // Step 1 state
  const [verifyMode,   setVerifyMode]   = useState(null);
  const [qrScanActive, setQrScanActive] = useState(false);
  const qrStreamRef = useRef(null);   // useRef — no stale-closure on stop
  const [passNumber,   setPassNumber]   = useState("");
  const [passVerified, setPassVerified] = useState(false);
  const [qrError,      setQrError]      = useState("");
  const qrVideoRef  = useRef(null);
  const qrCanvasRef = useRef(null);
  const qrFileRef   = useRef(null);
  const rafRef      = useRef(null);

  // Step 2 state
  const [submitting, setSubmitting] = useState(false);

  // The expected pass number from the visitor row
  const expectedPass = (visitor.pass_number || "").trim().toUpperCase();

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (qrStreamRef.current) {
        qrStreamRef.current.getTracks().forEach(t => t.stop());
        if (qrVideoRef.current) qrVideoRef.current.srcObject = null;
        qrStreamRef.current = null;
      }
    };
  }, []);

  // ── QR helpers ───────────────────────────────────────────────────────────
  const stopQrCamera = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (qrStreamRef.current) {
      qrStreamRef.current.getTracks().forEach(t => t.stop());
      if (qrVideoRef.current) qrVideoRef.current.srcObject = null;
      qrStreamRef.current = null;
    }
    setQrScanActive(false);
  }, []);

  const verifyPassString = useCallback((rawData) => {
    if (!rawData) return;

    // ── Decode the signed QR token format ──────────────────────────────────
    // Backend encodes: <base64url(JSON_payload)>.<base64url(HMAC_signature)>
    // We only need pass_number from the payload — HMAC verification is done server-side.
    let decoded = rawData.trim();

    // 1. Try signed token: split on last dot, base64url-decode the payload segment
    const dotIdx = decoded.lastIndexOf('.');
    if (dotIdx > 0) {
      try {
        const encodedPayload = decoded.slice(0, dotIdx);
        const base64 = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '=='.slice(0, (4 - base64.length % 4) % 4);
        const json = atob(padded);
        const parsed = JSON.parse(json);
        if (parsed?.pass_number) decoded = parsed.pass_number;
      } catch (_) {
        // Not a signed token — try next format
      }
    }

    // 2. Try legacy plain-JSON QR (for backward compat)
    if (decoded === rawData.trim()) {
      try {
        const parsed = JSON.parse(rawData);
        if (parsed?.pass_number) decoded = parsed.pass_number;
      } catch (_) {
        // Plain string — use as-is
      }
    }

    const upper = decoded.trim().toUpperCase();

    // ── Validate against visitor's actual pass number ──────────────
    if (upper !== expectedPass) {
      setQrError(`QR code does not match this visitor's gate pass. Expected: ${expectedPass}`);
      toast.error("This QR code belongs to a different pass.");
      stopQrCamera();
      return;
    }

    setPassNumber(upper);
    setPassVerified(true);
    setQrError("");
    toast.success("QR code matches this visitor's gate pass.");
    stopQrCamera();
  }, [stopQrCamera, expectedPass]);

  const startQrScan = async () => {
    setQrError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      qrStreamRef.current = stream;
      setQrScanActive(true);
      // Attach directly — no setTimeout race condition
      if (qrVideoRef.current) {
        qrVideoRef.current.srcObject = stream;
        qrVideoRef.current.play().catch(() => {});
      }
    } catch {
      toast.error("Camera not accessible. Try uploading or entering manually.");
    }
  };

  const handleQrVideoPlay = () => {
    const tick = () => {
      const video = qrVideoRef.current; const canvas = qrCanvasRef.current;
      if (!video || !canvas || video.readyState < 2) { rafRef.current = requestAnimationFrame(tick); return; }
      const ctx = canvas.getContext("2d");
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "attemptBoth" });
      if (code?.data) { verifyPassString(code.data); return; }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const handleQrFileUpload = (e) => {
    const file = e.target.files[0]; if (!file) return;
    setQrError("");
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width; canvas.height = img.height;
      canvas.getContext("2d").drawImage(img, 0, 0);
      const imageData = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "attemptBoth" });
      URL.revokeObjectURL(url);
      if (code?.data) { verifyPassString(code.data); } else { toast.error("No QR code found in image. Try a clearer photo."); }
    };
    img.src = url; e.target.value = "";
  };

  const handleManualVerify = () => {
    if (!passNumber.trim()) { toast.error("Please enter the pass number."); return; }
    const upper = passNumber.trim().toUpperCase();
    if (upper !== expectedPass) {
      setQrError(`Pass number does not match. Expected: ${expectedPass}`);
      toast.error("This pass number belongs to a different visitor.");
      return;
    }
    setPassNumber(upper);
    setPassVerified(true);
    setQrError("");
    toast.success("Pass number verified.");
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!passVerified) { toast.error("Please verify the QR code first."); return; }

    setSubmitting(true);
    try {
      await apiClient.post("/gate/checkout/qr", {
        pass_number: passNumber.trim().toUpperCase(),
      });
      toast.success("Visitor checked out. The pass QR no longer works.");
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "QR checkout failed."));
    } finally {
      setSubmitting(false);
    }
  };

  const resetVerify = () => { setPassVerified(false); setPassNumber(""); setVerifyMode(null); setQrError(""); stopQrCamera(); };
  const pickMode = (id) => {
    setVerifyMode(id);
    setQrError("");
    if (id === "webcam") startQrScan();
    if (id === "upload") setTimeout(() => qrFileRef.current?.click(), 50);
  };

  return (
    <Modal
      open
      onClose={onClose}
      busy={submitting}
      width={520}
      title={(
        <span className="flex items-center gap-2">
          Check out by QR
          <span className="text-[12px] font-normal text-muted">Step {step} of 2 · {step === 1 ? "Scan the pass" : "Confirm"}</span>
        </span>
      )}
      footer={step === 1 ? (
        <>
          <button type="button" className="btn-outline" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={!passVerified} onClick={() => setStep(2)}>
            Next <ArrowRight size={14} />
          </button>
        </>
      ) : (
        <>
          <button type="button" className="btn-outline" onClick={() => setStep(1)} disabled={submitting}>Back</button>
          <button type="button" className="btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
            {submitting ? "Checking out…" : "Check out"}
          </button>
        </>
      )}
    >
      <p className="text-[12.5px] text-ink-2 mb-3">
        {visitor.visitor_name} · pass <span className="mono text-ink">{expectedPass}</span>
      </p>

      {/* ══ Step 1: Scan QR ══ */}
      {step === 1 && (
        <div className="space-y-3">
          {qrError && (
            <div className="flex items-start gap-2">
              <Note tone="danger" icon={AlertCircle} className="flex-1"><b>Wrong QR code.</b> {qrError}</Note>
              <button type="button" onClick={() => setQrError("")} className="btn-link text-[12px] shrink-0">Dismiss</button>
            </div>
          )}

          {passVerified ? (
            <div className="inset-cell flex items-center gap-3 !bg-[var(--success-soft)]">
              <CheckCircle2 size={18} className="text-success shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-success">Pass verified</p>
                <p className="mono text-[12px] text-ink-2 truncate">{passNumber}</p>
              </div>
              <button type="button" onClick={resetVerify} className="btn-ghost btn-sm">Scan again</button>
            </div>
          ) : (
            <>
              <input ref={qrFileRef} type="file" accept="image/*" onChange={handleQrFileUpload} className="hidden" />

              {!verifyMode && (
                <>
                  <p className="text-[12.5px] text-muted">Only the QR code of this visitor&apos;s pass is accepted.</p>
                  <ChoiceCards options={VERIFY_MODES} value={verifyMode} onPick={pickMode} label="How to verify the pass" />
                </>
              )}

              {verifyMode === "webcam" && (
                <div className="space-y-2">
                  <div className="scan-stage" style={{ minHeight: 220 }}>
                    <video ref={qrVideoRef} autoPlay playsInline muted onPlay={handleQrVideoPlay} className="w-full max-h-[260px] object-cover" />
                    {qrScanActive && <ScanOverlay />}
                  </div>
                  <canvas ref={qrCanvasRef} className="hidden" />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => { stopQrCamera(); setVerifyMode(null); }} className="btn-ghost btn-sm">
                      <ArrowLeft size={13} /> Other method
                    </button>
                    <button type="button" onClick={() => { stopQrCamera(); setVerifyMode("manual"); }} className="btn-ghost btn-sm">
                      <Keyboard size={13} /> Type the number
                    </button>
                  </div>
                </div>
              )}

              {verifyMode === "upload" && (
                <div className="space-y-2">
                  <button
                    type="button"
                    className="w-full flex flex-col items-center gap-1.5 py-8 rounded-lg border border-dashed border-line-strong bg-surface-alt hover:border-primary transition-colors"
                    onClick={() => qrFileRef.current?.click()}
                  >
                    <ZoomIn size={22} duo className="text-primary-strong" />
                    <span className="text-[13px] font-medium text-ink">Choose a QR image</span>
                    <span className="text-[11.5px] text-muted">A screenshot of the gate-pass email works.</span>
                  </button>
                  <button type="button" onClick={() => setVerifyMode(null)} className="btn-ghost btn-sm">
                    <ArrowLeft size={13} /> Other method
                  </button>
                </div>
              )}

              {verifyMode === "manual" && (
                <div className="space-y-2">
                  <Field label="Gate pass number" htmlFor="co-pass">
                    <div className="flex gap-2">
                      <input
                        id="co-pass"
                        type="text"
                        value={passNumber}
                        autoFocus
                        onChange={e => { setPassNumber(e.target.value.toUpperCase()); setQrError(""); }}
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleManualVerify(); } }}
                        placeholder="HO-20240606-0001"
                        className="control mono uppercase flex-1"
                      />
                      <button type="button" onClick={handleManualVerify} className="btn-outline">Verify</button>
                    </div>
                  </Field>
                  <button type="button" onClick={() => setVerifyMode(null)} className="btn-ghost btn-sm">
                    <ArrowLeft size={13} /> Other method
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ══ Step 2: Confirm ══ */}
      {step === 2 && (
        <div className="space-y-3">
          <div className="tile">
            <KV items={[
              ["Visitor", visitor.visitor_name],
              ["Gate pass", <span key="p" className="mono">{passNumber}</span>],
              ["Checked in", <span key="t" className="tabular">{fmtClock(visitor.check_in_at)}</span>],
              ["QR", <State key="q" tone="success">Verified</State>],
            ]} className="!grid-cols-[110px_minmax(0,1fr)]" />
          </div>
          <Note tone="warning" icon={AlertTriangle}>The pass QR stops working as soon as the visitor is checked out.</Note>
        </div>
      )}
    </Modal>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// CheckOut — main page
// ─────────────────────────────────────────────────────────────────────────────
export default function CheckOut() {
  const [activeVisitors,  setActiveVisitors]  = useState([]);
  const [approvedToday,   setApprovedToday]   = useState([]);
  const [loading,         setLoading]         = useState(true);

  // Direct checkout modal
  const [directModal,     setDirectModal]     = useState(null); // { visit_log_id }
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
          <button type="button" onClick={fetchGateDashboard} disabled={loading} className="btn-outline">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        )}
      />

      <StatStrip cols={2}>
        <Stat label="On premises" value={activeVisitors.length} unit="visitors" loading={loading} />
        <Stat label="Expected today" value={approvedToday.length} unit="not yet arrived" loading={loading} />
      </StatStrip>

      <SectionTitle icon={Users} title="On premises" meta={loading ? null : `${activeVisitors.length}`} />
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
                  {fmtClock(visitor.check_in_at)}
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
