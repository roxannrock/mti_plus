import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import type { Prisma } from "../generated/prisma/client";
import { asyncHandler, HttpError } from "../middleware/errorHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { parseTestCsv } from "../lib/csvParser";
import { requireParam } from "../lib/params";
import { finalizeExpiredAttempts } from "../lib/attempts";

export const testsRouter = Router();

const csvSchema = z.object({
  csv: z.string().min(1),
  title: z.string(),
  description: z.string().nullish(),
  passPercent: z.number(),
});

function parseBody(body: unknown) {
  const { csv, title, description, passPercent } = csvSchema.parse(body);
  return { csv, result: parseTestCsv(csv, { title, description: description ?? null, passPercent }) };
}

// Lets the admin UI show a live preview (parsed questions + validation
// issues) before anything is written to the database.
testsRouter.post(
  "/parse-preview",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    res.json(parseBody(req.body).result);
  }),
);

testsRouter.post(
  "/",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { csv, result } = parseBody(req.body);

    if (!result.test) {
      throw new HttpError(400, "CSV не прошёл проверку, тест не сохранён.");
    }

    const { title, description, passPercent, questions } = result.test;

    const test = await prisma.test.create({
      data: {
        title,
        description,
        passPercent,
        source: csv,
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

// `source` holds the original CSV including the answer column: it must never
// reach students, and it's too heavy for list responses anyway. Admins fetch
// it explicitly via GET /:id/source.
const omitSource = { source: true } as const;
// Students see the same shape in the list and the detail: no source, no
// internal bookkeeping fields.
const studentOmit = { source: true, createdById: true, archivedAt: true, isPublished: true, updatedAt: true } as const;

function asKeys(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? (value as unknown as string[]) : [];
}

testsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.auth!.role === "ADMIN") {
      // Archived tests are hidden from the main list; the admin UI asks for
      // them explicitly on the "Архив" tab.
      const archived = req.query.archived === "true";
      const tests = await prisma.test.findMany({
        where: { archivedAt: archived ? { not: null } : null },
        omit: omitSource,
        orderBy: { createdAt: "desc" },
        include: {
          _count: { select: { questions: true, attempts: true } },
          createdBy: { select: { fullName: true } },
        },
      });
      // _count.attempts includes in-progress attempts (they decide delete vs
      // archive); the UI shows finished ones, like the participants page.
      const finished = await prisma.attempt.groupBy({
        by: ["testId"],
        where: { finishedAt: { not: null }, testId: { in: tests.map((t) => t.id) } },
        _count: { _all: true },
      });
      const finishedByTest = new Map(finished.map((row) => [row.testId, row._count._all]));
      res.json(tests.map((t) => ({ ...t, finishedAttempts: finishedByTest.get(t.id) ?? 0 })));
      return;
    }

    const studentId = req.auth!.userId;
    // Timed-out attempts must count towards myAttempts right away.
    await finalizeExpiredAttempts({ studentId });
    const tests = await prisma.test.findMany({
      where: { isPublished: true, archivedAt: null },
      omit: studentOmit,
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { questions: true } } },
    });

    // One grouped query for all tests instead of a count per test.
    const finished = await prisma.attempt.groupBy({
      by: ["testId"],
      where: { studentId, finishedAt: { not: null }, testId: { in: tests.map((t) => t.id) } },
      _count: { _all: true },
    });
    const finishedByTest = new Map(finished.map((row) => [row.testId, row._count._all]));

    res.json(tests.map((t) => ({ ...t, myAttempts: finishedByTest.get(t.id) ?? 0 })));
  }),
);

