import { Fragment, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Participant, TestDetail } from "../types";
import { getParticipants, getTest } from "../api/tests";
import { apiErrorMessage } from "../api/client";

interface StudentGroup {
  student: Participant["student"];
  attempts: Participant[]; // newest first
  best: Participant;
  last: Participant;
}

// A student may finish a test several times: group their attempts so the
// best and the latest result are visible at a glance.
function groupByStudent(participants: Participant[]): StudentGroup[] {
  const groups = new Map<string, Participant[]>();
  for (const p of participants) {
    const list = groups.get(p.student.id) ?? [];
    list.push(p);
    groups.set(p.student.id, list);
  }
  return [...groups.values()].map((attempts) => {
    attempts.sort((a, b) => b.attemptNumber - a.attemptNumber);
    const best = attempts.reduce((acc, a) => (a.scorePercent > acc.scorePercent ? a : acc));
    return { student: attempts[0]!.student, attempts, best, last: attempts[0]! };
  });
}

function StatusBadge({ passed }: { passed: boolean }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        passed
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
          : "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300"
      }`}
    >
      {passed ? "Сдал" : "Не сдал"}
    </span>
  );
}

export function TestParticipantsPage() {
  const { testId } = useParams<{ testId: string }>();
  const [test, setTest] = useState<TestDetail | null>(null);
  const [participants, setParticipants] = useState<Participant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    if (!testId) return;
    setTestError(null);
    setError(null);
    getTest(testId)
      .then(setTest)
      .catch((err) => setTestError(apiErrorMessage(err, "Не удалось загрузить данные теста.")));
    getParticipants(testId)
      .then(setParticipants)
      .catch((err) => setError(apiErrorMessage(err)));
  }, [testId]);

  const groups = participants ? groupByStudent(participants) : [];
  const attemptLabel = (n: number) => (test?.maxAttempts ? `Попытка ${n} из ${test.maxAttempts}` : `Попытка ${n}`);

  return (
    <div>
      <Link to="/tests" className="mb-4 inline-block text-sm text-indigo-600 hover:underline dark:text-indigo-400">
        ← Все тесты
      </Link>
      <h1 className="mb-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">
        Участники{test ? `: ${test.title}` : ""}
      </h1>
      {test && (
        <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
          Проходной балл: {test.passPercent}% · Лимит попыток: {test.maxAttempts ?? "без ограничений"} ·{" "}
          <Link to={`/tests/${test.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
            Вопросы и настройки
          </Link>
        </p>
      )}
      {testError && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{testError}</p>}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!participants && !error && <p className="text-slate-500 dark:text-slate-400">Загрузка...</p>}
      {participants?.length === 0 && (
        <p className="text-slate-500 dark:text-slate-400">Пока никто не завершил этот тест.</p>
      )}

      {groups.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Студент / попытка</th>
                <th className="px-4 py-3">Результат</th>
                <th className="px-4 py-3">Балл</th>
                <th className="px-4 py-3">Статус</th>
                <th className="px-4 py-3">Завершён</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {groups.map((g) => (
                <Fragment key={g.student.id}>
                  <tr className="bg-slate-50/60 dark:bg-slate-800/30">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-slate-100">{g.student.fullName}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{g.student.login}</div>
                    </td>
                    <td colSpan={2} className="px-4 py-3 text-slate-700 dark:text-slate-300">
                      <div>
                        Лучший: <b>{g.best.scorePercent}%</b>
                        {g.attempts.length > 1 && (
                          <span className="text-slate-500 dark:text-slate-400"> (попытка {g.best.attemptNumber})</span>
                        )}
                      </div>
                      {g.attempts.length > 1 && (
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          Последний: {g.last.scorePercent}%
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge passed={g.best.passed} />
                    </td>
                    <td colSpan={2} className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                      Попыток: {g.attempts.length}
                      {test?.maxAttempts ? ` из ${test.maxAttempts}` : ""}
                    </td>
                  </tr>
                  {g.attempts.map((p) => (
                    <tr key={p.id}>
                      <td className="py-2 pl-8 pr-4 text-slate-600 dark:text-slate-400">{attemptLabel(p.attemptNumber)}</td>
                      <td className="px-4 py-2 text-slate-700 dark:text-slate-300">
                        {p.correctCount}/{p.totalCount}
                      </td>
                      <td className="px-4 py-2 text-slate-700 dark:text-slate-300">{p.scorePercent}%</td>
                      <td className="px-4 py-2">
                        <StatusBadge passed={p.passed} />
                      </td>
                      <td className="px-4 py-2 text-slate-500 dark:text-slate-400">
                        {new Date(p.finishedAt).toLocaleString("ru-RU")}
                      </td>
                      <td className="px-4 py-2">
                        <Link
                          to={`/tests/${testId}/participants/${p.id}`}
                          className="text-indigo-600 hover:underline dark:text-indigo-400"
                        >
                          Подробнее
                        </Link>
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
