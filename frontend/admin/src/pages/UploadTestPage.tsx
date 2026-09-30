import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DEFAULT_AI_PROMPT } from "../promptTemplate";
import { createTest, parsePreview, type TestUpload } from "../api/tests";
import { apiErrorMessage } from "../api/client";
import type { ParsePreviewResult } from "../types";

const TEMPLATE_URL = `${import.meta.env.BASE_URL}test-template.csv`;

const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";

export function UploadTestPage() {
  const navigate = useNavigate();
  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState("");
  const [title, setTitle] = useState("");
  const [passPercent, setPassPercent] = useState("70");
  const [preview, setPreview] = useState<ParsePreviewResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(DEFAULT_AI_PROMPT);
  const [copied, setCopied] = useState(false);

  const buildUpload = (): TestUpload => ({ csv, title, description: null, passPercent: Number(passPercent) });

  // Re-validate whenever the file or the form fields change, so the admin
  // never has to press a separate "check" button.
  useEffect(() => {
    if (!csv) {
      setChecking(false);
      return;
    }
    let cancelled = false;
    setChecking(true);
    const timer = setTimeout(async () => {
      try {
        const result = await parsePreview({ csv, title, description: null, passPercent: Number(passPercent) });
        if (!cancelled) {
          setPreview(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(apiErrorMessage(err, "Не удалось проверить файл."));
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [csv, title, passPercent]);

  async function onFileChange(file: File | undefined) {
    setPreview(null);
    setError(null);
    setCsv("");
    setFileName(file?.name ?? null);
    if (!file) return;

    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    } catch {
      setError("Файл не в кодировке UTF-8. В Excel: «Сохранить как» → «CSV UTF-8 (разделитель — запятая)».");
      return;
    }
    if (!title.trim()) setTitle(file.name.replace(/\.csv$/i, ""));
    setCsv(text);
  }

  async function saveTest() {
    setError(null);
    setSaving(true);
    try {
      const test = await createTest(buildUpload());
      navigate(`/tests/${test.id}/participants`);
    } catch (err) {
      setError(apiErrorMessage(err, "Не удалось сохранить тест."));
    } finally {
      setSaving(false);
    }
  }

  async function copyPrompt() {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const canSave = !checking && preview?.test && preview.issues.length === 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">Новый тест из CSV</h2>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          Файл в кодировке UTF-8, разделитель — запятая. Колонки: <code>раздел,вопрос,A,B,C,D,E,ответ</code>.
          В «ответ» — буква правильного варианта, несколько — через запятую в кавычках: <code>"A,C"</code>.{" "}
          <a href={TEMPLATE_URL} download className="text-indigo-600 hover:underline dark:text-indigo-400">
            Скачать шаблон
          </a>
        </p>

        <label className="flex cursor-pointer items-center gap-3 rounded-md border-2 border-dashed border-slate-300 p-4 hover:border-indigo-400 dark:border-slate-700 dark:hover:border-indigo-500">
          <span className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white dark:bg-indigo-500">
            Выбрать файл
          </span>
          <span className="truncate text-sm text-slate-600 dark:text-slate-300">
            {fileName ?? "CSV-файл не выбран"}
          </span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              void onFileChange(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>

        <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_10rem]">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Название теста</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Проходной балл, %</span>
            <input
              type="number"
              min={1}
              max={100}
              value={passPercent}
              onChange={(e) => setPassPercent(e.target.value)}
              className={inputClass}
            />
          </label>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={saveTest}
            disabled={!canSave || saving}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40 dark:bg-indigo-500 dark:hover:bg-indigo-400"
          >
            {saving ? "Сохраняем..." : "Сохранить тест"}
          </button>
          {checking && <span className="text-sm text-slate-400">Проверяем файл...</span>}
        </div>

        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

        {preview && preview.issues.length > 0 && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900/50 dark:bg-red-500/10">
            <p className="mb-1 text-sm font-medium text-red-700 dark:text-red-300">
              Ошибки в файле ({preview.issues.length}) — исправьте и выберите файл заново:
            </p>
            <ul className="list-disc pl-5 text-sm text-red-700 dark:text-red-300">
              {preview.issues.map((issue, idx) => (
                <li key={idx}>
                  строка {issue.line}: {issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {preview?.test && preview.issues.length === 0 && (
          <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/50 dark:bg-emerald-500/10">
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
              ✓ {preview.test.title} — {preview.test.questions.length} вопросов, проходной балл{" "}
              {preview.test.passPercent}%
            </p>
            <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-xs text-emerald-900 dark:text-emerald-200">
              {preview.test.questions.map((q) => (
                <li key={q.order}>
                  Q{q.order} [{q.section}] — {q.prompt.slice(0, 70)}
                  {q.prompt.length > 70 ? "…" : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <details className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <summary className="cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-300">
          Нет CSV? Сгенерировать через AI
        </summary>
        <p className="my-3 text-sm text-slate-500 dark:text-slate-400">
          Скопируйте промпт в ChatGPT/Claude вместе с материалом (лекция, конспект и т.д.), скачайте готовый
          CSV-файл и загрузите его выше. Промпт можно отредактировать.
        </p>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={14}
          className="w-full rounded-md border border-slate-300 bg-white p-3 font-mono text-xs text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
        <button
          onClick={copyPrompt}
          className="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {copied ? "Скопировано ✓" : "Скопировать промпт"}
        </button>
      </details>
    </div>
  );
}
