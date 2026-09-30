import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app";
import { createTest, createUser, prisma, resetDb } from "../helpers";

let admin: Awaited<ReturnType<typeof createUser>>;
let student: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  await resetDb();
  admin = await createUser("ADMIN");
  student = await createUser("STUDENT");
});
afterAll(() => prisma.$disconnect());

const CSV = 'раздел,вопрос,A,B,C,ответ\nNet,"Порт, HTTPS?",21,80,443,C\nHw,Память?,CPU,RAM,SSD,"B,C"\n';

describe("upload endpoints (behaviour check)", () => {
  it("parse-preview returns parsed questions without writing anything", async () => {
    const res = await request(app)
      .post("/api/tests/parse-preview")
      .set("Authorization", admin.auth)
      .send({ csv: CSV, title: "Сети", passPercent: 70 });
    expect(res.status).toBe(200);
    expect(res.body.issues).toEqual([]);
    expect(res.body.test.questions).toHaveLength(2);
    expect(res.body.test.questions[1].correctKeys).toEqual(["B", "C"]);
    expect(await prisma.test.count()).toBe(0);
  });

  it("parse-preview reports issues", async () => {
    const res = await request(app)
      .post("/api/tests/parse-preview")
      .set("Authorization", admin.auth)
      .send({ csv: "раздел,вопрос,A,B,ответ\nS,Q,a,,A", title: "", passPercent: 70 });
    expect(res.status).toBe(200);
    expect(res.body.test).toBeNull();
    expect(res.body.issues.length).toBeGreaterThanOrEqual(2);
  });

  it("POST /api/tests saves the test as an unpublished draft with the source", async () => {
    const res = await request(app)
      .post("/api/tests")
      .set("Authorization", admin.auth)
      .send({ csv: CSV, title: " Сети ", description: "", passPercent: 70 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: "Сети", description: null, passPercent: 70, isPublished: false, _count: { questions: 2 } });
    const saved = await prisma.test.findUniqueOrThrow({ where: { id: res.body.id }, include: { questions: { orderBy: { order: "asc" } } } });
    expect(saved.source).toBe(CSV);
    expect(saved.createdById).toBe(admin.user.id);
    expect(saved.questions.map((q) => q.correctKeys)).toEqual([["C"], ["B", "C"]]);
  });

  it("POST /api/tests rejects an invalid CSV and a malformed body with 400", async () => {
    const before = await prisma.test.count();
    const bad = await request(app)
      .post("/api/tests")
      .set("Authorization", admin.auth)
      .send({ csv: "раздел,вопрос,A,B,ответ\nS,Q,a,b,Z", title: "x", passPercent: 70 });
    expect(bad.status).toBe(400);
    const malformed = await request(app).post("/api/tests").set("Authorization", admin.auth).send({ csv: CSV });
    expect(malformed.status).toBe(400);
    expect(await prisma.test.count()).toBe(before);
  });
});

describe("PATCH /api/tests/:id (settings)", () => {
  it("updates only the sent fields", async () => {
    const t = await createTest(admin.user.id, { title: "Old", maxAttempts: 2 });
    const res = await request(app)
      .patch(`/api/tests/${t.id}`)
      .set("Authorization", admin.auth)
      .send({ title: "  New  ", timeLimitMinutes: 45, description: "  " });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: "New", timeLimitMinutes: 45, maxAttempts: 2, description: null, passPercent: 50 });
    expect(res.body).not.toHaveProperty("source");

    const clear = await request(app).patch(`/api/tests/${t.id}`).set("Authorization", admin.auth).send({ maxAttempts: null });
    expect(clear.body.maxAttempts).toBeNull();
  });

  it.each([
    [{ title: "   " }],
    [{ passPercent: 0 }],
    [{ passPercent: 101 }],
    [{ maxAttempts: 0 }],
    [{ maxAttempts: 1.5 }],
    [{ timeLimitMinutes: 0 }],
    [{ timeLimitMinutes: 601 }],
    [{ timeLimitMinutes: "10" }],
  ])("400 for %j", async (body) => {
    const t = await createTest(admin.user.id);
    const res = await request(app).patch(`/api/tests/${t.id}`).set("Authorization", admin.auth).send(body);
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
  });

  it("ignores unknown fields such as source/createdById", async () => {
    const t = await createTest(admin.user.id);
    const res = await request(app)
      .patch(`/api/tests/${t.id}`)
      .set("Authorization", admin.auth)
      .send({ source: "hacked", createdById: student.user.id });
    expect(res.status).toBe(200);
    const row = await prisma.test.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.source).not.toBe("hacked");
    expect(row.createdById).toBe(admin.user.id);
  });
});

