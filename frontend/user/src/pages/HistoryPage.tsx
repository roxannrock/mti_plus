import { useEffect, useState } from "react";
import type { AttemptHistoryItem } from "../types";
import { listHistory } from "../api/attempts";
import { apiErrorMessage } from "../api/client";

export function HistoryPage() {
  const [history, setHistory] = useState<AttemptHistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listHistory()
      .then(setHistory)
      .catch((err) => setError(apiErrorMessage(err)));
  }, []);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-slate-900">Моя история</h1>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!history && !error && <p className="text-slate-500">Загрузка...</p>}
      {history?.length === 0 && <p className="text-slate-500">Вы ещё не проходили тесты.</p>}

      <div className="space-y-4">
        {history?.map((attempt) => (
          <div key={attempt.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-medium text-slate-900">{attempt.test.title}</h2>
                <p className="text-xs text-slate-500">{new Date(attempt.finishedAt).toLocaleString("ru-RU")}</p>
              </div>
              <div className="text-right">
                <p className={`text-lg font-semibold ${attempt.passed ? "text-emerald-600" : "text-red-600"}`}>
                  {attempt.scorePercent}%
                </p>
                <p className="text-xs text-slate-500">
                  {attempt.correctCount}/{attempt.totalCount}
                </p>
              </div>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(attempt.sectionStats).map(([section, stat]) => {
                const pct = stat.total === 0 ? 0 : Math.round((stat.correct / stat.total) * 100);
                return (
                  <div key={section} className="text-xs">
                    <div className="mb-0.5 flex justify-between text-slate-500">
                      <span>{section}</span>
                      <span>{pct}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100">
                      <div
                        className={`h-1.5 rounded-full ${pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
