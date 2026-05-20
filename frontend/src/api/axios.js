import axios from "axios";

const apiClient = axios.create({
 baseURL: import.meta.env.VITE_API_URL || "http://localhost:5000/api",
 headers: {
 "Content-Type": "application/json",
 },
});

// Request interceptor — inject Bearer token
apiClient.interceptors.request.use(
 (config) => {
 const token = localStorage.getItem("vms_token");
 if (token) {
 config.headers.Authorization = `Bearer ${token}`;
 }
 return config;
 },
 (error) => Promise.reject(error),
);

// Response interceptor — handle 401
// IMPORTANT: Skip the redirect for the /auth/login endpoint itself,
// otherwise a failed login (wrong password → 401) causes a hard page
// reload that wipes the error message before it can be displayed.
apiClient.interceptors.response.use(
 (response) => response,
 (error) => {
 const isLoginEndpoint = error.config?.url?.includes("/auth/login");
 if (error.response?.status === 401 && !isLoginEndpoint) {
 localStorage.removeItem("vms_token");
 localStorage.removeItem("vms_user");
 window.location.href = "/login";
 }
 return Promise.reject(error);
 },
);

export default apiClient;
