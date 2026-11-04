// frontend/src/components/visitor/IdProofPanel.jsx
// The visitor's ID proof and face photo on their portal profile. Every visit
// request they send copies both, and security checks them at the gate.
// Both are required before a visitor can send a request.
import { useState } from "react";
import toast from "react-hot-toast";
import { CreditCard, Camera, Loader2, Edit2, Trash2 } from "../icons";
import Select from "../Select";
import PhotoCapture from "../PhotoCapture";
import { State } from "../ui";
import { portalApi, portalError } from "../../lib/visitorPortal";
import { ID_PROOFS, idProofError, idProofLabel, cleanIdNumber } from "../../lib/idProof";

/**
 * @param {object}   account    — portal profile (id_proof_type, id_proof_number (masked), has_id_proof, photo_url)
 * @param {Function} onAccount  — receives { account, pending } after a save
 * @param {boolean}  [compact]  — narrower layout (the request form's side card)
 */
export default function IdProofPanel({ account, onAccount, compact = false }) {
  const [editing, setEditing] = useState(!account.has_id_proof);
  const [type, setType] = useState(account.id_proof_type || "AADHAAR");
  const [number, setNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);

  const error = idProofError(type, number);

  const saveId = async () => {
    const problem = idProofError(type, number, true);
    if (problem) { toast.error(problem); document.getElementById("idp-number")?.focus(); return; }
    setSaving(true);
    try {
      const { data } = await portalApi.put("/me/id-proof", { id_proof_type: type, id_proof_number: cleanIdNumber(type, number) });
      onAccount(data.data);
      setEditing(false);
      setNumber("");
      toast.success(data.message);
    } catch (err) {
      toast.error(portalError(err, "Could not save your ID proof."));
    } finally { setSaving(false); }
  };

  const savePhoto = async (dataUrl) => {
    if (!dataUrl) return;
    setPhotoBusy(true);
    try {
      const fd = new FormData();
      fd.append("photo", await (await fetch(dataUrl)).blob(), "visitor_photo.jpg");
      const { data } = await portalApi.post("/me/photo", fd, { headers: { "Content-Type": "multipart/form-data" } });
      onAccount(data.data);
      toast.success(data.message);
    } catch (err) {
      toast.error(portalError(err, "Could not save your photo."));
    } finally { setPhotoBusy(false); }
  };

  const removePhoto = async () => {
    setPhotoBusy(true);
    try {
      const { data } = await portalApi.delete("/me/photo");
      onAccount(data.data);
    } catch (err) {
      toast.error(portalError(err, "Could not remove your photo."));
    } finally { setPhotoBusy(false); }
  };

  return (
    <div className="space-y-4">
      {/* ID proof */}
      <div>
        <p className="field-label flex items-center gap-1.5"><CreditCard size={13} /> ID proof <span className="req">*</span></p>
        {!editing ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-ink">{idProofLabel(account.id_proof_type)}</span>
            <span className="mono text-ink-2">{account.id_proof_number}</span>
            <State tone="success">Saved</State>
            <button type="button" className="btn-ghost btn-sm !px-1" onClick={() => setEditing(true)}>
              <Edit2 size={12} /> Change
            </button>
          </div>
        ) : (
          <div className={`grid grid-cols-1 ${compact ? "" : "sm:grid-cols-[170px_minmax(0,1fr)]"} gap-2`}>
            <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="ID type">
              {ID_PROOFS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
            <div>
              <input id="idp-number" type="text" value={number} onChange={(e) => setNumber(e.target.value)}
                placeholder={ID_PROOFS.find((t) => t.value === type)?.placeholder} autoComplete="off"
                maxLength={type === "AADHAAR" ? 14 : 30} aria-label="ID number" aria-invalid={!!error || undefined}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveId(); } }}
                className="control mono uppercase" />
              {error && <p className="field-error">{error}</p>}
            </div>
            <div className={`flex gap-2 ${compact ? "" : "sm:col-span-2"}`}>
              <button type="button" onClick={saveId} disabled={saving} className="btn-primary btn-sm">
                {saving && <Loader2 size={13} className="animate-spin" />} Save ID proof
              </button>
              {account.has_id_proof && (
                <button type="button" onClick={() => { setEditing(false); setNumber(""); }} className="btn-outline btn-sm">Cancel</button>
              )}
            </div>
          </div>
        )}
        <p className="field-hint">Security checks your card against this at the gate.</p>
      </div>

      {/* Face photo */}
      <div>
        <p className="field-label flex items-center gap-1.5"><Camera size={13} /> Your photo <span className="req">*</span></p>
        {account.photo_url ? (
          <div className="flex items-start gap-3">
            <img src={account.photo_url} alt="Your photo" className="w-20 h-20 object-cover rounded border border-line" />
            <div className="pt-1 space-y-1">
              <p className="text-[12px] text-muted">Shown to security when you check in.</p>
              <button type="button" onClick={removePhoto} disabled={photoBusy} className="btn-ghost btn-sm !px-0">
                {photoBusy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Retake
              </button>
            </div>
          </div>
        ) : photoBusy ? (
          <p className="text-[12.5px] text-muted flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Saving your photo…</p>
        ) : (
          <>
            <PhotoCapture value={null} onChange={savePhoto} label="Your photo" />
            <p className="field-hint">Required. A clear photo of your face — not of the ID card.</p>
          </>
        )}
      </div>
    </div>
  );
}
