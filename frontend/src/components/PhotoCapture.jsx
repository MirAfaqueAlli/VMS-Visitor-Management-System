// frontend/src/components/PhotoCapture.jsx
// Visitor photo from the camera or a file, as a square JPEG (centre-cropped, up to 800px).
// value: data URL or null; onChange(dataUrl | null).
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Camera, Upload, X, RotateCcw } from "./icons";

const MAX_SIDE = 800;

/**
 * A square JPEG (side ≤ MAX_SIDE) cropped from the centre of an image / video frame —
 * the same crop the server makes, so the preview is what gets saved. Never stretched.
 */
function toJpeg(source, width, height) {
  const side = Math.min(width, height);
  const out = Math.min(MAX_SIDE, side);
  const canvas = document.createElement("canvas");
  canvas.width = out;
  canvas.height = out;
  canvas.getContext("2d").drawImage(source, (width - side) / 2, (height - side) / 2, side, side, 0, 0, out, out);
  return canvas.toDataURL("image/jpeg", 0.85);
}

export default function PhotoCapture({ value, onChange, label = "Visitor photo" }) {
  const [camera, setCamera] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileRef = useRef(null);

  const stop = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamera(false);
  };
  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 } } });
      streamRef.current = stream;
      setCamera(true);
      // The <video> mounts on this render; attach on the next frame
      requestAnimationFrame(() => {
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}); }
      });
    } catch {
      toast.error("Camera not accessible. Upload a photo instead.");
    }
  };

  const capture = () => {
    const v = videoRef.current;
    if (!v?.videoWidth) return;
    onChange(toJpeg(v, v.videoWidth, v.videoHeight));
    stop();
  };

  const onFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Choose an image file."); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { onChange(toJpeg(img, img.naturalWidth, img.naturalHeight)); URL.revokeObjectURL(url); };
    img.onerror = () => { toast.error("Could not read this image."); URL.revokeObjectURL(url); };
    img.src = url;
  };

  if (value) {
    return (
      <div className="flex items-start gap-3">
        <img src={value} alt={label} className="w-24 h-24 object-cover rounded border border-line" />
        <div className="pt-1 space-y-1">
          <p className="text-[12px] text-muted">Saved with the request; shown to security at check-in.</p>
          <button type="button" onClick={() => onChange(null)} className="btn-ghost btn-sm !px-0"><RotateCcw size={13} /> Retake or remove</button>
        </div>
      </div>
    );
  }

  return camera ? (
    <div className="space-y-2 max-w-[420px]">
      <div className="scan-stage" style={{ minHeight: 220 }}>
        <video ref={videoRef} autoPlay playsInline muted className="w-full max-h-[280px] object-cover" />
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={capture} className="btn-primary btn-sm"><Camera size={13} /> Take photo</button>
        <button type="button" onClick={stop} className="btn-outline btn-sm"><X size={13} /> Cancel</button>
      </div>
    </div>
  ) : (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={start} className="btn-outline btn-sm"><Camera size={13} /> Use camera</button>
      <button type="button" onClick={() => fileRef.current?.click()} className="btn-outline btn-sm"><Upload size={13} /> Upload photo</button>
      <input ref={fileRef} type="file" accept="image/*" capture="user" onChange={onFile} className="hidden" aria-label={label} />
    </div>
  );
}
