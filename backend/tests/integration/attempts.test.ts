import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app";
import { SUBMIT_GRACE_MS } from "../../src/lib/attempts";
import { createTest, createUser, prisma, resetDb } from "../helpers";

let admin: Awaited<ReturnType<typeof createUser>>;
let student: Awaited<ReturnType<typeof createUser>>;
let other: Awaited<ReturnType<typeof createUser>>;
let test: Awaited<ReturnType<typeof createTest>>;
let qIds: string[];

beforeAll(async () => {
  await resetDb();
  admin = await createUser("ADMIN");
  student = await createUser("STUDENT");
  other = await createUser("STUDENT");
  // correct: q1 A, q2 A+C, q3 B
  test = await createTest(admin.user.id, { passPercent: 60 });
  qIds = test.questions.map((q) => q.id);
});
beforeEach(async () => {
  await prisma.attempt.deleteMany();
  await prisma.test.update({ where: { id: test.id }, data: { maxAttempts: null, timeLimitMinutes: null } });
});
afterAll(() => prisma.$disconnect());

const start = (auth: string, testId = test.id) =>
  request(app).post("/api/attempts").set("Authorization", auth).send({ testId });

const submit = (auth: string, id: string, answers: { questionId: string; selectedKeys: string[] }[]) =>
  request(app).post(`/api/attempts/${id}/submit`).set("Authorization", auth).send({ answers });

function allCorrect() {
  return [
    { questionId: qIds[0]!, selectedKeys: ["A"] },
    { questionId: qIds[1]!, selectedKeys: ["C", "A"] },
    { questionId: qIds[2]!, selectedKeys: ["B"] },
  ];
}

describe("POST /api/attempts (start)", () => {
  it("creates an attempt, then returns the same one (idempotent)", async () => {
    const first = await start(student.auth);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ testId: test.id, deadlineAt: null, draftAnswers: {}, finishedAt: null });
    expect(first.body).toHaveProperty("serverNow");

    const second = await start(student.auth);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(await prisma.attempt.count()).toBe(1);
  });

  it("creates exactly one attempt under concurrent starts", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => start(student.auth)));
    expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(await prisma.attempt.count({ where: { studentId: student.user.id } })).toBe(1);
  });

  it("sets deadlineAt from timeLimitMinutes", async () => {
    await prisma.test.update({ where: { id: test.id }, data: { timeLimitMinutes: 10 } });
    const before = Date.now();
    const res = await start(student.auth);
    const deadline = new Date(res.body.deadlineAt).getTime();
    expect(deadline).toBeGreaterThanOrEqual(before + 10 * 60_000 - 1000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + 10 * 60_000 + 1000);
  });

  it("409 when maxAttempts is reached (unfinished attempts can still be resumed)", async () => {
    await prisma.test.update({ where: { id: test.id }, data: { maxAttempts: 1 } });
    const a = await start(student.auth);
    expect(a.status).toBe(201);
    expect((await submit(student.auth, a.body.id, allCorrect())).status).toBe(200);

    const again = await start(student.auth);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/Лимит попыток/);
    // other students are unaffected
    expect((await start(other.auth)).status).toBe(201);
  });

  it("404 for unpublished/archived/unknown tests", async () => {
    const draft = await createTest(admin.user.id, { isPublished: false });
    const arch = await createTest(admin.user.id, { archivedAt: new Date() });
    for (const id of [draft.id, arch.id, "nope"]) expect((await start(student.auth, id)).status).toBe(404);
  });
});

