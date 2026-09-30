import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { AnswerMap, TestDetail } from "../types";
import { getTest } from "../api/tests";
import { getAttemptStatus, saveDraft, startAttempt, submitAttempt } from "../api/attempts";
import { api, apiErrorMessage, SESSION_KEYS } from "../api/client";
import { Countdown } from "../components/Countdown";

const AUTOSAVE_DELAY_MS = 1000;
const RETRY_MIN_MS = 2000;
const RETRY_MAX_MS = 30_000;

type SaveState = "idle" | "saving" | "saved" | "error";
type Phase = "loading" | "start" | "starting" | "taking";

function httpStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } }).response?.status;
}

// Best-effort save while the page is being unloaded (reload / tab close):
// axios requests get cancelled then, a keepalive fetch survives.
function saveDraftOnUnload(attemptId: string, answers: AnswerMap) {
  const token = localStorage.getItem(SESSION_KEYS.tokenKey);
  fetch(`${api.defaults.baseURL ?? ""}/attempts/${attemptId}/draft`, {
    method: "PUT",
    keepalive: true,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ answers }),
  }).catch(() => undefined);
}

// The test may have been edited since the draft was saved: keep only answers
// that still fit (the server does the same; this keeps the UI consistent).
function fitDraft(test: TestDetail, draft: AnswerMap): { answers: AnswerMap; changed: boolean } {
  const answers: AnswerMap = {};
  let changed = false;
  for (const [questionId, keys] of Object.entries(draft)) {
    const q = test.questions.find((x) => x.id === questionId);
    if (!q) {
      changed = true;
      continue;
    }
    const allowed = new Set(q.options.map((o) => o.key));
    let fitted = keys.filter((k) => allowed.has(k));
    // a question that became single-answer: don't guess which one was meant
    if (!q.isMultiple && fitted.length > 1) fitted = [];
    if (fitted.length !== keys.length) changed = true;
    answers[questionId] = fitted;
  }
  return { answers, changed };
}

