import axios from "axios";

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:5000/api",
  headers: {
    "Content-Type": "application/json",
  },
});

// ── Helper: decode JWT expiry without a library ───────────────────────────────
function getTokenExpiryMs(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.exp ? payload.exp * 1000 : 0; // seconds → ms
  } catch {
    return 0;
  }
}

// Guard: don't fire multiple refresh calls at the same time
let isRefreshing = false;

// ── Request interceptor — inject Bearer token + active-unit headers ───────────
apiClient.interceptors.request.use(
  (config) => {
    // Only attach staff token if this is not a public visitor auth endpoint
    const isPublicAuth = config.url?.includes("/public-auth/");
    const token = localStorage.getItem("vms_token");
    if (token && !isPublicAuth) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // Attach visitor token if available (for visitor portal endpoints)
    const visitorToken =
      sessionStorage.getItem("vms_visitor_token") ||
      localStorage.getItem("vms_visitor_token");
    if (visitorToken) {
      config.headers["X-Visitor-Token"] = visitorToken;
      if (isPublicAuth && !config.headers.Authorization) {
        config.headers.Authorization = `Bearer ${visitorToken}`;
      }
    }

    // Support dynamic unit overriding for central admins.
    // Skip auth and public endpoints — those are always context-specific.
    const isAuthOrPublic = config.url?.includes("/auth/") || isPublicAuth;
    const activeUnitStr  = localStorage.getItem("vms_active_unit");
    if (!isAuthOrPublic && activeUnitStr) {
      try {
        const activeUnit = JSON.parse(activeUnitStr);
        if (activeUnit.id && activeUnit.db_name) {
          config.headers["X-Unit-Id"] = activeUnit.id;
          config.headers["X-Unit-Db"] = activeUnit.db_name;
        }
      } catch (e) {
        console.error("Failed to parse active unit:", e);
      }
    }

    return config;
  },
  (error) => Promise.reject(error),
);

// ── Response interceptor — silent refresh + 401 redirect ─────────────────────
apiClient.interceptors.response.use(
  async (response) => {
    // After every successful response, check if the token is close to expiry.
    // If < 2 hours remain and we're not already refreshing, silently renew.
    // Skip refresh and public endpoints to avoid unnecessary calls.
    const url = response.config?.url || "";
    const isRefreshCall = url.includes("/auth/refresh");
    const isPublicCall  = url.includes("/public-auth/") || url.includes("/public");

    if (!isRefreshing && !isRefreshCall && !isPublicCall) {
      const token = localStorage.getItem("vms_token");
      if (token) {
        const expiresAt = getTokenExpiryMs(token);
        const timeLeft  = expiresAt - Date.now();
        const TWO_HOURS = 2 * 60 * 60 * 1000;

        if (timeLeft > 0 && timeLeft < TWO_HOURS) {
          isRefreshing = true;
          try {
            const res = await apiClient.post("/auth/refresh");
            const newToken = res.data?.data?.token;
            if (newToken) {
              localStorage.setItem("vms_token", newToken);
            }
          } catch (_) {
            // Refresh failed silently — user will be logged out on next 401
          } finally {
            isRefreshing = false;
          }
        }
      }
    }

    return response;
  },

  (error) => {
    // IMPORTANT: Skip the redirect for login endpoints (staff and public) — a failed login
    // must display the error message on the page without redirecting.
    // Also never redirect staff if the user is on the public visitor request portal or visitor portal.
    const url = error.config?.url || "";
    const isLoginEndpoint      = url.includes("/auth/login") || url.includes("/public-auth/login");
    const isRefreshEndpoint    = url.includes("/auth/refresh");
    const isVisitorPath        = typeof window !== "undefined" &&
                                 (window.location.pathname.startsWith("/public-request") ||
                                  window.location.pathname.startsWith("/visitor"));
    const isPublicEndpoint     = url.includes("/public-auth/") ||
                                 url.includes("/visit-requests/public") ||
                                 url.includes("/units/public") ||
                                 url.includes("/departments/public") ||
                                 isVisitorPath;

    if (error.response?.status === 401 && !isLoginEndpoint && !isRefreshEndpoint) {
      if (isVisitorPath) {
        localStorage.removeItem("vms_visitor_token");
        sessionStorage.removeItem("vms_visitor_token");
        localStorage.removeItem("vms_visitor_data");
        window.location.href = "/public-request";
        return Promise.reject(error);
      }

      if (!isPublicEndpoint) {
        localStorage.removeItem("vms_token");
        localStorage.removeItem("vms_user");
        localStorage.removeItem("vms_active_unit");
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  },
);

export default apiClient;

