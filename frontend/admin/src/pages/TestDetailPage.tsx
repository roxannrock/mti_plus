import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import type { Question, TestDetail } from "../types";
import { downloadTestSource, getTest, updateQuestion, updateTestSettings } from "../api/tests";
import { apiErrorMessage } from "../api/client";

const cardClass =
  "rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900";
const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";
const labelClass = "mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400";
const primaryButton =
  "rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400";
const secondaryButton =
  "rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800";

interface SettingsForm {
  title: string;
  description: string;
  passPercent: string;
  maxAttempts: string;
  timeLimitMinutes: string;
}

function toForm(test: TestDetail): SettingsForm {
  return {
    title: test.title,
    description: test.description ?? "",
    passPercent: String(test.passPercent),
    maxAttempts: test.maxAttempts === null ? "" : String(test.maxAttempts),
    timeLimitMinutes: test.timeLimitMinutes === null ? "" : String(test.timeLimitMinutes),
  };
}

// Empty field = "no limit" (null); anything else must be a number. Range
// checks are left to the server so the rules live in one place.
function optionalNumber(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}

export function TestDetailPage() {
  const { testId } = useParams<{ testId: string }>();
  const [test, setTest] = useState<TestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    if (!testId) return;
    setError(null);
    getTest(testId)
      .then(setTest)
      .catch((err) => setError(apiErrorMessage(err, "Не удалось загрузить тест.")));
  }, [testId]);

  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!test) return <p className="text-slate-500 dark:text-slate-400">Загрузка...</p>;

  async function download() {
    if (!test) return;
    setDownloadError(null);
    try {
      await downloadTestSource(test.id, test.title);
    } catch (err) {
      setDownloadError(apiErrorMessage(err, "Не удалось скачать исходный файл."));
    }
  }

  function replaceQuestion(updated: Question) {
    setTest((t) => t && { ...t, questions: t.questions.map((q) => (q.id === updated.id ? updated : q)) });
  }

  return (
    <div>
      <Link to="/tests" className="mb-4 inline-block text-sm text-indigo-600 hover:underline dark:text-indigo-400">
        ← Все тесты
      </Link>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{test.title}</h1>
          <span
            className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${
              test.archivedAt
                ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
                : test.isPublished
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                  : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
            }`}
          >
            {test.archivedAt ? "В архиве" : test.isPublished ? "Опубликован" : "Черновик"}
          </span>
        </div>
        <div className="flex gap-3">
          <Link to={`/tests/${test.id}/participants`} className={secondaryButton}>
            Участники ({test.finishedAttempts})
          </Link>
          <button onClick={download} className={secondaryButton}>
            Скачать исходный CSV
          </button>
        </div>
      </div>
      {downloadError && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{downloadError}</p>}

      <SettingsCard test={test} onSaved={(saved) => setTest((t) => t && { ...t, ...saved })} />

      <h2 className="mb-3 mt-8 text-lg font-semibold text-slate-900 dark:text-slate-100">
        Вопросы ({test.questions.length})
      </h2>
      {test.finishedAttempts > 0 && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
          Этот тест уже проходили (завершённых попыток: {test.finishedAttempts}). Изменения вопросов, правильных ответов
          и проходного балла применяются только к новым попыткам — прошлые результаты не пересчитываются.
        </div>
      )}

      <div className="space-y-3">
        {test.questions.map((q) => (
          <QuestionCard key={q.id} testId={test.id} question={q} onSaved={replaceQuestion} />
        ))}
      </div>
    </div>
  );
}

function SettingsCard({ test, onSaved }: { test: TestDetail; onSaved: (saved: Partial<TestDetail>) => void }) {
  const [form, setForm] = useState<SettingsForm>(() => toForm(test));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const initial = toForm(test);
  const dirty = (Object.keys(form) as (keyof SettingsForm)[]).some((k) => form[k] !== initial[k]);

  function set<K extends keyof SettingsForm>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const title = form.title.trim();
    if (!title) {
      setError("Название не может быть пустым.");
      return;
    }
    const numbers = {
      passPercent: Number(form.passPercent),
      maxAttempts: optionalNumber(form.maxAttempts),
      timeLimitMinutes: optionalNumber(form.timeLimitMinutes),
    };
    if (Object.values(numbers).some((n) => n !== null && Number.isNaN(n))) {
      setError("Числовые поля должны содержать число.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await updateTestSettings(test.id, {
        title,
        description: form.description.trim() || null,
        ...numbers,
      });
      onSaved({
        title: result.title,
        description: result.description,
        passPercent: result.passPercent,
        maxAttempts: result.maxAttempts,
        timeLimitMinutes: result.timeLimitMinutes,
      });
      setForm({
        title: result.title,
        description: result.description ?? "",
        passPercent: String(result.passPercent),
        maxAttempts: result.maxAttempts === null ? "" : String(result.maxAttempts),
        timeLimitMinutes: result.timeLimitMinutes === null ? "" : String(result.timeLimitMinutes),
      });
      setSaved(true);
    } catch (err) {
      setError(apiErrorMessage(err, "Не удалось сохранить настройки."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className={cardClass}>
      <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Настройки</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="s-title">
            Название
          </label>
          <input id="s-title" value={form.title} onChange={(e) => set("title", e.target.value)} className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="s-description">
            Описание (видно студентам)
          </label>
          <textarea
            id="s-description"
            rows={2}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="s-pass">
            Проходной балл, % (1–100)
          </label>
          <input
            id="s-pass"
            type="number"
            min={1}
            max={100}
            value={form.passPercent}
            onChange={(e) => set("passPercent", e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="s-attempts">
            Максимум попыток (пусто — без ограничений)
          </label>
          <input
            id="s-attempts"
            type="number"
            min={1}
            step={1}
            placeholder="без ограничений"
            value={form.maxAttempts}
            onChange={(e) => set("maxAttempts", e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="s-time">
            Лимит времени, мин (пусто — без лимита)
          </label>
          <input
            id="s-time"
            type="number"
            min={1}
            max={600}
            step={1}
            placeholder="без лимита"
            value={form.timeLimitMinutes}
            onChange={(e) => set("timeLimitMinutes", e.target.value)}
            className={inputClass}
          />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button type="submit" disabled={saving || !dirty} className={primaryButton}>
          {saving ? "Сохраняем..." : "Сохранить настройки"}
        </button>
        {saved && !dirty && <span className="text-sm text-emerald-700 dark:text-emerald-400">Сохранено</span>}
        {error && <span className="text-sm text-red-600 dark:text-red-400">{error}</span>}
      </div>
    </form>
  );
}

function QuestionCard({
  testId,
  question,
  onSaved,
}: {
  testId: string;
  question: Question;
  onSaved: (q: Question) => void;
}) {
  const idPrefix = `q-${question.id}`;
  const [editing, setEditing] = useState(false);
  const [section, setSection] = useState(question.section);
  const [prompt, setPrompt] = useState(question.prompt);
  const [options, setOptions] = useState(question.options);
  const [correct, setCorrect] = useState<string[]>(question.correctKeys ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEditing() {
    setSection(question.section);
    setPrompt(question.prompt);
    setOptions(question.options);
    setCorrect(question.correctKeys ?? []);
    setError(null);
    setEditing(true);
  }

  function toggleCorrect(key: string) {
    setCorrect((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]));
  }

  async function save() {
    if (correct.length === 0) {
      setError("Отметьте хотя бы один правильный ответ.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateQuestion(testId, question.id, {
        section: section.trim(),
        prompt: prompt.trim(),
        options: options.map((o) => ({ key: o.key, text: o.text.trim() })),
        correctKeys: correct,
      });
      onSaved(updated);
      setEditing(false);
    } catch (err) {
      setError(apiErrorMessage(err, "Не удалось сохранить вопрос."));
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className={cardClass}>
        <div className="mb-1 flex items-start justify-between gap-4">
          <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Q{question.order} · {question.section}
            {(question.correctKeys?.length ?? 0) > 1 && " · несколько ответов"}
          </div>
          <button
            onClick={startEditing}
            className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Редактировать
          </button>
        </div>
        <p className="mb-2 whitespace-pre-wrap text-sm font-medium text-slate-900 dark:text-slate-100">
          {question.prompt}
        </p>
        <ul className="space-y-1 text-sm">
          {question.options.map((opt) => {
            const isCorrect = question.correctKeys?.includes(opt.key);
            return (
              <li
                key={opt.key}
                className={`rounded px-2 py-1 ${
                  isCorrect
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
                    : "text-slate-600 dark:text-slate-400"
                }`}
              >
                {isCorrect ? "✓" : "  "} {opt.key}. {opt.text}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div className={`${cardClass} border-indigo-300 dark:border-indigo-500/50`}>
      <div className="mb-3 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Q{question.order} · редактирование
      </div>
      <div className="space-y-3">
        <div>
          <label className={labelClass} htmlFor={`${idPrefix}-section`}>
            Раздел
          </label>
          <input
            id={`${idPrefix}-section`}
            value={section}
            onChange={(e) => setSection(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor={`${idPrefix}-prompt`}>
            Вопрос
          </label>
          <textarea
            id={`${idPrefix}-prompt`}
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className={inputClass}
          />
        </div>
        <fieldset>
          <legend className={labelClass}>Варианты (отметьте правильные)</legend>
          <div className="space-y-2">
            {options.map((opt, i) => (
              <div key={opt.key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={correct.includes(opt.key)}
                  onChange={() => toggleCorrect(opt.key)}
                  title="Правильный ответ"
                  aria-label={`Вариант ${opt.key} — правильный ответ`}
                  className="h-4 w-4 accent-emerald-600"
                />
                <span className="w-5 text-sm font-medium text-slate-600 dark:text-slate-400">{opt.key}.</span>
                <input
                  aria-label={`Текст варианта ${opt.key}`}
                  value={opt.text}
                  onChange={(e) =>
                    setOptions((list) => list.map((o, j) => (j === i ? { ...o, text: e.target.value } : o)))
                  }
                  className={inputClass}
                />
              </div>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button onClick={save} disabled={saving} className={primaryButton}>
          {saving ? "Сохраняем..." : "Сохранить вопрос"}
        </button>
        <button onClick={() => setEditing(false)} disabled={saving} className={secondaryButton}>
          Отмена
        </button>
        {error && <span className="text-sm text-red-600 dark:text-red-400">{error}</span>}
      </div>
    </div>
  );
}
