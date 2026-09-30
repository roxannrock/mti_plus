import axios, { type AxiosInstance } from "axios";

export interface SessionKeys {
  /** localStorage key of the JWT. */
  tokenKey: string;
  /** Keys older versions wrote (e.g. a cached user object); removed so no stale PII stays behind. */
  legacyKeys?: string[];
}

// The app's own login route. BASE_URL is "/admin/" for the admin panel and
// "/" for the student cabinet, so neither app hardcodes the other's layout.
export const LOGIN_PATH = `${import.meta.env.BASE_URL}login`;

export function clearSession({ tokenKey, legacyKeys = [] }: SessionKeys) {
  for (const key of [tokenKey, ...legacyKeys]) localStorage.removeItem(key);
}

/** Current location as a router path (without the app's base), e.g. "/tests/42?x=1". */
export function currentAppPath(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const { pathname, search } = window.location;
  const path = pathname.startsWith(base) ? pathname.slice(base.length) || "/" : pathname;
  return path + search;
}

/**
 * Validates a ?next= value before redirecting to it: only paths inside this
 * app are allowed ("/tests/1"), never "//evil.com", "/\evil.com" or full URLs.
 */
export function safeNextPath(next: string | null | undefined, fallback: string): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (next === "/login" || next.startsWith("/login?")) return fallback;
  return next;
}

export function loginPathWithNext(next: string): string {
  return next && next !== "/" ? `/login?next=${encodeURIComponent(next)}` : "/login";
}

export function createApiClient(keys: SessionKeys): AxiosInstance {
  const baseURL = import.meta.env.VITE_API_URL as string | undefined;
  if (!baseURL) {
    throw new Error("VITE_API_URL is not set. Add it to the app's .env (see .env.example)");
  }

  const api = axios.create({ baseURL });

  api.interceptors.request.use((config) => {
    const token = localStorage.getItem(keys.tokenKey);
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  api.interceptors.response.use(
    (res) => res,
    (error) => {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        clearSession(keys);
        // A wrong password on the login page is also a 401 — don't reload it.
        // Elsewhere the session expired: come back here after logging in again.
        if (window.location.pathname !== LOGIN_PATH) {
          window.location.href = import.meta.env.BASE_URL + loginPathWithNext(currentAppPath()).slice(1);
        }
      }
      return Promise.reject(error);
    },
  );

  return api;
}

export function apiErrorMessage(error: unknown, fallback = "Что-то пошло не так."): string {
  if (axios.isAxiosError(error)) {
    // No response at all: backend down, network error or CORS rejection.
    if (!error.response) return "Сервер недоступен. Проверьте, что backend запущен.";
    return (error.response.data as { error?: string } | undefined)?.error ?? fallback;
  }
  // Plain Errors carry messages meant for the user (e.g. the admin role check).
  return error instanceof Error ? error.message : fallback;
}