describe("drafts", () => {
  it("saves and restores the draft on resume", async () => {
    const a = await start(student.auth);
    const answers = { [qIds[0]!]: ["B"], [qIds[1]!]: ["A", "C"] };
    const save = await request(app)
      .put(`/api/attempts/${a.body.id}/draft`)
      .set("Authorization", student.auth)
      .send({ answers });
    expect(save.status).toBe(200);
    expect(save.body).toHaveProperty("savedAt");

    const resumed = await start(student.auth);
    expect(resumed.status).toBe(200);
    expect(resumed.body.draftAnswers).toEqual(answers);
  });

  it("fits drafts to the current questions instead of rejecting them", async () => {
    const a = await start(student.auth);
    const put = (auth: string, answers: unknown) =>
      request(app).put(`/api/attempts/${a.body.id}/draft`).set("Authorization", auth).send({ answers });
    const res = await put(student.auth, { [qIds[0]!]: ["A", "B", "Z", "A"], [qIds[1]!]: ["Z"], unknown: ["A"] });
    expect(res.status).toBe(200);
    const row = await prisma.attempt.findUniqueOrThrow({ where: { id: a.body.id } });
    expect(row.draftAnswers).toEqual({ [qIds[0]!]: ["A", "B"], [qIds[1]!]: [] });
  });

  it("400 only for structurally invalid drafts, 404 for foreign attempts", async () => {
    const a = await start(student.auth);
    const put = (auth: string, answers: unknown) =>
      request(app).put(`/api/attempts/${a.body.id}/draft`).set("Authorization", auth).send({ answers });
    expect((await put(student.auth, "nope")).status).toBe(400);
    expect((await put(student.auth, { [qIds[0]!]: "A" })).status).toBe(400);
    expect((await put(student.auth, { [qIds[0]!]: [1] })).status).toBe(400);
    expect((await put(other.auth, {})).status).toBe(404);
  });

  it("409 when saving a draft of a finished attempt", async () => {
    const a = await start(student.auth);
    await submit(student.auth, a.body.id, []);
    const res = await request(app)
      .put(`/api/attempts/${a.body.id}/draft`)
      .set("Authorization", student.auth)
      .send({ answers: {} });
    expect(res.status).toBe(409);
  });
});

