import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import axios, { type AxiosInstance } from "axios";
import { apiErrorMessage, clearSession, loginPathWithNext, type SessionKeys } from "./api";

export interface AuthUser {
  id: string;
  login: string;
  fullName: string;
  role: "ADMIN" | "STUDENT";
}

export interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  /** Set when the saved session couldn't be checked (backend unreachable); the token is kept. */
  sessionError: string | null;
  retrySession: () => void;
  login: (login: string, password: string) => Promise<void>;
  logout: () => void;
}

export interface AuthOptions extends SessionKeys {
  api: AxiosInstance;
  /** Refuse accounts with any other role (the admin panel refuses students). */
  requiredRole?: { role: AuthUser["role"]; message: string };
}

// Each app calls this once with its own storage keys, so the admin and the
// student sessions in one browser never overwrite each other.
export function createAuth({ api, requiredRole, ...keys }: AuthOptions) {
  const AuthContext = createContext<AuthContextValue | null>(null);
  // After an explicit logout the login page gets no ?next=, so whoever logs in
  // next on this computer doesn't land on the previous user's page.
  let loggedOut = false;

  function removeLegacyKeys() {
    for (const key of keys.legacyKeys ?? []) localStorage.removeItem(key);
  }

  function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [sessionError, setSessionError] = useState<string | null>(null);

    const checkSession = useCallback(() => {
      removeLegacyKeys();
      if (!localStorage.getItem(keys.tokenKey)) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setSessionError(null);
      api
        .get<AuthUser>("/auth/me")
        .then(({ data: me }) => {
          if (requiredRole && me.role !== requiredRole.role) {
            clearSession(keys);
            return;
          }
          setUser(me);
        })
        .catch((err: unknown) => {
          const status = axios.isAxiosError(err) ? err.response?.status : undefined;
          // Only a rejected token ends the session. A network blip or a 5xx
          // while reloading mid-exam must not log the student out.
          if (status === 401 || status === 403) clearSession(keys);
          else setSessionError(apiErrorMessage(err, "Не удалось проверить сессию."));
        })
        .finally(() => setLoading(false));
    }, []);

    useEffect(checkSession, [checkSession]);

    async function login(login: string, password: string) {
      const { data } = await api.post<{ token: string; user: AuthUser }>("/auth/login", {
        // Stray spaces from copy-paste or mobile keyboards shouldn't fail the login.
        login: login.trim(),
        password,
      });
      if (requiredRole && data.user.role !== requiredRole.role) {
        throw new Error(requiredRole.message);
      }
      removeLegacyKeys();
      localStorage.setItem(keys.tokenKey, data.token);
      loggedOut = false;
      setSessionError(null);
      setUser(data.user);
    }

    function logout() {
      loggedOut = true;
      clearSession(keys);
      setSessionError(null);
      setUser(null);
    }

    return (
      <AuthContext.Provider value={{ user, loading, sessionError, retrySession: checkSession, login, logout }}>
        {children}
      </AuthContext.Provider>
    );
  }

  function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used within AuthProvider");
    return ctx;
  }

  function ProtectedRoute({ children }: { children: ReactNode }) {
    const { user, loading, sessionError, retrySession } = useAuth();
    const location = useLocation();

    if (loading) {
      return <div className="p-8 text-center text-slate-500 dark:text-slate-400 dark:bg-slate-950">Загрузка...</div>;
    }

    if (!user && sessionError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <p className="mb-1 font-medium text-slate-900 dark:text-slate-100">Не удалось проверить вход</p>
            <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">{sessionError}</p>
            <button
              onClick={retrySession}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400"
            >
              Повторить
            </button>
          </div>
        </div>
      );
    }

    if (!user) {
      return <Navigate to={loggedOut ? "/login" : loginPathWithNext(location.pathname + location.search)} replace />;
    }

    return <>{children}</>;
  }

  return { AuthProvider, useAuth, ProtectedRoute };
}
