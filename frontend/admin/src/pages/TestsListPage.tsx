import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { TestSummary } from "../types";
import { deleteTest, listTests, restoreTest, setPublished, updateTestSettings } from "../api/tests";
import { apiErrorMessage } from "../api/client";

const tabClass = (active: boolean) =>
  `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
    active
      ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
      : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
  }`;

// Russian plural forms: 1 вопрос, 2 вопроса, 5 вопросов.
function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function TestsListPage() {
  const [showArchived, setShowArchived] = useState(false);
  const [tests, setTests] = useState<TestSummary[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);

  // Handlers finish after awaits, possibly after the tab changed: they read the
  // current tab from a ref, and only the latest request may write the list.
  const tabRef = useRef(showArchived);
  const requestId = useRef(0);

  async function load() {
    const id = ++requestId.current;
    const archived = tabRef.current;
    try {
      const list = await listTests(archived);
      if (id === requestId.current) setTests(list);
    } catch (err) {
      if (id === requestId.current) setError(apiErrorMessage(err, "Не удалось загрузить тесты."));
    }
  }

  useEffect(() => {
    load();
    // Invalidate the in-flight request when the page unmounts.
    return () => {
      requestId.current++;
    };
  }, []);

  function selectTab(archived: boolean) {
    if (archived === tabRef.current) return;
    tabRef.current = archived;
    setShowArchived(archived);
    setTests(null);
    setError(null);
    setNotice(null);
    load();
  }

  // Every action starts from a clean slate so a stale error doesn't linger
  // next to a later success.
  function startAction() {
    setError(null);
    setNotice(null);
  }

  async function togglePublish(test: TestSummary) {
    startAction();
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
    startAction();
    setSavingTitle(true);
    try {
      await updateTestSettings(test.id, { title });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Не удалось переименовать тест."));
    } finally {
      setSavingTitle(false);
    }
  }

  async function removeTest(test: TestSummary) {
    // Tests that students already started or finished are archived, not
    // deleted, so results survive.
    const hasAttempts = test._count.attempts > 0;
    const confirmed = window.confirm(
      hasAttempts
        ? `Тест «${test.title}» уже проходили (завершённых попыток: ${test.finishedAttempts}), поэтому он не будет удалён, а переместится в архив: студенты перестанут его видеть, результаты сохранятся. Тест можно восстановить на вкладке «Архив». Продолжить?`
        : `Удалить тест «${test.title}» безвозвратно? Попыток прохождения у него нет.`,
    );
    if (!confirmed) return;
    startAction();
    setDeletingId(test.id);
    try {
      const result = await deleteTest(test.id);
      setNotice(result.archived ? `Тест «${test.title}» перемещён в архив.` : `Тест «${test.title}» удалён.`);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Не удалось удалить тест."));
    } finally {
      setDeletingId(null);
    }
  }

  async function restore(test: TestSummary) {
    startAction();
    setRestoringId(test.id);
    try {
      await restoreTest(test.id);
      setNotice(`Тест «${test.title}» восстановлен как черновик. Опубликуйте его, когда будете готовы.`);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Не удалось восстановить тест."));
    } finally {
      setRestoringId(null);
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

      <div className="mb-4 flex gap-2">
        <button onClick={() => selectTab(false)} className={tabClass(!showArchived)}>
          Активные
        </button>
        <button onClick={() => selectTab(true)} className={tabClass(showArchived)}>
          Архив
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {notice && <p className="mb-4 text-sm text-emerald-700 dark:text-emerald-400">{notice}</p>}

      {!tests && !error && <p className="text-slate-500 dark:text-slate-400">Загрузка...</p>}
      {tests && tests.length === 0 && (
        <p className="text-slate-500 dark:text-slate-400">
          {showArchived ? "Архив пуст." : "Пока нет тестов. Загрузите первый CSV-файл."}
        </p>
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
                    <Link
                      to={`/tests/${test.id}`}
                      className="text-lg font-medium text-slate-900 hover:text-indigo-600 dark:text-slate-100 dark:hover:text-indigo-400"
                    >
                      {test.title}
                    </Link>
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
                  <span>
                    {test._count.questions} {plural(test._count.questions, "вопрос", "вопроса", "вопросов")}
                  </span>
                  <span>Проходной балл: {test.passPercent}%</span>
                  <span>
                    {test.finishedAttempts} {plural(test.finishedAttempts, "завершённая попытка", "завершённые попытки", "завершённых попыток")}
                  </span>
                  <span>
                    Лимит попыток: {test.maxAttempts ?? "без ограничений"}
                  </span>
                  <span>
                    Время: {test.timeLimitMinutes ? `${test.timeLimitMinutes} мин` : "без ограничения"}
                  </span>
                  <span>Автор: {test.createdBy.fullName}</span>
                </div>
              </div>
              <span
                className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${
                  test.archivedAt
                    ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
                    : test.isPublished
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                      : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                }`}
              >
                {test.archivedAt
                  ? `В архиве с ${new Date(test.archivedAt).toLocaleDateString("ru-RU")}`
                  : test.isPublished
                    ? "Опубликован"
                    : "Черновик"}
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                to={`/tests/${test.id}`}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Вопросы и настройки
              </Link>
              <Link
                to={`/tests/${test.id}/participants`}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Участники
              </Link>
              {test.archivedAt ? (
                <button
                  onClick={() => restore(test)}
                  disabled={restoringId === test.id}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {restoringId === test.id ? "Восстанавливаем..." : "Восстановить"}
                </button>
              ) : (
                <>
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
                    {deletingId === test.id
                      ? "Удаляем..."
                      : test._count.attempts > 0
                        ? "В архив"
                        : "Удалить"}
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
