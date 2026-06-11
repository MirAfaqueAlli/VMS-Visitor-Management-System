// frontend/src/pages/gate/CheckOut.jsx
import { useState, useEffect, useCallback, useRef } from "react";
import {
  LogOut, Clock, User, Hash, QrCode, Upload, Keyboard,
  X, Check, CheckCircle2, ZoomIn, ShieldCheck, AlertCircle,
} from "lucide-react";
import jsQR from "jsqr";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";
import useSocketEvent from "../../hooks/useSocketEvent";

// ── QR scan modes (same as CheckIn) ──────────────────────────────────────────
const VERIFY_MODES = [
  { id: "webcam", label: "Scan with Webcam", icon: QrCode,   desc: "Point camera at QR code" },
  { id: "upload", label: "Upload QR Image",  icon: Upload,   desc: "Upload screenshot or photo" },
  { id: "manual", label: "Enter Manually",   icon: Keyboard, desc: "Type the pass number" },
];

// ─────────────────────────────────────────────────────────────────────────────
// QR Checkout Modal — 2 steps: QR verify → Confirm
// ─────────────────────────────────────────────────────────────────────────────
function QRCheckoutModal({ visitor, onClose, onSuccess }) {
  const [step, setStep] = useState(1); // 1 = QR, 2 = Confirm

  // Step 1 state
  const [verifyMode,   setVerifyMode]   = useState(null);
  const [qrScanActive, setQrScanActive] = useState(false);
  const [qrStream,     setQrStream]     = useState(null);
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
    return () => stopQrCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── QR helpers ───────────────────────────────────────────────────────────
  const stopQrCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (qrStream) qrStream.getTracks().forEach(t => t.stop());
    setQrStream(null);
    setQrScanActive(false);
  }, [qrStream]);

  const verifyPassString = useCallback((rawData) => {
    if (!rawData) return;
    let decoded = rawData.trim();
    try {
      const parsed = JSON.parse(rawData);
      if (parsed?.pass_number) decoded = parsed.pass_number;
    } catch (_) {}
    const upper = decoded.trim().toUpperCase();

    // ── Validate against visitor's actual pass number ──────────────
    if (upper !== expectedPass) {
      setQrError(`QR code does not match this visitor's gate pass. Expected: ${expectedPass}`);
      toast.error("Wrong QR code! This does not belong to this visitor.");
      stopQrCamera();
      return;
    }

    setPassNumber(upper);
    setPassVerified(true);
    setQrError("");
    toast.success("QR code verified ✓ — matches visitor's gate pass");
    stopQrCamera();
  }, [stopQrCamera, expectedPass]);

  const startQrScan = async () => {
    setQrError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      setQrStream(stream);
      setQrScanActive(true);
      setTimeout(() => {
        if (qrVideoRef.current) { qrVideoRef.current.srcObject = stream; qrVideoRef.current.play(); }
      }, 80);
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
      toast.error("Wrong pass number! This does not match this visitor.");
      return;
    }
    setPassNumber(upper);
    setPassVerified(true);
    setQrError("");
    toast.success("Pass number verified ✓");
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!passVerified) { toast.error("Please verify the QR code first."); return; }

    setSubmitting(true);
    try {
      await apiClient.post("/gate/checkout/qr", {
        pass_number: passNumber.trim().toUpperCase(),
      });
      toast.success("✅ Visitor checked out. QR code invalidated.");
      onSuccess();
      onClose();
    } catch (err) {
      const msg = err.response?.data?.message || "QR checkout failed.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Shared styles ─────────────────────────────────────────────────────────
  const stepActive = (n) => n === step;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !submitting && onClose()} />
      <div
        className="relative z-10 w-full max-w-lg animate-fade-in"
        style={{
          background: "var(--color-bg-primary)",
          border: "1px solid var(--color-border)",
          borderRadius: "16px",
          boxShadow: "0 24px 64px rgba(0,0,0,0.35)",
          maxHeight: "92vh",
          overflowY: "auto",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "18px 20px 14px",
            borderBottom: "1px solid var(--color-border)",
            background: "var(--color-bg-secondary)",
            borderRadius: "16px 16px 0 0",
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: "rgba(139,92,246,0.15)" }}
              >
                <QrCode size={16} style={{ color: "#8b5cf6" }} />
              </div>
              <div>
                <h3 className="text-[14px] font-bold text-loud">QR Scan Checkout</h3>
                <p className="text-[11px] text-faint">{visitor.visitor_name} — <span className="font-mono">{expectedPass}</span></p>
              </div>
            </div>
            <button
              onClick={() => !submitting && onClose()}
              className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-mixed-bg transition-colors"
              style={{ color: "var(--color-text-faint)" }}
            >
              <X size={15} />
            </button>
          </div>

          {/* Step progress — 2 steps */}
          <div className="flex items-center gap-0 mt-4">
            {[
              { n: 1, label: "Scan QR" },
              { n: 2, label: "Confirm" },
            ].map(({ n, label }, i, arr) => (
              <div key={n} className="flex items-center" style={{ flex: n < arr.length ? "1" : "none" }}>
                <div className="flex flex-col items-center gap-0.5">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-all"
                    style={{
                      background: step > n ? "#22c55e" : step === n ? "#8b5cf6" : "var(--color-bg-primary)",
                      border: `2px solid ${step > n ? "#22c55e" : step === n ? "#8b5cf6" : "var(--color-border)"}`,
                      color: step >= n ? "#fff" : "var(--color-text-faint)",
                    }}
                  >
                    {step > n ? <Check size={12} /> : n}
                  </div>
                  <span className="text-[10px]" style={{ color: step === n ? "#8b5cf6" : "var(--color-text-faint)" }}>
                    {label}
                  </span>
                </div>
                {i < arr.length - 1 && (
                  <div
                    className="flex-1 h-0.5 mx-2 mb-3 transition-all"
                    style={{ background: step > n ? "#22c55e" : "var(--color-border)" }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "20px" }}>

          {/* ══ Step 1: Scan QR ══════════════════════════════════════════════ */}
          {stepActive(1) && (
            <div className="space-y-4">
              <p className="text-[13px] text-muted">
                Scan the <strong>visitor&apos;s QR code</strong> to verify their identity. Only the QR code for pass <strong className="font-mono">{expectedPass}</strong> will be accepted.
              </p>

              {/* QR mismatch error banner */}
              {qrError && (
                <div
                  className="flex items-start gap-3 p-3 rounded-xl text-[12px]"
                  style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "#991b1b" }}
                >
                  <AlertCircle size={16} style={{ color: "#ef4444", flexShrink: 0, marginTop: "1px" }} />
                  <div className="flex-1">
                    <p className="font-semibold">Wrong QR Code</p>
                    <p className="mt-0.5">{qrError}</p>
                  </div>
                  <button type="button" onClick={() => setQrError("")} className="text-[11px] underline shrink-0" style={{ color: "#991b1b" }}>Dismiss</button>
                </div>
              )}

              {passVerified ? (
                <div
                  className="flex items-center gap-3 p-4 rounded-xl"
                  style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.25)" }}
                >
                  <CheckCircle2 size={20} style={{ color: "#22c55e", flexShrink: 0 }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold" style={{ color: "#22c55e" }}>QR Code Verified ✓</p>
                    <p className="text-[11px] font-mono mt-0.5 text-faint truncate">{passNumber}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setPassVerified(false); setPassNumber(""); setVerifyMode(null); setQrError(""); stopQrCamera(); }}
                    className="text-[11px] underline"
                    style={{ color: "#22c55e", flexShrink: 0 }}
                  >
                    Reset
                  </button>
                </div>
              ) : (
                <>
                  {/* Mode picker */}
                  {!verifyMode && (
                    <div className="grid grid-cols-3 gap-2">
                      {VERIFY_MODES.map(m => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            setVerifyMode(m.id);
                            setQrError("");
                            if (m.id === "webcam") startQrScan();
                            if (m.id === "upload") setTimeout(() => qrFileRef.current?.click(), 50);
                          }}
                          className="flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all hover:scale-[1.02]"
                          style={{ borderColor: "var(--color-border)", background: "var(--color-bg-secondary)" }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = "#8b5cf6"; e.currentTarget.style.background = "rgba(139,92,246,0.06)"; }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--color-border)"; e.currentTarget.style.background = "var(--color-bg-secondary)"; }}
                        >
                          <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "rgba(139,92,246,0.12)" }}>
                            <m.icon size={16} style={{ color: "#8b5cf6" }} />
                          </div>
                          <p className="text-[11px] font-semibold text-loud text-center">{m.label}</p>
                          <p className="text-[10px] text-faint text-center leading-snug">{m.desc}</p>
                        </button>
                      ))}
                    </div>
                  )}

                  <input ref={qrFileRef} type="file" accept="image/*" onChange={handleQrFileUpload} className="hidden" />

                  {/* Webcam */}
                  {verifyMode === "webcam" && (
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <p className="text-[12px] text-muted">Point QR code at camera.</p>
                        <button type="button" onClick={() => { stopQrCamera(); setVerifyMode(null); }} className="text-[11px] text-faint underline">← Back</button>
                      </div>
                      <div className="relative rounded-xl overflow-hidden bg-black" style={{ minHeight: "220px" }}>
                        <video ref={qrVideoRef} autoPlay playsInline muted onPlay={handleQrVideoPlay} className="w-full max-h-[260px] object-cover" />
                        {qrScanActive && (
                          <>
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <div className="w-40 h-40 relative">
                                {["top-left","top-right","bottom-left","bottom-right"].map(c => (
                                  <div key={c} className="absolute w-7 h-7" style={{
                                    top: c.includes("top") ? 0 : "auto", bottom: c.includes("bottom") ? 0 : "auto",
                                    left: c.includes("left") ? 0 : "auto", right: c.includes("right") ? 0 : "auto",
                                    borderTop: c.includes("top") ? "3px solid #8b5cf6" : "none",
                                    borderBottom: c.includes("bottom") ? "3px solid #8b5cf6" : "none",
                                    borderLeft: c.includes("left") ? "3px solid #8b5cf6" : "none",
                                    borderRight: c.includes("right") ? "3px solid #8b5cf6" : "none",
                                    borderRadius: c === "top-left" ? "5px 0 0 0" : c === "top-right" ? "0 5px 0 0" : c === "bottom-left" ? "0 0 0 5px" : "0 0 5px 0",
                                  }} />
                                ))}
                                <div className="absolute left-1 right-1 h-0.5" style={{ background: "linear-gradient(90deg,transparent,#8b5cf6,transparent)", animation: "qr-scan-line 1.8s ease-in-out infinite", top: "50%" }} />
                              </div>
                            </div>
                            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[11px] font-medium flex items-center gap-1.5" style={{ background: "rgba(0,0,0,0.75)", color: "#8b5cf6" }}>
                              <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: "#8b5cf6", animation: "pulse 1s infinite" }} />
                              Scanning…
                            </div>
                          </>
                        )}
                      </div>
                      <canvas ref={qrCanvasRef} className="hidden" />
                      <button type="button" onClick={() => { stopQrCamera(); setVerifyMode("manual"); }} className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border text-[12px] text-muted hover:bg-mixed-bg" style={{ borderColor: "var(--color-border)" }}>
                        <Keyboard size={13} /> Switch to Manual
                      </button>
                    </div>
                  )}

                  {/* Upload */}
                  {verifyMode === "upload" && (
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <p className="text-[12px] text-muted">Upload a photo or screenshot of the QR code.</p>
                        <button type="button" onClick={() => setVerifyMode(null)} className="text-[11px] text-faint underline">← Back</button>
                      </div>
                      <div
                        className="flex flex-col items-center gap-2 p-8 rounded-xl border-2 border-dashed cursor-pointer hover:bg-mixed-bg transition-colors"
                        style={{ borderColor: "var(--color-border)" }}
                        onClick={() => qrFileRef.current?.click()}
                      >
                        <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "rgba(139,92,246,0.1)" }}>
                          <ZoomIn size={20} style={{ color: "#8b5cf6" }} />
                        </div>
                        <p className="text-[13px] font-medium text-loud">Click to upload QR image</p>
                        <p className="text-[11px] text-faint text-center">Gate pass email screenshots work perfectly.</p>
                      </div>
                      <button type="button" onClick={() => setVerifyMode(null)} className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border text-[12px] text-muted hover:bg-mixed-bg" style={{ borderColor: "var(--color-border)" }}>
                        ← Choose Another Method
                      </button>
                    </div>
                  )}

                  {/* Manual */}
                  {verifyMode === "manual" && (
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <p className="text-[12px] text-muted">Enter the gate pass number exactly.</p>
                        <button type="button" onClick={() => setVerifyMode(null)} className="text-[11px] text-faint underline">← Back</button>
                      </div>
                      <div className="flex gap-2" style={{ background: "var(--color-bg-secondary)", padding: "12px", borderRadius: "10px", border: "1px solid var(--color-border)" }}>
                        <input
                          type="text"
                          value={passNumber}
                          onChange={e => { setPassNumber(e.target.value.toUpperCase()); setQrError(""); }}
                          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleManualVerify(); } }}
                          placeholder="e.g. HO-20240606-0001"
                          className="flex-1 bg-transparent border-0 text-loud font-mono uppercase tracking-widest text-[13px] focus:ring-0 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={handleManualVerify}
                          className="px-4 py-1.5 rounded-full text-[12px] font-semibold text-white transition-all hover:scale-105"
                          style={{ background: "#8b5cf6" }}
                        >
                          Verify
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  disabled={!passVerified}
                  onClick={() => setStep(2)}
                  className="px-5 py-2 rounded-full text-[13px] font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:scale-105"
                  style={{ background: "#8b5cf6" }}
                >
                  Next: Confirm Checkout →
                </button>
              </div>
            </div>
          )}

          {/* ══ Step 2: Confirm ══════════════════════════════════════════════ */}
          {stepActive(2) && (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-2 py-2">
                <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: "rgba(139,92,246,0.1)" }}>
                  <ShieldCheck size={28} style={{ color: "#8b5cf6" }} />
                </div>
                <h4 className="text-[15px] font-bold text-loud text-center">Ready to Check Out</h4>
                <p className="text-[12px] text-faint text-center">The QR code will be immediately invalidated after checkout.</p>
              </div>

              {/* Summary */}
              <div className="space-y-2 rounded-xl p-4" style={{ background: "var(--color-bg-secondary)", border: "1px solid var(--color-border)" }}>
                <div className="flex justify-between text-[12px]">
                  <span className="text-faint">Visitor</span>
                  <span className="font-semibold text-loud">{visitor.visitor_name}</span>
                </div>
                <div className="flex justify-between text-[12px]">
                  <span className="text-faint">Gate Pass</span>
                  <span className="font-mono text-loud">{passNumber}</span>
                </div>
                <div className="flex justify-between text-[12px]">
                  <span className="text-faint">Check-In</span>
                  <span className="text-loud">
                    {new Date(visitor.check_in_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <div className="flex justify-between text-[12px]">
                  <span className="text-faint">QR Status</span>
                  <span className="font-semibold" style={{ color: "#22c55e" }}>✓ Verified</span>
                </div>
              </div>

              <div
                className="flex items-start gap-2 p-3 rounded-lg text-[11px]"
                style={{ background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.2)" }}
              >
                <QrCode size={13} style={{ color: "#8b5cf6", flexShrink: 0, marginTop: "1px" }} />
                <p style={{ color: "#6d28d9" }}>
                  <strong>QR Checkout:</strong> The gate pass QR will be <strong>permanently invalidated</strong> upon confirmation.
                </p>
              </div>

              <div className="flex justify-between pt-1">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  disabled={submitting}
                  className="px-4 py-2 rounded-full text-[12px] font-medium border hover:bg-mixed-bg transition-colors disabled:opacity-50"
                  style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
                >
                  ← Back
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="flex items-center gap-2 px-6 py-2 rounded-full text-[13px] font-semibold text-white transition-all hover:scale-105 disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{ background: submitting ? "#8b5cf6aa" : "#8b5cf6" }}
                >
                  {submitting ? (
                    <>
                      <span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      Processing…
                    </>
                  ) : (
                    <>
                      <ShieldCheck size={15} />
                      Confirm QR Checkout
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
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
    toast.success(`New approved visit: ${data.visitor_name || "Visitor"} arriving today!`, { icon: "✅", duration: 7000 });
  }, []), []);

  useSocketEvent("visit:checkin", useCallback((data) => {
    setApprovedToday(prev => prev.filter(v => v.id !== data.visit_request_id));
    setActiveVisitors(prev => {
      if (prev.some(v => v.visit_log_id === data.visit_log_id)) return prev;
      return [data, ...prev];
    });
    toast.success(`${data.visitor_name || "A visitor"} just checked in!`, { icon: "🟢" });
  }, []), []);

  useSocketEvent("visit:checkout", useCallback((data) => {
    setActiveVisitors(prev => prev.filter(v => v.visit_log_id !== data.visit_log_id));
    const method = data.checkout_method === "QR_SCAN" ? "via QR scan" : "";
    toast(`Visitor checked out ${method}.`.trim(), { icon: "🔴", duration: 4000 });
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
        remarks: remarks || undefined,
      });
      setDirectModal(null);
      fetchGateDashboard();
    } catch (err) {
      toast.error(err.response?.data?.message || "Checkout failed");
    } finally {
      setDirectSubmit(false);
    }
  };

  /* ── QR checkout handler ────────────────────────────────────────────── */
  const initiateQRCheckout = (visitor) => setQrModal(visitor);

  return (
    <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 animate-fade-in">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-loud">Gate <em className="italic">Check-Out</em></h1>
        <p className="text-muted mt-2">Manage currently active visitors on premises.</p>
      </div>

      <div className="vms-card rounded-md p-6 shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-subtle text-muted text-sm uppercase tracking-wider">
                <th className="py-4 px-4 font-medium">Visitor</th>
                <th className="py-4 px-4 font-medium">Pass Number</th>
                <th className="py-4 px-4 font-medium">Host</th>
                <th className="py-4 px-4 font-medium">Check-In Time</th>
                <th className="py-4 px-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="5" className="text-center py-12 text-faint italic">Loading active visitors...</td>
                </tr>
              ) : activeVisitors.length === 0 ? (
                <tr>
                  <td colSpan="5" className="text-center py-12 text-faint italic">No active visitors on premises.</td>
                </tr>
              ) : (
                activeVisitors.map((visitor) => (
                  <tr
                    key={visitor.visit_log_id}
                    className="border-b border-subtle hover:bg-bg-primary/50 transition-colors duration-300"
                  >
                    <td className="py-4 px-4">
                      <div className="font-medium text-loud flex items-center gap-2">
                        <User className="w-4 h-4 text-accent" />
                        {visitor.visitor_name}
                      </div>
                      {visitor.visitor_phone && (
                        <div className="text-xs text-faint pl-6 mt-0.5">📞 {visitor.visitor_phone}</div>
                      )}
                      <div className="text-sm text-muted pl-6 mt-1 line-clamp-1">{visitor.purpose}</div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="text-loud font-mono text-sm flex items-center gap-1.5 bg-bg-primary px-2 py-1 rounded inline-flex">
                        <Hash className="w-3 h-3 text-accent" />
                        {visitor.pass_number}
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="text-loud">{visitor.host_name}</div>
                      <div className="text-sm text-muted">{visitor.department_name}</div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="text-loud flex items-center gap-1.5">
                        <Clock className="w-4 h-4 text-accent" strokeWidth={1.5} />
                        {new Date(visitor.check_in_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex flex-col sm:flex-row gap-2 justify-end">
                        {/* Direct Checkout */}
                        <button
                          onClick={() => initiateDirectCheckout(visitor.visit_log_id)}
                          className="inline-flex items-center justify-center px-3 py-1.5 rounded-full text-xs font-medium uppercase tracking-wider gap-1.5 transition-colors duration-300"
                          style={{
                            background: "rgba(239,68,68,0.08)",
                            color: "#dc2626",
                            border: "1px solid rgba(239,68,68,0.2)",
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = "#dc2626"; e.currentTarget.style.color = "#fff"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "rgba(239,68,68,0.08)"; e.currentTarget.style.color = "#dc2626"; }}
                          title="Direct checkout — QR valid 24h post check-in"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          Direct
                        </button>

                        {/* QR Checkout */}
                        <button
                          onClick={() => initiateQRCheckout(visitor)}
                          className="inline-flex items-center justify-center px-3 py-1.5 rounded-full text-xs font-medium uppercase tracking-wider gap-1.5 transition-colors duration-300"
                          style={{
                            background: "rgba(139,92,246,0.08)",
                            color: "#8b5cf6",
                            border: "1px solid rgba(139,92,246,0.2)",
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = "#8b5cf6"; e.currentTarget.style.color = "#fff"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "rgba(139,92,246,0.08)"; e.currentTarget.style.color = "#8b5cf6"; }}
                          title="QR checkout — immediately invalidates the QR code"
                        >
                          <QrCode className="w-3.5 h-3.5" />
                          QR Scan
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Direct Checkout Modal ─────────────────────────────────────────── */}
      {directModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-accent/40 backdrop-blur-sm"
            onClick={() => !directSubmit && setDirectModal(null)}
          />
          <div className="bg-vms-card rounded-md p-8 max-w-md w-full relative z-10 shadow-card animate-fade-in">
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ background: "rgba(239,68,68,0.1)" }}
              >
                <LogOut size={18} style={{ color: "#dc2626" }} />
              </div>
              <div>
                <h3 className="text-[16px] font-bold text-loud">Direct Check-Out</h3>
                <p className="text-[11px] text-faint">QR code stays valid for 24h after check-in</p>
              </div>
            </div>
            <p className="text-muted text-sm mb-5">
              Are you sure you want to check out this visitor? Their QR code will remain valid until 24 hours after check-in time.
            </p>
            <div className="space-y-2 mb-6">
              <label className="block text-sm font-medium text-loud">Remarks (Optional)</label>
              <textarea
                value={remarks}
                onChange={e => setRemarks(e.target.value)}
                className="w-full bg-bg-primary border border-subtle rounded-xl p-3 text-loud focus:outline-none focus:border-border transition-colors resize-none"
                rows="3"
                placeholder="Any issues or notes during departure..."
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDirectModal(null)}
                disabled={directSubmit}
                className="btn-secondary text-loud hover:bg-bg-primary transition-colors text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleDirectCheckout}
                disabled={directSubmit}
                className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-red-600 text-white hover:bg-red-700 transition-colors text-sm font-medium disabled:opacity-60"
              >
                {directSubmit ? "Processing..." : <><LogOut className="w-4 h-4" /> Confirm Check-Out</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── QR Checkout Modal ─────────────────────────────────────────────── */}
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
