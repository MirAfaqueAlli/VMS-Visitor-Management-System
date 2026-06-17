// frontend/src/context/AuthContext.jsx
import { createContext, useReducer, useEffect, useCallback } from "react";
import apiClient from "../api/axios";

export const AuthContext = createContext(null);

const initialState = {
  user:            null,
  token:           null,
  isAuthenticated: false,
  isLoading:       true,
  activeUnit:      null,
};

function authReducer(state, action) {
  switch (action.type) {
    case "LOGIN_SUCCESS":
      return { ...state, user: action.payload.user, token: action.payload.token, isAuthenticated: true, isLoading: false };
    case "LOGOUT":
      return { ...state, user: null, token: null, isAuthenticated: false, isLoading: false, activeUnit: null };
    case "SET_LOADING":
      return { ...state, isLoading: action.payload };
    case "SET_ACTIVE_UNIT":
      return { ...state, activeUnit: action.payload };
    default:
      return state;
  }
}

export function AuthProvider({ children }) {
  const [state, dispatch] = useReducer(authReducer, initialState);

  // On mount: restore session from localStorage
  useEffect(() => {
    const restoreSession = async () => {
      const token = localStorage.getItem("vms_token");
      if (!token) { dispatch({ type: "LOGOUT" }); return; }
      try {
        const response = await apiClient.get("/auth/me");
        const user = response.data?.data || response.data;
        
        let activeUnit = null;
        const activeUnitStr = localStorage.getItem("vms_active_unit");
        if (activeUnitStr) {
          try { activeUnit = JSON.parse(activeUnitStr); } catch (_) {}
        }

        dispatch({ type: "LOGIN_SUCCESS", payload: { user, token } });
        if (activeUnit) {
          dispatch({ type: "SET_ACTIVE_UNIT", payload: activeUnit });
        }
      } catch {
        localStorage.removeItem("vms_token");
        localStorage.removeItem("vms_user");
        localStorage.removeItem("vms_active_unit");
        dispatch({ type: "LOGOUT" });
      }
    };
    restoreSession();
  }, []);

  /**
   * login — sends email + password + optional unit_id (numeric ID from dropdown) to backend.
   * unit_id is required for all non-super-admin users.
   * If unitId is empty string / falsy, it's a super admin login against central DB.
   */
  const login = useCallback(async (email, password, unitId = "") => {
    const body = { email, password };
    if (unitId) body.unit_id = parseInt(unitId);

    const response = await apiClient.post("/auth/login", body);
    const { token, user } = response.data.data;
    localStorage.setItem("vms_token", token);
    localStorage.setItem("vms_user", JSON.stringify(user));
    dispatch({ type: "LOGIN_SUCCESS", payload: { user, token } });
    return response.data;
  }, []);

  // loginDirect — used by Setup wizard to auto-login without a second API call
  const loginDirect = useCallback((token, user) => {
    localStorage.setItem("vms_token", token);
    localStorage.setItem("vms_user", JSON.stringify(user));
    dispatch({ type: "LOGIN_SUCCESS", payload: { user, token } });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("vms_token");
    localStorage.removeItem("vms_user");
    localStorage.removeItem("vms_active_unit");
    dispatch({ type: "LOGOUT" });
  }, []);

  const setActiveUnit = useCallback((unit) => {
    if (unit) {
      localStorage.setItem("vms_active_unit", JSON.stringify(unit));
      dispatch({ type: "SET_ACTIVE_UNIT", payload: unit });
    } else {
      localStorage.removeItem("vms_active_unit");
      dispatch({ type: "SET_ACTIVE_UNIT", payload: null });
    }
  }, []);

  /**
   * hasRole(...roles) — checks if the current user has any of the listed roles.
   */
  const hasRole = useCallback(
    (...roles) => {
      const userRole = state.user?.role_type || state.user?.role;
      return roles.includes(userRole);
    },
    [state.user]
  );

  const role = state.user?.role_type || state.user?.role;

  // ── Convenience role flags (new schema) ──────────────────────────────────
  const isSuperAdmin    = role === "super_admin";
  const isUnitAdmin     = role === "unit_admin";
  const isEmployee      = role === "employee";
  const isSecurity      = role === "security";
  const isReceptionist  = role === "receptionist";
  const isGlobalAuditor = role === "global_auditor";
  const isUnitAuditor   = role === "unit_auditor";

  // Composite flags
  const isAnyAdmin   = isSuperAdmin || isUnitAdmin;
  const isAnyAuditor = isGlobalAuditor || isUnitAuditor;

  // Backward-compat aliases
  const isOrgAdmin = isUnitAdmin;
  const isAdmin    = isAnyAdmin;

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        loginDirect,
        logout,
        hasRole,
        setActiveUnit,
        // New role flags
        isSuperAdmin,
        isUnitAdmin,
        isEmployee,
        isSecurity,
        isReceptionist,
        isGlobalAuditor,
        isUnitAuditor,
        isAnyAdmin,
        isAnyAuditor,
        // Backward-compat
        isOrgAdmin,
        isAdmin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
