import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { DEFAULT_AI_PROMPT } from "../promptTemplate";
import { createTest, parsePreview } from "../api/tests";
import { apiErrorMessage } from "../api/client";
import type { ParsePreviewResult } from "../types";

export function UploadTestPage() {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState(DEFAULT_AI_PROMPT);
  const [copied, setCopied] = useState(false);
  const [markdown, setMarkdown] = useState("");
  const [preview, setPreview] = useState<ParsePreviewResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copyPrompt() {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function checkMarkdown() {
    setError(null);
    setChecking(true);
    setPreview(null);
    try {
      const result = await parsePreview(markdown);
      setPreview(result);
    } catch (err) {
      setError(apiErrorMessage(err, "Не удалось проверить файл."));
    } finally {
      setChecking(false);
    }
  }

  async function saveTest() {
    setError(null);
    setSaving(true);
    try {
      const test = await createTest(markdown);
      navigate(`/tests/${test.id}/participants`);
    } catch (err) {
      setError(apiErrorMessage(err, "Не удалось сохранить тест."));
    } finally {
      setSaving(false);
    }
  }

  const canSave = preview?.test && preview.issues.length === 0;

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-1 text-lg font-semibold text-slate-900">1. Промпт для AI</h2>
        <p className="mb-3 text-sm text-slate-500">
          Отредактируйте при необходимости, скопируйте, вставьте в ChatGPT/Claude вместе с материалом
          (лекция, конспект и т.д.), заберите готовый MD-ответ обратно сюда.
        </p>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={18}
          className="w-full rounded-md border border-slate-300 p-3 font-mono text-xs outline-none focus:border-indigo-500"
        />
        <button
          onClick={copyPrompt}
          className="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {copied ? "Скопировано ✓" : "Скопировать промпт"}
        </button>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-1 text-lg font-semibold text-slate-900">2. MD-файл теста</h2>
        <p className="mb-3 text-sm text-slate-500">Вставьте ответ AI сюда и проверьте перед сохранением.</p>
        <textarea
          value={markdown}
          onChange={(e) => {
            setMarkdown(e.target.value);
            setPreview(null);
          }}
          rows={18}
          placeholder={"---\ntitle: ...\npass_percent: 70\n---\n\n## Q1 [Раздел]\n..."}
          className="w-full rounded-md border border-slate-300 p-3 font-mono text-xs outline-none focus:border-indigo-500"
        />
        <div className="mt-3 flex gap-3">
          <button
            onClick={checkMarkdown}
            disabled={!markdown.trim() || checking}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {checking ? "Проверяем..." : "Проверить"}
          </button>
          <button
            onClick={saveTest}
            disabled={!canSave || saving}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {saving ? "Сохраняем..." : "Сохранить тест"}
          </button>
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        {preview && preview.issues.length > 0 && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3">
            <p className="mb-1 text-sm font-medium text-red-700">Формат нарушен ({preview.issues.length}):</p>
            <ul className="list-disc pl-5 text-sm text-red-700">
              {preview.issues.map((issue, idx) => (
                <li key={idx}>
                  строка {issue.line}: {issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {preview?.test && preview.issues.length === 0 && (
          <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-sm font-medium text-emerald-700">
              ✓ {preview.test.title} — {preview.test.questions.length} вопросов, проходной балл{" "}
              {preview.test.passPercent}%
            </p>
            <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-xs text-emerald-900">
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
    </div>
  );
}
