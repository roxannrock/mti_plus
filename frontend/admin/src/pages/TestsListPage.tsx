import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { TestSummary } from "../types";
import { deleteTest, listTests, renameTest, setPublished } from "../api/tests";
import { apiErrorMessage } from "../api/client";

export function TestsListPage() {
  const [tests, setTests] = useState<TestSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);

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

  function startEditing(test: TestSummary) {
    setEditingId(test.id);
    setEditingTitle(test.title);
  }

  async function saveTitle(test: TestSummary) {
    const title = editingTitle.trim();
    if (!title || title === test.title) {
      setEditingId(null);
      return;
    }
    setSavingTitle(true);
    try {
      await renameTest(test.id, title);
      setEditingId(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Не удалось переименовать тест."));
    } finally {
      setSavingTitle(false);
    }
  }

  async function removeTest(test: TestSummary) {
    const confirmed = window.confirm(
      `Удалить тест «${test.title}» безвозвратно? Вместе с ним удалятся все попытки прохождения (${test._count.attempts}).`,
    );
    if (!confirmed) return;
    setDeletingId(test.id);
    try {
      await deleteTest(test.id);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Не удалось удалить тест."));
    } finally {
      setDeletingId(null);
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
              <div className="min-w-0 flex-1">
                {editingId === test.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveTitle(test);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="w-full max-w-md rounded-md border border-slate-300 bg-white px-2 py-1 text-lg font-medium text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                    <button
                      onClick={() => saveTitle(test)}
                      disabled={savingTitle}
                      className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400"
                    >
                      Сохранить
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      Отмена
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-medium text-slate-900 dark:text-slate-100">{test.title}</h2>
                    <button
                      onClick={() => startEditing(test)}
                      title="Переименовать"
                      className="text-xs text-slate-400 hover:text-indigo-600 dark:text-slate-500 dark:hover:text-indigo-400"
                    >
                      ✎
                    </button>
                  </div>
                )}
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
              <button
                onClick={() => removeTest(test)}
                disabled={deletingId === test.id}
                className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-500/10"
              >
                {deletingId === test.id ? "Удаляем..." : "Удалить"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
