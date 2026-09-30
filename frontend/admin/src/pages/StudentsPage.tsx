import { useEffect, useMemo, useState, type FormEvent } from "react";
import { apiErrorMessage } from "../api/client";
import {
  createStudent,
  deleteStudent,
  downloadCsv,
  importStudents,
  listStudents,
  renameStudent,
  resetStudentPassword,
  type ImportResult,
  type SkippedStudent,
  type CsvIssue,
  type Student,
  type StudentCredentials,
} from "../api/students";

const TEMPLATE_URL = `${import.meta.env.BASE_URL}students-template.csv`;

const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";
const cardClass =
  "rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900";
// Import summary kept for display; deliberately without the created
// accounts, so their passwords live only in the (dismissible) `revealed` panel.
interface ImportSummary {
  createdCount: number;
  skipped: SkippedStudent[];
  issues: CsvIssue[];
}

function summarize(result: ImportResult): ImportSummary {
  return { createdCount: result.created.length, skipped: result.skipped, issues: result.issues };
}

interface Revealed {
  title: string;
  accounts: StudentCredentials[];
  credentialsCsv: string;
  downloaded: boolean;
}

const primaryButton =
  "rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40 dark:bg-indigo-500 dark:hover:bg-indigo-400";
const smallButton =
  "rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800";
const smallDangerButton =
  "rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-500/10";

function pluralResults(n: number) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "результат";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "результата";
  return "результатов";
}

function timestamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

// navigator.clipboard only exists on secure origins (HTTPS/localhost) and
// may still be refused (permissions); a bare-IP HTTP deploy or a refusal
// falls back to the legacy execCommand path.
async function copyText(text: string) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // fall through to the legacy path
    }
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    if (!document.execCommand("copy")) throw new Error("copy failed");
  } finally {
    area.remove();
  }
}

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    let ok = true;
    try {
      await copyText(text);
    } catch {
      ok = false;
    }
    setState(ok ? "copied" : "failed");
    setTimeout(() => setState("idle"), ok ? 1500 : 4000);
  }
  return (
    <span className="inline-flex items-center gap-2">
      {state === "failed" && (
        <span className="text-xs text-red-600 dark:text-red-400">не удалось скопировать — выделите вручную</span>
      )}
      <button onClick={copy} className={smallButton}>
        {state === "copied" ? "Скопировано ✓" : "Копировать"}
      </button>
    </span>
  );
}

