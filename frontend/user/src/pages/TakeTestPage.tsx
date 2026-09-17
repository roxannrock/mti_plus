import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { TestDetail } from "../types";
import { getTest } from "../api/tests";
import { startAttempt, submitAttempt } from "../api/attempts";
import { apiErrorMessage } from "../api/client";

export function TakeTestPage() {
  const { testId } = useParams<{ testId: string }>();
  const navigate = useNavigate();

  const [test, setTest] = useState<TestDetail | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!testId) return;
    Promise.all([getTest(testId), startAttempt(testId)])
      .then(([testData, attempt]) => {
        setTest(testData);
        setAttemptId(attempt.id);
      })
      .catch((err) => setError(apiErrorMessage(err, "Не удалось начать тест.")));
  }, [testId]);

  function selectSingle(questionId: string, key: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: [key] }));
  }

  function toggleMultiple(questionId: string, key: string) {
    setAnswers((prev) => {
      const current = prev[questionId] ?? [];
      const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
      return { ...prev, [questionId]: next };
    });
  }

  const answeredCount = test ? test.questions.filter((q) => (answers[q.id]?.length ?? 0) > 0).length : 0;

  async function onSubmit() {
    if (!test || !attemptId) return;
    setError(null);
    setSubmitting(true);
    try {
      const payload = test.questions.map((q) => ({
        questionId: q.id,
        selectedKeys: answers[q.id] ?? [],
      }));
      const result = await submitAttempt(attemptId, payload);
      navigate(`/tests/${test.id}/result`, { state: { result, testTitle: test.title } });
    } catch (err) {
      setError(apiErrorMessage(err, "Не удалось отправить ответы."));
    } finally {
      setSubmitting(false);
    }
  }

  if (error && !test) return <p className="text-sm text-red-600">{error}</p>;
  if (!test) return <p className="text-slate-500">Загрузка...</p>;

  return (
    <div>
      <div className="sticky top-0 z-10 mb-6 -mx-6 border-b border-slate-200 bg-white/90 px-6 py-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-slate-900">{test.title}</h1>
          <span className="text-sm text-slate-500">
            Отвечено: {answeredCount}/{test.questions.length}
          </span>
        </div>
      </div>

      <div className="space-y-5">
        {test.questions.map((q) => (
          <div key={q.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">
              Q{q.order} · {q.section}
            </div>
            <p className="mb-1 font-medium text-slate-900">{q.prompt}</p>
            {q.isMultiple && (
              <p className="mb-2 text-xs text-indigo-600">Выберите все подходящие варианты</p>
            )}
            <div className="mt-2 space-y-2">
              {q.options.map((opt) => {
                const selected = (answers[q.id] ?? []).includes(opt.key);
                return (
                  <label
                    key={opt.key}
                    className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                      selected ? "border-indigo-400 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type={q.isMultiple ? "checkbox" : "radio"}
                      name={q.isMultiple ? undefined : q.id}
                      checked={selected}
                      onChange={() =>
                        q.isMultiple ? toggleMultiple(q.id, opt.key) : selectSingle(q.id, opt.key)
                      }
                      className="accent-indigo-600"
                    />
                    <span>
                      {opt.key}. {opt.text}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="sticky bottom-0 mt-6 -mx-6 border-t border-slate-200 bg-white/90 px-6 py-4 backdrop-blur">
        <button
          onClick={onSubmit}
          disabled={submitting}
          className="w-full rounded-md bg-indigo-600 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? "Отправляем..." : "Завершить и отправить"}
        </button>
      </div>
    </div>
  );
}