describe("404 for unknown ids", () => {
  it.each([
    ["patch", "/api/tests/nope", { title: "x" }],
    ["patch", "/api/tests/nope/restore", {}],
    ["patch", "/api/tests/nope/publish", { isPublished: true }],
    ["patch", "/api/tests/nope/publish", { isPublished: false }],
    ["delete", "/api/tests/nope", undefined],
    ["get", "/api/tests/nope", undefined],
    ["get", "/api/tests/nope/source", undefined],
    ["get", "/api/tests/nope/participants", undefined],
    ["get", "/api/tests/nope/participants/nope", undefined],
  ] as const)("%s %s", async (method, url, body) => {
    const res = await request(app)[method](url).set("Authorization", admin.auth).send(body);
    expect(res.status).toBe(404);
    expect(typeof res.body.error).toBe("string");
  });
});

describe("publish / archive / delete", () => {
  it("DELETE really deletes a test without attempts", async () => {
    const t = await createTest(admin.user.id);
    const res = await request(app).delete(`/api/tests/${t.id}`).set("Authorization", admin.auth);
    expect(res.body).toEqual({ deleted: true, archived: false });
    expect(await prisma.test.findUnique({ where: { id: t.id } })).toBeNull();
  });

  it("DELETE archives a test with attempts and keeps the results", async () => {
    const t = await createTest(admin.user.id);
    await prisma.attempt.create({ data: { testId: t.id, studentId: student.user.id, finishedAt: new Date() } });
    const res = await request(app).delete(`/api/tests/${t.id}`).set("Authorization", admin.auth);
    expect(res.body).toEqual({ deleted: false, archived: true });
    const row = await prisma.test.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.archivedAt).not.toBeNull();
    expect(row.isPublished).toBe(false);
    expect(await prisma.attempt.count({ where: { testId: t.id } })).toBe(1);

    // archived → can't be published until restored; restore brings it back as a draft
    const pub = await request(app).patch(`/api/tests/${t.id}/publish`).set("Authorization", admin.auth).send({ isPublished: true });
    expect(pub.status).toBe(400);
    const restored = await request(app).patch(`/api/tests/${t.id}/restore`).set("Authorization", admin.auth);
    expect(restored.body).toMatchObject({ archivedAt: null, isPublished: false });
    const pub2 = await request(app).patch(`/api/tests/${t.id}/publish`).set("Authorization", admin.auth).send({ isPublished: true });
    expect(pub2.body.isPublished).toBe(true);
  });

  it("DELETE archives a test that only has an in-progress attempt", async () => {
    const t = await createTest(admin.user.id);
    await prisma.attempt.create({ data: { testId: t.id, studentId: student.user.id } });
    const res = await request(app).delete(`/api/tests/${t.id}`).set("Authorization", admin.auth);
    expect(res.body).toEqual({ deleted: false, archived: true });
    expect(await prisma.attempt.count({ where: { testId: t.id } })).toBe(1);
  });

  it("archived tests are listed only on the archive tab", async () => {
    const t = await createTest(admin.user.id, { title: "В архив" });
    await prisma.attempt.create({ data: { testId: t.id, studentId: student.user.id, finishedAt: new Date() } });
    await request(app).delete(`/api/tests/${t.id}`).set("Authorization", admin.auth);
    const active = await request(app).get("/api/tests").set("Authorization", admin.auth);
    expect(active.body.map((x: { id: string }) => x.id)).not.toContain(t.id);
    const arch = await request(app).get("/api/tests?archived=true").set("Authorization", admin.auth);
    expect(arch.body.map((x: { id: string }) => x.id)).toContain(t.id);
  });
});

