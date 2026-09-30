import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import type { AttemptDetail } from "../types";
import { getAttempt, listHistory } from "../api/attempts";
import { apiErrorMessage } from "../api/client";
import { sectionBarClass } from "../components/sectionBar";

export function ResultPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const location = useLocation();
  const expired = (location.state as { expired?: boolean } | null)?.expired === true;

  const [attempt, setAttempt] = useState<AttemptDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!attemptId) return;
    let cancelled = false;
    getAttempt(attemptId)
      .then((data) => {
        if (!cancelled) setAttempt(data);
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err, "Не удалось загрузить результат."));
      });
    return () => {
      cancelled = true;
    };
  }, [attemptId]);

  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!attempt) return <p className="text-slate-500 dark:text-slate-400">Загрузка...</p>;

  if (!attempt.finishedAt) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <p className="text-slate-700 dark:text-slate-300">Эта попытка ещё не завершена.</p>
        <Link to={`/tests/${attempt.testId}`} className="mt-2 inline-block text-indigo-600 hover:underline dark:text-indigo-400">
          Продолжить тест →
        </Link>
      </div>
    );
  }

  // the pass mark the attempt was scored with; older attempts fall back to the current one
  const passPercent = attempt.passPercentAtFinish ?? attempt.test.passPercent;
  const hideCorrect = attempt.correctAnswersHidden !== false;

  return (
    <div>
      {expired && (
        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
          Время вышло — засчитаны последние автоматически сохранённые ответы.
        </p>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm text-slate-500 dark:text-slate-400">{attempt.test.title}</p>
        <p
          className={`mt-2 text-5xl font-semibold ${
            attempt.passed ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
          }`}
        >
          {attempt.scorePercent}%
        </p>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          {attempt.correctCount} из {attempt.totalCount} правильно · проходной балл {passPercent}%
        </p>
        <p
          className={`mt-1 text-sm font-medium ${
            attempt.passed ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"
          }`}
        >
          {attempt.passed ? "Тест пройден ✓" : "Тест не пройден"}
        </p>
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
          {new Date(attempt.finishedAt).toLocaleString("ru-RU")}
        </p>
      </div>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-slate-100">По разделам</h2>
        <div className="space-y-3">
          {Object.entries(attempt.sectionStats ?? {}).map(([section, stat]) => {
            const pct = stat.total === 0 ? 0 : Math.round((stat.correct / stat.total) * 100);
            return (
              <div key={section}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="text-slate-700 dark:text-slate-300">{section}</span>
                  <span className="text-slate-500 dark:text-slate-400">
                    {stat.correct}/{stat.total} ({pct}%)
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className={`h-2.5 rounded-full ${sectionBarClass(pct, passPercent)}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {attempt.answers.length > 0 && (
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-1 text-base font-semibold text-slate-900 dark:text-slate-100">Разбор ответов</h2>
          {hideCorrect ? (
            <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
              Правильные ответы не показываются, пока у вас остаются попытки пройти этот тест.
            </p>
          ) : (
            <div className="mb-4" />
          )}
          <div className="space-y-4">
            {attempt.answers.map((a) => (
              <div key={a.id} className="border-b border-slate-100 pb-4 last:border-0 last:pb-0 dark:border-slate-800">
                <div className="mb-1 flex items-center justify-between gap-2 text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  <span>
                    Q{a.question.order} · {a.question.section}
                  </span>
                  <span
                    className={`normal-case ${
                      a.isCorrect ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {a.selectedKeys.length === 0 ? "Нет ответа" : a.isCorrect ? "Верно" : "Неверно"}
                  </span>
                </div>
                <p className="mb-2 text-sm font-medium text-slate-900 dark:text-slate-100">{a.question.prompt}</p>
                <ul className="space-y-1 text-sm">
                  {a.question.options.map((opt) => {
                    const correct = !hideCorrect && (a.correctKeys ?? []).includes(opt.key);
                    const chosen = a.selectedKeys.includes(opt.key);
                    return (
                      <li
                        key={opt.key}
                        className={`rounded px-2 py-1 ${
                          correct || (hideCorrect && chosen && a.isCorrect)
                            ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300"
                            : chosen
                              ? "bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-300"
                              : "text-slate-600 dark:text-slate-400"
                        }`}
                      >
                        {opt.key}. {opt.text}
                        {chosen && <span className="ml-2 text-xs opacity-75">(ваш ответ)</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 flex gap-3">
        <Link
          to="/tests"
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          К списку тестов
        </Link>
        <Link
          to="/history"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400"
        >
          Моя история
        </Link>
      </div>
    </div>
  );
}

/** Old /tests/:testId/result URL (had no attempt id): open the latest result for that test. */
export function LegacyResultRedirect() {
  const { testId } = useParams<{ testId: string }>();
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listHistory()
      .then((history) => {
        // history is sorted newest first
        const latest = history.find((a) => a.testId === testId);
        if (!cancelled) setTarget(latest ? `/results/${latest.id}` : "/history");
      })
      .catch(() => {
        if (!cancelled) setTarget("/history");
      });
    return () => {
      cancelled = true;
    };
  }, [testId]);

  if (!target) return <p className="text-slate-500 dark:text-slate-400">Загрузка...</p>;
  return <Navigate to={target} replace />;
}