describe("POST /api/attempts/:id/submit", () => {
  it("scores the answers and stores them", async () => {
    const a = await start(student.auth);
    const answers = allCorrect();
    answers[2] = { questionId: qIds[2]!, selectedKeys: ["A"] };
    const res = await submit(student.auth, a.body.id, answers);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      attemptId: a.body.id,
      totalCount: 3,
      correctCount: 2,
      scorePercent: 66.67,
      passed: true,
      sectionStats: { S1: { correct: 2, total: 2 }, S2: { correct: 0, total: 1 } },
      expired: false,
    });
    expect(await prisma.attemptAnswer.count({ where: { attemptId: a.body.id } })).toBe(3);
  });

  it("double submit → exactly one 200 and one 409", async () => {
    const a = await start(student.auth);
    const [r1, r2] = await Promise.all([submit(student.auth, a.body.id, allCorrect()), submit(student.auth, a.body.id, [])]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(await prisma.attemptAnswer.count({ where: { attemptId: a.body.id } })).toBe(3);

    const again = await submit(student.auth, a.body.id, allCorrect());
    expect(again.status).toBe(409);
  });

  it("tolerates answers that don't fit the current questions", async () => {
    const a = await start(student.auth);
    const res = await submit(student.auth, a.body.id, [
      { questionId: "nope", selectedKeys: ["A"] }, // ignored
      { questionId: qIds[0]!, selectedKeys: ["A", "B"] }, // several on single → wrong
      { questionId: qIds[1]!, selectedKeys: ["A", "A", "C", "Z"] }, // → A,C (correct)
      { questionId: qIds[2]!, selectedKeys: ["Z"] }, // → nothing
    ]);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ correctCount: 1, totalCount: 3 });
    const rows = await prisma.attemptAnswer.findMany({ where: { attemptId: a.body.id } });
    const byQ = Object.fromEntries(rows.map((r) => [r.questionId, r.selectedKeys]));
    expect(byQ).toEqual({ [qIds[0]!]: ["A", "B"], [qIds[1]!]: ["A", "C"], [qIds[2]!]: [] });
  });

  it("400 for the same question twice, and the attempt stays open", async () => {
    const a = await start(student.auth);
    const res = await submit(student.auth, a.body.id, [
      { questionId: qIds[0]!, selectedKeys: ["A"] },
      { questionId: qIds[0]!, selectedKeys: ["B"] },
    ]);
    expect(res.status).toBe(400);
    const row = await prisma.attempt.findUniqueOrThrow({ where: { id: a.body.id } });
    expect(row.finishedAt).toBeNull();
  });

  it("400 for a malformed body", async () => {
    const a = await start(student.auth);
    const res = await request(app)
      .post(`/api/attempts/${a.body.id}/submit`)
      .set("Authorization", student.auth)
      .send({ answers: "all of them" });
    expect(res.status).toBe(400);
  });

  it("404 for someone else's attempt", async () => {
    const a = await start(student.auth);
    expect((await submit(other.auth, a.body.id, [])).status).toBe(404);
  });

  it("scores an expired attempt from the draft, ignoring the submitted answers", async () => {
    await prisma.test.update({ where: { id: test.id }, data: { timeLimitMinutes: 5 } });
    const a = await start(student.auth);
    await request(app)
      .put(`/api/attempts/${a.body.id}/draft`)
      .set("Authorization", student.auth)
      .send({ answers: { [qIds[0]!]: ["A"] } })
      .expect(200);
    await prisma.attempt.update({
      where: { id: a.body.id },
      data: { deadlineAt: new Date(Date.now() - SUBMIT_GRACE_MS - 5_000) },
    });

    const res = await submit(student.auth, a.body.id, allCorrect());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ expired: true, correctCount: 1, totalCount: 3, passed: false });
  });

  it("still accepts submitted answers within the grace period", async () => {
    await prisma.test.update({ where: { id: test.id }, data: { timeLimitMinutes: 5 } });
    const a = await start(student.auth);
    await prisma.attempt.update({ where: { id: a.body.id }, data: { deadlineAt: new Date(Date.now() - 5_000) } });
    const res = await submit(student.auth, a.body.id, allCorrect());
    expect(res.body).toMatchObject({ expired: false, correctCount: 3 });
  });

  it("finalizes expired attempts lazily (history) and on restart", async () => {
    await prisma.test.update({ where: { id: test.id }, data: { timeLimitMinutes: 5 } });
    const a = await start(student.auth);
    await prisma.attempt.update({
      where: { id: a.body.id },
      data: { deadlineAt: new Date(Date.now() - SUBMIT_GRACE_MS - 5_000), draftAnswers: { [qIds[2]!]: ["B", "Z"] } },
    });
    const history = await request(app).get("/api/attempts").set("Authorization", student.auth);
    expect(history.status).toBe(200);
    expect(history.body).toHaveLength(1);
    expect(history.body[0]).toMatchObject({ id: a.body.id, correctCount: 1 });
    expect(history.body[0]).not.toHaveProperty("draftAnswers");

    // within the grace period a restart resumes the attempt (the client then submits it)
    const b = await start(student.auth);
    await prisma.attempt.update({ where: { id: b.body.id }, data: { deadlineAt: new Date(Date.now() - 1_000) } });
    const c = await start(student.auth);
    expect(c.status).toBe(200);
    expect(c.body.id).toBe(b.body.id);
  });

  it("a start after deadline+grace closes the attempt and returns 409 with its id, no new attempt", async () => {
    await prisma.test.update({ where: { id: test.id }, data: { timeLimitMinutes: 5 } });
    const a = await start(student.auth);
    await prisma.attempt.update({
      where: { id: a.body.id },
      data: { deadlineAt: new Date(Date.now() - SUBMIT_GRACE_MS - 1_000), draftAnswers: { [qIds[0]!]: ["A"] } },
    });
    const res = await start(student.auth);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Время на попытку истекло, она засчитана.", finishedAttemptId: a.body.id });
    expect(await prisma.attempt.count({ where: { studentId: student.user.id } })).toBe(1);
    const closed = await prisma.attempt.findUniqueOrThrow({ where: { id: a.body.id } });
    expect(closed).toMatchObject({ correctCount: 1 });
    expect(closed.finishedAt).not.toBeNull();

    // the next explicit start creates a new attempt
    expect((await start(student.auth)).status).toBe(201);
  });

  it("stores snapshots of the pass mark and correct keys", async () => {
    const a = await start(student.auth);
    await submit(student.auth, a.body.id, allCorrect());
    const row = await prisma.attempt.findUniqueOrThrow({ where: { id: a.body.id }, include: { answers: true } });
    expect(row.passPercentAtFinish).toBe(60);
    const keys = Object.fromEntries(row.answers.map((x) => [x.questionId, x.correctKeysAtFinish]));
    expect(keys).toEqual({ [qIds[0]!]: ["A"], [qIds[1]!]: ["A", "C"], [qIds[2]!]: ["B"] });
  });

  it("a question edited mid-attempt never blocks saving or submitting", async () => {
    const edited = await createTest(admin.user.id, { passPercent: 50 });
    const [q1, q2] = edited.questions;
    const a = await start(student.auth, edited.id);
    const put = (answers: unknown) =>
      request(app).put(`/api/attempts/${a.body.id}/draft`).set("Authorization", student.auth).send({ answers });
    expect((await put({ [q1!.id]: ["B"], [q2!.id]: ["A", "C"] })).status).toBe(200);

    // admin: drop option B from q1, turn q2 (A+C) into single-answer C
    await prisma.question.update({
      where: { id: q1!.id },
      data: { options: [{ key: "A", text: "a" }, { key: "C", text: "c" }], correctKeys: ["A"] },
    });
    await prisma.question.update({ where: { id: q2!.id }, data: { correctKeys: ["C"] } });

    expect((await put({ [q1!.id]: ["B"], [q2!.id]: ["A", "C"] })).status).toBe(200);
    const res = await submit(student.auth, a.body.id, [
      { questionId: q1!.id, selectedKeys: ["B"] },
      { questionId: q2!.id, selectedKeys: ["A", "C"] },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.correctCount).toBe(0);
  });

  it("an attempt stays saveable/submittable after the test is archived or unpublished", async () => {
    for (const data of [{ archivedAt: new Date() }, { isPublished: false }]) {
      const t = await createTest(admin.user.id);
      const a = await start(student.auth, t.id);
      await prisma.test.update({ where: { id: t.id }, data });
      const save = await request(app)
        .put(`/api/attempts/${a.body.id}/draft`)
        .set("Authorization", student.auth)
        .send({ answers: {} });
      expect(save.status).toBe(200);
      expect((await submit(student.auth, a.body.id, [])).status).toBe(200);
    }
  });
});

