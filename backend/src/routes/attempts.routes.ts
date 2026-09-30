import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import type { Prisma } from "../generated/prisma/client";
import { asyncHandler, HttpError } from "../middleware/errorHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { requireParam } from "../lib/params";
import {
  finalizeExpiredAttempts,
  finishAttemptTx,
  finishFromDraftTx,
  isPastGrace,
  normalizeAnswers,
  type AnswerMap,
} from "../lib/attempts";

export const attemptsRouter = Router();

// Structural limits only; content that doesn't fit the current questions is
// dropped by normalizeAnswers, never rejected (see there).
const keysSchema = z.array(z.string().max(64)).max(100);
const answerMapSchema = z.record(z.string().min(1).max(64), keysSchema);

// Fields safe to show while an attempt is in progress (no scores, no answers).
function publicAttempt(a: {
  id: string;
  testId: string;
  startedAt: Date;
  deadlineAt: Date | null;
  draftAnswers: unknown;
  finishedAt: Date | null;
}) {
  return {
    id: a.id,
    testId: a.testId,
    startedAt: a.startedAt,
    deadlineAt: a.deadlineAt,
    draftAnswers: (a.draftAnswers ?? {}) as AnswerMap,
    finishedAt: a.finishedAt,
    // lets the client correct its countdown for clock skew
    serverNow: new Date(),
  };
}

const EXPIRED_MESSAGE = "Время на попытку истекло, она засчитана.";

attemptsRouter.post(
  "/",
  requireAuth,
  requireRole("STUDENT"),
  asyncHandler(async (req, res) => {
    const { testId } = z.object({ testId: z.string().min(1) }).parse(req.body);
    const studentId = req.auth!.userId;

    const test = await prisma.test.findUnique({ where: { id: testId } });
    if (!test || !test.isPublished || test.archivedAt) throw new HttpError(404, "Тест не найден.");

    const outcome = await prisma.$transaction(async (tx) => {
      // Serialize starts per student+test so a double request (StrictMode,
      // two tabs, double click) can't create two attempts.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${studentId}:${testId}`}::text))`;

      const now = Date.now();
      const open = await tx.attempt.findMany({
        where: { studentId, testId, finishedAt: null },
        orderBy: { startedAt: "desc" },
      });
      let resume = null;
      let finalizedId: string | null = null;
      for (const a of open) {
        if (isPastGrace(a.deadlineAt, now)) {
          if (await finishFromDraftTx(tx, a.id)) finalizedId ??= a.id;
        } else if (!resume) {
          // Also within the grace period: the client resumes it, sees 00:00 and submits.
          resume = a;
        }
      }
      if (resume) return { kind: "resume" as const, attempt: resume };
      // Don't silently start a fresh timer on top of an attempt that just ran
      // out — show that result first; a new attempt needs another explicit start.
      if (finalizedId) return { kind: "expired" as const, finishedAttemptId: finalizedId };

      if (test.maxAttempts !== null) {
        const finished = await tx.attempt.count({ where: { studentId, testId, finishedAt: { not: null } } });
        if (finished >= test.maxAttempts) throw new HttpError(409, "Лимит попыток исчерпан.");
      }

      const startedAt = new Date(now);
      const deadlineAt =
        test.timeLimitMinutes !== null ? new Date(now + test.timeLimitMinutes * 60_000) : null;
      const created = await tx.attempt.create({
        data: { testId, studentId, startedAt, deadlineAt },
      });
      return { kind: "created" as const, attempt: created };
    });

    if (outcome.kind === "expired") {
      res.status(409).json({ error: EXPIRED_MESSAGE, finishedAttemptId: outcome.finishedAttemptId });
      return;
    }
    res.status(outcome.kind === "created" ? 201 : 200).json(publicAttempt(outcome.attempt));
  }),
);

// The student's attempts in progress (for "Продолжить" on the test list).
attemptsRouter.get(
  "/active",
  requireAuth,
  requireRole("STUDENT"),
  asyncHandler(async (req, res) => {
    const studentId = req.auth!.userId;
    await finalizeExpiredAttempts({ studentId });
    const attempts = await prisma.attempt.findMany({
      where: { studentId, finishedAt: null },
      select: { id: true, testId: true, startedAt: true, deadlineAt: true },
      orderBy: { startedAt: "desc" },
    });
    res.json(attempts);
  }),
);

// Everything the start screen needs without creating an attempt.
attemptsRouter.get(
  "/status",
  requireAuth,
  requireRole("STUDENT"),
  asyncHandler(async (req, res) => {
    const { testId } = z.object({ testId: z.string().min(1) }).parse(req.query);
    const studentId = req.auth!.userId;
    const finalized = await finalizeExpiredAttempts({ studentId, testId });
    const [active, finishedCount] = await Promise.all([
      prisma.attempt.findFirst({
        where: { studentId, testId, finishedAt: null },
        select: { id: true, testId: true, startedAt: true, deadlineAt: true },
        orderBy: { startedAt: "desc" },
      }),
      prisma.attempt.count({ where: { studentId, testId, finishedAt: { not: null } } }),
    ]);
    res.json({
      active,
      finishedCount,
      // set when this very call closed a timed-out attempt, so the UI can show its result
      expiredAttemptId: finalized[0] ?? null,
    });
  }),
);

// Deliberately doesn't check isPublished/archivedAt: an attempt already in
// progress can be saved and submitted even if the test is hidden meanwhile.
async function loadOwnAttempt(attemptId: string, studentId: string) {
  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    include: { test: { include: { questions: true } } },
  });
  if (!attempt || attempt.studentId !== studentId) throw new HttpError(404, "Попытка не найдена.");
  return attempt;
}

