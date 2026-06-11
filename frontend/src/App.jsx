import { createBrowserRouter, RouterProvider, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";

import { AuthProvider }         from "./context/AuthContext";
import { SocketProvider }       from "./context/SocketContext";
import { ThemeProvider }        from "./context/ThemeContext";
import useTheme                 from "./context/ThemeContext";
import ProtectedRoute           from "./components/Layout/ProtectedRoute";

import AppLayout                from "./components/Layout/AppLayout";
import Login                    from "./pages/auth/Login";
import Setup                    from "./pages/auth/Setup";
import RegisterOrganization     from "./pages/auth/RegisterOrganization";
import Dashboard                from "./pages/dashboard/Dashboard";
import VisitorList              from "./pages/visitors/VisitorList";
import VisitorDetail            from "./pages/visitors/VisitorDetail";
import NewRequest               from "./pages/requests/NewRequest";
import RequestList              from "./pages/requests/RequestList";
import RequestDetail            from "./pages/requests/RequestDetail";
import PublicRequest            from "./pages/requests/PublicRequest";
import CheckIn                  from "./pages/gate/CheckIn";
import CheckOut                 from "./pages/gate/CheckOut";
import GatePass                 from "./pages/gate/GatePass";
import ApprovalInbox            from "./pages/approvals/ApprovalInbox";
import UserManagement           from "./pages/admin/UserManagement";
import DepartmentManagement     from "./pages/admin/DepartmentManagement";
import UnitManagement           from "./pages/super/UnitManagement";
import GlobalUserManagement     from "./pages/super/GlobalUserManagement";
import Reports                  from "./pages/reports/Reports";
import AuditLog                 from "./pages/audit/AuditLog";
import Profile                  from "./pages/profile/Profile";
import ArchiveManagement        from "./pages/admin/ArchiveManagement";

// ── Role groups ──────────────────────────────────────────────────────────────
const ADMIN_ROLES    = ["super_admin", "unit_admin"];
const GATE_ROLES     = ["security", "receptionist", "unit_admin", "super_admin"];
const APPROVAL_ROLES = ["unit_admin", "employee", "super_admin"];
const REPORT_ROLES   = ["unit_admin", "unit_auditor", "global_auditor", "super_admin"];

const router = createBrowserRouter([
  // ── Public pages ──────────────────────────────────────────────────────────
  { path: "/setup",            element: <Setup /> },
  { path: "/login",            element: <Login /> },
  { path: "/login/:unitCode",  element: <Login /> },   // unit-scoped login URL
  { path: "/register",         element: <RegisterOrganization /> },
  { path: "/public-request",   element: <PublicRequest /> },

  {
    path: "/",
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },
          { path: "dashboard", element: <Dashboard /> },
          { path: "profile",   element: <Profile /> },

          // Visitors
          { path: "visitors",     element: <VisitorList /> },
          { path: "visitors/:id", element: <VisitorDetail /> },

          // Visit Requests
          { path: "requests",     element: <RequestList /> },
          { path: "requests/new", element: <NewRequest /> },
          { path: "requests/:id", element: <RequestDetail /> },

          // Approvals
          {
            path: "approvals",
            element: <ProtectedRoute roles={APPROVAL_ROLES} />,
            children: [{ index: true, element: <ApprovalInbox /> }],
          },

          // Gate
          {
            path: "gate",
            element: <ProtectedRoute roles={GATE_ROLES} />,
            children: [
              { index: true,               element: <CheckOut /> },
              { path: "checkin/:requestId",element: <CheckIn /> },
              { path: "pass/:passNumber",  element: <GatePass /> },
            ],
          },

          // Reports
          {
            path: "reports",
            element: <ProtectedRoute roles={REPORT_ROLES} />,
            children: [{ index: true, element: <Reports /> }],
          },

          // Audit Logs
          {
            path: "audit-logs",
            element: <ProtectedRoute roles={['super_admin', 'global_auditor', 'unit_admin', 'unit_auditor']} />,
            children: [{ index: true, element: <AuditLog /> }],
          },

          // Admin — user + dept management
          {
            path: "admin",
            element: <ProtectedRoute roles={ADMIN_ROLES} />,
            children: [
              { index: true, element: <UserManagement /> },
              {
                path: "departments",
                element: <ProtectedRoute roles={["super_admin", "unit_admin"]} />,
                children: [{ index: true, element: <DepartmentManagement /> }],
              },
              {
                path: "archive",
                element: <ProtectedRoute roles={["super_admin", "unit_admin"]} />,
                children: [{ index: true, element: <ArchiveManagement /> }],
              },
            ],
          },

          // Super-admin panel
          {
            path: "super",
            element: <ProtectedRoute roles={["super_admin", "global_auditor"]} />,
            children: [
              { path: "units", element: <UnitManagement /> },
              {
                path: "users",
                element: <ProtectedRoute roles={["super_admin"]} />,
                children: [{ index: true, element: <GlobalUserManagement /> }],
              },
            ],
          },
        ],
      },
    ],
  },
]);

// Theme-aware toaster so it adapts colours in dark mode
function ThemedToaster() {
  const { theme } = useTheme();
  const dark = theme === 'dark';
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
          padding:      "10px 14px",
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
