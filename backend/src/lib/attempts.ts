import { prisma } from "../db/prisma";
import type { Prisma } from "../generated/prisma/client";
import { scoreAttempt, type ScoreResult } from "./scoring";

// A submit that arrives up to this long after deadlineAt still counts with
// the answers it carries (network latency, auto-submit racing the clock).
// Lazy finalization waits for the same grace, so every place (start, test
// list, history, admin) agrees on when an attempt is "over".
export const SUBMIT_GRACE_MS = 60_000;

export type AnswerMap = Record<string, string[]>;

type Tx = Prisma.TransactionClient;

interface QuestionForScoring {
  id: string;
  section: string;
  options: unknown;
  correctKeys: unknown;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function optionKeys(q: QuestionForScoring): string[] {
  return Array.isArray(q.options)
    ? (q.options as { key?: unknown }[]).map((o) => o.key).filter((k): k is string => typeof k === "string")
    : [];
}

/** True once the attempt can no longer be submitted with fresh answers. */
export function isPastGrace(deadlineAt: Date | null, now = Date.now()): boolean {
  return deadlineAt !== null && now > deadlineAt.getTime() + SUBMIT_GRACE_MS;
}

/**
 * Fits answers to the test's CURRENT questions instead of rejecting them.
 * An admin may edit a question while an attempt is open (remove an option,
 * turn multi into single); rejecting would leave the student unable to save
 * or submit at all. So: unknown questionIds and unknown option keys are
 * dropped, duplicate keys collapsed. Several keys on a single-answer question
 * are kept — they're simply scored as wrong. Structural validation (shape,
 * types, sizes) is the route's zod schema's job and still returns 400.
 */
export function normalizeAnswers(questions: QuestionForScoring[], answers: unknown): AnswerMap {
  const result: AnswerMap = {};
  if (!answers || typeof answers !== "object") return result;
  const byId = new Map(questions.map((q) => [q.id, q]));
  for (const [questionId, raw] of Object.entries(answers as Record<string, unknown>)) {
    const q = byId.get(questionId);
    if (!q) continue;
    const allowed = new Set(optionKeys(q));
    result[questionId] = [...new Set(asStringArray(raw).filter((k) => allowed.has(k)))];
  }
  return result;
}

/**
 * Finishes an attempt inside the given transaction. The attempt is claimed with
 * a conditional update (finishedAt IS NULL) first, so two concurrent submits
 * can't both write answers: the loser sees 0 rows and gets null back.
 * The pass mark and each question's correct keys are snapshotted, so later
 * edits to the test don't change how an old result reads.
 */
export async function finishAttemptTx(
  tx: Tx,
  attemptId: string,
  questions: QuestionForScoring[],
  passPercent: number,
  answers: AnswerMap,
): Promise<ScoreResult | null> {
  const claimed = await tx.attempt.updateMany({
    where: { id: attemptId, finishedAt: null },
    data: { finishedAt: new Date() },
  });
  if (claimed.count === 0) return null;

  const correctById = new Map(questions.map((q) => [q.id, asStringArray(q.correctKeys)]));
  const scored = scoreAttempt(
    questions.map((q) => ({
      questionId: q.id,
      section: q.section,
      correctKeys: correctById.get(q.id) ?? [],
      selectedKeys: answers[q.id] ?? [],
    })),
    passPercent,
  );

  await tx.attemptAnswer.createMany({
    data: scored.perQuestion.map((pq) => ({
      attemptId,
      questionId: pq.questionId,
      selectedKeys: answers[pq.questionId] ?? [],
      isCorrect: pq.isCorrect,
      correctKeysAtFinish: correctById.get(pq.questionId) ?? [],
    })),
  });
  await tx.attempt.update({
    where: { id: attemptId },
    data: {
      draftAnswers: answers as Prisma.InputJsonValue,
      totalCount: scored.totalCount,
      correctCount: scored.correctCount,
      scorePercent: scored.scorePercent,
      passed: scored.passed,
      passPercentAtFinish: passPercent,
      sectionStats: scored.sectionStats as unknown as Prisma.InputJsonValue,
    },
  });
  return scored;
}

/** Scores an unfinished attempt from its saved draft (time ran out). Returns null if it was already finished. */
export async function finishFromDraftTx(tx: Tx, attemptId: string): Promise<ScoreResult | null> {
  const attempt = await tx.attempt.findUnique({
    where: { id: attemptId },
    include: { test: { include: { questions: true } } },
  });
  if (!attempt || attempt.finishedAt) return null;
  const answers = normalizeAnswers(attempt.test.questions, attempt.draftAnswers);
  return finishAttemptTx(tx, attempt.id, attempt.test.questions, attempt.test.passPercent, answers);
}

/**
 * Lazily finalizes unfinished attempts whose time plus the submit grace period
 * is over, scoring them from their autosaved draft. Call it before reading
 * attempts so results/limits never show "stuck" attempts, e.g.
 * `finalizeExpiredAttempts({ studentId })` or `finalizeExpiredAttempts({ testId })`.
 * Returns the ids of the attempts this call finalized.
 */
export async function finalizeExpiredAttempts(where: Prisma.AttemptWhereInput): Promise<string[]> {
  const cutoff = new Date(Date.now() - SUBMIT_GRACE_MS);
  const expired = await prisma.attempt.findMany({
    where: { AND: [where, { finishedAt: null, deadlineAt: { lt: cutoff } }] },
    select: { id: true },
  });
  const finalized: string[] = [];
  for (const { id } of expired) {
    const scored = await prisma.$transaction((tx) => finishFromDraftTx(tx, id));
    if (scored) finalized.push(id);
  }
  return finalized;
}
