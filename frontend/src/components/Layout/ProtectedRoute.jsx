import { Navigate, Outlet } from "react-router-dom";
import { ShieldOff } from "lucide-react";
import useAuth from "../../hooks/useAuth";

export default function ProtectedRoute({ roles }) {
 const { isLoading, isAuthenticated, hasRole } = useAuth();

 if (isLoading) {
 return (
 <div className="min-h-screen bg-bg-primary flex flex-col items-center justify-center gap-4">
 <div className="w-9 h-9 rounded-full border-2 border-border border-t-transparent animate-spin" />
 <p className="text-faint text-sm tracking-widest uppercase font-sans">
 Loading VMS
 </p>
 </div>
 );
 }

 if (!isAuthenticated) {
 return <Navigate to="/login" replace />;
 }

 if (roles && !hasRole(...roles)) {
 return (
 <div className="min-h-screen bg-bg-secondary flex flex-col items-center justify-center text-center px-6">

 <h1 className="text-4xl font-semibold text-loud mb-3 select-none">
 Access Restricted
 </h1>
 <p className="text-faint max-w-sm mb-8 leading-relaxed">
 You don&apos;t have permission to view this area. Please contact your
 administrator if you believe this is an error.
 </p>
 <button onClick={() => window.history.back()} className="btn-secondary">
 Go Back
 </button>
 </div>
 );
 }

 return <Outlet />;
}
