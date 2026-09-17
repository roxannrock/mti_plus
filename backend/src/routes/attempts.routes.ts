import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { asyncHandler, HttpError } from "../middleware/errorHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { scoreAttempt } from "../lib/scoring";

export const attemptsRouter = Router();

attemptsRouter.post(
  "/",
  requireAuth,
  requireRole("STUDENT"),
  asyncHandler(async (req, res) => {
    const { testId } = z.object({ testId: z.string().min(1) }).parse(req.body);

    const test = await prisma.test.findUnique({ where: { id: testId } });
    if (!test || !test.isPublished) throw new HttpError(404, "Тест не найден.");

    const attempt = await prisma.attempt.create({
      data: { testId, studentId: req.auth!.userId },
    });
    res.status(201).json(attempt);
  }),
);

const submitSchema = z.object({
  answers: z.array(
    z.object({
      questionId: z.string().min(1),
      selectedKeys: z.array(z.string()),
    }),
  ),
});

attemptsRouter.post(
  "/:id/submit",
  requireAuth,
  requireRole("STUDENT"),
  asyncHandler(async (req, res) => {
    const { answers } = submitSchema.parse(req.body);

    const attempt = await prisma.attempt.findUnique({
      where: { id: req.params.id },
      include: { test: { include: { questions: true } } },
    });
    if (!attempt || attempt.studentId !== req.auth!.userId) {
      throw new HttpError(404, "Попытка не найдена.");
    }
    if (attempt.finishedAt) throw new HttpError(409, "Эта попытка уже завершена.");

    const answersByQuestion = new Map(answers.map((a) => [a.questionId, a.selectedKeys]));

    const scored = scoreAttempt(
      attempt.test.questions.map((q) => ({
        questionId: q.id,
        section: q.section,
        correctKeys: q.correctKeys as string[],
        selectedKeys: answersByQuestion.get(q.id) ?? [],
      })),
      attempt.test.passPercent,
    );

    await prisma.$transaction([
      ...scored.perQuestion.map((pq) =>
        prisma.attemptAnswer.create({
          data: {
            attemptId: attempt.id,
            questionId: pq.questionId,
            selectedKeys: answersByQuestion.get(pq.questionId) ?? [],
            isCorrect: pq.isCorrect,
          },
        }),
      ),
      prisma.attempt.update({
        where: { id: attempt.id },
        data: {
          finishedAt: new Date(),
          totalCount: scored.totalCount,
          correctCount: scored.correctCount,
          scorePercent: scored.scorePercent,
          passed: scored.passed,
          sectionStats: scored.sectionStats,
        },
      }),
    ]);

    res.json({
      totalCount: scored.totalCount,
      correctCount: scored.correctCount,
      scorePercent: scored.scorePercent,
      passed: scored.passed,
      sectionStats: scored.sectionStats,
    });
  }),
);

attemptsRouter.get(
  "/",
  requireAuth,
  requireRole("STUDENT"),
  asyncHandler(async (req, res) => {
    const attempts = await prisma.attempt.findMany({
      where: { studentId: req.auth!.userId, finishedAt: { not: null } },
      orderBy: { finishedAt: "desc" },
      include: { test: { select: { title: true, passPercent: true } } },
    });
    res.json(attempts);
  }),
);

attemptsRouter.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const attempt = await prisma.attempt.findUnique({
      where: { id: req.params.id },
      include: {
        test: { select: { title: true, passPercent: true } },
        answers: { include: { question: true } },
      },
    });
    if (!attempt) throw new HttpError(404, "Попытка не найдена.");

    const isOwner = attempt.studentId === req.auth!.userId;
    const isAdmin = req.auth!.role === "ADMIN";
    if (!isOwner && !isAdmin) throw new HttpError(403, "Недостаточно прав.");

    res.json(attempt);
  }),
);