attemptsRouter.put(
  "/:id/draft",
  requireAuth,
  requireRole("STUDENT"),
  asyncHandler(async (req, res) => {
    const { answers } = z.object({ answers: answerMapSchema }).parse(req.body);
    const attempt = await loadOwnAttempt(requireParam(req, "id"), req.auth!.userId);
    if (attempt.finishedAt) throw new HttpError(409, "Эта попытка уже завершена.");
    if (isPastGrace(attempt.deadlineAt)) throw new HttpError(409, "Время на тест истекло.");
    const normalized = normalizeAnswers(attempt.test.questions, answers);

    // Conditional update: never overwrite the draft of an attempt finished in between.
    const updated = await prisma.attempt.updateMany({
      where: { id: attempt.id, finishedAt: null },
      data: { draftAnswers: normalized as Prisma.InputJsonValue },
    });
    if (updated.count === 0) throw new HttpError(409, "Эта попытка уже завершена.");
    res.json({ savedAt: new Date() });
  }),
);

const submitSchema = z.object({
  answers: z
    .array(z.object({ questionId: z.string().min(1).max(64), selectedKeys: keysSchema }))
    .max(2000)
    // the same question twice is a malformed payload, not an edited test
    .refine((list) => new Set(list.map((a) => a.questionId)).size === list.length, {
      message: "Повторяющийся ответ на вопрос.",
    }),
});

attemptsRouter.post(
  "/:id/submit",
  requireAuth,
  requireRole("STUDENT"),
  asyncHandler(async (req, res) => {
    const { answers } = submitSchema.parse(req.body);
    const attempt = await loadOwnAttempt(requireParam(req, "id"), req.auth!.userId);
    if (attempt.finishedAt) throw new HttpError(409, "Эта попытка уже завершена.");

    const expired = isPastGrace(attempt.deadlineAt);
    let scored;
    if (expired) {
      // Too late: the submitted answers are ignored, the last autosaved draft counts.
      scored = await prisma.$transaction((tx) => finishFromDraftTx(tx, attempt.id));
    } else {
      const answerMap = normalizeAnswers(
        attempt.test.questions,
        Object.fromEntries(answers.map((a) => [a.questionId, a.selectedKeys])),
      );
      scored = await prisma.$transaction((tx) =>
        finishAttemptTx(tx, attempt.id, attempt.test.questions, attempt.test.passPercent, answerMap),
      );
    }
    if (!scored) throw new HttpError(409, "Эта попытка уже завершена.");

    res.json({
      attemptId: attempt.id,
      totalCount: scored.totalCount,
      correctCount: scored.correctCount,
      scorePercent: scored.scorePercent,
      passed: scored.passed,
      sectionStats: scored.sectionStats,
      expired,
    });
  }),
);

attemptsRouter.get(
  "/",
  requireAuth,
  requireRole("STUDENT"),
  asyncHandler(async (req, res) => {
    await finalizeExpiredAttempts({ studentId: req.auth!.userId });
    const attempts = await prisma.attempt.findMany({
      where: { studentId: req.auth!.userId, finishedAt: { not: null } },
      orderBy: { finishedAt: "desc" },
      omit: { draftAnswers: true },
      include: { test: { select: { title: true, passPercent: true } } },
    });
    res.json(attempts);
  }),
);

attemptsRouter.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = requireParam(req, "id");
    await finalizeExpiredAttempts({ id });
    const attempt = await prisma.attempt.findUnique({
      where: { id },
      include: {
        test: { select: { title: true, passPercent: true, maxAttempts: true } },
        answers: {
          include: { question: true },
          orderBy: { question: { order: "asc" } },
        },
      },
    });
    if (!attempt) throw new HttpError(404, "Попытка не найдена.");

    const isOwner = attempt.studentId === req.auth!.userId;
    const isAdmin = req.auth!.role === "ADMIN";
    if (!isOwner && !isAdmin) throw new HttpError(403, "Недостаточно прав.");

    const test = { title: attempt.test.title, passPercent: attempt.test.passPercent };
    if (!attempt.finishedAt) {
      // In progress: never expose answers/correctKeys, only what the test page needs.
      res.json({ ...publicAttempt(attempt), test, answers: [] });
      return;
    }

    // With retakes left, showing the key would let a student submit a blank
    // attempt, read the answers and ace the next one. So students see correct
    // answers only once they can't retake; admins always do.
    let revealCorrect = isAdmin;
    if (!revealCorrect && attempt.test.maxAttempts !== null) {
      const finished = await prisma.attempt.count({
        where: { studentId: attempt.studentId, testId: attempt.testId, finishedAt: { not: null } },
      });
      revealCorrect = finished >= attempt.test.maxAttempts;
    }

    const { draftAnswers: _draft, answers, test: _test, ...rest } = attempt;
    res.json({
      ...rest,
      test,
      correctAnswersHidden: !revealCorrect,
      answers: answers.map(({ question, correctKeysAtFinish, ...a }) => {
        const { correctKeys, ...questionPublic } = question;
        return {
          ...a,
          question: revealCorrect ? question : questionPublic,
          // snapshot taken when scored; older attempts fall back to the current key
          ...(revealCorrect ? { correctKeys: correctKeysAtFinish ?? correctKeys } : {}),
        };
      }),
    });
  }),
);
