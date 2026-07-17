// frontend/src/pages/gate/CheckIn.jsx
import { useState, useCallback, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Check, AlertCircle, Scan, Phone, User, Building,
  Camera, Upload, X, RotateCcw, QrCode, Keyboard,
  CheckCircle2, ZoomIn,
} from "lucide-react";
import jsQR from "jsqr";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";
import StatusBadge from "../../components/shared/StatusBadge";

const CATEGORY_LABELS = {
  EMPLOYEE_VISIT:    'Employee Visit',
  VENDOR:            'Vendor',
  SPOT:              'Walk-in',
  PERSONAL_VISIT:    'Personal Visit',
};

// ── QR scan modes for Step 1 ──────────────────────────────────────────────────
const VERIFY_MODES = [
  { id: 'webcam', label: 'Scan with Webcam',  icon: QrCode,    desc: 'Point camera at QR code' },
  { id: 'upload', label: 'Upload QR Image',   icon: Upload,    desc: 'Upload screenshot or photo' },
  { id: 'manual', label: 'Enter Manually',    icon: Keyboard,  desc: 'Type the pass number' },
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
  const [qrStream,     setQrStream]     = useState(null);
  const [qrDetected,   setQrDetected]   = useState(false);
  const qrVideoRef    = useRef(null);
  const qrCanvasRef   = useRef(null);
  const qrFileRef     = useRef(null);
  const rafRef        = useRef(null);

  // ── Step 2: visitor photo capture ─────────────────────────────────────────
  const [captureMode,  setCaptureMode]  = useState(null); // null | 'camera' | 'preview'
  const [cameraStream, setCameraStream] = useState(null);
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

  // Cleanup cameras on unmount
  useEffect(() => {
    return () => {
      stopQrCamera();
      if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (e) =>
    setFormData(p => ({ ...p, [e.target.name]: e.target.value }));

  // ── QR Verification helpers ────────────────────────────────────────────────

  const stopQrCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (qrStream) qrStream.getTracks().forEach(t => t.stop());
    setQrStream(null);
    setQrScanActive(false);
  }, [qrStream]);

  /**
   * Verify a decoded pass string against the request's expected pass_number.
   */
  const verifyPassString = useCallback((rawData) => {
    if (!rawData) return;

    // The gate pass QR encodes a JSON object: { pass_number, visit_request_id, visit_date, visitor_name }
    // Try to parse JSON first; fall back to treating rawData as a plain pass number string.
    let passNumber = rawData.trim();
    try {
      const parsed = JSON.parse(rawData);
      if (parsed?.pass_number) {
        passNumber = parsed.pass_number;
      }
    } catch (_) {
      // rawData is a plain string — use it as-is
    }

    const entered  = passNumber.trim().toUpperCase();
    const expected = (request?.pass_number || "").trim().toUpperCase();

    

    setFormData(p => ({ ...p, pass_number: entered }));
    if (entered === expected) {
      setPassVerified(true);
      setQrDetected(true);
      toast.success("Gate pass verified ✓");
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
      setQrStream(stream);
      setQrScanActive(true);
      setQrDetected(false);
      setTimeout(() => {
        if (qrVideoRef.current) {
          qrVideoRef.current.srcObject = stream;
          qrVideoRef.current.play();
        }
      }, 80);
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
      toast.success("Gate pass verified ✓");
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
      setCameraStream(stream);
      setCaptureMode("camera");
      setPhotoDataUrl(null);
      setTimeout(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      }, 60);
    } catch {
      toast.error("Camera not accessible. Try uploading a photo instead.");
    }
  };

  const stopCamera = () => {
    if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
    setCameraStream(null);
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
    toast.success("Photo captured ✓");
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setPhotoDataUrl(ev.target.result);
      setCaptureMode("preview");
      toast.success("Photo uploaded ✓");
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
      toast.success("Check-in successful! Visitor is now inside.");
      navigate("/gate");
    } catch (err) {
      toast.error(err.response?.data?.message || "Check-in failed.");
    } finally { setSubmitting(false); }
  };

  // ── Loading / empty states ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <div
          className="w-7 h-7 rounded-full border-2 animate-spin"
          style={{ borderColor: "var(--color-border)", borderTopColor: "var(--color-accent)" }}
        />
      </div>
    );
  }

  if (!request) return null;

  if (!request.pass_number) {
    return (
      <div className="max-w-xl mx-auto py-20 px-4 text-center">
        <div className="vms-card rounded-md p-10 shadow-card">
          <AlertCircle className="w-12 h-12 text-blue-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-loud mb-2">Gate Pass Not Generated</h2>
          <p className="text-muted mb-6">A gate pass must be generated before check-in can proceed.</p>
          <button onClick={() => navigate("/requests")} className="btn-primary">
            Back to Requests
          </button>
        </div>
      </div>
    );
  }

  const inputCls = "w-full bg-bg-primary border-0 border-b border-subtle px-0 py-2 text-loud focus:ring-0 focus:border-border transition-colors duration-300";

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 sm:px-6 lg:px-8 animate-fade-in">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-loud">Gate <em className="italic">Check-In</em></h1>
        <p className="text-muted mt-2">Verify gate pass and ID to grant entry.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

        {/* ── Left: Visitor Info Card ────────────────────────────────────── */}
        <div className="lg:col-span-4">
          <div className="vms-card rounded-md p-5 sm:p-6 shadow-card lg:sticky lg:top-8 space-y-5">
            <h2
              className="text-lg font-semibold text-loud pb-3"
              style={{ borderBottom: "1px solid var(--color-border)" }}
            >
              Visit Details
            </h2>

            <div className="space-y-4">
              {/* Captured photo preview */}
              {photoDataUrl && (
                <div className="flex flex-col items-center pb-2">
                  <img
                    src={photoDataUrl}
                    alt="Visitor"
                    className="w-24 h-24 rounded-full object-cover border-2"
                    style={{ borderColor: "var(--color-accent)" }}
                  />
                  <p className="text-[10px] text-faint mt-1.5 uppercase tracking-wider">Visitor Photo</p>
                </div>
              )}

              {/* Visitor */}
              <div>
                <p className="text-xs text-faint mb-1 flex items-center gap-1">
                  <User size={11} /> Visitor
                </p>
                <p className="font-semibold text-loud">
                  {request.visitor_name || request.company_name || "—"}
                </p>
                {request.visitor_phone && (
                  <p className="text-xs text-muted flex items-center gap-1 mt-0.5">
                    <Phone size={10} /> {request.visitor_phone}
                  </p>
                )}
                {request.visitor_email && (
                  <p className="text-xs text-muted mt-0.5">{request.visitor_email}</p>
                )}
              </div>

              {/* Host */}
              <div>
                <p className="text-xs text-faint mb-1 flex items-center gap-1">
                  <Building size={11} /> Host
                </p>
                <p className="font-medium text-loud">{request.host_name || "—"}</p>
                <p className="text-xs text-muted">{request.department_name}</p>
              </div>

              {/* Purpose */}
              <div>
                <p className="text-xs text-faint mb-1">Purpose</p>
                <p className="text-sm text-loud leading-relaxed">{request.purpose}</p>
              </div>

              {/* Scheduled Date */}
              {request.visit_date && (
                <div>
                  <p className="text-xs text-faint mb-1">Scheduled Date</p>
                  <p className="text-sm font-semibold text-loud">
                    {new Date(request.visit_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
              )}

              {/* Category + Status */}
              <div
                className="pt-3 flex flex-wrap gap-2"
                style={{ borderTop: "1px solid var(--color-border)" }}
              >
                <span
                  className="text-[10px] px-2 py-0.5 rounded font-medium uppercase tracking-wider"
                  style={{ background: "var(--color-info-bg)", color: "var(--color-info)" }}
                >
                  {CATEGORY_LABELS[request.visit_category] ?? request.visit_category}
                </span>
                <StatusBadge status={request.status} />
              </div>
            </div>
          </div>
        </div>

        {/* ── Right: Three-step check-in form ───────────────────────────── */}
        <div className="lg:col-span-8">
          <form onSubmit={handleSubmit} className="vms-card rounded-md p-6 sm:p-8 shadow-card space-y-8">

            {/* ══ Step 1: Gate Pass Verification ════════════════════════════ */}
            <div>
              <h3 className="text-[16px] font-semibold text-loud mb-4 flex items-center gap-2">
                {passVerified
                  ? <CheckCircle2 className="w-5 h-5 text-green-500" />
                  : <Scan className="w-5 h-5 text-blue-500" />}
                Step 1: Verify Gate Pass
              </h3>

              {/* ── Verified state ── */}
              {passVerified ? (
                <div className="bg-green-50 border border-green-200 p-4 rounded-md flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                    <Check className="w-5 h-5 text-green-600" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-green-800">Pass Verified Successfully</p>
                    <p className="text-xs text-green-600 font-mono mt-0.5">{formData.pass_number}</p>
                  </div>
                  <button
                    type="button"
                    onClick={resetVerification}
                    className="text-xs text-green-700 underline shrink-0"
                  >
                    Reset
                  </button>
                </div>
              ) : (
                <>
                  {/* Mode picker — shown only when no mode selected yet */}
                  {!verifyMode && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
                      {VERIFY_MODES.map(m => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            setVerifyMode(m.id);
                            if (m.id === 'webcam') startQrScan();
                            if (m.id === 'upload') setTimeout(() => qrFileRef.current?.click(), 50);
                          }}
                          className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                          style={{
                            borderColor: "var(--color-border)",
                            background: "var(--color-bg-primary)",
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.borderColor = "var(--color-accent)";
                            e.currentTarget.style.background  = "var(--color-mixed-bg)";
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.borderColor = "var(--color-border)";
                            e.currentTarget.style.background  = "var(--color-bg-primary)";
                          }}
                        >
                          <div
                            className="w-11 h-11 rounded-full flex items-center justify-center"
                            style={{ background: "var(--color-info-bg)" }}
                          >
                            <m.icon className="w-5 h-5" style={{ color: "var(--color-info)" }} />
                          </div>
                          <div className="text-center">
                            <p className="text-sm font-semibold text-loud">{m.label}</p>
                            <p className="text-[11px] text-faint mt-0.5">{m.desc}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Hidden QR file input */}
                  <input
                    ref={qrFileRef}
                    type="file"
                    accept="image/*"
                    onChange={handleQrFileUpload}
                    className="hidden"
                  />

                  {/* ── Webcam QR scanner ── */}
                  {verifyMode === 'webcam' && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm text-muted">Point the visitor's QR code at the camera.</p>
                        <button
                          type="button"
                          onClick={() => { stopQrCamera(); setVerifyMode(null); }}
                          className="text-xs text-faint underline"
                        >
                          ← Back
                        </button>
                      </div>

                      {/* Live viewfinder */}
                      <div
                        className="relative rounded-xl overflow-hidden bg-black flex items-center justify-center"
                        style={{ minHeight: "260px" }}
                      >
                        <video
                          ref={qrVideoRef}
                          autoPlay
                          playsInline
                          muted
                          onPlay={handleQrVideoPlay}
                          className="w-full max-h-[340px] object-cover"
                        />
                        {/* QR target overlay */}
                        {qrScanActive && (
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="w-48 h-48 relative">
                              {/* Corner brackets */}
                              {['top-left','top-right','bottom-left','bottom-right'].map(corner => (
                                <div
                                  key={corner}
                                  className="absolute w-8 h-8"
                                  style={{
                                    top:    corner.includes('top')    ? 0 : 'auto',
                                    bottom: corner.includes('bottom') ? 0 : 'auto',
                                    left:   corner.includes('left')   ? 0 : 'auto',
                                    right:  corner.includes('right')  ? 0 : 'auto',
                                    borderTop:    corner.includes('top')    ? '3px solid #3b82f6' : 'none',
                                    borderBottom: corner.includes('bottom') ? '3px solid #3b82f6' : 'none',
                                    borderLeft:   corner.includes('left')   ? '3px solid #3b82f6' : 'none',
                                    borderRight:  corner.includes('right')  ? '3px solid #3b82f6' : 'none',
                                    borderRadius: corner === 'top-left'     ? '6px 0 0 0'
                                                : corner === 'top-right'    ? '0 6px 0 0'
                                                : corner === 'bottom-left'  ? '0 0 0 6px'
                                                                            : '0 0 6px 0',
                                  }}
                                />
                              ))}
                              {/* Scanning line animation */}
                              <div
                                className="absolute left-1 right-1 h-0.5"
                                style={{
                                  background: 'linear-gradient(90deg, transparent, #3b82f6, transparent)',
                                  animation: 'qr-scan-line 1.8s ease-in-out infinite',
                                  top: '50%',
                                }}
                              />
                            </div>
                          </div>
                        )}
                        {/* Scanning status pill */}
                        {qrScanActive && (
                          <div
                            className="absolute bottom-3 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5"
                            style={{ background: 'rgba(0,0,0,0.7)', color: '#3b82f6' }}
                          >
                            <span
                              className="w-2 h-2 rounded-full inline-block"
                              style={{ background: '#3b82f6', animation: 'pulse 1s infinite' }}
                            />
                            Scanning for QR code…
                          </div>
                        )}
                      </div>
                      {/* Hidden canvas for jsQR */}
                      <canvas ref={qrCanvasRef} className="hidden" />

                      <div className="flex gap-2 mt-2">
                        <button
                          type="button"
                          onClick={() => { stopQrCamera(); setVerifyMode(null); }}
                          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm text-muted hover:bg-mixed-bg transition-colors"
                          style={{ borderColor: "var(--color-border)" }}
                        >
                          <X className="w-4 h-4" /> Cancel Scan
                        </button>
                        <button
                          type="button"
                          onClick={() => { stopQrCamera(); setVerifyMode('manual'); }}
                          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm text-muted hover:bg-mixed-bg transition-colors"
                          style={{ borderColor: "var(--color-border)" }}
                        >
                          <Keyboard className="w-4 h-4" /> Switch to Manual
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ── QR Upload feedback ── */}
                  {verifyMode === 'upload' && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm text-muted">Upload a photo or screenshot of the gate pass QR code.</p>
                        <button
                          type="button"
                          onClick={() => setVerifyMode(null)}
                          className="text-xs text-faint underline"
                        >
                          ← Back
                        </button>
                      </div>
                      <div
                        className="flex flex-col items-center justify-center gap-3 p-8 rounded-xl border-2 border-dashed cursor-pointer hover:bg-mixed-bg transition-colors"
                        style={{ borderColor: "var(--color-border)" }}
                        onClick={() => qrFileRef.current?.click()}
                      >
                        <div
                          className="w-14 h-14 rounded-full flex items-center justify-center"
                          style={{ background: "var(--color-info-bg)" }}
                        >
                          <ZoomIn className="w-6 h-6" style={{ color: "var(--color-info)" }} />
                        </div>
                        <p className="text-sm font-medium text-loud">Click to upload QR image</p>
                        <p className="text-xs text-faint text-center">
                          Accepts any image containing a QR code.<br />Gate pass email screenshots work perfectly.
                        </p>
                      </div>
                      <div className="flex gap-2 mt-1">
                        <button
                          type="button"
                          onClick={() => setVerifyMode(null)}
                          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm text-muted hover:bg-mixed-bg transition-colors"
                          style={{ borderColor: "var(--color-border)" }}
                        >
                          ← Choose Another Method
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ── Manual entry ── */}
                  {verifyMode === 'manual' && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm text-muted">Type the gate pass number exactly as shown.</p>
                        <button
                          type="button"
                          onClick={() => setVerifyMode(null)}
                          className="text-xs text-faint underline"
                        >
                          ← Back
                        </button>
                      </div>
                      <div className="bg-bg-primary border border-subtle p-5 rounded-xl space-y-3">
                        <div className="flex gap-3">
                          <input
                            type="text"
                            value={formData.pass_number}
                            onChange={e => setFormData(p => ({ ...p, pass_number: e.target.value.toUpperCase() }))}
                            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleVerifyPass(); }}}
                            placeholder="e.g. GP-20240526-0001"
                            className="flex-1 bg-transparent border-0 border-b border-subtle px-0 py-2 text-loud font-mono uppercase tracking-widest focus:ring-0 focus:border-border"
                          />
                          <button
                            type="button"
                            onClick={handleVerifyPass}
                            className="px-5 py-2 rounded-full text-sm font-semibold transition-all duration-200 hover:scale-105 active:scale-95"
                            style={{ background: "var(--color-accent)", color: "#fff" }}
                          >
                            Verify
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ══ Step 2: Capture Visitor Photo ═════════════════════════════ */}
            <div
              className={`pt-8 border-t transition-opacity duration-300 ${!passVerified ? "opacity-40 pointer-events-none" : ""}`}
              style={{ borderColor: "var(--color-border)" }}
            >
              <h3 className="text-[16px] font-semibold text-loud mb-4 flex items-center gap-2">
                <Camera className="w-5 h-5 text-accent" />
                Step 2: Capture Visitor Photo
                <span className="text-xs font-normal text-faint ml-1">(optional)</span>
              </h3>

              {/* Hidden canvas for snapshot */}
              <canvas ref={canvasRef} className="hidden" />

              {/* No photo yet — show buttons */}
              {!photoDataUrl && captureMode !== "camera" && (
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    type="button"
                    onClick={startCamera}
                    className="flex-1 flex items-center justify-center gap-2 py-4 px-4 rounded-md border transition-all duration-200 hover:bg-mixed-bg"
                    style={{ borderColor: "var(--color-border)" }}
                  >
                    <Camera className="w-5 h-5 text-accent" />
                    <div className="text-left">
                      <p className="text-sm font-medium text-loud">Use Webcam</p>
                      <p className="text-xs text-faint">Live camera capture</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-2 py-4 px-4 rounded-md border transition-all duration-200 hover:bg-mixed-bg"
                    style={{ borderColor: "var(--color-border)" }}
                  >
                    <Upload className="w-5 h-5 text-accent" />
                    <div className="text-left">
                      <p className="text-sm font-medium text-loud">Upload / Take Photo</p>
                      <p className="text-xs text-faint">File or mobile camera</p>
                    </div>
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </div>
              )}

              {/* Camera live view */}
              {captureMode === "camera" && !photoDataUrl && (
                <div className="space-y-3">
                  <div
                    className="relative rounded-md overflow-hidden bg-black flex items-center justify-center"
                    style={{ minHeight: "260px" }}
                  >
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full max-h-[320px] object-cover"
                    />
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={capturePhoto}
                      className="flex-1 flex items-center justify-center gap-2 py-3 rounded-md font-medium text-sm transition-all duration-200"
                      style={{ background: "var(--color-accent)", color: "#fff" }}
                    >
                      <Camera className="w-4 h-4" /> Capture Photo
                    </button>
                    <button
                      type="button"
                      onClick={stopCamera}
                      className="px-4 py-3 rounded-md border text-muted hover:bg-mixed-bg transition-colors"
                      style={{ borderColor: "var(--color-border)" }}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* Photo preview */}
              {photoDataUrl && (
                <div className="flex items-start gap-5 p-4 rounded-md border" style={{ borderColor: "var(--color-border)" }}>
                  <img
                    src={photoDataUrl}
                    alt="Captured visitor"
                    className="w-28 h-28 object-cover rounded-md border"
                    style={{ borderColor: "var(--color-border)" }}
                  />
                  <div className="space-y-2 pt-1">
                    <p className="text-sm font-semibold text-loud flex items-center gap-1.5">
                      <Check className="w-4 h-4 text-green-500" /> Photo ready
                    </p>
                    <p className="text-xs text-faint">This photo will be saved with the check-in record.</p>
                    <button
                      type="button"
                      onClick={retakePhoto}
                      className="flex items-center gap-1.5 text-xs text-accent underline mt-2"
                    >
                      <RotateCcw className="w-3 h-3" /> Retake / Change
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ══ Step 3: ID Verification ════════════════════════════════════ */}
            <div
              className={`pt-8 border-t transition-opacity duration-300 ${!passVerified ? "opacity-40 pointer-events-none" : ""}`}
              style={{ borderColor: "var(--color-border)" }}
            >
              <h3 className="text-[16px] font-semibold text-loud mb-6">Step 3: ID Verification</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-loud">ID Type *</label>
                  <select
                    name="id_verified_type"
                    required
                    value={formData.id_verified_type}
                    onChange={handleChange}
                    className={inputCls}
                  >
                    <option value="AADHAAR">Aadhaar</option>
                    <option value="PAN">PAN</option>
                    <option value="DRIVING_LICENSE">Driving License</option>
                    <option value="PASSPORT">Passport</option>
                    <option value="VOTER_ID">Voter ID</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-loud">ID Number *</label>
                  <input
                    type="text"
                    name="id_verified_number"
                    required
                    value={formData.id_verified_number}
                    onChange={handleChange}
                    placeholder="Enter ID number"
                    className={inputCls}
                  />
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <label className="block text-sm font-medium text-loud">Remarks (Optional)</label>
                  <textarea
                    name="remarks"
                    rows={2}
                    value={formData.remarks}
                    onChange={handleChange}
                    placeholder="Any observations or items being brought in..."
                    className={`${inputCls} resize-none`}
                  />
                </div>
              </div>
            </div>

            {/* ══ Actions ════════════════════════════════════════════════════ */}
            <div
              className="pt-6 flex justify-end gap-4"
              style={{ borderTop: "1px solid var(--color-border)" }}
            >
              <button
                type="button"
                onClick={() => navigate("/gate")}
                className="btn-secondary text-accent uppercase tracking-widest text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !passVerified || !formData.id_verified_number}
                className="btn-primary uppercase tracking-widest text-sm font-medium flex items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {submitting
                  ? "Processing..."
                  : <><Check className="w-4 h-4" /> Complete Check-In</>
                }
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* QR scan line animation */}
      <style>{`
        @keyframes qr-scan-line {
          0%   { top: 10%; opacity: 0; }
          10%  { opacity: 1; }
          90%  { opacity: 1; }
          100% { top: 90%; opacity: 0; }
        }
      `}</style>
    </div>
  );
}