export function TakeTestPage() {
  const { testId } = useParams<{ testId: string }>();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>("loading");
  const [test, setTest] = useState<TestDetail | null>(null);
  const [finishedCount, setFinishedCount] = useState(0);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [deadline, setDeadline] = useState<number | null>(null); // in local clock ms
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [timeUp, setTimeUp] = useState(false);
  const [autoStatus, setAutoStatus] = useState<string | null>(null);

  const answersRef = useRef<AnswerMap>({});
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const submittingRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);
  const retryDelayRef = useRef(0);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  const goToResult = useCallback(
    (id: string, expired = false) => navigate(`/results/${id}`, { replace: true, state: { expired } }),
    [navigate],
  );

  const begin = useCallback(
    async (loadedTest: TestDetail, isCancelled: () => boolean = () => false) => {
      setPhase("starting");
      try {
        const attempt = await startAttempt(loadedTest.id);
        if (isCancelled()) return;
        const offset = new Date(attempt.serverNow).getTime() - Date.now();
        const fitted = fitDraft(loadedTest, attempt.draftAnswers ?? {});
        answersRef.current = fitted.answers;
        dirtyRef.current = fitted.changed;
        setAnswers(fitted.answers);
        setAttemptId(attempt.id);
        setDeadline(attempt.deadlineAt ? new Date(attempt.deadlineAt).getTime() - offset : null);
        setPhase("taking");
      } catch (err) {
        if (isCancelled()) return;
        const finishedId = (err as { response?: { data?: { finishedAttemptId?: string } } }).response?.data
          ?.finishedAttemptId;
        if (finishedId) {
          goToResult(finishedId, true);
          return;
        }
        setLoadError(apiErrorMessage(err, "Не удалось начать тест."));
        setPhase("start");
      }
    },
    [goToResult],
  );

  useEffect(() => {
    if (!testId) return;
    // StrictMode runs effects twice in dev: the status call is read-only and
    // the start is idempotent on the server, stale responses are ignored.
    let cancelled = false;
    Promise.all([getTest(testId), getAttemptStatus(testId)])
      .then(([testData, status]) => {
        if (cancelled) return;
        if (status.expiredAttemptId) {
          goToResult(status.expiredAttemptId, true);
          return;
        }
        setTest(testData);
        setFinishedCount(status.finishedCount);
        // an attempt in progress is resumed right away; otherwise show the start screen
        if (status.active) void begin(testData, () => cancelled);
        else setPhase("start");
      })
      .catch((err) => {
        if (!cancelled) setLoadError(apiErrorMessage(err, "Не удалось загрузить тест."));
      });
    return () => {
      cancelled = true;
    };
  }, [testId, begin, goToResult]);

  // Autosave, one request at a time: a slow earlier save must never land after
  // a newer one. Callers wait for the one in flight, then save the latest state.
  const flushDraft = useCallback(async () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    while (inFlightRef.current) await inFlightRef.current;
    if (!attemptId || !dirtyRef.current) return;
    dirtyRef.current = false;
    setSaveState("saving");
    const request = saveDraft(attemptId, answersRef.current).then(
      () => {
        setSaveState("saved");
        setSaveError(null);
      },
      (err: unknown) => {
        dirtyRef.current = true;
        setSaveState("error");
        setSaveError(apiErrorMessage(err, "Не удалось сохранить ответы."));
      },
    );
    inFlightRef.current = request;
    try {
      await request;
    } finally {
      inFlightRef.current = null;
    }
  }, [attemptId]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => void flushDraft(), AUTOSAVE_DELAY_MS);
  }, [flushDraft]);

  // A draft trimmed by fitDraft is saved back right away.
  useEffect(() => {
    if (attemptId && dirtyRef.current) scheduleSave();
  }, [attemptId, scheduleSave]);

  function updateAnswers(update: (prev: AnswerMap) => AnswerMap) {
    const next = update(answersRef.current);
    answersRef.current = next;
    setAnswers(next);
    dirtyRef.current = true;
    scheduleSave();
  }

  // Save pending changes when leaving the page (SPA navigation or reload).
  useEffect(() => {
    if (!attemptId) return;
    const onPageHide = () => {
      if (dirtyRef.current && !submittingRef.current) saveDraftOnUnload(attemptId, answersRef.current);
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
      onPageHide();
    };
  }, [attemptId]);

  const locked = submitting || timeUp;

  function selectSingle(questionId: string, key: string) {
    if (locked) return;
    updateAnswers((prev) => ({ ...prev, [questionId]: [key] }));
  }

  function toggleMultiple(questionId: string, key: string) {
    if (locked) return;
    updateAnswers((prev) => {
      const current = prev[questionId] ?? [];
      const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
      return { ...prev, [questionId]: next };
    });
  }

  const answeredCount = test ? test.questions.filter((q) => (answers[q.id]?.length ?? 0) > 0).length : 0;
  const unansweredCount = test ? test.questions.length - answeredCount : 0;

  const doSubmitRef = useRef<(auto: boolean) => Promise<void>>(async () => undefined);
  const doSubmit = useCallback(
    async (auto: boolean) => {
      if (!test || !attemptId || submittingRef.current) return;
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      submittingRef.current = true;
      setConfirming(false);
      setError(null);
      setSubmitting(true);
      if (auto) setAutoStatus("Время вышло. Отправляем ответы...");
      try {
        await flushDraft();
        const current = answersRef.current;
        const payload = test.questions.map((q) => ({
          questionId: q.id,
          selectedKeys: current[q.id] ?? [],
        }));
        const result = await submitAttempt(attemptId, payload);
        goToResult(result.attemptId, result.expired);
      } catch (err) {
        const status = httpStatus(err);
        // Already finished (another tab, or a retry after a lost response) — just show the result.
        if (status === 409) {
          goToResult(attemptId);
          return;
        }
        submittingRef.current = false;
        // Time is up: the answers can't be changed any more, so keep trying
        // (backoff + as soon as the browser is back online) instead of giving up.
        if (auto && (status === undefined || status >= 500)) {
          const delay = Math.min(RETRY_MAX_MS, retryDelayRef.current ? retryDelayRef.current * 2 : RETRY_MIN_MS);
          retryDelayRef.current = delay;
          setSubmitting(false); // inputs stay locked by timeUp; "Отправить сейчас" retries manually
          setAutoStatus(`Нет связи с сервером. Повторная отправка через ${Math.round(delay / 1000)} с...`);
          retryTimerRef.current = window.setTimeout(() => void doSubmitRef.current(true), delay);
          return;
        }
        setSubmitting(false);
        setAutoStatus(null);
        setError(apiErrorMessage(err, "Не удалось отправить ответы."));
      }
    },
    [test, attemptId, flushDraft, goToResult],
  );
  useEffect(() => {
    doSubmitRef.current = doSubmit;
  }, [doSubmit]);

  useEffect(() => {
    if (!timeUp) return;
    const onOnline = () => void doSubmitRef.current(true);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [timeUp]);

  const onExpire = useCallback(() => {
    setTimeUp(true);
    void doSubmitRef.current(true);
  }, []);

  useEffect(() => {
    if (!confirming) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirming(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming]);

  function onSubmitClick() {
    if (timeUp) void doSubmit(true);
    else if (unansweredCount > 0) setConfirming(true);
    else void doSubmit(false);
  }

  if (loadError && !test) {
    return (
      <div>
        <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
        <Link to="/tests" className="mt-3 inline-block text-sm text-indigo-600 hover:underline dark:text-indigo-400">
          ← К списку тестов
        </Link>
      </div>
    );
  }
  if (!test || phase === "loading") return <p className="text-slate-500 dark:text-slate-400">Загрузка...</p>;

  if (phase === "start" || phase === "starting") {
    const exhausted = test.maxAttempts !== null && finishedCount >= test.maxAttempts;
    return (
      <div className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{test.title}</h1>
        {test.description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{test.description}</p>}
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-slate-500 dark:text-slate-400">Вопросов</dt>
          <dd className="text-slate-900 dark:text-slate-100">{test.questions.length}</dd>
          <dt className="text-slate-500 dark:text-slate-400">Время</dt>
          <dd className="text-slate-900 dark:text-slate-100">
            {test.timeLimitMinutes !== null ? `${test.timeLimitMinutes} мин` : "без ограничения"}
          </dd>
          <dt className="text-slate-500 dark:text-slate-400">Проходной балл</dt>
          <dd className="text-slate-900 dark:text-slate-100">{test.passPercent}%</dd>
          <dt className="text-slate-500 dark:text-slate-400">Попыток</dt>
          <dd className={exhausted ? "font-medium text-red-600 dark:text-red-400" : "text-slate-900 dark:text-slate-100"}>
            {test.maxAttempts !== null ? `${finishedCount}/${test.maxAttempts}` : `${finishedCount} (без ограничения)`}
          </dd>
        </dl>
        {test.timeLimitMinutes !== null && !exhausted && (
          <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
            Таймер запустится после нажатия «Начать». Когда время выйдет, ответы отправятся автоматически.
          </p>
        )}
        {loadError && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{loadError}</p>}
        <div className="mt-6 flex gap-3">
          <Link
            to="/tests"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Назад
          </Link>
          {exhausted ? (
            <span className="rounded-md bg-slate-200 px-4 py-2 text-sm font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-500">
              Попытки исчерпаны
            </span>
          ) : (
            <button
              onClick={() => {
                setLoadError(null);
                void begin(test);
              }}
              disabled={phase === "starting"}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400"
            >
              {phase === "starting" ? "Запускаем..." : "Начать"}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="sticky top-0 z-10 mb-6 -mx-6 border-b border-slate-200 bg-white/90 px-6 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{test.title}</h1>
          <div className="flex items-center gap-4 text-sm text-slate-500 dark:text-slate-400">
            <span className="text-xs" aria-live="polite">
              {saveState === "saving" && "Сохранение..."}
              {saveState === "saved" && "Ответы сохранены"}
              {saveState === "error" && <span className="text-red-600 dark:text-red-400">{saveError}</span>}
            </span>
            <span>
              Отвечено: {answeredCount}/{test.questions.length}
            </span>
            {deadline !== null && <Countdown deadline={deadline} onExpire={onExpire} />}
          </div>
        </div>
      </div>

      <div className="space-y-5">
        {test.questions.map((q) => (
          <fieldset
            key={q.id}
            disabled={locked}
            className="scroll-mt-24 rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <legend className="sr-only">Вопрос {q.order}</legend>
            <div className="mb-1 text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Q{q.order} · {q.section}
            </div>
            <p className="mb-1 font-medium text-slate-900 dark:text-slate-100">{q.prompt}</p>
            {q.isMultiple && (
              <p className="mb-2 text-xs text-indigo-600 dark:text-indigo-400">Выберите все подходящие варианты</p>
            )}
            <div className="mt-2 space-y-2">
              {q.options.map((opt) => {
                const selected = (answers[q.id] ?? []).includes(opt.key);
                return (
                  <label
                    key={opt.key}
                    className={`flex scroll-mt-24 items-center gap-2 rounded-md border px-3 py-2 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-indigo-500 has-[:focus-visible]:ring-offset-1 dark:has-[:focus-visible]:ring-offset-slate-900 ${
                      locked ? "cursor-not-allowed opacity-70" : "cursor-pointer"
                    } ${
                      selected
                        ? "border-indigo-400 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-500/10"
                        : "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                    }`}
                  >
                    <input
                      type={q.isMultiple ? "checkbox" : "radio"}
                      name={q.isMultiple ? undefined : q.id}
                      checked={selected}
                      onChange={() =>
                        q.isMultiple ? toggleMultiple(q.id, opt.key) : selectSingle(q.id, opt.key)
                      }
                      className="scroll-mt-24 accent-indigo-600 focus:outline-none"
                    />
                    <span className="text-slate-800 dark:text-slate-200">
                      {opt.key}. {opt.text}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="sticky bottom-0 mt-6 -mx-6 border-t border-slate-200 bg-white/90 px-6 py-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        {timeUp ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
              {autoStatus ?? "Время вышло."}
            </p>
            <button
              onClick={onSubmitClick}
              disabled={submitting}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400"
            >
              {submitting ? "Отправляем..." : "Отправить сейчас"}
            </button>
          </div>
        ) : confirming ? (
          <div
            role="alertdialog"
            aria-labelledby="confirm-submit-text"
            className="flex flex-wrap items-center justify-between gap-3"
          >
            <p id="confirm-submit-text" className="text-sm text-amber-700 dark:text-amber-400">
              Без ответа осталось вопросов: {unansweredCount}. Завершить тест?
            </p>
            <div className="flex gap-2">
              <button
                ref={confirmRef}
                onClick={() => setConfirming(false)}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Вернуться к тесту
              </button>
              <button
                onClick={() => void doSubmit(false)}
                disabled={submitting}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400"
              >
                Всё равно отправить
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={onSubmitClick}
            disabled={submitting}
            className="w-full rounded-md bg-indigo-600 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400"
          >
            {submitting ? "Отправляем..." : "Завершить и отправить"}
          </button>
        )}
      </div>
    </div>
  );
}
