import { createBrowserRouter, RouterProvider, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { lazy, Suspense } from "react";

import { AuthProvider }   from "./context/AuthContext";
import { SocketProvider } from "./context/SocketContext";
import { ThemeProvider }  from "./context/ThemeContext";

// ── Always-eager: layout scaffolding needed on every route ───────────────────
import AppLayout      from "./components/Layout/AppLayout";
import ProtectedRoute from "./components/Layout/ProtectedRoute";

// ── Lazy page imports — each becomes a separate JS chunk ─────────────────────
const Login                 = lazy(() => import("./pages/auth/Login"));
const Setup                 = lazy(() => import("./pages/auth/Setup"));
const RegisterOrganization  = lazy(() => import("./pages/auth/RegisterOrganization"));
const PublicRequest         = lazy(() => import("./pages/requests/PublicRequest"));
const VisitorPortal         = lazy(() => import("./pages/visitor/VisitorPortal"));
const ResetPassword         = lazy(() => import("./pages/auth/ResetPassword"));


// Dashboard — default export is SuperAdmin view; named export AdminDashboard is unit view.
// For named exports, .then() lets us remap them to `default` for lazy().
const Dashboard     = lazy(() => import("./pages/dashboard/Dashboard"));
const UnitDashboard = lazy(() =>
  import("./pages/dashboard/Dashboard").then((m) => ({ default: m.AdminDashboard }))
);

const VisitorList            = lazy(() => import("./pages/visitors/VisitorList"));
const VisitorDetail          = lazy(() => import("./pages/visitors/VisitorDetail"));
const VisitorForm            = lazy(() => import("./pages/visitors/VisitorForm"));
const NewRequest             = lazy(() => import("./pages/requests/NewRequest"));
const RequestList            = lazy(() => import("./pages/requests/RequestList"));
const RequestDetail          = lazy(() => import("./pages/requests/RequestDetail"));
const CheckIn                = lazy(() => import("./pages/gate/CheckIn"));
const CheckOut               = lazy(() => import("./pages/gate/CheckOut"));
const GatePass               = lazy(() => import("./pages/gate/GatePass"));
const ApprovalInbox          = lazy(() => import("./pages/approvals/ApprovalInbox"));
const UserManagement         = lazy(() => import("./pages/admin/UserManagement"));
const DepartmentManagement   = lazy(() => import("./pages/admin/DepartmentManagement"));
const UnitManagement         = lazy(() => import("./pages/super/UnitManagement"));
const GlobalUserManagement   = lazy(() => import("./pages/super/GlobalUserManagement"));
const Reports                = lazy(() => import("./pages/reports/Reports"));
const AuditLog               = lazy(() => import("./pages/audit/AuditLog"));
const Profile                = lazy(() => import("./pages/profile/Profile"));

// ── Minimal page-level loading spinner (brand-blue ring, token colours) ───────
function PageLoader() {
  return (
    <div className="flex items-center justify-center w-full" style={{ minHeight: "40vh" }} role="status" aria-label="Loading">
      <div
        className="animate-spin rounded-full"
        style={{
          width: "28px",
          height: "28px",
          border: "3px solid var(--primary-soft)",
          borderTopColor: "var(--primary-strong)",
        }}
      />
    </div>
  );
}

// ── Convenience wrapper — gives every lazy element a Suspense boundary ────────
function S({ children }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
}

// ── Role groups ───────────────────────────────────────────────────────────────
// super_admin oversees units (view + user/department setup) but doesn't perform
// operational actions inside them — gate, approvals and creating requests/visitors
// are unit staff only (the backend enforces the same).
const ADMIN_ROLES    = ["super_admin", "unit_admin"];
const GATE_ROLES     = ["security", "receptionist", "unit_admin"];
const APPROVAL_ROLES = ["unit_admin", "employee"];
const REPORT_ROLES   = ["unit_admin", "unit_auditor", "global_auditor", "super_admin"];
const CREATE_ROLES   = ["unit_admin", "employee", "security", "receptionist"];

const router = createBrowserRouter([
  // ── Public pages ────────────────────────────────────────────────────────────
  { path: "/setup",           element: <S><Setup /></S> },
  { path: "/login",           element: <S><Login /></S> },
  { path: "/login/:unitCode", element: <S><Login /></S> },
  { path: "/register",        element: <S><RegisterOrganization /></S> },
  // Visitor portal: sign-in / register / dashboard, and the new-visit form
  { path: "/public-request",      element: <S><VisitorPortal /></S> },
  { path: "/public-request/new",  element: <S><PublicRequest /></S> },
  { path: "/visitor/*",           element: <Navigate to="/public-request" replace /> },
  { path: "/reset-password",  element: <S><ResetPassword /></S> },


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
          { path: "profile",        element: <S><Profile /></S> },

          // Visitors
          { path: "visitors",     element: <S><VisitorList /></S> },
          {
            path: "visitors/new",
            element: <ProtectedRoute roles={CREATE_ROLES} />,
            children: [{ index: true, element: <S><VisitorForm /></S> }],
          },
          { path: "visitors/:id", element: <S><VisitorDetail /></S> },

          // Visit Requests
          { path: "requests",     element: <S><RequestList /></S> },
          {
            path: "requests/new",
            element: <ProtectedRoute roles={CREATE_ROLES} />,
            children: [{ index: true, element: <S><NewRequest /></S> }],
          },
          { path: "requests/:id", element: <S><RequestDetail /></S> },
          { path: "gate/pass/:passNumber",   element: <S><GatePass /></S> },
          { path: "passes/pass/:passNumber", element: <S><GatePass /></S> },

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

          // Admin — user + dept management
          {
            path: "admin",
            element: <ProtectedRoute roles={ADMIN_ROLES} />,
            children: [
              { index: true, element: <Navigate to="/admin/employees" replace /> },
              { path: "employees", element: <S><UserManagement key="employees" initialTab="employees" /></S> },
              { path: "security",  element: <S><UserManagement key="security" initialTab="security" /></S> },
              {
                path: "departments",
                element: <ProtectedRoute roles={["super_admin", "unit_admin"]} />,
                children: [{ index: true, element: <S><DepartmentManagement /></S> }],
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

// ── Toasts (DESIGN_RULES §16): bottom-right, 320px white card with a tinted
// border; 3.5s, errors 6s. Colours are tokens, so dark mode follows by itself.
function ThemedToaster() {
  return (
    <Toaster
      position="bottom-right"
      toastOptions={{
        duration: 3500,
        style: {
          width: 320,
          maxWidth: "calc(100vw - 32px)",
          borderRadius: "var(--radius)",
          background: "var(--surface)",
          color: "var(--ink)",
          fontFamily: "var(--font-ui)",
          fontSize: "12.5px",
          border: "1px solid var(--line-strong)",
          boxShadow: "none",
          padding: "10px 12px",
        },
        success: {
          style: { borderColor: "color-mix(in srgb, var(--success) 45%, transparent)" },
          iconTheme: { primary: "var(--success)", secondary: "var(--surface)" },
        },
        error: {
          duration: 6000,
          style: { borderColor: "color-mix(in srgb, var(--danger) 45%, transparent)" },
          iconTheme: { primary: "var(--danger)", secondary: "var(--surface)" },
        },
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