describe("GET /api/attempts/:id", () => {
  it("does not leak answers/correctKeys for an unfinished attempt", async () => {
    const a = await start(student.auth);
    const res = await request(app).get(`/api/attempts/${a.body.id}`).set("Authorization", student.auth);
    expect(res.status).toBe(200);
    expect(res.body.answers).toEqual([]);
    expect(res.body.test).toEqual({ title: test.title, passPercent: 60 });
    expect(JSON.stringify(res.body)).not.toMatch(/correctKeys|SECRET-SOURCE|scorePercent/);
  });

  it("returns the result of a finished attempt to the owner and admins, 403 to others", async () => {
    const a = await start(student.auth);
    await submit(student.auth, a.body.id, allCorrect());
    const own = await request(app).get(`/api/attempts/${a.body.id}`).set("Authorization", student.auth);
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({
      correctCount: 3,
      passed: true,
      passPercentAtFinish: 60,
      test: { title: test.title, passPercent: 60 },
    });
    expect(own.body.answers).toHaveLength(3);
    expect(JSON.stringify(own.body)).not.toMatch(/SECRET-SOURCE|draftAnswers/);

    const asAdmin = await request(app).get(`/api/attempts/${a.body.id}`).set("Authorization", admin.auth);
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.correctAnswersHidden).toBe(false);
    expect(asAdmin.body.answers[0].correctKeys).toEqual(["A"]);
    expect((await request(app).get(`/api/attempts/${a.body.id}`).set("Authorization", other.auth)).status).toBe(403);
    expect((await request(app).get(`/api/attempts/nope`).set("Authorization", student.auth)).status).toBe(404);
  });
});

