// frontend/src/pages/gate/CheckIn.jsx
// Gate check-in (DESIGN_RULES §11/§12): visit details tile on the left; on the
// right three steps — verify the pass, photo (optional), ID — then Check in.
import { useState, useCallback, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Check, AlertCircle, Scan, Camera, Upload, X, RotateCcw, QrCode, Keyboard,
  CheckCircle2, ZoomIn, CreditCard, ArrowLeft, Loader2,
} from "../../components/icons";
import jsQR from "jsqr";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";
import { getApiErrorMessage } from "../../utils/apiError";
import Select from "../../components/Select";
import {
  PageHeader, SectionTitle, KV, Status, Field, Empty, Spinner, ChoiceCards, ScanOverlay,
} from "../../components/ui";
import { fmtDate, fmtTime } from "../../lib/format";

// ── QR scan modes for Step 1 ──────────────────────────────────────────────────
const VERIFY_MODES = [
  { id: 'webcam', label: 'Scan with camera', icon: QrCode,   desc: 'Hold the QR code up to the camera' },
  { id: 'upload', label: 'Upload QR image',  icon: Upload,   desc: 'A photo or screenshot of the pass' },
  { id: 'manual', label: 'Type the number',  icon: Keyboard, desc: 'Enter the pass number by hand' },
];

