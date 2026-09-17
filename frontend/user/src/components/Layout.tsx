import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ThemeToggle } from "./ThemeToggle";

const navItems = [
  { to: "/tests", label: "Тесты" },
  { to: "/history", label: "История" },
];

export function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-8">
            <span className="text-lg font-semibold text-slate-900 dark:text-slate-100">MTI+</span>
            <nav className="flex gap-4">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
                        : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-4 text-sm text-slate-600 dark:text-slate-400">
            <span>{user?.fullName}</span>
            <ThemeToggle />
            <button
              onClick={logout}
              className="rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Выйти
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
