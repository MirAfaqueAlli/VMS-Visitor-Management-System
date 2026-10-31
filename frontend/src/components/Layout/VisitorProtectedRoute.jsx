// frontend/src/components/Layout/VisitorProtectedRoute.jsx
import { Navigate, Outlet, useLocation } from "react-router-dom";

/**
 * Validates whether the visitor token is present and not expired.
 * If expired or absent, redirects back to the public registration / login portal.
 */
function isVisitorTokenValid(token) {
  if (!token) return false;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const payload = JSON.parse(atob(parts[1]));
    if (payload.purpose !== "PUBLIC_VISITOR") return false;
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      return false; // Token expired
    }
    return true;
  } catch {
    return false;
  }
}

export default function VisitorProtectedRoute() {
  const location = useLocation();
  const token =
    sessionStorage.getItem("vms_visitor_token") ||
    localStorage.getItem("vms_visitor_token");

  if (!isVisitorTokenValid(token)) {
    // Clear any stale visitor tokens
    sessionStorage.removeItem("vms_visitor_token");
    localStorage.removeItem("vms_visitor_token");
    localStorage.removeItem("vms_visitor_data");
    return <Navigate to="/public-request" state={{ from: location }} replace />;
  }

  return <Outlet />;
}

