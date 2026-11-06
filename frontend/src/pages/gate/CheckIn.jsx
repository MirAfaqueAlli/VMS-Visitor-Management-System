// frontend/src/pages/gate/CheckIn.jsx
// Gate check-in (DESIGN_RULES §11/§12): visit details tile on the left; on the
// right three steps — verify the pass, photo (optional), ID — then Check in.
import { useState, useCallback, useEffect, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import {
  Check, AlertCircle, AlertTriangle, Scan, Camera, Upload, X, RotateCcw, QrCode, Keyboard,
  CheckCircle2, ZoomIn, CreditCard, ArrowLeft, Loader2,
} from "../../components/icons";
import jsQR from "jsqr";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";
import { getApiErrorMessage } from "../../utils/apiError";
import Select from "../../components/Select";
import {
  PageHeader, SectionTitle, KV, Status, Field, Empty, Spinner, ChoiceCards, ScanOverlay, Note,
} from "../../components/ui";
import { fmtDate, fmtTime } from "../../lib/format";
import { idProofLabel } from "../../lib/idProof";

// ── QR scan modes for Step 1 ──────────────────────────────────────────────────
const VERIFY_MODES = [
  { id: 'webcam', label: 'Scan with camera', icon: QrCode,   desc: 'Hold the QR code up to the camera' },
  { id: 'upload', label: 'Upload QR image',  icon: Upload,   desc: 'A photo or screenshot of the pass' },
  { id: 'manual', label: 'Type the number',  icon: Keyboard, desc: 'Enter the pass number by hand' },
];

/**
 * Why this visit can't be checked in today (the server refuses it too), or null.
 * visit_day comes from the API: 'past' | 'today' | 'future', in IST.
 */
/** Where the visitor's ID proof / photo on record came from, in words. */
const SOURCE_TEXT = {
  request:        "the visit request",
  profile:        "the visitor's portal profile",
  previous_visit: "their last visit",
};

function offDay(request) {
  if (!request) return null;
  const date = fmtDate(request.visit_date);
  if (request.status === "EXPIRED" || (request.visit_day === "past" && ["APPROVED", "SCHEDULED"].includes(request.status))) {
    return { tone: "danger", title: "Gate pass expired", text: `This visit was booked for ${date} — the pass can't be used today.` };
  }
  if (request.visit_day === "future") {
    return { tone: "warning", title: "Not today", text: `This visit is booked for ${date}. Check-in is allowed only on the visit date.` };
  }
  return null;
}

export default function CheckIn() {
  const { requestId } = useParams();
  const navigate      = useNavigate();
  const handedPass    = useLocation().state?.verifiedPass;   // already checked by "Check in by pass"

  const [request,      setRequest]      = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [submitting,   setSubmitting]   = useState(false);
  const [passVerified, setPassVerified] = useState(false);
  const [autoVerified, setAutoVerified] = useState(null);   // 'walk-in' | 'lookup' — verified without a scan here

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
      const data = res.data?.data ?? res.data;
      setRequest(data);
      // The ID taken with the request — security checks the card against it
      // (masked numbers aren't pre-filled; the API sends full ones to the gate)
      if (data?.id_proof_type) {
        setFormData((p) => ({
          ...p,
          id_verified_type: data.id_proof_type,
          id_verified_number: data.id_proof_number && !/X{4}/.test(data.id_proof_number) ? data.id_proof_number : p.id_verified_number,
        }));
      }
      // Verified already: checked by "Check in by pass", or a walk-in — registered here at
      // the gate with the visitor present, so scanning the pass again proves nothing
      const walkIn = data?.visit_category === "SPOT" && !!data?.pass_number;
      if (((handedPass && data?.pass_number === handedPass) || walkIn) && !offDay(data)) {
        setPassVerified(true);
        setAutoVerified(walkIn ? "walk-in" : "lookup");
        setFormData((p) => ({ ...p, pass_number: data.pass_number }));
      }
    } catch {
      toast.error("Failed to load visit request.");
      navigate("/requests");
    } finally { setLoading(false); }
  }, [requestId, navigate, handedPass]);

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
    const block = offDay(request);
    if (entered === expected && block) {
      toast.error(`${block.title}. ${block.text}`, { duration: 6000 });
      return;
    }
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
    const block = offDay(request);
    if (entered === expected && block) {
      toast.error(`${block.title}. ${block.text}`, { duration: 6000 });
      return;
    }
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
    setAutoVerified(null);
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

  // An employee visiting carries the staff ID card — the ID check is optional for them
  const idOptional = request?.visit_category === "EMPLOYEE_VISIT";
  // An ID already on record is shown, not edited — the server checks the card against it
  const idLocked = !!request?.id_proof_type;

  // ── Submit check-in ────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!passVerified)                       { toast.error("Please verify the gate pass first."); return; }
    if (!idOptional && !idLocked && !formData.id_verified_number.trim()) { toast.error("ID number is required."); return; }

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
  const dayBlock = offDay(request);
  const visitorName = request.visitor_name || request.company_name || "visitor";

  return (
    <div className="animate-fade-in">
      <PageHeader title={`Check in ${visitorName}`} meta={<span className="mono">{request.pass_number}</span>} />
      {dayBlock && (
        <Note tone={dayBlock.tone} icon={dayBlock.tone === "danger" ? AlertCircle : AlertTriangle} className="mb-5">
          <b>{dayBlock.title}.</b> {dayBlock.text}
        </Note>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-x-8 gap-y-6 items-start">

        {/* ── Visit details ── */}
        <aside className="tile space-y-4 lg:sticky lg:top-4">
          {(photoDataUrl || request.visitor_photo_path) && (
            <img src={photoDataUrl || request.visitor_photo_path} alt="Visitor" className="w-20 h-20 rounded-lg object-cover" />
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
            request.id_proof_type && ["ID on record", <span key="id">{idProofLabel(request.id_proof_type)}{" "}
              <span className="mono text-ink-2">{request.id_proof_number}</span></span>],
            request.last_check_in_at && ["Last visit", <span key="lv" className="tabular">{fmtDate(request.last_check_in_at)}</span>],
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
                  <p className="text-[13px] font-medium text-success">
                    {autoVerified === "walk-in" ? "Walk-in — verified automatically" : "Pass verified"}
                  </p>
                  <p className="mono text-[12px] text-ink-2">{formData.pass_number}</p>
                  {autoVerified === "walk-in" && (
                    <p className="text-[11.5px] text-ink-2 mt-0.5">Registered at this gate with the visitor present — no scan needed.</p>
                  )}
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

            {/* Photo on record: shown here, saved with the check-in unless a new one is taken */}
            {request.visitor_photo_path && !photoDataUrl && captureMode !== "camera" && (
              <div className="flex items-start gap-4 mb-3">
                <img src={request.visitor_photo_path} alt="Visitor photo on record" className="w-28 h-28 object-cover rounded-lg border border-line" />
                <div className="space-y-1 pt-1 min-w-0">
                  <p className="text-[13px] font-medium text-ink flex items-center gap-1.5">
                    <Check size={14} weight="bold" className="text-success" /> Photo on record
                  </p>
                  <p className="text-[12px] text-muted">
                    From {SOURCE_TEXT[request.photo_source] || "an earlier record"} — saved with this check-in.
                    Take a new one only if it doesn&apos;t match the visitor.
                  </p>
                </div>
              </div>
            )}

            {!photoDataUrl && captureMode !== "camera" && (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={startCamera} className="btn-outline">
                  <Camera size={14} /> {request.visitor_photo_path ? "Take a new photo" : "Use camera"}
                </button>
                <button type="button" onClick={() => fileRef.current?.click()} className="btn-outline">
                  <Upload size={14} /> {request.visitor_photo_path ? "Upload a new photo" : "Upload photo"}
                </button>
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
            <SectionTitle icon={CreditCard} title="3 · ID check" meta={idOptional ? "Optional for employees" : undefined} />
            {request.id_proof_type && (
              <p className="text-[12.5px] text-ink-2 mb-3 max-w-[640px]">
                ID on record from {SOURCE_TEXT[request.id_proof_source] || "an earlier record"} — it can&apos;t be changed at the gate.
                Check that the visitor&apos;s card shows this number before checking in.
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 max-w-[640px]">
              <Field label="ID type" required={!idOptional && !idLocked}>
                <Select name="id_verified_type" required value={formData.id_verified_type} onChange={handleChange} aria-label="ID type"
                  disabled={idLocked}>
                  <option value="AADHAAR">Aadhaar</option>
                  <option value="PAN">PAN</option>
                  <option value="DRIVING_LICENSE">Driving licence</option>
                  <option value="PASSPORT">Passport</option>
                  <option value="VOTER_ID">Voter ID</option>
                  <option value="OTHER">Other</option>
                </Select>
              </Field>
              <Field label="ID number" htmlFor="ci-id" required={!idOptional && !idLocked}
                hint={idLocked ? undefined : idOptional ? "Optional — the visitor is an OHPC employee." : undefined}>
                <input id="ci-id" type="text" name="id_verified_number" required={!idOptional && !idLocked} value={formData.id_verified_number}
                  disabled={idLocked}
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
              disabled={submitting || !passVerified || (!idOptional && !idLocked && !formData.id_verified_number)}
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
