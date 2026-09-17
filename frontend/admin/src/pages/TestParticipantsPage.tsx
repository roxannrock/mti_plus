import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Participant } from "../types";
import { getParticipants, getTest } from "../api/tests";
import { apiErrorMessage } from "../api/client";

export function TestParticipantsPage() {
  const { testId } = useParams<{ testId: string }>();
  const [title, setTitle] = useState("");
  const [participants, setParticipants] = useState<Participant[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!testId) return;
    getTest(testId)
      .then((t) => setTitle(t.title))
      .catch(() => {});
    getParticipants(testId)
      .then(setParticipants)
      .catch((err) => setError(apiErrorMessage(err)));
  }, [testId]);

  return (
    <div>
      <Link to="/tests" className="mb-4 inline-block text-sm text-indigo-600 hover:underline">
        ← Все тесты
      </Link>
      <h1 className="mb-6 text-2xl font-semibold text-slate-900">Участники: {title}</h1>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!participants && !error && <p className="text-slate-500">Загрузка...</p>}
      {participants?.length === 0 && <p className="text-slate-500">Пока никто не завершил этот тест.</p>}

      {participants && participants.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Студент</th>
                <th className="px-4 py-3">Результат</th>
                <th className="px-4 py-3">Балл</th>
                <th className="px-4 py-3">Статус</th>
                <th className="px-4 py-3">Завершён</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {participants.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{p.student.fullName}</div>
                    <div className="text-xs text-slate-500">{p.student.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    {p.correctCount}/{p.totalCount}
                  </td>
                  <td className="px-4 py-3">{p.scorePercent}%</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        p.passed ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                      }`}
                    >
                      {p.passed ? "Сдал" : "Не сдал"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{new Date(p.finishedAt).toLocaleString("ru-RU")}</td>
                  <td className="px-4 py-3">
                    <Link to={`/tests/${testId}/participants/${p.id}`} className="text-indigo-600 hover:underline">
                      Подробнее
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