testsRouter.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = requireParam(req, "id");

    if (req.auth!.role === "ADMIN") {
      const [test, finishedAttempts] = await Promise.all([
        prisma.test.findUnique({
          where: { id },
          omit: omitSource,
          include: {
            questions: { orderBy: { order: "asc" } },
            createdBy: { select: { fullName: true } },
            _count: { select: { questions: true, attempts: true } },
          },
        }),
        prisma.attempt.count({ where: { testId: id, finishedAt: { not: null } } }),
      ]);
      if (!test) throw new HttpError(404, "Тест не найден.");
      res.json({ ...test, finishedAttempts });
      return;
    }

    const test = await prisma.test.findFirst({
      where: { id, isPublished: true, archivedAt: null },
      omit: studentOmit,
      include: { questions: { orderBy: { order: "asc" } } },
    });
    if (!test) throw new HttpError(404, "Тест не найден.");

    // Students never receive correct answers up front — only whether the
    // question expects one or several selections, so the UI can render
    // radio buttons vs checkboxes without leaking which option is correct.
    res.json({
      ...test,
      questions: test.questions.map(({ correctKeys, ...q }) => ({
        ...q,
        isMultiple: asKeys(correctKeys).length > 1,
      })),
    });
  }),
);

testsRouter.get(
  "/:id/source",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const test = await prisma.test.findUnique({
      where: { id: requireParam(req, "id") },
      select: { title: true, source: true },
    });
    if (!test) throw new HttpError(404, "Тест не найден.");

    // Tests uploaded before the CSV switch kept their Markdown source.
    const isMarkdown = test.source.trimStart().startsWith("#");
    const ext = isMarkdown ? "md" : "csv";
    const base = test.title.replace(/[\\/:*?"<>|\r\n]+/g, " ").trim() || "test";
    const asciiBase = base.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "_");

    res.setHeader("Content-Type", `${isMarkdown ? "text/markdown" : "text/csv"}; charset=utf-8`);
    // filename* carries the real (often Cyrillic) title; filename is the ASCII fallback.
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${asciiBase}.${ext}"; filename*=UTF-8''${encodeURIComponent(`${base}.${ext}`)}`,
    );
    res.send(test.source);
  }),
);

const settingsSchema = z
  .object({
    title: z.string().trim().min(1, "Название не может быть пустым."),
    description: z
      .string()
      .trim()
      .nullable()
      .transform((v) => (v ? v : null)),
    passPercent: z.number().min(1, "Проходной балл: от 1 до 100%.").max(100, "Проходной балл: от 1 до 100%."),
    maxAttempts: z.number().int("Число попыток должно быть целым.").min(1, "Число попыток должно быть не меньше 1.").nullable(),
    timeLimitMinutes: z
      .number()
      .int("Лимит времени должен быть целым числом минут.")
      .min(1, "Лимит времени: от 1 до 600 минут.")
      .max(600, "Лимит времени: от 1 до 600 минут.")
      .nullable(),
  })
  .partial();

testsRouter.patch(
  "/:id",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? "Некорректные настройки теста.");
    }
    // Drop keys that weren't sent so a partial update leaves the rest alone.
    const data = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
    const test = await prisma.test.update({
      where: { id: requireParam(req, "id") },
      data,
      omit: omitSource,
    });
    res.json(test);
  }),
);

// Deleting a test cascades to every attempt, so once students have taken it
// we archive instead: hidden from students and the main admin list, results kept.
testsRouter.delete(
  "/:id",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const id = requireParam(req, "id");
    // One conditional statement instead of count-then-delete, so an attempt
    // started concurrently can't be cascaded away between the two steps.
    const { count: deleted } = await prisma.test.deleteMany({ where: { id, attempts: { none: {} } } });
    if (deleted === 1) {
      res.json({ deleted: true, archived: false });
      return;
    }
    const { count: archived } = await prisma.test.updateMany({
      where: { id },
      data: { archivedAt: new Date(), isPublished: false },
    });
    if (archived === 0) throw new HttpError(404, "Тест не найден.");
    res.json({ deleted: false, archived: true });
  }),
);

testsRouter.patch(
  "/:id/restore",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    // Restored tests come back as drafts; the admin re-publishes deliberately.
    const test = await prisma.test.update({
      where: { id: requireParam(req, "id") },
      data: { archivedAt: null },
      omit: omitSource,
    });
    res.json(test);
  }),
);

