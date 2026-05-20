import { useState, useRef, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Webcam from "react-webcam";
import { Camera, Check, AlertCircle, X, Scan } from "lucide-react";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";
import jsQR from "jsqr";
import useAuth from "../../hooks/useAuth";

export default function CheckIn() {
 const { requestId } = useParams();
 const navigate = useNavigate();
 const { hasRole } = useAuth();
 const isSecurity = hasRole("security", "receptionist");

 const [request, setRequest] = useState(null);
 const [loading, setLoading] = useState(true);
 const [submitting, setSubmitting] = useState(false);

 const webcamRef = useRef(null);
 const fileInputRef = useRef(null);
 const qrInputRef = useRef(null);

 const [cameraError, setCameraError] = useState(false);
 const [photoPreview, setPhotoPreview] = useState(null);
 const [photoFile, setPhotoFile] = useState(null);
 const [qrVerified, setQrVerified] = useState(false);

 const qrWebcamRef = useRef(null);
 const [showQrCam, setShowQrCam] = useState(false);
 const [qrCameraError, setQrCameraError] = useState(false);

 const [formData, setFormData] = useState({
 manual_pass_number: "",
 id_verified_type: "AADHAAR",
 id_verified_number: "",
 remarks: "",
 });

 const fetchRequest = useCallback(async () => {
 try {
 setLoading(true);
 const response = await apiClient.get(`/visit-requests/${requestId}`);
 setRequest(response.data.data);
 // Pre-fill ID info if available from visitor profile
 if (response.data.data.Visitor) {
 setFormData((prev) => ({
 ...prev,
 id_verified_type: response.data.data.Visitor.id_type || "AADHAAR",
 id_verified_number: response.data.data.Visitor.id_number || "",
 }));
 }
 } catch (error) {
 toast.error("Failed to load visit request details");
 navigate("/requests");
 } finally {
 setLoading(false);
 }
 }, [requestId, navigate]);

 useEffect(() => {
 fetchRequest();
 }, [fetchRequest]);

 const handleCapture = useCallback(() => {
 if (webcamRef.current) {
 const imageSrc = webcamRef.current.getScreenshot();
 setPhotoPreview(imageSrc);

 // Convert base64 to File
 fetch(imageSrc)
 .then((res) => res.blob())
 .then((blob) => {
 const file = new File([blob], "capture.jpg", { type: "image/jpeg" });
 setPhotoFile(file);
 });
 }
 }, [webcamRef]);

 const handleFileUpload = (e) => {
 const file = e.target.files[0];
 if (file) {
 setPhotoFile(file);
 setPhotoPreview(URL.createObjectURL(file));
 }
 };

 const clearPhoto = () => {
 setPhotoPreview(null);
 setPhotoFile(null);
 };

 const verifyQrImage = (file) => {
 const reader = new FileReader();
 reader.onload = (e) => {
 const img = new Image();
 img.onload = () => {
 const canvas = document.createElement("canvas");
 canvas.width = img.width;
 canvas.height = img.height;
 const ctx = canvas.getContext("2d");
 ctx.drawImage(img, 0, 0, img.width, img.height);
 const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
 const code = jsQR(imageData.data, imageData.width, imageData.height);

 if (code) {
 try {
 const data = JSON.parse(code.data);
 if (data.pass_number === request.pass_number) {
 setQrVerified(true);
 toast.success("QR Code Verified successfully!");
 } else {
 toast.error("Invalid QR Code. Does not match this request.");
 }
 } catch (err) {
 // If not JSON, maybe it's just raw pass number
 if (code.data === request.pass_number) {
 setQrVerified(true);
 toast.success("QR Code Verified successfully!");
 } else {
 toast.error("Invalid QR Code format.");
 }
 }
 } else {
 toast.error(
 "No QR code found in the image. Ensure the image is clear.",
 );
 }
 };
 img.src = e.target.result;
 };
 reader.readAsDataURL(file);
 };

 const handleInputChange = (e) => {
 const { name, value } = e.target;
 setFormData((prev) => ({ ...prev, [name]: value }));
 };

 const handleVerifyPass = () => {
 if (formData.manual_pass_number === request.pass_number) {
 setQrVerified(true);
 setShowQrCam(false);
 toast.success("Pass verified successfully!");
 } else {
 toast.error("Invalid Pass Number.");
 }
 };

 const handleCaptureQr = () => {
 if (qrWebcamRef.current) {
 const imageSrc = qrWebcamRef.current.getScreenshot();
 if (!imageSrc) return toast.error("Failed to capture image");

 const img = new Image();
 img.onload = () => {
 const canvas = document.createElement("canvas");
 canvas.width = img.width;
 canvas.height = img.height;
 const ctx = canvas.getContext("2d");
 ctx.drawImage(img, 0, 0, img.width, img.height);
 const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
 const code = jsQR(imageData.data, imageData.width, imageData.height);

 if (code) {
 try {
 const data = JSON.parse(code.data);
 if (data.pass_number === request.pass_number) {
 setQrVerified(true);
 setShowQrCam(false);
 toast.success("QR Code Verified successfully!");
 } else {
 toast.error("Invalid QR Code. Does not match this request.");
 }
 } catch (err) {
 if (code.data === request.pass_number) {
 setQrVerified(true);
 setShowQrCam(false);
 toast.success("QR Code Verified successfully!");
 } else {
 toast.error("Invalid QR Code format.");
 }
 }
 } else {
 toast.error(
 "No QR code found. Please ensure it is clearly visible in the camera.",
 );
 }
 };
 img.src = imageSrc;
 }
 };

 const handleSubmit = async (e) => {
 e.preventDefault();
 if (!qrVerified) {
 toast.error("Please verify the Gate Pass (QR Code) first.");
 return;
 }
 setSubmitting(true);

 try {
 const data = new FormData();
 data.append("id_verified_type", formData.id_verified_type);
 data.append("id_verified_number", formData.id_verified_number);
 data.append("pass_number", request.pass_number);
 if (formData.remarks) data.append("remarks", formData.remarks);
 if (photoFile) data.append("photo", photoFile);

 const response = await apiClient.post(`/gate/checkin/${requestId}`, data);

 toast.success("Check-in successful");
 if (response.data.data?.pass_number) {
 navigate(`/gate/pass/${response.data.data.pass_number}`);
 } else {
 navigate("/dashboard"); // fallback
 }
 } catch (error) {
 toast.error(error.response?.data?.message || "Check-in failed");
 } finally {
 setSubmitting(false);
 }
 };

 if (loading) {
 return (
 <div className="flex justify-center items-center min-h-[60vh]">
 Loading...
 </div>
 );
 }

 if (!request) return null;

 if (!request.pass_number) {
 return (
 <div className="max-w-xl mx-auto py-20 px-4 text-center">
 <div className="vms-card rounded-md p-10 shadow-card">
 <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
 <h2 className="text-2xl font-bold text-loud mb-2">
 Gate Pass Not Generated
 </h2>
 <p className="text-muted mb-6">
 A gate pass must be generated for this visit request before check-in
 can proceed.
 </p>
 <button
 onClick={() => navigate("/requests")}
 className="btn-primary text-white text-sm font-medium uppercase tracking-widest hover:bg-accent transition-colors"
 >
 Back to Requests
 </button>
 </div>
 </div>
 );
 }

 return (
 <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 animate-fade-in">
 <div className="mb-8">
 <h1 className="text-2xl font-bold text-loud">
 Gate <em className="italic">Check-In</em>
 </h1>
 <p className="text-muted mt-2">
 Verify identity and capture photo to grant entry.
 </p>
 </div>

 <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
 {/* Left Panel - Visitor Info */}
 <div className="lg:col-span-4">
 <div className="vms-card rounded-md p-6 shadow-card sticky top-8">
 <h2 className="text-2xl text-loud mb-6 pb-4 border-b border-subtle">
 Visit Details
 </h2>

 <div className="space-y-6">
 <div>
 <p className="text-sm text-faint mb-1">
 Visitor Name
 </p>
 <p className="text-lg font-medium text-loud">
 {request.Visitor?.full_name || request.visitor_name || "N/A"}
 </p>
 </div>

 <div>
 <p className="text-sm text-faint mb-1">Host</p>
 <p className="text-loud">
 {request.Host?.full_name || request.host_name || "N/A"}
 </p>
 <p className="text-sm text-muted">
 {request.Department?.name || request.department_name}
 </p>
 </div>

 <div>
 <p className="text-sm text-faint mb-1">Purpose</p>
 <p className="text-loud">{request.purpose}</p>
 </div>

 {request.company_name && (
 <div>
 <p className="text-sm text-faint mb-1">Company</p>
 <p className="text-loud">{request.company_name}</p>
 </div>
 )}

 <div className="pt-4 border-t border-subtle space-y-3">
 <span
 className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium uppercase tracking-wider bg-mixed-bg text-accent`}
 >
 {request.visit_category}
 </span>
 {/* Pass number is only visible after printing — security cannot see it here */}
 {!isSecurity && request.pass_number && (
 <div className="mt-3">
 <p className="text-xs text-faint mb-1">
 Gate Pass Number
 </p>
 <p className="font-mono text-sm font-bold text-loud bg-bg-primary px-3 py-2 rounded-xl border border-subtle tracking-wider">
 {request.pass_number}
 </p>
 </div>
 )}
 </div>
 </div>
 </div>
 </div>

 {/* Right Panel - Check-in Form */}
 <div className="lg:col-span-8">
 <form
 onSubmit={handleSubmit}
 className="vms-card rounded-md p-6 sm:p-8 shadow-card space-y-8"
 >
 {/* QR Verification Section */}
 <div>
 <h3 className="text-[16px] font-semibold text-loud mb-4 flex items-center gap-2">
 {qrVerified ? (
 <Check className="w-5 h-5 text-green-500" />
 ) : (
 <Scan className="w-5 h-5 text-amber-500" />
 )}
 Step 1: Verify Gate Pass (QR Code)
 </h3>

 {!qrVerified ? (
 <div className="bg-bg-primary border border-subtle p-6 rounded-md">
 <p className="text-sm text-loud mb-4">
 Scan the visitor's QR code or manually enter the Pass Number
 to verify their gate pass.
 </p>
 <div className="flex gap-4">
 <input
 type="text"
 placeholder="Scan QR or type Pass Number..."
 className="flex-1 bg-transparent border-b border-subtle px-0 py-2 text-loud focus:ring-0 focus:border-border transition-colors font-mono uppercase"
 value={formData.manual_pass_number}
 onChange={(e) =>
 setFormData((prev) => ({
 ...prev,
 manual_pass_number: e.target.value.toUpperCase(),
 }))
 }
 onKeyDown={(e) => {
 if (e.key === "Enter") {
 e.preventDefault(); // Prevent form submission
 handleVerifyPass();
 }
 }}
 />
 <button
 type="button"
 onClick={handleVerifyPass}
 className="px-4 py-2 bg-mixed-bg text-accent rounded-full text-sm font-medium hover:bg-accent/20 transition-colors"
 >
 Verify
 </button>
 </div>

 <div className="mt-4 flex items-center gap-4">
 <span className="text-xs text-faint uppercase font-medium">
 OR
 </span>
 <input
 type="file"
 accept="image/*"
 capture="environment"
 ref={qrInputRef}
 className="hidden"
 onChange={(e) => {
 if (e.target.files[0]) verifyQrImage(e.target.files[0]);
 }}
 />
 <button
 type="button"
 onClick={() => qrInputRef.current?.click()}
 className="text-sm text-accent underline hover:text-warning"
 >
 Upload Image
 </button>
 <span className="text-xs text-faint uppercase font-medium mx-2">
 OR
 </span>
 <button
 type="button"
 onClick={() => setShowQrCam(!showQrCam)}
 className="text-sm text-accent underline hover:text-warning flex items-center gap-1"
 >
 <Camera className="w-4 h-4" /> Live Camera
 </button>
 </div>

 {showQrCam && (
 <div className="mt-4 border border-subtle rounded-xl p-4 bg-bg-primary flex flex-col items-center">
 <div className="w-full max-w-[300px] aspect-square bg-black rounded-lg overflow-hidden relative shadow-soft-sm mb-4">
 {qrCameraError ? (
 <div className="w-full h-full flex items-center justify-center text-loud text-sm p-4 text-center">
 Camera unavailable
 </div>
 ) : (
 <Webcam
 audio={false}
 ref={qrWebcamRef}
 screenshotFormat="image/jpeg"
 videoConstraints={{ facingMode: "environment" }}
 onUserMediaError={() => setQrCameraError(true)}
 className="w-full h-full object-cover"
 />
 )}
 </div>
 <button
 type="button"
 onClick={handleCaptureQr}
 className="px-6 py-2 bg-accent text-white rounded-full text-sm font-medium hover:bg-accent transition-colors flex items-center gap-2"
 >
 <Scan className="w-4 h-4" /> Click to Scan QR
 </button>
 </div>
 )}
 </div>
 ) : (
 <div className="bg-green-50 border border-green-200 p-4 rounded-md flex items-center gap-3">
 <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
 <Check className="w-5 h-5 text-green-600" />
 </div>
 <div>
 <p className="font-medium text-green-800">
 Pass Verified Successfully
 </p>
 <p className="text-xs text-green-600 font-mono mt-0.5">
 {request.pass_number}
 </p>
 </div>
 <button
 type="button"
 onClick={() => setQrVerified(false)}
 className="ml-auto text-xs text-green-700 underline"
 >
 Reset
 </button>
 </div>
 )}
 </div>

 {/* Photo Section */}
 <div
 className={`pt-8 border-t border-subtle transition-opacity duration-300 ${!qrVerified ? "opacity-50 pointer-events-none grayscale" : ""}`}
 >
 <h3 className="text-[16px] font-semibold text-loud mb-4">
 Step 2: Capture Visitor Face Photo
 </h3>
 <div className="flex flex-col md:flex-row gap-6 items-center">
 <div className="w-full max-w-[320px] aspect-video md:aspect-square bg-black rounded-md overflow-hidden relative shadow-soft-sm">
 {photoPreview ? (
 <img
 src={photoPreview}
 alt="Captured"
 className="w-full h-full object-cover"
 />
 ) : cameraError ? (
 <div className="w-full h-full flex flex-col items-center justify-center bg-bg-primary border border-subtle p-4 text-center">
 <AlertCircle className="w-8 h-8 text-warning mb-2" />
 <p className="text-sm text-loud">
 Camera access denied or unavailable.
 </p>
 <button
 type="button"
 onClick={() => fileInputRef.current?.click()}
 className="mt-4 px-4 py-2 bg-mixed-bg text-accent rounded-full text-xs font-medium uppercase tracking-wider"
 >
 Upload File Instead
 </button>
 </div>
 ) : (
 <Webcam
 audio={false}
 ref={webcamRef}
 screenshotFormat="image/jpeg"
 videoConstraints={{ facingMode: "user" }}
 onUserMediaError={() => setCameraError(true)}
 className="w-full h-full object-cover"
 />
 )}
 </div>

 <div className="flex flex-col gap-3">
 {!photoPreview && !cameraError && (
 <button
 type="button"
 onClick={handleCapture}
 className="px-6 py-3 rounded-full bg-accent text-white uppercase tracking-widest text-sm font-medium hover:bg-accent/90 transition-colors flex items-center justify-center gap-2"
 >
 <Camera className="w-4 h-4" /> Capture Photo
 </button>
 )}
 {photoPreview && (
 <button
 type="button"
 onClick={clearPhoto}
 className="btn-secondary text-accent uppercase tracking-widest text-sm font-medium hover:bg-mixed-bg transition-colors flex items-center justify-center gap-2"
 >
 <X className="w-4 h-4" /> Retake
 </button>
 )}
 <input
 type="file"
 ref={fileInputRef}
 onChange={handleFileUpload}
 accept="image/*"
 className="hidden"
 />
 {!photoPreview && !cameraError && (
 <button
 type="button"
 onClick={() => fileInputRef.current?.click()}
 className="text-xs text-muted underline hover:text-accent transition-colors"
 >
 Or upload file manually
 </button>
 )}
 </div>
 </div>
 </div>

 {/* Verification Section */}
 <div className="pt-8 border-t border-subtle">
 <h3 className="text-[16px] font-semibold text-loud mb-6">
 ID Verification
 </h3>
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
 <div className="space-y-2">
 <label className="block text-sm font-medium text-loud">
 ID Type *
 </label>
 <select
 name="id_verified_type"
 required
 value={formData.id_verified_type}
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
 name="id_verified_number"
 required
 value={formData.id_verified_number}
 onChange={handleInputChange}
 className="w-full bg-bg-primary border-0 border-b border-subtle px-0 py-2 text-loud focus:ring-0 focus:border-border transition-colors duration-300"
 placeholder="Enter ID number"
 />
 </div>

 <div className="space-y-2 sm:col-span-2">
 <label className="block text-sm font-medium text-loud">
 Remarks (Optional)
 </label>
 <textarea
 name="remarks"
 rows="2"
 value={formData.remarks}
 onChange={handleInputChange}
 className="w-full bg-bg-primary border-0 border-b border-subtle px-0 py-2 text-loud focus:ring-0 focus:border-border transition-colors duration-300 resize-none"
 placeholder="Any observations or items brought in..."
 ></textarea>
 </div>
 </div>
 </div>

 <div className="pt-8 border-t border-subtle flex justify-end gap-4">
 <button
 type="button"
 onClick={() => navigate("/requests")}
 className="btn-secondary text-accent uppercase tracking-widest text-sm font-medium hover:bg-mixed-bg transition-colors duration-300"
 >
 Cancel
 </button>
 <button
 type="submit"
 disabled={submitting || !formData.id_verified_number}
 className="btn-primary text-white uppercase tracking-widest text-sm font-medium hover:bg-accent transition-colors duration-300 shadow-card hover:shadow-hover disabled:opacity-70 disabled:cursor-not-allowed flex items-center gap-2"
 >
 {submitting ? (
 "Processing..."
 ) : (
 <>
 <Check className="w-4 h-4" />
 Complete Check-In
 </>
 )}
 </button>
 </div>
 </form>
 </div>
 </div>
 </div>
 );
}
