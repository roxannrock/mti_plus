import { Link, Navigate, useLocation } from "react-router-dom";
import type { SubmitResult } from "../types";

interface LocationState {
  result: SubmitResult;
  testTitle: string;
}

export function ResultPage() {
  const location = useLocation();
  const state = location.state as LocationState | undefined;

  if (!state) {
    return <Navigate to="/history" replace />;
  }

  const { result, testTitle } = state;

  return (
    <div>
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm text-slate-500">{testTitle}</p>
        <p className={`mt-2 text-5xl font-semibold ${result.passed ? "text-emerald-600" : "text-red-600"}`}>
          {result.scorePercent}%
        </p>
        <p className="mt-2 text-sm text-slate-600">
          {result.correctCount} из {result.totalCount} правильно
        </p>
        <p className={`mt-1 text-sm font-medium ${result.passed ? "text-emerald-700" : "text-red-700"}`}>
          {result.passed ? "Тест пройден ✓" : "Тест не пройден"}
        </p>
      </div>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-slate-900">По разделам</h2>
        <div className="space-y-3">
          {Object.entries(result.sectionStats).map(([section, stat]) => {
            const pct = stat.total === 0 ? 0 : Math.round((stat.correct / stat.total) * 100);
            return (
              <div key={section}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="text-slate-700">{section}</span>
                  <span className="text-slate-500">
                    {stat.correct}/{stat.total} ({pct}%)
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-slate-100">
                  <div
                    className={`h-2.5 rounded-full ${pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-6 flex gap-3">
        <Link
          to="/tests"
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          К списку тестов
        </Link>
        <Link
          to="/history"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Моя история
        </Link>
      </div>
    </div>
  );
}
