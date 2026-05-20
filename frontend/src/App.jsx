import { createBrowserRouter, RouterProvider, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";

import { AuthProvider }         from "./context/AuthContext";
import ProtectedRoute           from "./components/Layout/ProtectedRoute";
import AppLayout                from "./components/Layout/AppLayout";
import Login                    from "./pages/auth/Login";
import RegisterOrganization     from "./pages/auth/RegisterOrganization";
import Dashboard                from "./pages/dashboard/Dashboard";
import VisitorForm              from "./pages/visitors/VisitorForm";
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
import Reports                  from "./pages/reports/Reports";
import Profile                  from "./pages/profile/Profile";

const ADMIN_ROLES      = ["org_admin", "dept_admin"];
const ALL_ADMIN_ROLES  = ["org_admin", "dept_admin"];
const GATE_ROLES       = ["security", "receptionist", "org_admin", "dept_admin"];
const APPROVAL_ROLES   = ["org_admin", "dept_admin", "employee"];
const REPORT_ROLES     = ["org_admin", "dept_admin"];

const router = createBrowserRouter([
  // Public pages
  { path: "/login",    element: <Login /> },
  { path: "/register", element: <RegisterOrganization /> },
  { path: "/public-request", element: <PublicRequest /> },

  {
    path: "/",
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },
          { path: "dashboard",      element: <Dashboard /> },
          { path: "visitors",       element: <VisitorList /> },
          { path: "visitors/new",   element: <VisitorForm /> },
          { path: "visitors/:id",   element: <VisitorDetail /> },
          { path: "requests",       element: <RequestList /> },
          { path: "requests/new",   element: <NewRequest /> },
          { path: "requests/:id",   element: <RequestDetail /> },
          { path: "profile",        element: <Profile /> },
          {
            path: "approvals",
            element: <ProtectedRoute roles={APPROVAL_ROLES} />,
            children: [{ index: true, element: <ApprovalInbox /> }],
          },
          {
            path: "gate",
            element: <ProtectedRoute roles={GATE_ROLES} />,
            children: [
              { index: true,                   element: <CheckOut /> },
              { path: "checkin/:requestId",     element: <CheckIn /> },
              { path: "pass/:passNumber",       element: <GatePass /> },
            ],
          },
          {
            path: "reports",
            element: <ProtectedRoute roles={REPORT_ROLES} />,
            children: [{ index: true, element: <Reports /> }],
          },
          {
            path: "admin",
            element: <ProtectedRoute roles={ALL_ADMIN_ROLES} />,
            children: [
              { index: true,         element: <UserManagement /> },
              // Departments only accessible to org_admin
              {
                path: "departments",
                element: <ProtectedRoute roles={["org_admin"]} />,
                children: [{ index: true, element: <DepartmentManagement /> }],
              },
            ],
          },
        ],
      },
    ],
  },
]);

export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            borderRadius: "6px",
            background: "#ffffff",
            color: "#0f172a",
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: "13px",
            border: "1px solid #e2e8f0",
            boxShadow: "0 1px 3px rgba(15,23,42,0.08)",
            padding: "10px 14px",
          },
          success: { iconTheme: { primary: "#16a34a", secondary: "#ffffff" } },
          error:   { iconTheme: { primary: "#dc2626", secondary: "#ffffff" } },
        }}
      />
    </AuthProvider>
  );
}
