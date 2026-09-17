import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import type { Prisma } from "../generated/prisma/client";
import { asyncHandler, HttpError } from "../middleware/errorHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { parseTestMarkdown } from "../lib/mdParser";
import { requireParam } from "../lib/params";

export const testsRouter = Router();

const markdownSchema = z.object({ markdown: z.string().min(1) });

// Lets the admin UI show a live preview (parsed questions + validation
// issues) before anything is written to the database.
testsRouter.post(
  "/parse-preview",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { markdown } = markdownSchema.parse(req.body);
    const result = parseTestMarkdown(markdown);
    res.json(result);
  }),
);

testsRouter.post(
  "/",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { markdown } = markdownSchema.parse(req.body);
    const result = parseTestMarkdown(markdown);

    if (!result.test) {
      throw new HttpError(400, "Markdown не прошёл валидацию, тест не сохранён.");
    }

    const { title, description, passPercent, language, groupKey, questions } = result.test;

    const test = await prisma.test.create({
      data: {
        title,
        description,
        passPercent,
        language,
        groupKey,
        mdSource: markdown,
        createdById: req.auth!.userId,
        questions: {
          create: questions.map((q) => ({
            order: q.order,
            section: q.section,
            prompt: q.prompt,
            options: q.options as unknown as Prisma.InputJsonValue,
            correctKeys: q.correctKeys as unknown as Prisma.InputJsonValue,
          })),
        },
      },
      include: { _count: { select: { questions: true } } },
    });

    res.status(201).json(test);
  }),
);

testsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const isAdmin = req.auth!.role === "ADMIN";
    const tests = await prisma.test.findMany({
      where: isAdmin ? {} : { isPublished: true },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { questions: true, attempts: true } },
        createdBy: { select: { fullName: true } },
      },
    });
    res.json(tests);
  }),
);

testsRouter.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const test = await prisma.test.findUnique({
      where: { id: requireParam(req, "id") },
      include: { questions: { orderBy: { order: "asc" } } },
    });
    if (!test) throw new HttpError(404, "Тест не найден.");

    const isAdmin = req.auth!.role === "ADMIN";
    if (!isAdmin && !test.isPublished) throw new HttpError(404, "Тест не найден.");

    if (isAdmin) {
      res.json(test);
      return;
    }

    // Students never receive correct answers up front — only whether the
    // question expects one or several selections, so the UI can render
    // radio buttons vs checkboxes without leaking which option is correct.
    res.json({
      ...test,
      questions: test.questions.map(({ correctKeys, ...q }) => ({
        ...q,
        isMultiple: Array.isArray(correctKeys) && correctKeys.length > 1,
      })),
    });
  }),
);

testsRouter.patch(
  "/:id/publish",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { isPublished } = z.object({ isPublished: z.boolean() }).parse(req.body);
    const test = await prisma.test.update({
      where: { id: requireParam(req, "id") },
      data: { isPublished },
    });
    res.json(test);
  }),
);

testsRouter.get(
  "/:id/participants",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const attempts = await prisma.attempt.findMany({
      where: { testId: requireParam(req, "id"), finishedAt: { not: null } },
      orderBy: { finishedAt: "desc" },
      include: { student: { select: { id: true, fullName: true, email: true } } },
    });
    res.json(attempts);
  }),
);

testsRouter.get(
  "/:id/participants/:attemptId",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const attempt = await prisma.attempt.findFirst({
      where: { id: requireParam(req, "attemptId"), testId: requireParam(req, "id") },
      include: {
        student: { select: { id: true, fullName: true, email: true } },
        answers: { include: { question: true } },
      },
    });
    if (!attempt) throw new HttpError(404, "Попытка не найдена.");
    res.json(attempt);
  }),
);
