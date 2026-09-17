import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { TestSummary } from "../types";
import { listTests } from "../api/tests";
import { apiErrorMessage } from "../api/client";

export function TestsListPage() {
  const [tests, setTests] = useState<TestSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listTests()
      .then(setTests)
      .catch((err) => setError(apiErrorMessage(err)));
  }, []);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-slate-900 dark:text-slate-100">Доступные тесты</h1>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!tests && !error && <p className="text-slate-500 dark:text-slate-400">Загрузка...</p>}
      {tests?.length === 0 && <p className="text-slate-500 dark:text-slate-400">Пока нет доступных тестов.</p>}

      <div className="grid gap-4">
        {tests?.map((test) => (
          <Link
            key={test.id}
            to={`/tests/${test.id}`}
            className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:shadow-slate-900/50"
          >
            <h2 className="text-lg font-medium text-slate-900 dark:text-slate-100">{test.title}</h2>
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
