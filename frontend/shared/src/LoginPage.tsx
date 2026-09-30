import { useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { apiErrorMessage, safeNextPath } from "./api";
import type { AuthContextValue } from "./auth";
import { ThemeToggle } from "./theme";

export interface LoginPageProps {
  title: string;
  subtitle: string;
  /** Where to go after logging in when there's no valid ?next= (a route inside the app). */
  defaultRedirect: string;
  /** The app's useAuth() value. */
  auth: AuthContextValue;
  themeStorageKey: string;
}

export function LoginPage({ title, subtitle, defaultRedirect, auth, themeStorageKey }: LoginPageProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Back to the page that sent us here (e.g. after the session expired).
  const next = safeNextPath(searchParams.get("next"), defaultRedirect);
  const [loginValue, setLoginValue] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await auth.login(loginValue, password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err, "Не удалось войти."));
    } finally {
      setSubmitting(false);
    }
  }

  if (auth.loading) {
    return <div className="p-8 text-center text-slate-500 dark:text-slate-400 dark:bg-slate-950">Загрузка...</div>;
  }
  // Already logged in — the form would only be confusing.
  if (auth.user && !submitting) return <Navigate to={next} replace />;

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
      <div className="absolute right-4 top-4">
        <ThemeToggle storageKey={themeStorageKey} />
      </div>
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <h1 className="mb-1 text-xl font-semibold text-slate-900 dark:text-slate-100">{title}</h1>
        <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>

        <label htmlFor="login-username" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
          Логин
        </label>
        <input
          id="login-username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={loginValue}
          onChange={(e) => setLoginValue(e.target.value)}
          className="mb-4 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />

        <label htmlFor="login-password" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
          Пароль
        </label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-4 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />

        {error && <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400"
        >
          {submitting ? "Входим..." : "Войти"}
        </button>
      </form>
    </div>
  );
}