testsRouter.patch(
  "/:id/publish",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { isPublished } = z.object({ isPublished: z.boolean() }).parse(req.body);
    const id = requireParam(req, "id");
    if (isPublished) {
      const current = await prisma.test.findUnique({ where: { id }, select: { archivedAt: true } });
      if (!current) throw new HttpError(404, "Тест не найден.");
      if (current.archivedAt) throw new HttpError(400, "Тест в архиве. Сначала восстановите его.");
    }
    const test = await prisma.test.update({
      where: { id },
      data: { isPublished },
      omit: omitSource,
    });
    res.json(test);
  }),
);

const questionSchema = z
  .object({
    section: z.string().trim().min(1, "Раздел не может быть пустым."),
    prompt: z.string().trim().min(1, "Текст вопроса не может быть пустым."),
    options: z
      .array(
        z.object({
          key: z.string().trim().min(1),
          text: z.string().trim().min(1, "Текст варианта не может быть пустым."),
        }),
      )
      .min(2, "Нужно минимум 2 варианта ответа."),
    correctKeys: z.array(z.string().trim().min(1)).min(1, "Отметьте хотя бы один правильный ответ."),
  })
  .superRefine((q, ctx) => {
    const keys = q.options.map((o) => o.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "Ключи вариантов должны быть уникальны." });
    }
    const unknown = q.correctKeys.filter((k) => !keys.includes(k));
    if (unknown.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["correctKeys"],
        message: `Правильный ответ ссылается на несуществующий вариант: ${unknown.join(", ")}.`,
      });
    }
  });

// Fixing a question after upload. Past attempts keep their stored isCorrect /
// score — results are not recalculated (the admin UI warns about this).
testsRouter.put(
  "/:id/questions/:questionId",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const parsed = questionSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? "Некорректные данные вопроса.");
    }
    const { section, prompt, options, correctKeys } = parsed.data;
    const testId = requireParam(req, "id");
    const questionId = requireParam(req, "questionId");

    const existing = await prisma.question.findFirst({ where: { id: questionId, testId }, select: { id: true } });
    if (!existing) throw new HttpError(404, "Вопрос не найден.");

    // Keep correct keys in option order and deduplicated.
    const correct = options.map((o) => o.key).filter((k) => correctKeys.includes(k));

    const question = await prisma.question.update({
      where: { id: questionId },
      data: {
        section,
        prompt,
        options: options as unknown as Prisma.InputJsonValue,
        correctKeys: correct as unknown as Prisma.InputJsonValue,
      },
    });
    res.json(question);
  }),
);

testsRouter.get(
  "/:id/participants",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const testId = requireParam(req, "id");
    const exists = await prisma.test.findUnique({ where: { id: testId }, select: { id: true } });
    if (!exists) throw new HttpError(404, "Тест не найден.");
    // Attempts whose time ran out are scored from their draft so they show up here.
    await finalizeExpiredAttempts({ testId });
    const attempts = await prisma.attempt.findMany({
      where: { testId, finishedAt: { not: null } },
      orderBy: { finishedAt: "asc" },
      omit: { draftAnswers: true },
      include: { student: { select: { id: true, fullName: true, login: true } } },
    });

    // Number each student's finished attempts chronologically (1, 2, 3...).
    const seen = new Map<string, number>();
    const numbered = attempts.map((a) => {
      const n = (seen.get(a.studentId) ?? 0) + 1;
      seen.set(a.studentId, n);
      return { ...a, attemptNumber: n };
    });
    res.json(numbered.reverse());
  }),
);

testsRouter.get(
  "/:id/participants/:attemptId",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const attempt = await prisma.attempt.findFirst({
      where: { id: requireParam(req, "attemptId"), testId: requireParam(req, "id") },
      omit: { draftAnswers: true },
      include: {
        student: { select: { id: true, fullName: true, login: true } },
        test: { select: { title: true, passPercent: true } },
        answers: { include: { question: true } },
      },
    });
    if (!attempt) throw new HttpError(404, "Попытка не найдена.");
    // passPercentAtFinish and answers[].correctKeysAtFinish are the snapshots
    // the attempt was scored against; test.passPercent / question.correctKeys
    // are the current values (the admin may have edited them since).
    res.json(attempt);
  }),
);
