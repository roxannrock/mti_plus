import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { ParticipantDetail } from "../types";
import { getParticipantDetail } from "../api/tests";
import { apiErrorMessage } from "../api/client";

function sameKeys(a: string[], b: string[]) {
  return a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");
}

export function ParticipantDetailPage() {
  const { testId, attemptId } = useParams<{ testId: string; attemptId: string }>();
  const [detail, setDetail] = useState<ParticipantDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!testId || !attemptId) return;
    setError(null);
    getParticipantDetail(testId, attemptId)
      .then(setDetail)
      .catch((err) => setError(apiErrorMessage(err)));
  }, [testId, attemptId]);

  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!detail) return <p className="text-slate-500 dark:text-slate-400">Загрузка...</p>;

  const sortedAnswers = [...detail.answers].sort((a, b) => a.question.order - b.question.order);
  // The verdict was computed against the pass mark / correct keys at finish
  // time; the admin may have edited them since. Show the snapshot so the page
  // agrees with the stored result (older rows without a snapshot fall back to
  // the current values).
  const passPercent = detail.passPercentAtFinish ?? detail.test.passPercent;
  const passPercentChanged = passPercent !== detail.test.passPercent;

  return (
    <div>
      <Link
        to={`/tests/${testId}/participants`}
        className="mb-4 inline-block text-sm text-indigo-600 hover:underline dark:text-indigo-400"
      >
        ← Все участники
      </Link>

      <div className="mb-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{detail.student.fullName}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {detail.student.login} · {detail.test.title} · завершён{" "}
          {new Date(detail.finishedAt).toLocaleString("ru-RU")}
        </p>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-700 dark:text-slate-300">
          <span>
            Результат: <b>{detail.correctCount}/{detail.totalCount}</b> ({detail.scorePercent}%)
          </span>
          <span>
            Проходной балл: {passPercent}%
            {passPercentChanged && (
              <span className="text-slate-500 dark:text-slate-400"> (сейчас {detail.test.passPercent}%)</span>
            )}
          </span>
          <span className={detail.passed ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}>
            {detail.passed ? "Тест сдан" : "Тест не сдан"}
          </span>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(detail.sectionStats).map(([section, stat]) => {
            const pct = stat.total === 0 ? 0 : Math.round((stat.correct / stat.total) * 100);
            return (
              <div key={section} className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
                <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>{section}</span>
                  <span>
                    {stat.correct}/{stat.total}
                  </span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className={`h-2 rounded-full ${pct >= passPercent ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        {sortedAnswers.map((a) => {
          const currentKeys = a.question.correctKeys ?? [];
          const scoredKeys = a.correctKeysAtFinish ?? currentKeys;
          const changed = !sameKeys(scoredKeys, currentKeys);
          return (
            <div
              key={a.id}
              className={`rounded-lg border p-4 ${
                a.isCorrect
                  ? "border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/50 dark:bg-emerald-500/5"
                  : "border-red-200 bg-red-50/40 dark:border-red-900/50 dark:bg-red-500/5"
              }`}
            >
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Q{a.question.order} · {a.question.section}
                </span>
                {changed && (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                    Вопрос изменён после прохождения
                  </span>
                )}
              </div>
              <p className="mb-2 text-sm font-medium text-slate-900 dark:text-slate-100">{a.question.prompt}</p>
              <ul className="space-y-1 text-sm">
                {a.question.options.map((opt) => {
                  const isSelected = a.selectedKeys.includes(opt.key);
                  const isCorrectOption = scoredKeys.includes(opt.key);
                  return (
                    <li
                      key={opt.key}
                      className={`rounded px-2 py-1 ${
                        isCorrectOption
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
                          : isSelected
                            ? "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300"
                            : "text-slate-600 dark:text-slate-400"
                      }`}
                    >
                      {isSelected ? "☑" : "☐"} {opt.key}. {opt.text}
                    </li>
                  );
                })}
              </ul>
              {changed && (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  При проверке правильным считался ответ: {scoredKeys.join(", ") || "—"}. Сейчас правильный:{" "}
                  {currentKeys.join(", ") || "—"}. Результат попытки не пересчитывался.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
