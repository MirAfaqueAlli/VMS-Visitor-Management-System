import { createContext, useReducer, useEffect, useCallback } from "react";
import apiClient from "../api/axios";

export const AuthContext = createContext(null);

const initialState = {
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,
};

function authReducer(state, action) {
  switch (action.type) {
    case "LOGIN_SUCCESS":
      return {
        ...state,
        user: action.payload.user,
        token: action.payload.token,
        isAuthenticated: true,
        isLoading: false,
      };
    case "LOGOUT":
      return {
        ...state,
        user: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
      };
    case "SET_LOADING":
      return { ...state, isLoading: action.payload };
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
      if (!token) {
        dispatch({ type: "LOGOUT" });
        return;
      }
      try {
        const response = await apiClient.get("/auth/me");
        const user = response.data?.data || response.data;
        dispatch({ type: "LOGIN_SUCCESS", payload: { user, token } });
      } catch {
        localStorage.removeItem("vms_token");
        localStorage.removeItem("vms_user");
        dispatch({ type: "LOGOUT" });
      }
    };
    restoreSession();
  }, []);

  const login = useCallback(async (email, password) => {
    const response = await apiClient.post("/auth/login", { email, password });
    const { token, user } = response.data.data;
    localStorage.setItem("vms_token", token);
    localStorage.setItem("vms_user", JSON.stringify(user));
    dispatch({ type: "LOGIN_SUCCESS", payload: { user, token } });
    return response.data;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("vms_token");
    localStorage.removeItem("vms_user");
    dispatch({ type: "LOGOUT" });
  }, []);

  /**
   * hasRole(...roles) — checks if current user has one of the listed roles.
   * Accepts both 'role' and 'role_type' field names for compatibility.
   */
  const hasRole = useCallback(
    (...roles) => {
      const userRole = state.user?.role_type || state.user?.role;
      return roles.includes(userRole);
    },
    [state.user]
  );

  // Convenience flags derived from role
  const isOrgAdmin  = (state.user?.role_type || state.user?.role) === "org_admin";
  const isDeptAdmin = (state.user?.role_type || state.user?.role) === "dept_admin";
  const isEmployee  = (state.user?.role_type || state.user?.role) === "employee";
  const isSecurity  = (state.user?.role_type || state.user?.role) === "security";
  const isReceptionist = (state.user?.role_type || state.user?.role) === "receptionist";
  const isAdmin     = isOrgAdmin || isDeptAdmin; // either admin type

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        logout,
        hasRole,
        isOrgAdmin,
        isDeptAdmin,
        isEmployee,
        isSecurity,
        isReceptionist,
        isAdmin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
