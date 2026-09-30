// What students can see of tests: never `source`, never correctKeys.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app";
import { createTest, createUser, prisma, resetDb } from "../helpers";

let admin: Awaited<ReturnType<typeof createUser>>;
let student: Awaited<ReturnType<typeof createUser>>;
let published: Awaited<ReturnType<typeof createTest>>;
let draft: Awaited<ReturnType<typeof createTest>>;
let archived: Awaited<ReturnType<typeof createTest>>;

beforeAll(async () => {
  await resetDb();
  admin = await createUser("ADMIN");
  student = await createUser("STUDENT");
  published = await createTest(admin.user.id, { title: "Опубликован", maxAttempts: 3, timeLimitMinutes: 30 });
  draft = await createTest(admin.user.id, { title: "Черновик", isPublished: false });
  archived = await createTest(admin.user.id, { title: "Архив", isPublished: true, archivedAt: new Date() });
  // one finished and one unfinished attempt → myAttempts counts only the finished one
  await prisma.attempt.create({ data: { testId: published.id, studentId: student.user.id, finishedAt: new Date() } });
  await prisma.attempt.create({ data: { testId: published.id, studentId: student.user.id } });
});
afterAll(() => prisma.$disconnect());

function assertNoSecrets(body: unknown) {
  const json = JSON.stringify(body);
  expect(json).not.toContain("SECRET-SOURCE");
  expect(json).not.toContain('"source"');
  expect(json).not.toContain("correctKeys");
}

describe("GET /api/tests as a student", () => {
  it("lists only published, non-archived tests without source", async () => {
    const res = await request(app).get("/api/tests").set("Authorization", student.auth);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const [t] = res.body;
    expect(t).toMatchObject({
      id: published.id,
      title: "Опубликован",
      maxAttempts: 3,
      timeLimitMinutes: 30,
      _count: { questions: 3 },
      myAttempts: 1,
    });
    expect(t).not.toHaveProperty("createdById");
    assertNoSecrets(res.body);
  });

  it("returns the published test without source and correctKeys, with isMultiple", async () => {
    const res = await request(app).get(`/api/tests/${published.id}`).set("Authorization", student.auth);
    expect(res.status).toBe(200);
    assertNoSecrets(res.body);
    // same shape as the list: no internal bookkeeping fields
    for (const field of ["createdById", "isPublished", "archivedAt", "updatedAt"]) {
      expect(res.body).not.toHaveProperty(field);
    }
    expect(res.body.questions.map((q: { isMultiple: boolean }) => q.isMultiple)).toEqual([false, true, false]);
    expect(res.body.questions[0].options).toHaveLength(3);
  });

  it("404s for unpublished, archived and unknown tests", async () => {
    for (const id of [draft.id, archived.id, "does-not-exist"]) {
      const res = await request(app).get(`/api/tests/${id}`).set("Authorization", student.auth);
      expect(res.status).toBe(404);
      assertNoSecrets(res.body);
    }
  });
});

describe("GET /api/tests as an admin", () => {
  it("lists non-archived tests (incl. drafts) without source; archived only on request", async () => {
    const res = await request(app).get("/api/tests").set("Authorization", admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.map((t: { id: string }) => t.id).sort()).toEqual([published.id, draft.id].sort());
    // _count.attempts includes the in-progress attempt, finishedAttempts doesn't
    const pub = res.body.find((t: { id: string }) => t.id === published.id);
    expect(pub._count.attempts).toBe(2);
    expect(pub.finishedAttempts).toBe(1);
    expect(JSON.stringify(res.body)).not.toContain("SECRET-SOURCE");

    const arch = await request(app).get("/api/tests?archived=true").set("Authorization", admin.auth);
    expect(arch.body.map((t: { id: string }) => t.id)).toEqual([archived.id]);
  });

  it("returns correctKeys but not source in detail; source only via /source", async () => {
    const res = await request(app).get(`/api/tests/${draft.id}`).set("Authorization", admin.auth);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("source");
    expect(res.body.questions[1].correctKeys).toEqual(["A", "C"]);

    const src = await request(app).get(`/api/tests/${draft.id}/source`).set("Authorization", admin.auth);
    expect(src.status).toBe(200);
    expect(src.text).toContain("SECRET-SOURCE");
    expect(src.headers["content-disposition"]).toMatch(/attachment/);
  });
});
