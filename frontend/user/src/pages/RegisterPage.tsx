import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { apiErrorMessage } from "../api/client";
import { ThemeToggle } from "../components/ThemeToggle";

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register(email, password, fullName);
      navigate("/tests");
    } catch (err) {
      setError(apiErrorMessage(err, "Не удалось зарегистрироваться."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <h1 className="mb-1 text-xl font-semibold text-slate-900 dark:text-slate-100">Регистрация</h1>
        <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">Создайте аккаунт студента</p>

        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Имя</label>
        <input
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="mb-4 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />

        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />

        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Пароль</label>
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-4 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />

        {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400"
        >
          {submitting ? "Создаём..." : "Зарегистрироваться"}
        </button>

        <p className="mt-4 text-center text-sm text-slate-500 dark:text-slate-400">
          Уже есть аккаунт?{" "}
          <Link to="/login" className="text-indigo-600 hover:underline dark:text-indigo-400">
            Войти
          </Link>
        </p>
      </form>
    </div>
  );
}
