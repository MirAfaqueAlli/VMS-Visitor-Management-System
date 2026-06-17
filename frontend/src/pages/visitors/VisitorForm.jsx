import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Camera, Upload, X, Check } from "lucide-react";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";

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
 if (photo) {
 data.append("photo", photo);
 }

 // Debug: log what's being sent
 console.log('[VisitorForm] Submitting fields:', Object.fromEntries(data.entries()));

 await apiClient.post("/visitors", data);

 toast.success("Visitor registered successfully");
 navigate("/visitors");
 } catch (error) {
 console.error('[VisitorForm] Error:', error.response?.data);
 const zodErrors = error.response?.data?.errors;
 if (Array.isArray(zodErrors) && zodErrors.length > 0) {
   const details = zodErrors
     .map((e) => `${e.path?.join('.') || 'field'}: ${e.message}`)
     .join(' | ');
   toast.error(`Validation failed — ${details}`, { duration: 8000 });
 } else {
   toast.error(
     error.response?.data?.message || "Failed to register visitor"
   );
 }
 } finally {
 setLoading(false);
 }
 };

 return (
 <div className="max-w-5xl mx-auto py-12 px-4 sm:px-6 lg:px-8 animate-fade-in">
 <div className="mb-12">
 <h1 className="text-2xl font-bold text-loud">
 New <em className="italic">Visitor</em>
 </h1>
 <p className="text-muted mt-3 text-lg">
 Register a new visitor in the system.
 </p>
 </div>

 <form
 onSubmit={handleSubmit}
 className="vms-card rounded-md p-5 sm:p-8 shadow-card"
 >
 <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
 {/* Photo Upload Column */}
 <div className="lg:col-span-4 flex flex-col items-center">
 <div className="w-full aspect-[3/4] max-w-[240px] rounded-[40px] overflow-hidden bg-bg-primary border border-subtle flex flex-col items-center justify-center relative shadow-soft-sm transition-transform duration-500 hover:shadow-hover group">
 {photoPreview ? (
 <>
 <img
 src={photoPreview}
 alt="Preview"
 className="w-full h-full object-cover"
 />
 <div className="absolute inset-0 bg-overlay opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
 <button
 type="button"
 onClick={clearPhoto}
 className="bg-white/90 p-3 rounded-full text-warning shadow-card hover:scale-110 transition-transform"
 >
 <X className="w-5 h-5" strokeWidth={2} />
 </button>
 </div>
 </>
 ) : (
 <div
 className="w-full h-full flex flex-col items-center justify-center p-6 text-center cursor-pointer"
 onClick={() => fileInputRef.current?.click()}
 >
 <div className="w-16 h-16 rounded-full bg-mixed-bg flex items-center justify-center mb-4 text-accent group-hover:bg-accent group-hover:text-white transition-colors duration-500">
 <Camera className="w-7 h-7" strokeWidth={1.5} />
 </div>
 <span className="text-lg text-loud mb-1">
 Capture Photo
 </span>
 <span className="text-xs text-faint">
 Click to upload image
 </span>
 </div>
 )}
 <input
 type="file"
 ref={fileInputRef}
 onChange={handlePhotoChange}
 accept="image/*"
 className="hidden"
 />
 </div>
 </div>

 {/* Form Fields Column */}
 <div className="lg:col-span-8 space-y-8">
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
 <div className="space-y-2">
 <label className="block text-sm font-medium text-loud">
 Full Name *
 </label>
 <input
 type="text"
 name="full_name"
 required
 value={formData.full_name}
 onChange={handleInputChange}
 className="w-full bg-bg-primary border-0 border-b border-subtle px-0 py-2 text-loud focus:ring-0 focus:border-border transition-colors duration-300"
 placeholder="Jane Doe"
 />
 </div>

 <div className="space-y-2">
 <label className="block text-sm font-medium text-loud">
 Visitor Type *
 </label>
 <select
 name="visitor_type"
 required
 value={formData.visitor_type}
 onChange={handleInputChange}
 className="w-full bg-bg-primary border-0 border-b border-subtle px-0 py-2 text-loud focus:ring-0 focus:border-border transition-colors duration-300"
 >
 <option value="individual">Individual</option>
 <option value="business">Business</option>
 </select>
 </div>

 <div className="space-y-2">
 <label className="block text-sm font-medium text-loud">
 Phone Number * <span className="text-xs text-faint font-normal normal-case tracking-normal">(WhatsApp preferred)</span>
 </label>
 <input
 type="tel"
 name="phone"
 required
 minLength={10}
 maxLength={15}
 value={formData.phone}
 onChange={handleInputChange}
 className="w-full bg-bg-primary border-0 border-b border-subtle px-0 py-2 text-loud focus:ring-0 focus:border-border transition-colors duration-300"
 placeholder="+91 98765 43210"
 />
 </div>

 <div className="space-y-2">
 <label className="block text-sm font-medium text-loud">
 Email Address
 </label>
 <input
 type="email"
 name="email"
 value={formData.email}
 onChange={handleInputChange}
 className="w-full bg-bg-primary border-0 border-b border-subtle px-0 py-2 text-loud focus:ring-0 focus:border-border transition-colors duration-300"
 placeholder="jane@example.com"
 />
 </div>

 <div className="space-y-2">
 <label className="block text-sm font-medium text-loud">
 ID Type *
 </label>
 <select
 name="id_type"
 required
 value={formData.id_type}
 onChange={handleInputChange}
 className="w-full bg-bg-primary border-0 border-b border-subtle px-0 py-2 text-loud focus:ring-0 focus:border-border transition-colors duration-300"
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
 <label className="block text-sm font-medium text-loud">
 ID Number *
 </label>
 <input
 type="text"
 name="id_number"
 required
 value={formData.id_number}
 onChange={handleInputChange}
 className="w-full bg-bg-primary border-0 border-b border-subtle px-0 py-2 text-loud focus:ring-0 focus:border-border transition-colors duration-300"
 placeholder="XXXX-XXXX-XXXX"
 />
 </div>
 </div>

 {formData.visitor_type === "business" && (
 <div className="space-y-2 animate-fade-in">
 <label className="block text-sm font-medium text-loud">
 Company Name *
 </label>
 <input
 type="text"
 name="company_name"
 required
 value={formData.company_name}
 onChange={handleInputChange}
 className="w-full bg-bg-primary border-0 border-b border-subtle px-0 py-2 text-loud focus:ring-0 focus:border-border transition-colors duration-300"
 placeholder="Acme Corp"
 />
 </div>
 )}

 <div className="space-y-2">
 <label className="block text-sm font-medium text-loud">
 Address
 </label>
 <textarea
 name="address"
 rows="2"
 value={formData.address}
 onChange={handleInputChange}
 className="w-full bg-bg-primary border-0 border-b border-subtle px-0 py-2 text-loud focus:ring-0 focus:border-border transition-colors duration-300 resize-none"
 placeholder="123 Main St, City"
 ></textarea>
 </div>

 <div className="pt-6 sm:pt-8 border-t border-subtle flex flex-col sm:flex-row sm:justify-end gap-3">
 <button
 type="button"
 onClick={() => navigate("/visitors")}
 className="btn-secondary text-accent uppercase tracking-widest text-sm font-medium hover:bg-mixed-bg transition-colors duration-300 w-full sm:w-auto justify-center"
 >
 Cancel
 </button>
 <button
 type="submit"
 disabled={loading}
 className="btn-primary text-white uppercase tracking-widest text-sm font-medium hover:bg-accent transition-colors duration-300 shadow-card hover:shadow-hover disabled:opacity-70 disabled:cursor-not-allowed flex items-center gap-2 w-full sm:w-auto justify-center"
 >
 {loading ? (
 "Saving..."
 ) : (
 <>
 <Check className="w-4 h-4" />
 Register Visitor
 </>
 )}
 </button>
 </div>
 </div>
 </div>
 </form>
 </div>
 );
}
