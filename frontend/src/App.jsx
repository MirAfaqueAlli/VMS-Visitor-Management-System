import { createBrowserRouter, RouterProvider, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { lazy, Suspense } from "react";

import { AuthProvider }   from "./context/AuthContext";
import { SocketProvider } from "./context/SocketContext";
import { ThemeProvider }  from "./context/ThemeContext";
import useTheme           from "./context/ThemeContext";
import useAuth            from "./hooks/useAuth";

// ── Always-eager: layout scaffolding needed on every route ───────────────────
import AppLayout      from "./components/Layout/AppLayout";
import ProtectedRoute from "./components/Layout/ProtectedRoute";

// ── Lazy page imports — each becomes a separate JS chunk ─────────────────────
const Login                 = lazy(() => import("./pages/auth/Login"));
const Setup                 = lazy(() => import("./pages/auth/Setup"));
const RegisterOrganization  = lazy(() => import("./pages/auth/RegisterOrganization"));
const PublicRequest         = lazy(() => import("./pages/requests/PublicRequest"));

// Dashboard — default export is SuperAdmin view; named export AdminDashboard is unit view.
// For named exports, .then() lets us remap them to `default` for lazy().
const Dashboard     = lazy(() => import("./pages/dashboard/Dashboard"));
const UnitDashboard = lazy(() =>
  import("./pages/dashboard/Dashboard").then((m) => ({ default: m.AdminDashboard }))
);

const VisitorList            = lazy(() => import("./pages/visitors/VisitorList"));
const VisitorDetail          = lazy(() => import("./pages/visitors/VisitorDetail"));
const NewRequest             = lazy(() => import("./pages/requests/NewRequest"));
const RequestList            = lazy(() => import("./pages/requests/RequestList"));
const RequestDetail          = lazy(() => import("./pages/requests/RequestDetail"));
const CheckIn                = lazy(() => import("./pages/gate/CheckIn"));
const CheckOut               = lazy(() => import("./pages/gate/CheckOut"));
const GatePass               = lazy(() => import("./pages/gate/GatePass"));
const ApprovalInbox          = lazy(() => import("./pages/approvals/ApprovalInbox"));
const UserManagement         = lazy(() => import("./pages/admin/UserManagement"));
const DepartmentManagement   = lazy(() => import("./pages/admin/DepartmentManagement"));
const ArchiveManagement      = lazy(() => import("./pages/admin/ArchiveManagement"));
const UnitManagement         = lazy(() => import("./pages/super/UnitManagement"));
const GlobalUserManagement   = lazy(() => import("./pages/super/GlobalUserManagement"));
const SuperArchiveManagement = lazy(() => import("./pages/super/SuperArchiveManagement"));
const Reports                = lazy(() => import("./pages/reports/Reports"));
const AuditLog               = lazy(() => import("./pages/audit/AuditLog"));
const Profile                = lazy(() => import("./pages/profile/Profile"));

// ── Minimal page-level loading spinner ───────────────────────────────────────
function PageLoader() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        width: "100%",
      }}
    >
      <div
        style={{
          width: "36px",
          height: "36px",
          borderRadius: "50%",
          border: "3px solid rgba(134,59,255,0.15)",
          borderTopColor: "#863bff",
          animation: "vms-spin 0.7s linear infinite",
        }}
      />
      <style>{`@keyframes vms-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Convenience wrapper — gives every lazy element a Suspense boundary ────────
function S({ children }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
}

// ── Role-switching archive wrapper ────────────────────────────────────────────
// Super admin without an active unit context → global archive view.
// Everyone else (unit_admin, super_admin managing a unit) → per-unit archive view.
function ArchiveRouter() {
  const { user, activeUnit } = useAuth();
  if (user?.role_type === "super_admin" && !activeUnit) {
    return (
      <S>
        <SuperArchiveManagement />
      </S>
    );
  }
  return (
    <S>
      <ArchiveManagement />
    </S>
  );
}

// ── Role groups ───────────────────────────────────────────────────────────────
const ADMIN_ROLES    = ["super_admin", "unit_admin"];
const GATE_ROLES     = ["security", "receptionist", "unit_admin", "super_admin"];
const APPROVAL_ROLES = ["unit_admin", "employee", "super_admin"];
const REPORT_ROLES   = ["unit_admin", "unit_auditor", "global_auditor", "super_admin"];

const router = createBrowserRouter([
  // ── Public pages ────────────────────────────────────────────────────────────
  { path: "/setup",           element: <S><Setup /></S> },
  { path: "/login",           element: <S><Login /></S> },
  { path: "/login/:unitCode", element: <S><Login /></S> },
  { path: "/register",        element: <S><RegisterOrganization /></S> },
  { path: "/public-request",  element: <S><PublicRequest /></S> },

  {
    path: "/",
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true,            element: <Navigate to="/dashboard" replace /> },
          { path: "dashboard",      element: <S><Dashboard /></S> },
          { path: "unit-dashboard", element: <S><UnitDashboard /></S> },
          { path: "unit-archive",   element: <S><ArchiveManagement /></S> },
          { path: "profile",        element: <S><Profile /></S> },

          // Visitors
          { path: "visitors",     element: <S><VisitorList /></S> },
          { path: "visitors/:id", element: <S><VisitorDetail /></S> },

          // Visit Requests
          { path: "requests",     element: <S><RequestList /></S> },
          { path: "requests/new", element: <S><NewRequest /></S> },
          { path: "requests/:id", element: <S><RequestDetail /></S> },

          // Approvals
          {
            path: "approvals",
            element: <ProtectedRoute roles={APPROVAL_ROLES} />,
            children: [{ index: true, element: <S><ApprovalInbox /></S> }],
          },

          // Gate
          {
            path: "gate",
            element: <ProtectedRoute roles={GATE_ROLES} />,
            children: [
              { index: true,                element: <S><CheckOut /></S> },
              { path: "checkin/:requestId", element: <S><CheckIn /></S> },
              { path: "pass/:passNumber",   element: <S><GatePass /></S> },
            ],
          },

          // Reports
          {
            path: "reports",
            element: <ProtectedRoute roles={REPORT_ROLES} />,
            children: [{ index: true, element: <S><Reports /></S> }],
          },

          // Audit Logs
          {
            path: "audit-logs",
            element: <ProtectedRoute roles={["super_admin", "global_auditor", "unit_admin", "unit_auditor"]} />,
            children: [{ index: true, element: <S><AuditLog /></S> }],
          },

          // Admin — user + dept + archive management
          {
            path: "admin",
            element: <ProtectedRoute roles={ADMIN_ROLES} />,
            children: [
              { index: true, element: <S><UserManagement /></S> },
              {
                path: "departments",
                element: <ProtectedRoute roles={["super_admin", "unit_admin"]} />,
                children: [{ index: true, element: <S><DepartmentManagement /></S> }],
              },
              {
                path: "archive",
                element: <ProtectedRoute roles={["super_admin", "unit_admin"]} />,
                children: [{ index: true, element: <ArchiveRouter /> }],
              },
            ],
          },

          // Super-admin panel
          {
            path: "super",
            element: <ProtectedRoute roles={["super_admin", "global_auditor"]} />,
            children: [
              { path: "units", element: <S><UnitManagement /></S> },
              {
                path: "users",
                element: <ProtectedRoute roles={["super_admin"]} />,
                children: [{ index: true, element: <S><GlobalUserManagement /></S> }],
              },
            ],
          },
        ],
      },
    ],
  },

  // ── Catch-all: unknown path → dashboard (ProtectedRoute handles auth) ───────
  { path: "*", element: <Navigate to="/dashboard" replace /> },
]);

// ── Theme-aware toaster ───────────────────────────────────────────────────────
function ThemedToaster() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        style: {
          borderRadius: "6px",
          background:   dark ? "#1e293b" : "#ffffff",
          color:        dark ? "#f1f5f9" : "#0f172a",
          fontFamily:   "Inter, system-ui, sans-serif",
          fontSize:     "13px",
          border:       dark ? "1px solid #334155" : "1px solid #e2e8f0",
          boxShadow:    dark
            ? "0 4px 16px rgba(0,0,0,0.5)"
            : "0 1px 3px rgba(15,23,42,0.08)",
          padding: "10px 14px",
        },
        success: { iconTheme: { primary: dark ? "#4ade80" : "#16a34a", secondary: dark ? "#1e293b" : "#ffffff" } },
        error:   { iconTheme: { primary: dark ? "#f87171" : "#dc2626", secondary: dark ? "#1e293b" : "#ffffff" } },
      }}
    />
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <SocketProvider>
          <RouterProvider router={router} />
          <ThemedToaster />
        </SocketProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
