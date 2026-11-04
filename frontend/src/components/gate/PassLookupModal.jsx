// frontend/src/components/gate/PassLookupModal.jsx
// "Check in by pass": scan the visitor's QR (camera or image) or type the pass
// number — a handheld scanner types into the field too. The server says whether
// the visitor can be checked in now (POST /gate/lookup); a visitor who comes on
// another day than the one booked, or whose pass has expired, is stopped here.
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import jsQR from "jsqr";
import toast from "react-hot-toast";
import {
  QrCode, Upload, Keyboard, ZoomIn, AlertCircle, AlertTriangle, CheckCircle2, ArrowLeft, ArrowRight, Loader2, RotateCcw, Info,
} from "../icons";
import apiClient from "../../api/axios";
import { getApiErrorMessage } from "../../utils/apiError";
import { Modal, Field, KV, Note, ChoiceCards, ScanOverlay, Status } from "../ui";
import { fmtDate, fmtTime } from "../../lib/format";

const MODES = [
  { id: "webcam", label: "Scan with camera", icon: QrCode,   desc: "Hold the QR code up to the camera" },
  { id: "upload", label: "Upload QR image",  icon: Upload,   desc: "A photo or screenshot of the pass" },
  { id: "manual", label: "Type or scan",     icon: Keyboard, desc: "Pass number, or a handheld scanner" },
];

// How each answer is shown
const VERDICT = {
  ok:           { tone: "success", icon: CheckCircle2,  title: "Valid for today" },
  future:       { tone: "warning", icon: AlertTriangle, title: "Not today" },
  expired:      { tone: "danger",  icon: AlertCircle,   title: "Gate pass expired" },
  used:         { tone: "danger",  icon: AlertCircle,   title: "Pass already used" },
  cancelled:    { tone: "danger",  icon: AlertCircle,   title: "Visit cancelled" },
  not_approved: { tone: "warning", icon: AlertTriangle, title: "Not approved yet" },
  inside:       { tone: "info",    icon: Info,          title: "Already inside" },
};

export default function PassLookupModal({ onClose }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const streamRef = useRef(null);
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const fileRef   = useRef(null);
  const rafRef    = useRef(null);

  const stopCamera = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
      streamRef.current = null;
    }
    setScanning(false);
  }, []);
  useEffect(() => stopCamera, [stopCamera]);

  const lookup = useCallback(async (raw) => {
    const value = String(raw || "").trim();
    if (!value) { toast.error("Scan the QR code or enter the pass number."); return; }
    stopCamera();
    setBusy(true);
    try {
      const { data } = await apiClient.post("/gate/lookup", { code: value });
      setResult(data.data);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not check this gate pass."));
    } finally { setBusy(false); }
  }, [stopCamera]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      setScanning(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
    } catch {
      toast.error("Camera not accessible. Upload a QR image or type the number.");
      setMode("manual");
    }
  };

  const onVideoPlay = () => {
    const tick = () => {
      const video = videoRef.current; const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) { rafRef.current = requestAnimationFrame(tick); return; }
      const ctx = canvas.getContext("2d");
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const qr = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "attemptBoth" });
      if (qr?.data) { lookup(qr.data); return; }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const onFile = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const qr = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "attemptBoth" });
      URL.revokeObjectURL(url);
      if (qr?.data) lookup(qr.data); else toast.error("No QR code found in the image. Try a clearer photo.");
    };
    img.src = url; e.target.value = "";
  };

  const pick = (id) => {
    setMode(id);
    if (id === "webcam") startCamera();
    if (id === "upload") setTimeout(() => fileRef.current?.click(), 50);
  };
  const again = () => { setResult(null); setCode(""); setMode(null); };

  const v = result && (VERDICT[result.verdict] || VERDICT.not_approved);
  const goCheckIn = () => {
    onClose();
    navigate(`/gate/checkin/${result.request_id}`, { state: { verifiedPass: result.pass_number } });
  };

  return (
    <Modal open onClose={onClose} busy={busy} width={520} title="Check in by gate pass"
      footer={result ? (
        <>
          <button type="button" className="btn-outline" onClick={again}><RotateCcw size={14} /> Check another pass</button>
          {result.verdict === "ok" && (
            <button type="button" className="btn-primary" onClick={goCheckIn}>Continue to check-in <ArrowRight size={14} /></button>
          )}
        </>
      ) : (
        <button type="button" className="btn-outline" onClick={onClose}>Cancel</button>
      )}>
      {result ? (
        <div className="space-y-3">
          <Note tone={v.tone} icon={v.icon}><b>{v.title}.</b> {result.message}</Note>
          <KV items={[
            ["Visitor", result.visitor_name],
            ["Pass", <span key="p" className="mono">{result.pass_number}</span>],
            ["To meet", result.host_name],
            ["Visit date", <span key="d" className={`tabular${result.visit_day !== "today" ? " font-semibold" : ""}`}>
              {fmtDate(result.visit_date)}{result.visit_start_time ? ` · ${fmtTime(result.visit_start_time)}` : ""}
            </span>],
            ["Status", <Status key="s" value={result.status} />],
          ]} />
        </div>
      ) : (
        <div className="space-y-3">
          <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden" />
          {!mode && <ChoiceCards options={MODES} value={mode} onPick={pick} label="How to read the pass" />}

          {mode === "webcam" && (
            <div className="space-y-2">
              <div className="scan-stage" style={{ minHeight: 220 }}>
                <video ref={videoRef} autoPlay playsInline muted onPlay={onVideoPlay} className="w-full max-h-[260px] object-cover" />
                {scanning && <ScanOverlay />}
                {busy && <ScanOverlay label="Checking the pass…" />}
              </div>
              <canvas ref={canvasRef} className="hidden" />
              <button type="button" onClick={() => { stopCamera(); setMode(null); }} className="btn-ghost btn-sm">
                <ArrowLeft size={13} /> Other method
              </button>
            </div>
          )}

          {mode === "upload" && (
            <div className="space-y-2">
              <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
                className="w-full flex flex-col items-center gap-1.5 py-8 rounded-lg border border-dashed border-line-strong bg-surface-alt hover:border-primary transition-colors">
                {busy ? <Loader2 size={22} className="animate-spin text-primary-strong" /> : <ZoomIn size={22} duo className="text-primary-strong" />}
                <span className="text-[13px] font-medium text-ink">Choose a QR image</span>
                <span className="text-[11.5px] text-muted">A screenshot of the gate-pass email or WhatsApp works.</span>
              </button>
              <button type="button" onClick={() => setMode(null)} className="btn-ghost btn-sm"><ArrowLeft size={13} /> Other method</button>
            </div>
          )}

          {mode === "manual" && (
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); lookup(code); }}>
              <Field label="Gate pass number" htmlFor="pl-code" hint="A handheld QR scanner can scan straight into this field.">
                <div className="flex gap-2">
                  <input id="pl-code" type="text" autoFocus value={code} onChange={(e) => setCode(e.target.value)}
                    placeholder="VMS-UT-20261104-12345" className="control mono flex-1" autoComplete="off" />
                  <button type="submit" disabled={busy || !code.trim()} className="btn-primary">
                    {busy ? <Loader2 size={14} className="animate-spin" /> : null} Check
                  </button>
                </div>
              </Field>
              <button type="button" onClick={() => setMode(null)} className="btn-ghost btn-sm"><ArrowLeft size={13} /> Other method</button>
            </form>
          )}
        </div>
      )}
    </Modal>
  );
}
