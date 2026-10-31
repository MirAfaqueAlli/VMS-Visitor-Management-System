// frontend/src/pages/visitors/VisitorForm.jsx
// Register a visitor (DESIGN_RULES §11): 3-column field grid, photo in a tinted
// side tile, primary action below a hairline (left-aligned on full pages).
import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Camera, Paperclip, X, Check, Loader2 } from "../../components/icons";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";
import { getApiErrorMessage } from "../../utils/apiError";
import Select from "../../components/Select";
import { PageHeader, Field } from "../../components/ui";

export default function VisitorForm() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef(null);

  const [formData, setFormData] = useState({
    full_name: "",
    visitor_type: "individual",
    email: "",
    phone: "",
    address: "",
    id_type: "AADHAAR",
    id_number: "",
    company_name: "",
  });

  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handlePhotoChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setPhoto(file);
      setPhotoPreview(URL.createObjectURL(file));
    }
  };

  // Reset the input too, so choosing the same file again still works
  const clearPhoto = () => {
    setPhoto(null);
    setPhotoPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const data = new FormData();
      Object.keys(formData).forEach((key) => {
        if (formData[key]) data.append(key, formData[key]);
      });
      if (photo) data.append("photo", photo);

      await apiClient.post("/visitors", data);
      toast.success(`${formData.full_name.trim()} registered as a visitor.`);
      navigate("/visitors");
    } catch (error) {
      console.error("[VisitorForm] Error:", error.response?.data);
      toast.error(getApiErrorMessage(error, "Failed to register visitor."), { duration: 6000 });
    } finally {
      setLoading(false);
    }
  };

  const isBusiness = formData.visitor_type === "business";

  return (
    <div className="animate-fade-in">
      <PageHeader title="Register visitor" />

      <form onSubmit={handleSubmit} className="max-w-[1100px]">
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-x-8 gap-y-6 items-start">
          {/* Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-4 gap-y-3">
            <Field label="Full name" htmlFor="full_name" required>
              <input id="full_name" type="text" name="full_name" required value={formData.full_name}
                onChange={handleInputChange} className="control" placeholder="e.g. Rajesh Kumar Mohapatra" />
            </Field>

            <Field label="Visitor type" required>
              <Select name="visitor_type" required value={formData.visitor_type} onChange={handleInputChange} aria-label="Visitor type">
                <option value="individual">Individual</option>
                <option value="business">Business</option>
              </Select>
            </Field>

            {isBusiness ? (
              <Field label="Company name" htmlFor="company_name" required>
                <input id="company_name" type="text" name="company_name" required value={formData.company_name}
                  onChange={handleInputChange} className="control" placeholder="e.g. Odisha Power Services" />
              </Field>
            ) : <div className="hidden xl:block" />}

            <Field label="Mobile number" htmlFor="phone" required hint="WhatsApp number preferred">
              <input id="phone" type="tel" name="phone" required minLength={10} maxLength={15} value={formData.phone}
                onChange={handleInputChange} className="control tabular" placeholder="98765 43210" />
            </Field>

            <Field label="Email" htmlFor="email">
              <input id="email" type="email" name="email" value={formData.email}
                onChange={handleInputChange} className="control" placeholder="name@example.com" />
            </Field>

            <div className="hidden xl:block" />

            <Field label="ID type" required>
              <Select name="id_type" required value={formData.id_type} onChange={handleInputChange} aria-label="ID type">
                <option value="AADHAAR">Aadhaar</option>
                <option value="PAN">PAN</option>
                <option value="DRIVING_LICENSE">Driving licence</option>
                <option value="PASSPORT">Passport</option>
                <option value="VOTER_ID">Voter ID</option>
                <option value="OTHER">Other</option>
              </Select>
            </Field>

            <Field label="ID number" htmlFor="id_number" required>
              <input id="id_number" type="text" name="id_number" required value={formData.id_number}
                onChange={handleInputChange} className="control mono" placeholder="XXXX XXXX XXXX" />
            </Field>

            <Field label="Address" htmlFor="address" className="sm:col-span-2 xl:col-span-3">
              <textarea id="address" name="address" rows={2} value={formData.address}
                onChange={handleInputChange} className="control resize-none" placeholder="House, street, city, PIN" />
            </Field>
          </div>

          {/* Photo */}
          <div className="tile">
            <p className="group-heading mb-3">Photo</p>
            <div className="aspect-[3/4] max-w-[200px] mx-auto rounded-lg overflow-hidden bg-surface flex items-center justify-center mb-3">
              {photoPreview ? (
                <img src={photoPreview} alt="Visitor" className="w-full h-full object-cover" />
              ) : (
                <div className="text-center px-4 text-muted">
                  <Camera size={26} duo className="mx-auto mb-2" />
                  <p className="text-[12px]">No photo yet</p>
                </div>
              )}
            </div>
            <input type="file" ref={fileInputRef} onChange={handlePhotoChange} accept="image/*" className="hidden" />
            <div className="flex items-stretch rounded border border-line-strong bg-surface overflow-hidden">
              <button type="button" onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-2.5 text-[12.5px] font-medium bg-surface-alt border-r border-line-strong min-h-control">
                <Paperclip size={13} /> Upload photo
              </button>
              <span className="flex-1 min-w-0 px-2.5 py-1.5 text-[12px] truncate text-muted">{photo ? photo.name : "No file chosen"}</span>
              {photo && (
                <button type="button" onClick={clearPhoto} className="btn-icon !min-h-0 !w-8" aria-label="Remove photo" title="Remove photo">
                  <X size={13} />
                </button>
              )}
            </div>
            <p className="field-hint">The gate takes a live photo at check-in; this one is optional.</p>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-line flex flex-wrap gap-2">
          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {loading ? "Registering…" : "Register visitor"}
          </button>
          <button type="button" onClick={() => navigate("/visitors")} className="btn-outline">Cancel</button>
        </div>
      </form>
    </div>
  );
}
