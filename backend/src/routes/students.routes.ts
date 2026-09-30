import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { asyncHandler, HttpError } from "../middleware/errorHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { requireParam } from "../lib/params";
import { generatePassword } from "../lib/passwords";
import {
  createStudents,
  credentialsCsv,
  hashPassword,
  normalizeLogin,
  parseStudentsCsv,
  validateFullName,
  validateLogin,
  validatePassword,
} from "../lib/studentsCsv";

// Student account management for the admin panel. Only STUDENT accounts are
// visible/editable here — admins are managed via the seed, never this API.
export const studentsRouter = Router();

studentsRouter.use(requireAuth, requireRole("ADMIN"));

// zod refinement reusing the CSV validators, so the single-add form and the
// import accept exactly the same values.
const checked = (validate: (v: string) => string | null) =>
  z.string().superRefine((v, ctx) => {
    const message = validate(v);
    if (message) ctx.addIssue({ code: "custom", message });
  });

function firstIssue(err: z.ZodError) {
  const message = err.issues[0]?.message ?? "некорректные данные.";
  return message.charAt(0).toUpperCase() + message.slice(1);
}

const createSchema = z.object({
  login: z.string().transform(normalizeLogin).pipe(checked(validateLogin)),
  fullName: z.string().trim().transform((s) => s.replace(/\s+/g, " ")).pipe(checked(validateFullName)),
  password: z
    .string()
    .trim()
    .nullish()
    .transform((s) => s || null)
    .pipe(checked(validatePassword).nullable()),
});

const renameSchema = z.object({
  fullName: z.string().trim().transform((s) => s.replace(/\s+/g, " ")).pipe(checked(validateFullName)),
});

const importSchema = z.object({ csv: z.string().min(1, "пустой файл.") });

async function findStudent(id: string) {
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, login: true } });
  if (!user || user.role !== "STUDENT") throw new HttpError(404, "Студент не найден.");
  return user;
}

studentsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const [students, finished] = await Promise.all([
      prisma.user.findMany({
        where: { role: "STUDENT" },
        orderBy: { login: "asc" },
        select: { id: true, login: true, fullName: true, createdAt: true, _count: { select: { attempts: true } } },
      }),
      prisma.attempt.groupBy({
        by: ["studentId"],
        where: { finishedAt: { not: null }, student: { role: "STUDENT" } },
        _count: { _all: true },
      }),
    ]);
    const finishedBy = new Map(finished.map((f) => [f.studentId, f._count._all]));
    res.json(
      students.map(({ _count, ...s }) => ({
        ...s,
        attemptsCount: _count.attempts, // incl. unfinished — what a delete removes
        finishedAttempts: finishedBy.get(s.id) ?? 0,
      })),
    );
  }),
);

// Nothing is created if the file has any errors (like the test upload): the
// admin fixes the file and imports it again, instead of ending up with half
// a class imported. Existing logins are not errors — they're skipped.
studentsRouter.post(
  "/import",
  asyncHandler(async (req, res) => {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error));

    const { rows, issues } = parseStudentsCsv(parsed.data.csv);
    if (issues.length > 0) {
      res.json({ created: [], skipped: [], issues, credentialsCsv: null });
      return;
    }
    const { created, skipped } = await createStudents(rows);
    res.status(created.length > 0 ? 201 : 200).json({
      created,
      skipped,
      issues: [],
      credentialsCsv: created.length > 0 ? credentialsCsv(created) : null,
    });
  }),
);

studentsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error));
    const { login, fullName, password } = parsed.data;

    const existing = await prisma.user.findFirst({
      where: { login: { equals: login, mode: "insensitive" } },
      select: { id: true },
    });
    if (existing) throw new HttpError(409, `Логин «${login}» уже занят.`);

    const plain = password ?? generatePassword();
    const user = await prisma.user.create({
      data: { login, fullName, passwordHash: await hashPassword(plain), role: "STUDENT" },
      select: { id: true, login: true, fullName: true, createdAt: true },
    });
    // The plaintext password is returned only here, once — it's not stored.
    res.status(201).json({
      ...user,
      password: plain,
      generated: password === null,
      credentialsCsv: credentialsCsv([{ ...user, password: plain }]),
    });
  }),
);

studentsRouter.post(
  "/:id/reset-password",
  asyncHandler(async (req, res) => {
    const student = await findStudent(requireParam(req, "id"));
    const password = generatePassword();
    // Bumping tokenVersion logs out every existing session of this student
    // (requireAuth rejects tokens signed with an older version) — a reset is
    // usually done because someone else may know the old password.
    const user = await prisma.user.update({
      where: { id: student.id },
      data: { passwordHash: await hashPassword(password), tokenVersion: { increment: 1 } },
      select: { id: true, login: true, fullName: true },
    });
    res.json({ ...user, password, credentialsCsv: credentialsCsv([{ ...user, password }]) });
  }),
);

studentsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const student = await findStudent(requireParam(req, "id"));
    const parsed = renameSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error));
    const user = await prisma.user.update({
      where: { id: student.id },
      data: { fullName: parsed.data.fullName },
      select: { id: true, login: true, fullName: true, createdAt: true },
    });
    res.json(user);
  }),
);

studentsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const student = await findStudent(requireParam(req, "id"));
    const withAttempts = req.query.withAttempts === "1";

    const attempts = await prisma.attempt.count({ where: { studentId: student.id } });
    if (attempts > 0 && !withAttempts) {
      throw new HttpError(
        409,
        `У студента «${student.login}» есть попытки прохождения (${attempts}). Удаление сотрёт и их результаты — подтвердите удаление вместе с попытками.`,
      );
    }
    // Attempt → User has no cascade (results must not vanish by accident),
    // so attempts go first; their answers cascade from Attempt.
    await prisma.$transaction([
      prisma.attempt.deleteMany({ where: { studentId: student.id } }),
      prisma.user.delete({ where: { id: student.id } }),
    ]);
    res.status(204).end();
  }),
);
