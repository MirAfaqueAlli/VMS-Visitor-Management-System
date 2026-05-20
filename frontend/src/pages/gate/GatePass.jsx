import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Printer, ArrowLeft, ShieldCheck, Sprout } from "lucide-react";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";

export default function GatePass() {
 const { passNumber } = useParams();
 const navigate = useNavigate();
 const [passData, setPassData] = useState(null);
 const [loading, setLoading] = useState(true);

 useEffect(() => {
 const fetchPass = async () => {
 try {
 const response = await apiClient.get(`/passes/pass/${passNumber}`);
 setPassData(response.data.data);
 } catch (error) {
 toast.error("Failed to load gate pass");
 navigate("/dashboard");
 } finally {
 setLoading(false);
 }
 };
 fetchPass();
 }, [passNumber, navigate]);

 if (loading) {
 return (
 <div className="flex justify-center items-center min-h-[60vh]">
 Loading pass...
 </div>
 );
 }

 if (!passData) return null;

 return (
 <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
 {/* Controls - Hidden when printing */}
 <div className="flex justify-between items-center mb-8 print:hidden">
 <button
 onClick={() => navigate(-1)}
 className="inline-flex items-center gap-2 text-muted hover:text-accent transition-colors"
 >
 <ArrowLeft className="w-4 h-4" /> Back
 </button>
 <button
 onClick={() => window.print()}
 className="bg-accent text-white px-6 py-3 rounded-full uppercase tracking-widest text-sm font-medium hover:bg-accent transition-colors duration-300 flex items-center gap-2 shadow-card"
 >
 <Printer className="w-4 h-4" /> Print Pass
 </button>
 </div>

 {/* Pass Container */}
 <div className="flex justify-center">
 <div className="vms-card rounded-[32px] p-8 sm:p-10 w-full max-w-lg shadow-card relative overflow-hidden border border-subtle print:shadow-none print:border-2">
 {/* Decorative Elements */}
 <div className="absolute top-0 right-0 w-32 h-32 bg-mixed-bg rounded-bl-full -mr-4 -mt-4 print:bg-gray-100"></div>
 <div className="absolute bottom-0 left-0 w-24 h-24 bg-accent/5 rounded-tr-full -ml-4 -mb-4 print:hidden"></div>

 {/* Header */}
 <div className="flex flex-col items-center mb-8 relative z-10 border-b border-subtle pb-6">
 <div className="w-12 h-12 rounded-full bg-bg-primary flex items-center justify-center mb-3 text-accent shadow-soft-sm">
 <Sprout className="w-6 h-6" strokeWidth={1.5} />
 </div>
 <h2 className="text-2xl font-bold text-loud uppercase tracking-widest text-center">
 Visitor Pass
 </h2>
 <div className="mt-2 inline-flex items-center gap-1.5 btn-secondary text-xs font-mono text-loud font-medium shadow-soft-sm">
 <ShieldCheck className="w-3.5 h-3.5 text-accent" />
 {passData.pass_number}
 </div>
 </div>

 {/* Main Content */}
 <div className="relative z-10 grid grid-cols-1 gap-8">
 {/* Top Row: Info + QR */}
 <div className="flex justify-between items-start gap-4">
 <div className="flex-1">
 <p className="text-[10px] uppercase tracking-widest text-faint mb-1">
 Visitor Name
 </p>
 <p className="text-3xl font-bold text-loud leading-tight mb-4">
 {passData.visitor_name}
 </p>

 <div className="space-y-3">
 <div>
 <p className="text-[10px] uppercase tracking-widest text-faint mb-0.5">
 Host & Dept
 </p>
 <p className="text-sm font-medium text-loud">
 {passData.host_name}
 </p>
 <p className="text-xs text-muted">
 {passData.department_name}
 </p>
 </div>
 </div>
 </div>

 {/* QR Code */}
 <div className="shrink-0 p-2 bg-white rounded-md shadow-soft-sm border border-subtle">
 {passData.qr_code_path ? (
 <img
 src={`http://localhost:5000/${passData.qr_code_path}`}
 alt="QR Code"
 className="w-24 h-24 object-contain"
 crossOrigin="anonymous"
 />
 ) : (
 <div className="w-24 h-24 bg-gray-100 flex items-center justify-center text-xs text-gray-400">
 No QR
 </div>
 )}
 </div>
 </div>

 {/* Bottom Row: Validity */}
 <div className="bg-bg-primary rounded-md p-4 border border-subtle mt-2">
 <div className="grid grid-cols-2 gap-4">
 <div>
 <p className="text-[10px] uppercase tracking-widest text-faint mb-1">
 Valid Date
 </p>
 <p className="font-medium text-loud">
 {new Date(passData.visit_date).toLocaleDateString()}
 </p>
 </div>
 <div>
 <p className="text-[10px] uppercase tracking-widest text-faint mb-1">
 Valid Time
 </p>
 <p className="font-medium text-loud">
 {passData.visit_start_time
 ? passData.visit_start_time.substring(0, 5)
 : "All Day"}
 </p>
 </div>
 </div>
 </div>
 </div>

 {/* Footer */}
 <div className="mt-8 text-center text-[10px] text-faint uppercase tracking-widest">
 Please wear this pass visibly while on premises.
 </div>
 </div>
 </div>

 {/* Print styles */}
 <style
 dangerouslySetInnerHTML={{
 __html: `
 @media print {
 @page { margin: 15mm; }
 body * { visibility: hidden; }
 .vms-card, .vms-card * { visibility: visible; }
 .vms-card { 
 position: absolute; 
 left: 0; 
 top: 0;
 width: 100%;
 max-width: 400px;
 margin: 0;
 page-break-inside: avoid;
 break-inside: avoid;
 box-shadow: none !important;
 }
 }
 `,
 }}
 />
 </div>
 );
}
