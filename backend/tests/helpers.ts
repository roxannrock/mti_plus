// Shared helpers for integration tests. Importing this module loads the real
// app/prisma modules, so it must only be imported from test files (the env is
// set by vitest.config.ts before that happens).
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../src/db/prisma";
import { env } from "../src/config/env";
import type { Prisma } from "../src/generated/prisma/client";

export { prisma };

export const PASSWORD = "Secret-pass-1";
// Cost 4 (bcrypt's minimum) computed once: the tests never need real hashing strength.
export const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);

if (!env.DATABASE_URL.includes("_test")) {
  throw new Error(`Refusing to run integration tests against ${env.DATABASE_URL}`);
}

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "attempt_answers", "attempts", "questions", "tests", "users" RESTART IDENTITY CASCADE',
  );
}

let counter = 0;

export async function createUser(role: "ADMIN" | "STUDENT", login?: string) {
  counter += 1;
  const user = await prisma.user.create({
    data: {
      login: login ?? `${role.toLowerCase()}${counter}`,
      fullName: `${role} ${counter}`,
      passwordHash: PASSWORD_HASH,
      role,
    },
  });
  const token = jwt.sign({ userId: user.id, role: user.role }, env.JWT_SECRET, { expiresIn: "1h" });
  return { user, token, auth: `Bearer ${token}` };
}

export interface QuestionSeed {
  section?: string;
  prompt?: string;
  options?: { key: string; text: string }[];
  correctKeys: string[];
}

const DEFAULT_OPTIONS = [
  { key: "A", text: "Вариант A" },
  { key: "B", text: "Вариант B" },
  { key: "C", text: "Вариант C" },
];

export async function createTest(
  createdById: string,
  opts: Partial<{
    title: string;
    isPublished: boolean;
    archivedAt: Date | null;
    maxAttempts: number | null;
    timeLimitMinutes: number | null;
    passPercent: number;
    questions: QuestionSeed[];
  }> = {},
) {
  const questions = opts.questions ?? [
    { section: "S1", correctKeys: ["A"] },
    { section: "S1", correctKeys: ["A", "C"] },
    { section: "S2", correctKeys: ["B"] },
  ];
  return prisma.test.create({
    data: {
      title: opts.title ?? "Тест",
      passPercent: opts.passPercent ?? 50,
      source: "раздел,вопрос,A,B,C,ответ\nSECRET-SOURCE",
      isPublished: opts.isPublished ?? true,
      archivedAt: opts.archivedAt ?? null,
      maxAttempts: opts.maxAttempts ?? null,
      timeLimitMinutes: opts.timeLimitMinutes ?? null,
      createdById,
      questions: {
        create: questions.map((q, i) => ({
          order: i + 1,
          section: q.section ?? "S1",
          prompt: q.prompt ?? `Вопрос ${i + 1}`,
          options: (q.options ?? DEFAULT_OPTIONS) as unknown as Prisma.InputJsonValue,
          correctKeys: q.correctKeys as unknown as Prisma.InputJsonValue,
        })),
      },
    },
    include: { questions: { orderBy: { order: "asc" } } },
  });
}