describe("correct answers in the result", () => {
  const get = (auth: string, id: string) => request(app).get(`/api/attempts/${id}`).set("Authorization", auth);

  it("are hidden from a student who can still retake", async () => {
    const a = await start(student.auth);
    await submit(student.auth, a.body.id, []);
    const res = await get(student.auth, a.body.id);
    expect(res.body.correctAnswersHidden).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/correctKeys/);
    expect(res.body.answers[0]).toMatchObject({ selectedKeys: [], isCorrect: false });
  });

  it("are shown once the attempt limit is used up, from the snapshot", async () => {
    await prisma.test.update({ where: { id: test.id }, data: { maxAttempts: 2 } });
    const a = await start(student.auth);
    await submit(student.auth, a.body.id, []);
    expect((await get(student.auth, a.body.id)).body.correctAnswersHidden).toBe(true);

    const b = await start(student.auth);
    await submit(student.auth, b.body.id, []);
    // key changed after scoring: the result keeps the key it was scored with
    await prisma.question.update({ where: { id: qIds[0]! }, data: { correctKeys: ["B"] } });
    try {
      const res = await get(student.auth, a.body.id);
      expect(res.body.correctAnswersHidden).toBe(false);
      expect(res.body.answers[0].correctKeys).toEqual(["A"]);
    } finally {
      await prisma.question.update({ where: { id: qIds[0]! }, data: { correctKeys: ["A"] } });
    }
  });
});

describe("GET /api/attempts/active and /status", () => {
  it("lists attempts in progress and reports the start-screen status", async () => {
    await prisma.test.update({ where: { id: test.id }, data: { maxAttempts: 3 } });
    const status0 = await request(app).get(`/api/attempts/status?testId=${test.id}`).set("Authorization", student.auth);
    expect(status0.body).toEqual({ active: null, finishedCount: 0, expiredAttemptId: null });

    const done = await start(student.auth);
    await submit(student.auth, done.body.id, []);
    const a = await start(student.auth);

    const active = await request(app).get("/api/attempts/active").set("Authorization", student.auth);
    expect(active.status).toBe(200);
    expect(active.body).toEqual([expect.objectContaining({ id: a.body.id, testId: test.id })]);

    const status = await request(app).get(`/api/attempts/status?testId=${test.id}`).set("Authorization", student.auth);
    expect(status.body).toMatchObject({ active: { id: a.body.id }, finishedCount: 1, expiredAttemptId: null });
    expect(status.body.active).not.toHaveProperty("draftAnswers");
    expect(await prisma.attempt.count()).toBe(2); // reading the status never creates attempts
  });

  it("/status closes a timed-out attempt and reports its id once", async () => {
    await prisma.test.update({ where: { id: test.id }, data: { timeLimitMinutes: 5 } });
    const a = await start(student.auth);
    await prisma.attempt.update({
      where: { id: a.body.id },
      data: { deadlineAt: new Date(Date.now() - SUBMIT_GRACE_MS - 1_000) },
    });
    const url = `/api/attempts/status?testId=${test.id}`;
    const first = await request(app).get(url).set("Authorization", student.auth);
    expect(first.body).toEqual({ active: null, finishedCount: 1, expiredAttemptId: a.body.id });
    const second = await request(app).get(url).set("Authorization", student.auth);
    expect(second.body.expiredAttemptId).toBeNull();
  });

  it("400 without testId, 403 for admins", async () => {
    expect((await request(app).get("/api/attempts/status").set("Authorization", student.auth)).status).toBe(400);
    expect((await request(app).get("/api/attempts/active").set("Authorization", admin.auth)).status).toBe(403);
  });
});
