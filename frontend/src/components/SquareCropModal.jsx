// frontend/src/components/SquareCropModal.jsx
// Crop a photo to a square before it is saved: drag the photo to position it, zoom
// with the slider (or the mouse wheel). The square always stays filled — the photo
// can't be moved or zoomed out past its edges. Returns a JPEG data URL (≤ 800 px).
import { useCallback, useRef, useState } from "react";
import { Check, Minus, Plus } from "./icons";
import { Modal } from "./ui";

const VIEW = 300;        // the crop square on screen (px)
const MAX_SIDE = 800;    // saved photo side (px), as before
const MAX_ZOOM = 4;

/**
 * @param {object}   props
 * @param {string|null} props.src  — the photo to crop (data / object URL); open while set
 * @param {(dataUrl: string) => void} props.onDone
 * @param {() => void} props.onCancel
 * @param {string}   [props.title]
 */
export default function SquareCropModal(props) {
  // A fresh crop (centred, zoom 1) for every new photo
  return <CropView key={props.src || 'none'} {...props} />;
}

function CropView({ src, onDone, onCancel, title = "Crop the photo" }) {
  const imgRef = useRef(null);
  const drag = useRef(null);
  const [nat, setNat] = useState(null);           // { w, h } of the loaded photo
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 }); // photo's top-left inside the square
  const [dragging, setDragging] = useState(false);

  // "Cover" scale at zoom 1: the shorter side fills the square
  const base = nat ? VIEW / Math.min(nat.w, nat.h) : 1;
  const scale = base * zoom;

  /** Keeps the square filled: the photo's edges never come inside it. */
  const clamp = useCallback((p, s = scale) => {
    if (!nat) return p;
    const w = nat.w * s;
    const h = nat.h * s;
    return { x: Math.min(0, Math.max(VIEW - w, p.x)), y: Math.min(0, Math.max(VIEW - h, p.y)) };
  }, [nat, scale]);

  const onLoad = (e) => {
    const w = e.currentTarget.naturalWidth;
    const h = e.currentTarget.naturalHeight;
    const s = VIEW / Math.min(w, h);
    setNat({ w, h });
    setPos({ x: (VIEW - w * s) / 2, y: (VIEW - h * s) / 2 });
  };

  /** Zoom around the centre of the square, keeping that point still. */
  const zoomTo = (z) => {
    const next = Math.min(MAX_ZOOM, Math.max(1, z));
    const s1 = base * next;
    const cx = (VIEW / 2 - pos.x) / scale;   // photo point under the centre
    const cy = (VIEW / 2 - pos.y) / scale;
    setZoom(next);
    setPos(clamp({ x: VIEW / 2 - cx * s1, y: VIEW / 2 - cy * s1 }, s1));
  };

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { sx: e.clientX, sy: e.clientY, px: pos.x, py: pos.y };
    setDragging(true);
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    const d = drag.current;
    setPos(clamp({ x: d.px + (e.clientX - d.sx), y: d.py + (e.clientY - d.sy) }));
  };
  const onPointerUp = () => { drag.current = null; setDragging(false); };
  const onWheel = (e) => zoomTo(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));

  const save = () => {
    const img = imgRef.current;
    if (!img || !nat) return;
    const sx = -pos.x / scale;
    const sy = -pos.y / scale;
    const side = VIEW / scale;                 // the square, in photo pixels
    const out = Math.round(Math.min(MAX_SIDE, side));
    const canvas = document.createElement("canvas");
    canvas.width = out;
    canvas.height = out;
    canvas.getContext("2d").drawImage(img, sx, sy, side, side, 0, 0, out, out);
    onDone(canvas.toDataURL("image/jpeg", 0.85));
  };

  return (
    <Modal
      open={!!src}
      onClose={onCancel}
      width={380}
      title={title}
      footer={(
        <>
          <button type="button" className="btn-outline" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn-primary" onClick={save} disabled={!nat}>
            <Check size={14} /> Use this photo
          </button>
        </>
      )}
    >
      <p className="text-[12px] text-muted mb-3">Drag to position the face in the square. Zoom with the slider or the mouse wheel.</p>
      <div
        className="relative mx-auto overflow-hidden rounded-[3px] border border-line bg-surface-alt select-none"
        style={{ width: VIEW, height: VIEW, touchAction: "none", cursor: dragging ? "grabbing" : "grab" }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        {src && (
          <img
            ref={imgRef}
            src={src}
            alt=""
            draggable={false}
            onLoad={onLoad}
            className="absolute top-0 left-0 max-w-none pointer-events-none"
            style={nat ? { width: nat.w * scale, height: nat.h * scale, transform: `translate(${pos.x}px, ${pos.y}px)` } : { opacity: 0 }}
          />
        )}
        {/* Thirds guide, to centre the face */}
        <div aria-hidden="true" className="absolute inset-0 pointer-events-none"
          style={{ backgroundImage: "linear-gradient(to right, rgba(255,255,255,.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,.35) 1px, transparent 1px)", backgroundSize: `${VIEW / 3}px ${VIEW / 3}px` }} />
      </div>
      <div className="mt-3 flex items-center gap-2" style={{ width: VIEW, margin: "12px auto 0" }}>
        <button type="button" className="btn-icon" onClick={() => zoomTo(zoom / 1.2)} aria-label="Zoom out" disabled={zoom <= 1}><Minus size={14} /></button>
        <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom} onChange={(e) => zoomTo(Number(e.target.value))}
          className="flex-1" aria-label="Zoom" />
        <button type="button" className="btn-icon" onClick={() => zoomTo(zoom * 1.2)} aria-label="Zoom in" disabled={zoom >= MAX_ZOOM}><Plus size={14} /></button>
      </div>
    </Modal>
  );
}
