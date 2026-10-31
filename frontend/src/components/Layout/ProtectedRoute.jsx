import { Navigate, Outlet } from "react-router-dom";
import { ShieldOff, Loader2 } from "../icons";
import useAuth from "../../hooks/useAuth";

export default function ProtectedRoute({ roles }) {
 const { isLoading, isAuthenticated, hasRole } = useAuth();

 if (isLoading) {
 return (
 <div className="min-h-screen bg-canvas flex items-center justify-center gap-2 text-[12.5px] text-muted">
 <Loader2 size={16} className="animate-spin" /> Loading VMS…
 </div>
 );
 }

 if (!isAuthenticated) {
 return <Navigate to="/login" replace />;
 }

 if (roles && !hasRole(...roles)) {
 return (
 <div className="min-h-screen bg-surface flex flex-col items-center justify-center text-center px-6">
 <span className="head-chip tone-danger !w-10 !h-10 mb-4"><ShieldOff size={20} duo /></span>
 <h1 className="text-[17px] font-semibold text-ink mb-1">You don&apos;t have access to this page</h1>
 <p className="text-[12.5px] text-muted max-w-sm mb-5">
 Ask your administrator if you think you should.
 </p>
 <button type="button" onClick={() => window.history.back()} className="btn-outline">
 Go back
 </button>
 </div>
 );
 }

 return <Outlet />;
}
