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
    const token = localStorage.getItem("vms_token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // Support dynamic unit overriding for central admins.
    // Skip auth endpoints — those are always about the logged-in user.
    const isAuthEndpoint = config.url?.includes("/auth/");
    const activeUnitStr  = localStorage.getItem("vms_active_unit");
    if (!isAuthEndpoint && activeUnitStr) {
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
    // Skip the refresh endpoint itself to avoid an infinite loop.
    const isRefreshCall = response.config?.url?.includes("/auth/refresh");

    if (!isRefreshing && !isRefreshCall) {
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
    // IMPORTANT: Skip the redirect for /auth/login itself — a failed login
    // (wrong password → 401) would otherwise wipe the error message before
    // it can be displayed.
    const isLoginEndpoint   = error.config?.url?.includes("/auth/login");
    const isRefreshEndpoint = error.config?.url?.includes("/auth/refresh");

    if (error.response?.status === 401 && !isLoginEndpoint && !isRefreshEndpoint) {
      localStorage.removeItem("vms_token");
      localStorage.removeItem("vms_user");
      localStorage.removeItem("vms_active_unit");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  },
);

export default apiClient;

