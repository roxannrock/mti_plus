import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { TestSummary } from "../types";
import { listTests } from "../api/tests";
import { apiErrorMessage } from "../api/client";

interface TestGroup {
  key: string;
  variants: TestSummary[];
}

export function TestsListPage() {
  const [tests, setTests] = useState<TestSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [languageFilter, setLanguageFilter] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<Record<string, string>>({});

  useEffect(() => {
    listTests()
      .then(setTests)
      .catch((err) => setError(apiErrorMessage(err)));
  }, []);

  const languages = useMemo(() => {
    if (!tests) return [];
    return Array.from(new Set(tests.map((t) => t.language))).sort();
  }, [tests]);

  // Tests that share a `groupKey` are language variants of the same exam —
  // shown as one card with a language switcher. A test without a groupKey
  // is its own group of one.
  const groups: TestGroup[] = useMemo(() => {
    if (!tests) return [];
    const byKey = new Map<string, TestSummary[]>();
    for (const t of tests) {
      const key = t.groupKey ?? t.id;
      const list = byKey.get(key) ?? [];
      list.push(t);
      byKey.set(key, list);
    }
    return Array.from(byKey.entries()).map(([key, variants]) => ({ key, variants }));
  }, [tests]);

  const visibleGroups = languageFilter
    ? groups.filter((g) => g.variants.some((v) => v.language === languageFilter))
    : groups;

  function activeVariant(group: TestGroup): TestSummary {
    const preferred = selectedLanguage[group.key] ?? languageFilter ?? undefined;
    // group.variants is never empty — every group is built from at least one test.
    return group.variants.find((v) => v.language === preferred) ?? (group.variants[0] as TestSummary);
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Доступные тесты</h1>
        {languages.length > 1 && (
          <div className="flex gap-2">
            <button
              onClick={() => setLanguageFilter(null)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                languageFilter === null
                  ? "bg-indigo-600 text-white dark:bg-indigo-500"
                  : "border border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              Все
            </button>
            {languages.map((lang) => (
              <button
                key={lang}
                onClick={() => setLanguageFilter(lang)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium uppercase ${
                  languageFilter === lang
                    ? "bg-indigo-600 text-white dark:bg-indigo-500"
                    : "border border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
              >
                {lang}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!tests && !error && <p className="text-slate-500 dark:text-slate-400">Загрузка...</p>}
      {tests?.length === 0 && <p className="text-slate-500 dark:text-slate-400">Пока нет доступных тестов.</p>}

      <div className="grid gap-4">
        {visibleGroups.map((group) => {
          const variant = activeVariant(group);
          const hasLanguageChoice = group.variants.length > 1;

          return (
            <div
              key={group.key}
              className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-medium text-slate-900 dark:text-slate-100">{variant.title}</h2>
                  {!hasLanguageChoice && (
                    <span className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                      {variant.language}
                    </span>
                  )}
                </div>

                {hasLanguageChoice && (
                  <div className="flex gap-1">
                    {group.variants.map((v) => (
                      <button
                        key={v.id}
                        onClick={() => setSelectedLanguage((prev) => ({ ...prev, [group.key]: v.language }))}
                        className={`rounded px-2 py-1 text-xs font-semibold uppercase ${
                          v.id === variant.id
                            ? "bg-indigo-600 text-white dark:bg-indigo-500"
                            : "border border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        }`}
                      >
                        {v.language}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {variant.description && (
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{variant.description}</p>
              )}

              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <div className="flex gap-4 text-xs text-slate-500 dark:text-slate-400">
                  <span>{variant._count.questions} вопросов</span>
                  <span>Проходной балл: {variant.passPercent}%</span>
                </div>
                <Link
                  to={`/tests/${variant.id}`}
                  className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400"
                >
                  Пройти тест →
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