describe("PUT /api/tests/:id/questions/:questionId", () => {
  const valid = {
    section: " Сеть ",
    prompt: " Новый текст ",
    options: [
      { key: "A", text: "один" },
      { key: "B", text: "два" },
      { key: "C", text: "три" },
    ],
    correctKeys: ["C", "A", "A"],
  };

  it("updates the question, normalizing correctKeys to option order", async () => {
    const t = await createTest(admin.user.id);
    const q = t.questions[0]!;
    const res = await request(app).put(`/api/tests/${t.id}/questions/${q.id}`).set("Authorization", admin.auth).send(valid);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ section: "Сеть", prompt: "Новый текст", correctKeys: ["A", "C"] });
  });

  it.each([
    ["empty section", { section: " " }],
    ["empty prompt", { prompt: "" }],
    ["one option", { options: [{ key: "A", text: "x" }], correctKeys: ["A"] }],
    ["empty option text", { options: [{ key: "A", text: "x" }, { key: "B", text: " " }], correctKeys: ["A"] }],
    ["duplicate keys", { options: [{ key: "A", text: "x" }, { key: "A", text: "y" }], correctKeys: ["A"] }],
    ["no correct keys", { correctKeys: [] }],
    ["unknown correct key", { correctKeys: ["Z"] }],
  ])("400 for %s", async (_name, patch) => {
    const t = await createTest(admin.user.id);
    const q = t.questions[0]!;
    const res = await request(app)
      .put(`/api/tests/${t.id}/questions/${q.id}`)
      .set("Authorization", admin.auth)
      .send({ ...valid, ...patch });
    expect(res.status).toBe(400);
    const row = await prisma.question.findUniqueOrThrow({ where: { id: q.id } });
    expect(row.prompt).toBe(q.prompt);
  });

  it("404 for a question of another test or an unknown id", async () => {
    const t1 = await createTest(admin.user.id);
    const t2 = await createTest(admin.user.id);
    const foreign = await request(app)
      .put(`/api/tests/${t1.id}/questions/${t2.questions[0]!.id}`)
      .set("Authorization", admin.auth)
      .send(valid);
    expect(foreign.status).toBe(404);
    const unknown = await request(app).put(`/api/tests/${t1.id}/questions/nope`).set("Authorization", admin.auth).send(valid);
    expect(unknown.status).toBe(404);
  });
});

describe("participants", () => {
  it("lists finished attempts numbered per student, without drafts", async () => {
    const t = await createTest(admin.user.id);
    const base = Date.now();
    for (let i = 0; i < 2; i++) {
      await prisma.attempt.create({
        data: { testId: t.id, studentId: student.user.id, finishedAt: new Date(base + i * 1000), draftAnswers: { x: ["A"] } },
      });
    }
    await prisma.attempt.create({ data: { testId: t.id, studentId: student.user.id } }); // unfinished
    const res = await request(app).get(`/api/tests/${t.id}/participants`).set("Authorization", admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.map((a: { attemptNumber: number }) => a.attemptNumber)).toEqual([2, 1]);
    expect(res.body[0]).not.toHaveProperty("draftAnswers");
    expect(res.body[0].student).toEqual({ id: student.user.id, fullName: student.user.fullName, login: student.user.login });
  });

  it("participant detail carries the scoring snapshots next to the current values", async () => {
    const t = await createTest(admin.user.id, { passPercent: 60 });
    const q = t.questions[0]!;
    const attempt = await prisma.attempt.create({
      data: {
        testId: t.id,
        studentId: student.user.id,
        finishedAt: new Date(),
        passPercentAtFinish: 50,
        answers: { create: { questionId: q.id, selectedKeys: ["A"], isCorrect: true, correctKeysAtFinish: ["A"] } },
      },
    });
    // the admin edits the question after the attempt was scored
    await request(app)
      .put(`/api/tests/${t.id}/questions/${q.id}`)
      .set("Authorization", admin.auth)
      .send({ section: "S1", prompt: "p", options: q.options, correctKeys: ["B"] });

    const res = await request(app).get(`/api/tests/${t.id}/participants/${attempt.id}`).set("Authorization", admin.auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ passPercentAtFinish: 50, test: { passPercent: 60, title: t.title } });
    expect(res.body).not.toHaveProperty("draftAnswers");
    expect(res.body.answers[0]).toMatchObject({ isCorrect: true, correctKeysAtFinish: ["A"], question: { correctKeys: ["B"] } });
  });
});