export function StudentsPage() {
  const [students, setStudents] = useState<Student[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Passwords are only ever shown right after the server generates them.
  // Held in memory only; gone on reload by design.
  const [revealed, setRevealed] = useState<Revealed | null>(null);

  const [newLogin, setNewLogin] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportSummary | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  async function load() {
    try {
      setStudents(await listStudents());
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Не удалось загрузить студентов."));
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!students || !q) return students;
    return students.filter((s) => s.login.toLowerCase().includes(q) || s.fullName.toLowerCase().includes(q));
  }, [students, search]);

  async function addStudent(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      const created = await createStudent({
        login: newLogin.trim(),
        fullName: newName.trim(),
        password: newPassword.trim() || null,
      });
      setRevealed({
        title: `Студент ${created.login} создан`,
        accounts: [created],
        credentialsCsv: created.credentialsCsv,
        downloaded: false,
      });
      setNewLogin("");
      setNewName("");
      setNewPassword("");
      await load();
    } catch (err) {
      setCreateError(apiErrorMessage(err, "Не удалось создать студента."));
    } finally {
      setCreating(false);
    }
  }

  async function onFileChange(file: File | undefined) {
    setImportError(null);
    setImportResult(null);
    setCsv(null);
    setFileName(file?.name ?? null);
    if (!file) return;
    try {
      setCsv(new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()));
    } catch {
      setImportError("Файл не в кодировке UTF-8. В Excel: «Сохранить как» → «CSV UTF-8 (разделитель — запятая)».");
    }
  }

  async function runImport() {
    if (!csv) return;
    setImportError(null);
    setImportResult(null);
    setImporting(true);
    try {
      const result = await importStudents(csv);
      setImportResult(summarize(result));
      if (result.credentialsCsv && result.created.length > 0) {
        setRevealed({
          title: `Импортировано студентов: ${result.created.length}`,
          accounts: result.created,
          credentialsCsv: result.credentialsCsv,
          downloaded: false,
        });
        setCsv(null);
        await load();
      }
    } catch (err) {
      setImportError(apiErrorMessage(err, "Не удалось импортировать файл."));
    } finally {
      setImporting(false);
    }
  }

  async function resetPassword(student: Student) {
    const confirmed = window.confirm(
      `Сбросить пароль студента ${student.login}? Старый пароль перестанет работать, новый будет показан один раз.`,
    );
    if (!confirmed) return;
    setError(null);
    setBusyId(student.id);
    try {
      const reset = await resetStudentPassword(student.id);
      setRevealed({
        title: `Новый пароль для ${student.login} (старый пароль и открытые сессии больше не действуют)`,
        accounts: [reset],
        credentialsCsv: reset.credentialsCsv,
        downloaded: false,
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(apiErrorMessage(err, "Не удалось сбросить пароль."));
    } finally {
      setBusyId(null);
    }
  }

  async function saveName(student: Student) {
    const fullName = editingName.trim();
    if (!fullName || fullName === student.fullName) {
      setEditingId(null);
      return;
    }
    setError(null);
    setBusyId(student.id);
    try {
      await renameStudent(student.id, fullName);
      setEditingId(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Не удалось изменить ФИО."));
    } finally {
      setBusyId(null);
    }
  }

  async function removeStudent(student: Student) {
    const n = student.attemptsCount;
    const confirmed = window.confirm(
      n > 0
        ? `Удалить студента ${student.login} (${student.fullName})? Вместе с ним безвозвратно удалятся ${n} ${pluralResults(n)} прохождения тестов.`
        : `Удалить студента ${student.login} (${student.fullName})?`,
    );
    if (!confirmed) return;
    setError(null);
    setBusyId(student.id);
    try {
      await deleteStudent(student.id, n > 0);
      if (revealed?.accounts.some((a) => a.login === student.login)) setRevealed(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Не удалось удалить студента."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Студенты</h1>
        {students && <span className="text-sm text-slate-500 dark:text-slate-400">Всего: {students.length}</span>}
      </div>

      {revealed && (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/50 dark:bg-emerald-500/10">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">{revealed.title}</p>
              <p className="mt-0.5 text-xs text-emerald-700 dark:text-emerald-300">
                {revealed.downloaded
                  ? "Файл скачан. Нажмите «Скрыть», чтобы убрать пароли с экрана."
                  : "Пароли показываются только сейчас — сохраните их. Потом их можно лишь сбросить."}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  downloadCsv(revealed.credentialsCsv, `logins_${timestamp()}.csv`);
                  setRevealed({ ...revealed, downloaded: true });
                }}
                // 700/800 in both themes: white text on lighter emerald fails 4.5:1.
                className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 dark:bg-emerald-700 dark:hover:bg-emerald-800"
              >
                Скачать логины и пароли (CSV)
              </button>
              <button onClick={() => setRevealed(null)} className={smallButton}>
                Скрыть
              </button>
            </div>
          </div>
          <div className="mt-3 max-h-72 overflow-y-auto">
            <table className="w-full text-left text-sm">
              <tbody className="divide-y divide-emerald-200/70 dark:divide-emerald-900/50">
                {revealed.accounts.map((a) => (
                  <tr key={a.login}>
                    <td className="py-1.5 pr-3 font-mono text-emerald-900 dark:text-emerald-100">{a.login}</td>
                    <td className="py-1.5 pr-3 text-emerald-900 dark:text-emerald-100">{a.fullName}</td>
                    <td className="py-1.5 pr-3 font-mono text-emerald-900 dark:text-emerald-100">{a.password}</td>
                    <td className="py-1.5 text-right">
                      <CopyButton text={a.password} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className={cardClass}>
          <h2 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">Добавить студента</h2>
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
            Логин — латиница, цифры, «.», «_», «-» (сохраняется строчными буквами). Пароль можно не указывать — будет сгенерирован.
          </p>
          <form onSubmit={addStudent} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Логин</span>
                <input
                  value={newLogin}
                  onChange={(e) => setNewLogin(e.target.value)}
                  autoComplete="off"
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Пароль <span className="font-normal text-slate-400">(необязательно)</span>
                </span>
                <input
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="сгенерировать"
                  className={inputClass}
                />
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">ФИО</span>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} className={inputClass} />
            </label>
            <button type="submit" disabled={creating || !newLogin.trim() || !newName.trim()} className={primaryButton}>
              {creating ? "Создаём..." : "Создать"}
            </button>
            {createError && <p className="text-sm text-red-600 dark:text-red-400">{createError}</p>}
          </form>
        </section>

        <section className={cardClass}>
          <h2 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">Импорт из CSV</h2>
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
            Файл в UTF-8, колонки <code>логин,фио,пароль</code>, не больше 500 студентов за раз. Пустой пароль —
            сгенерируется. Уже существующие логины пропускаются, их пароли не меняются.{" "}
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

          <button onClick={runImport} disabled={!csv || importing} className={`mt-4 ${primaryButton}`}>
            {importing ? "Импортируем..." : "Импортировать"}
          </button>

          {importError && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{importError}</p>}

          {importResult && importResult.issues.length > 0 && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900/50 dark:bg-red-500/10">
              <p className="mb-1 text-sm font-medium text-red-700 dark:text-red-300">
                Ошибки в файле ({importResult.issues.length}) — никто не создан. Исправьте и выберите файл заново:
              </p>
              <ul className="max-h-48 list-disc overflow-y-auto pl-5 text-sm text-red-700 dark:text-red-300">
                {importResult.issues.map((issue, idx) => (
                  <li key={idx}>
                    строка {issue.line}: {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {importResult && importResult.issues.length === 0 && (
            <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">
              Создано: {importResult.createdCount}, пропущено: {importResult.skipped.length}.
            </p>
          )}

          {importResult && importResult.skipped.length > 0 && (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-500/10">
              <p className="mb-1 text-sm font-medium text-amber-800 dark:text-amber-200">
                Пропущено ({importResult.skipped.length}):
              </p>
              <ul className="max-h-48 list-disc overflow-y-auto pl-5 text-sm text-amber-800 dark:text-amber-200">
                {importResult.skipped.map((s) => (
                  <li key={s.line}>
                    строка {s.line}, {s.login}: {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      <section className={cardClass}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Список</h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по логину или ФИО"
            className={`${inputClass} max-w-xs`}
          />
        </div>

        {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
        {!students && !error && <p className="text-slate-500 dark:text-slate-400">Загрузка...</p>}
        {students && students.length === 0 && (
          <p className="text-slate-500 dark:text-slate-400">Студентов пока нет. Добавьте их вручную или импортом.</p>
        )}
        {students && students.length > 0 && filtered?.length === 0 && (
          <p className="text-slate-500 dark:text-slate-400">Никого не найдено.</p>
        )}

        {filtered && filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <tr>
                  <th className="py-2 pr-4 font-medium">Логин</th>
                  <th className="py-2 pr-4 font-medium">ФИО</th>
                  <th className="py-2 pr-4 font-medium">Создан</th>
                  <th className="py-2 pr-4 font-medium" title="Завершённые попытки">
                    Попыток
                  </th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.map((s) => (
                  <tr key={s.id} className="text-slate-700 dark:text-slate-300">
                    <td className="py-2 pr-4 font-mono text-slate-900 dark:text-slate-100">{s.login}</td>
                    <td className="py-2 pr-4">
                      {editingId === s.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            autoFocus
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveName(s);
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            className="w-full min-w-48 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          />
                          <button
                            onClick={() => saveName(s)}
                            disabled={busyId === s.id}
                            className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400"
                          >
                            Сохранить
                          </button>
                          <button onClick={() => setEditingId(null)} className={smallButton}>
                            Отмена
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span>{s.fullName}</span>
                          <button
                            onClick={() => {
                              setEditingId(s.id);
                              setEditingName(s.fullName);
                            }}
                            title="Изменить ФИО"
                            className="text-xs text-slate-400 hover:text-indigo-600 dark:text-slate-500 dark:hover:text-indigo-400"
                          >
                            ✎
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-4 text-slate-500 dark:text-slate-400">
                      {new Date(s.createdAt).toLocaleDateString("ru-RU")}
                    </td>
                    <td className="py-2 pr-4">{s.finishedAttempts}</td>
                    <td className="py-2">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => resetPassword(s)} disabled={busyId === s.id} className={smallButton}>
                          Сбросить пароль
                        </button>
                        <button
                          onClick={() => removeStudent(s)}
                          disabled={busyId === s.id}
                          className={smallDangerButton}
                        >
                          Удалить
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
