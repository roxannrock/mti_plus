import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { TestSummary } from "../types";
import { listTests } from "../api/tests";
import { apiErrorMessage } from "../api/client";

export function TestsListPage() {
  const [tests, setTests] = useState<TestSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [languageFilter, setLanguageFilter] = useState<string | null>(null);

  useEffect(() => {
    listTests()
      .then(setTests)
      .catch((err) => setError(apiErrorMessage(err)));
  }, []);

  const languages = useMemo(() => {
    if (!tests) return [];
    return Array.from(new Set(tests.map((t) => t.language))).sort();
  }, [tests]);

  const visibleTests = languageFilter ? tests?.filter((t) => t.language === languageFilter) : tests;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Доступные тесты</h1>
        {languages.length > 1 && (
          <div className="flex gap-2">
            <button
              onClick={() => setLanguageFilter(null)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                languageFilter === null
                  ? "bg-indigo-600 text-white dark:bg-indigo-500"
                  : "border border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              Все
            </button>
            {languages.map((lang) => (
              <button
                key={lang}
                onClick={() => setLanguageFilter(lang)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium uppercase ${
                  languageFilter === lang
                    ? "bg-indigo-600 text-white dark:bg-indigo-500"
                    : "border border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
              >
                {lang}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!tests && !error && <p className="text-slate-500 dark:text-slate-400">Загрузка...</p>}
      {tests?.length === 0 && <p className="text-slate-500 dark:text-slate-400">Пока нет доступных тестов.</p>}

      <div className="grid gap-4">
        {visibleTests?.map((test) => (
          <Link
            key={test.id}
            to={`/tests/${test.id}`}
            className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:shadow-slate-900/50"
          >
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-medium text-slate-900 dark:text-slate-100">{test.title}</h2>
              <span className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                {test.language}
              </span>
            </div>
            {test.description && (
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{test.description}</p>
            )}
            <div className="mt-2 flex gap-4 text-xs text-slate-500 dark:text-slate-400">
              <span>{test._count.questions} вопросов</span>
              <span>Проходной балл: {test.passPercent}%</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
