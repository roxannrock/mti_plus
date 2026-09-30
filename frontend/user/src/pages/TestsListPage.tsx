import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { TestSummary } from "../types";
import { listTests } from "../api/tests";
import { listActiveAttempts } from "../api/attempts";
import { apiErrorMessage } from "../api/client";

export function TestsListPage() {
  const [tests, setTests] = useState<TestSummary[] | null>(null);
  const [inProgress, setInProgress] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Both endpoints close timed-out attempts with the same rule first, so the
    // attempt counts and "Продолжить" always agree.
    Promise.all([listTests(), listActiveAttempts()])
      .then(([testList, active]) => {
        setInProgress(new Set(active.map((a) => a.testId)));
        setTests(testList);
      })
      .catch((err) => setError(apiErrorMessage(err)));
  }, []);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-slate-900 dark:text-slate-100">Доступные тесты</h1>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!tests && !error && <p className="text-slate-500 dark:text-slate-400">Загрузка...</p>}
      {tests?.length === 0 && <p className="text-slate-500 dark:text-slate-400">Пока нет доступных тестов.</p>}

      <div className="grid gap-4">
        {tests?.map((test) => {
          const resumable = inProgress.has(test.id);
          const exhausted = !resumable && test.maxAttempts !== null && test.myAttempts >= test.maxAttempts;
          return (
            <div
              key={test.id}
              className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <h2 className="text-lg font-medium text-slate-900 dark:text-slate-100">{test.title}</h2>

              {test.description && (
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{test.description}</p>
              )}

              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                  <span>{test._count.questions} вопросов</span>
                  <span>Проходной балл: {test.passPercent}%</span>
                  <span>
                    {test.timeLimitMinutes !== null ? `Время: ${test.timeLimitMinutes} мин` : "Без ограничения времени"}
                  </span>
                  {test.maxAttempts !== null && (
                    <span className={exhausted ? "font-medium text-red-600 dark:text-red-400" : undefined}>
                      Попыток: {test.myAttempts}/{test.maxAttempts}
                    </span>
                  )}
                </div>
                {exhausted ? (
                  <span
                    aria-disabled="true"
                    className="cursor-not-allowed rounded-md bg-slate-200 px-3 py-1.5 text-sm font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-500"
                  >
                    Попытки исчерпаны
                  </span>
                ) : (
                  <Link
                    to={`/tests/${test.id}`}
                    className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400"
                  >
                    {resumable ? "Продолжить →" : "Пройти тест →"}
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
