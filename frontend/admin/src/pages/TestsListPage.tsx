import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { TestSummary } from "../types";
import { listTests, setPublished } from "../api/tests";
import { apiErrorMessage } from "../api/client";

export function TestsListPage() {
  const [tests, setTests] = useState<TestSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function load() {
    try {
      setTests(await listTests());
    } catch (err) {
      setError(apiErrorMessage(err, "Не удалось загрузить тесты."));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function togglePublish(test: TestSummary) {
    setTogglingId(test.id);
    try {
      await setPublished(test.id, !test.isPublished);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Тесты</h1>
        <Link
          to="/upload"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400"
        >
          + Загрузить материал
        </Link>
      </div>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {!tests && <p className="text-slate-500 dark:text-slate-400">Загрузка...</p>}
      {tests && tests.length === 0 && (
        <p className="text-slate-500 dark:text-slate-400">Пока нет тестов. Загрузите первый MD-файл.</p>
      )}

      <div className="grid gap-4">
        {tests?.map((test) => (
          <div
            key={test.id}
            className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-medium text-slate-900 dark:text-slate-100">{test.title}</h2>
                {test.description && (
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{test.description}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                  <span>{test._count.questions} вопросов</span>
                  <span>Проходной балл: {test.passPercent}%</span>
                  <span>{test._count.attempts} попыток</span>
                  <span>Автор: {test.createdBy.fullName}</span>
                </div>
              </div>
              <span
                className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${
                  test.isPublished
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                    : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                }`}
              >
                {test.isPublished ? "Опубликован" : "Черновик"}
              </span>
            </div>
            <div className="mt-4 flex gap-3">
              <Link
                to={`/tests/${test.id}/participants`}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Участники
              </Link>
              <button
                onClick={() => togglePublish(test)}
                disabled={togglingId === test.id}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {test.isPublished ? "Снять с публикации" : "Опубликовать"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
