import axios from "axios";
import { jwtDecode } from "jwt-decode";
import { clearAuthStorage } from "@/lib/auth/authService";
import { isAuthEnabled, shouldAttachApiToken } from "@/lib/config";

const baseURL = typeof window === "undefined" ? process.env.NEXT_PUBLIC_BI_API_BASE ?? "" : "/api/bi";

const api = axios.create({ baseURL });

let jwtExpCache: { token: string; expMs: number } | null = null;

const isTokenExpired = (token: string | null) => {
  if (!token) return true;
  if (jwtExpCache?.token === token) {
    return jwtExpCache.expMs < Date.now() + 5000;
  }
  try {
    const decoded = jwtDecode<{ exp: number }>(token);
    jwtExpCache = { token, expMs: decoded.exp * 1000 };
    return jwtExpCache.expMs < Date.now() + 5000;
  } catch {
    jwtExpCache = null;
    return true;
  }
};

api.interceptors.request.use((config) => {
  if (typeof window === "undefined" || !shouldAttachApiToken()) return config;

  const token = localStorage.getItem("access_token");
  if (token && !isTokenExpired(token)) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (typeof window === "undefined") {
      return Promise.reject(error);
    }

    const status = error.response?.status;
    // Upstream errors. Callers catch this; it must not sign the user out.
    if (status === 502 || status === 503) {
      const message = error.response?.data?.message;
      error.message = typeof message === "string" && message ? message : "The service is not reachable.";
      return Promise.reject(error);
    }
    const path = window.location.pathname;
    const onAuthPage = path.startsWith("/login") || path.startsWith("/auth/") || path.startsWith("/authentication/");
    if (status === 401 && isAuthEnabled() && !onAuthPage) {
      const token = localStorage.getItem("access_token");
      const apiMessage = error.response?.data?.Message || error.response?.data?.message;
      if (!token || isTokenExpired(token)) {
        clearAuthStorage();
        window.location.replace("/login");
      } else if (typeof apiMessage === "string" && apiMessage) {
        error.message = apiMessage;
      } else {
        error.message = "bi-report-api rejected the current sign-in token.";
      }
    }
    return Promise.reject(error);
  }
);

export default api;