export default function CheckIn() {
  const { requestId } = useParams();
  const navigate      = useNavigate();

  const [request,      setRequest]      = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [submitting,   setSubmitting]   = useState(false);
  const [passVerified, setPassVerified] = useState(false);

  // ── Step 1: verification mode & state ─────────────────────────────────────
  const [verifyMode,   setVerifyMode]   = useState(null); // null | 'webcam' | 'upload' | 'manual'
  const [qrScanActive, setQrScanActive] = useState(false);
  const [qrDetected,   setQrDetected]   = useState(false);
  const qrStreamRef   = useRef(null);   // useRef — no stale-closure on stop
  const qrVideoRef    = useRef(null);
  const qrCanvasRef   = useRef(null);
  const qrFileRef     = useRef(null);
  const rafRef        = useRef(null);

  // ── Step 2: visitor photo capture ─────────────────────────────────────────
  const [captureMode,  setCaptureMode]  = useState(null); // null | 'camera' | 'preview'
  const cameraStreamRef = useRef(null); // useRef — no stale-closure on stop
  const [photoDataUrl, setPhotoDataUrl] = useState(null);
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const fileRef   = useRef(null);

  const [formData, setFormData] = useState({
    pass_number:        "",
    id_verified_type:   "AADHAAR",
    id_verified_number: "",
    remarks:            "",
  });

  // ── Fetch request ──────────────────────────────────────────────────────────
  const fetchRequest = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get(`/visit-requests/${requestId}`);
      setRequest(res.data?.data ?? res.data);
    } catch {
      toast.error("Failed to load visit request.");
      navigate("/requests");
    } finally { setLoading(false); }
  }, [requestId, navigate]);

  useEffect(() => { fetchRequest(); }, [fetchRequest]);

  // Cleanup ALL cameras on unmount — uses refs so always sees current stream
  useEffect(() => {
    return () => {
      // Cancel QR animation loop
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      // Stop QR stream
      if (qrStreamRef.current) {
        qrStreamRef.current.getTracks().forEach(t => t.stop());
        if (qrVideoRef.current) qrVideoRef.current.srcObject = null;
        qrStreamRef.current = null;
      }
      // Stop photo-capture stream
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach(t => t.stop());
        if (videoRef.current) videoRef.current.srcObject = null;
        cameraStreamRef.current = null;
      }
    };
  }, []);

  const handleChange = (e) =>
    setFormData(p => ({ ...p, [e.target.name]: e.target.value }));

  // ── QR Verification helpers ────────────────────────────────────────────────

  const stopQrCamera = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (qrStreamRef.current) {
      qrStreamRef.current.getTracks().forEach(t => t.stop());
      if (qrVideoRef.current) qrVideoRef.current.srcObject = null;
      qrStreamRef.current = null;
    }
    setQrScanActive(false);
  }, []);

  /**
   * Verify a decoded pass string against the request's expected pass_number.
   */
  const verifyPassString = useCallback((rawData) => {
    if (!rawData) return;

    // ── Decode the signed QR token format ──────────────────────────────────
    // Backend encodes: <base64url(JSON_payload)>.<base64url(HMAC_signature)>
    // We only need pass_number from the payload — HMAC verification is done server-side.
    let passNumber = rawData.trim();

    // 1. Try signed token: split on last dot, base64url-decode the payload segment
    const dotIdx = passNumber.lastIndexOf('.');
    if (dotIdx > 0) {
      try {
        const encodedPayload = passNumber.slice(0, dotIdx);
        const base64 = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '=='.slice(0, (4 - base64.length % 4) % 4);
        const json = atob(padded);
        const parsed = JSON.parse(json);
        if (parsed?.pass_number) passNumber = parsed.pass_number;
      } catch (_) {
        // Not a signed token — try next format
      }
    }

    // 2. Try legacy plain-JSON QR (for backward compat)
    if (passNumber === rawData.trim()) {
      try {
        const parsed = JSON.parse(rawData);
        if (parsed?.pass_number) passNumber = parsed.pass_number;
      } catch (_) {
        // Plain string — use as-is
      }
    }

    const entered  = passNumber.trim().toUpperCase();
    const expected = (request?.pass_number || "").trim().toUpperCase();

    setFormData(p => ({ ...p, pass_number: entered }));
    if (entered === expected) {
      setPassVerified(true);
      setQrDetected(true);
      toast.success("Gate pass verified.");
    } else {
      toast.error(`QR code decoded but pass doesn't match. Got: ${entered}`);
    }
  }, [request]);

  /**
   * Continuously scan webcam frames for QR codes using jsQR.
   */
  const startQrScan = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      qrStreamRef.current = stream;
      setQrScanActive(true);
      setQrDetected(false);
      // Attach directly — no setTimeout race condition
      if (qrVideoRef.current) {
        qrVideoRef.current.srcObject = stream;
        qrVideoRef.current.play().catch(() => {});
      }
    } catch {
      toast.error("Camera not accessible. Try uploading a QR image or enter manually.");
    }
  };

  // Start scanning frames once video is playing
  const handleQrVideoPlay = () => {
    const tick = () => {
      const video  = qrVideoRef.current;
      const canvas = qrCanvasRef.current;
      if (!video || !canvas || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const ctx = canvas.getContext("2d");
      canvas.width  = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "attemptBoth",
      });
      if (code?.data) {
        stopQrCamera();
        verifyPassString(code.data);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  /**
   * Decode QR from an uploaded image file using jsQR.
   */
  const handleQrFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width  = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "attemptBoth",
      });
      URL.revokeObjectURL(url);
      if (code?.data) {
        verifyPassString(code.data);
      } else {
        toast.error("No QR code found in the image. Try a clearer photo or enter manually.");
      }
    };
    img.src = url;
    // reset file input
    e.target.value = "";
  };

  /**
   * Manual pass number entry verify button handler.
   */
  const handleVerifyPass = () => {
    const entered  = formData.pass_number.trim().toUpperCase();
    const expected = request?.pass_number;
    if (!entered) { toast.error("Please enter the gate pass number."); return; }
    if (entered === expected) {
      setPassVerified(true);
      toast.success("Gate pass verified.");
    } else {
      toast.error("Pass number does not match. Please check and try again.");
    }
  };

  const resetVerification = () => {
    stopQrCamera();
    setPassVerified(false);
    setQrDetected(false);
    setVerifyMode(null);
    setFormData(p => ({ ...p, pass_number: "" }));
  };

  // ── Photo capture helpers ──────────────────────────────────────────────────
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      });
      cameraStreamRef.current = stream;
      setCaptureMode("camera");
      setPhotoDataUrl(null);
      // Attach directly — no setTimeout race condition
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch {
      toast.error("Camera not accessible. Try uploading a photo instead.");
    }
  };

  const stopCamera = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(t => t.stop());
      // Null out srcObject so the browser releases the camera indicator
      if (videoRef.current) videoRef.current.srcObject = null;
      cameraStreamRef.current = null;
    }
    setCaptureMode(null);
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext("2d").drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    setPhotoDataUrl(dataUrl);
    stopCamera();
    setCaptureMode("preview");
    toast.success("Photo taken.");
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setPhotoDataUrl(ev.target.result);
      setCaptureMode("preview");
      toast.success("Photo added.");
    };
    reader.readAsDataURL(file);
  };

  const retakePhoto = () => {
    setPhotoDataUrl(null);
    setCaptureMode(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  // ── Submit check-in ────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!passVerified)                       { toast.error("Please verify the gate pass first."); return; }
    if (!formData.id_verified_number.trim()) { toast.error("ID number is required.");             return; }

    setSubmitting(true);
    try {
      if (photoDataUrl) {
        const fd = new FormData();
        fd.append("pass_number",        formData.pass_number.trim().toUpperCase());
        fd.append("id_verified_type",   formData.id_verified_type);
        fd.append("id_verified_number", formData.id_verified_number.trim());
        if (formData.remarks.trim()) fd.append("remarks", formData.remarks.trim());
        const blob = await (await fetch(photoDataUrl)).blob();
        fd.append("photo", blob, "visitor_photo.jpg");
        await apiClient.post(`/gate/checkin/${requestId}`, fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      } else {
        await apiClient.post(`/gate/checkin/${requestId}`, {
          pass_number:        formData.pass_number.trim().toUpperCase(),
          id_verified_type:   formData.id_verified_type,
          id_verified_number: formData.id_verified_number.trim(),
          remarks:            formData.remarks.trim() || undefined,
        });
      }
      toast.success("Checked in. The visitor is now on the premises.");
      navigate("/gate");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Check-in failed. Please try again."));
    } finally { setSubmitting(false); }
  };

  // ── Loading / empty states ─────────────────────────────────────────────────
  if (loading) return <><PageHeader title="Check in" /><Spinner label="Loading the visit…" /></>;

  if (!request) return null;

  if (!request.pass_number) {
    return (
      <>
        <PageHeader title="Check in" />
        <Empty
          icon={AlertCircle}
          title="No gate pass yet"
          hint="A gate pass is issued when the visit is approved. Check in once it exists."
          action={<button type="button" onClick={() => navigate("/requests")} className="btn-outline">Back to requests</button>}
        />
      </>
    );
  }

  const pickMode = (id) => {
    setVerifyMode(id);
    if (id === 'webcam') startQrScan();
    if (id === 'upload') setTimeout(() => qrFileRef.current?.click(), 50);
  };
  const stepCls = passVerified ? "" : " opacity-50 pointer-events-none";
  const visitorName = request.visitor_name || request.company_name || "visitor";

  return (
    <div className="animate-fade-in">
      <PageHeader title={`Check in ${visitorName}`} meta={<span className="mono">{request.pass_number}</span>} />

      <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-x-8 gap-y-6 items-start">

        {/* ── Visit details ── */}
        <aside className="tile space-y-4 lg:sticky lg:top-4">
          {photoDataUrl && (
            <img src={photoDataUrl} alt="Visitor" className="w-20 h-20 rounded-lg object-cover" />
          )}
          <div>
            <p className="text-[14px] font-semibold text-ink">{request.visitor_name || request.company_name || "—"}</p>
            {request.visitor_phone && <p className="text-[12px] tabular text-ink-2">{request.visitor_phone}</p>}
            {request.visitor_email && <p className="text-[12px] text-muted break-all">{request.visitor_email}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Status value={request.status} />
            <Status value={request.visit_category} />
          </div>
          <KV items={[
            ["Host", request.host_name],
            request.department_name && ["Department", request.department_name],
            request.visit_date && ["Date", <span key="d" className="tabular">{fmtDate(request.visit_date)}</span>],
            request.visit_start_time && ["Time", <span key="t" className="tabular">
              {fmtTime(request.visit_start_time)}{request.visit_end_time ? ` – ${fmtTime(request.visit_end_time)}` : ""}
            </span>],
            ["Purpose", request.purpose],
          ]} className="!grid-cols-[84px_minmax(0,1fr)]" />
        </aside>

        {/* ── Check-in steps ── */}
        <form onSubmit={handleSubmit}>

          {/* ══ Step 1: Gate pass ══ */}
          <section>
            <SectionTitle icon={passVerified ? CheckCircle2 : Scan} tone={passVerified ? "success" : "brand"} title="1 · Verify the gate pass" />

            {passVerified ? (
              <div className="inset-cell flex items-center gap-3 !bg-[var(--success-soft)]">
                <CheckCircle2 size={18} className="text-success shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-success">Pass verified</p>
                  <p className="mono text-[12px] text-ink-2">{formData.pass_number}</p>
                </div>
                <button type="button" onClick={resetVerification} className="btn-ghost btn-sm">Scan again</button>
              </div>
            ) : (
              <>
                <input ref={qrFileRef} type="file" accept="image/*" onChange={handleQrFileUpload} className="hidden" />

                {!verifyMode && (
                  <div className="max-w-[640px]">
                    <ChoiceCards options={VERIFY_MODES} value={verifyMode} onPick={pickMode} label="How to verify the pass" />
                  </div>
                )}

                {verifyMode === 'webcam' && (
                  <div className="space-y-2 max-w-[560px]">
                    <div className="scan-stage" style={{ minHeight: 260 }}>
                      <video ref={qrVideoRef} autoPlay playsInline muted onPlay={handleQrVideoPlay} className="w-full max-h-[340px] object-cover" />
                      {qrScanActive && <ScanOverlay label="Looking for a QR code…" />}
                    </div>
                    <canvas ref={qrCanvasRef} className="hidden" />
                    <div className="flex gap-2">
                      <button type="button" onClick={() => { stopQrCamera(); setVerifyMode(null); }} className="btn-ghost btn-sm">
                        <ArrowLeft size={13} /> Other method
                      </button>
                      <button type="button" onClick={() => { stopQrCamera(); setVerifyMode('manual'); }} className="btn-ghost btn-sm">
                        <Keyboard size={13} /> Type the number
                      </button>
                    </div>
                  </div>
                )}

                {verifyMode === 'upload' && (
                  <div className="space-y-2 max-w-[560px]">
                    <button
                      type="button"
                      className="w-full flex flex-col items-center gap-1.5 py-8 rounded-lg border border-dashed border-line-strong bg-surface-alt hover:border-primary transition-colors"
                      onClick={() => qrFileRef.current?.click()}
                    >
                      <ZoomIn size={22} duo className="text-primary-strong" />
                      <span className="text-[13px] font-medium text-ink">Choose a QR image</span>
                      <span className="text-[11.5px] text-muted">Any image with the QR works, e.g. a screenshot of the gate-pass email.</span>
                    </button>
                    <button type="button" onClick={() => setVerifyMode(null)} className="btn-ghost btn-sm">
                      <ArrowLeft size={13} /> Other method
                    </button>
                  </div>
                )}

                {verifyMode === 'manual' && (
                  <div className="space-y-2 max-w-[420px]">
                    <Field label="Gate pass number" htmlFor="ci-pass">
                      <div className="flex gap-2">
                        <input
                          id="ci-pass"
                          type="text"
                          autoFocus
                          value={formData.pass_number}
                          onChange={e => setFormData(p => ({ ...p, pass_number: e.target.value.toUpperCase() }))}
                          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleVerifyPass(); }}}
                          placeholder="GP-20240526-0001"
                          className="control mono uppercase flex-1"
                        />
                        <button type="button" onClick={handleVerifyPass} className="btn-outline">Verify</button>
                      </div>
                    </Field>
                    <button type="button" onClick={() => setVerifyMode(null)} className="btn-ghost btn-sm">
                      <ArrowLeft size={13} /> Other method
                    </button>
                  </div>
                )}
              </>
            )}
          </section>

          {/* ══ Step 2: Photo ══ */}
          <section className={`section${stepCls}`} aria-disabled={!passVerified}>
            <SectionTitle icon={Camera} title="2 · Visitor photo" meta="Optional" />
            <canvas ref={canvasRef} className="hidden" />

            {!photoDataUrl && captureMode !== "camera" && (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={startCamera} className="btn-outline"><Camera size={14} /> Use camera</button>
                <button type="button" onClick={() => fileRef.current?.click()} className="btn-outline"><Upload size={14} /> Upload photo</button>
                <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handleFileUpload} className="hidden" />
              </div>
            )}

            {captureMode === "camera" && !photoDataUrl && (
              <div className="space-y-2 max-w-[560px]">
                <div className="scan-stage" style={{ minHeight: 260 }}>
                  <video ref={videoRef} autoPlay playsInline muted className="w-full max-h-[320px] object-cover" />
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={capturePhoto} className="btn-primary"><Camera size={14} /> Take photo</button>
                  <button type="button" onClick={stopCamera} className="btn-outline"><X size={14} /> Cancel</button>
                </div>
              </div>
            )}

            {photoDataUrl && (
              <div className="flex items-start gap-4">
                <img src={photoDataUrl} alt="Captured visitor" className="w-28 h-28 object-cover rounded-lg border border-line" />
                <div className="space-y-1 pt-1">
                  <p className="text-[13px] font-medium text-ink flex items-center gap-1.5">
                    <Check size={14} weight="bold" className="text-success" /> Photo ready
                  </p>
                  <p className="text-[12px] text-muted">Saved with the check-in record.</p>
                  <button type="button" onClick={retakePhoto} className="btn-ghost btn-sm !px-0">
                    <RotateCcw size={13} /> Retake
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* ══ Step 3: ID ══ */}
          <section className={`section${stepCls}`} aria-disabled={!passVerified}>
            <SectionTitle icon={CreditCard} title="3 · ID check" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 max-w-[640px]">
              <Field label="ID type" required>
                <Select name="id_verified_type" required value={formData.id_verified_type} onChange={handleChange} aria-label="ID type">
                  <option value="AADHAAR">Aadhaar</option>
                  <option value="PAN">PAN</option>
                  <option value="DRIVING_LICENSE">Driving licence</option>
                  <option value="PASSPORT">Passport</option>
                  <option value="VOTER_ID">Voter ID</option>
                  <option value="OTHER">Other</option>
                </Select>
              </Field>
              <Field label="ID number" htmlFor="ci-id" required>
                <input id="ci-id" type="text" name="id_verified_number" required value={formData.id_verified_number}
                  onChange={handleChange} placeholder="As printed on the ID" className="control mono" />
              </Field>
              <Field label="Remarks" htmlFor="ci-remarks" className="sm:col-span-2">
                <textarea id="ci-remarks" name="remarks" rows={2} value={formData.remarks} onChange={handleChange}
                  placeholder="Optional: anything noted, or items brought in" className="control resize-none" />
              </Field>
            </div>
          </section>

          {/* ══ Actions ══ */}
          <div className="mt-6 pt-4 border-t border-line flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={submitting || !passVerified || !formData.id_verified_number}
              className="btn-primary"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {submitting ? "Checking in…" : "Check in"}
            </button>
            <button type="button" onClick={() => navigate("/gate")} className="btn-outline">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
