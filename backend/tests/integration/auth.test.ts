import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app";
import { createUser, PASSWORD, prisma, resetDb } from "../helpers";

let admin: Awaited<ReturnType<typeof createUser>>;
let student: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  await resetDb();
  admin = await createUser("ADMIN", "boss");
  student = await createUser("STUDENT", "ivanov");
});
afterAll(() => prisma.$disconnect());

describe("POST /api/auth/login", () => {
  it("logs in with a trimmed login and returns a working token", async () => {
    const res = await request(app).post("/api/auth/login").send({ login: "  ivanov \t", password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: student.user.id, login: "ivanov", fullName: student.user.fullName, role: "STUDENT" });
    expect(res.body.user).not.toHaveProperty("passwordHash");

    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${res.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.login).toBe("ivanov");
  });

  it("treats the login case-insensitively and signs the token version", async () => {
    const res = await request(app).post("/api/auth/login").send({ login: "IvAnov", password: PASSWORD });
    expect(res.status).toBe(200);
    const payload = JSON.parse(Buffer.from(res.body.token.split(".")[1], "base64url").toString());
    expect(payload.tv).toBe(0);
  });

  it("does not trim the password", async () => {
    const res = await request(app).post("/api/auth/login").send({ login: "ivanov", password: ` ${PASSWORD}` });
    expect(res.status).toBe(401);
  });

  it("returns 401 with the same message for a wrong password and an unknown login", async () => {
    const wrong = await request(app).post("/api/auth/login").send({ login: "ivanov", password: "nope-nope" });
    const unknown = await request(app).post("/api/auth/login").send({ login: "nobody", password: "nope-nope" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toBe(unknown.body.error);
  });

  it("returns 400 for an empty body", async () => {
    const res = await request(app).post("/api/auth/login").send({ login: "   ", password: "" });
    expect(res.status).toBe(400);
  });
});

describe("authorization", () => {
  it("401 without a token or with a bad token", async () => {
    expect((await request(app).get("/api/tests")).status).toBe(401);
    expect((await request(app).get("/api/tests").set("Authorization", "Bearer garbage")).status).toBe(401);
    expect((await request(app).get("/api/students")).status).toBe(401);
  });

  it("403 for a student on admin endpoints", async () => {
    const test = await prisma.test.create({
      data: { title: "t", passPercent: 50, source: "x", createdById: admin.user.id },
    });
    const calls: [string, () => request.Test][] = [
      ["GET /students", () => request(app).get("/api/students")],
      ["POST /students/import", () => request(app).post("/api/students/import").send({ csv: "логин,фио\nx,y" })],
      ["POST /tests/parse-preview", () => request(app).post("/api/tests/parse-preview").send({ csv: "x", title: "t", passPercent: 50 })],
      ["POST /tests", () => request(app).post("/api/tests").send({ csv: "x", title: "t", passPercent: 50 })],
      ["PATCH /tests/:id", () => request(app).patch(`/api/tests/${test.id}`).send({ title: "hacked" })],
      ["DELETE /tests/:id", () => request(app).delete(`/api/tests/${test.id}`)],
      ["GET /tests/:id/source", () => request(app).get(`/api/tests/${test.id}/source`)],
      ["GET /tests/:id/participants", () => request(app).get(`/api/tests/${test.id}/participants`)],
      ["PATCH /tests/:id/publish", () => request(app).patch(`/api/tests/${test.id}/publish`).send({ isPublished: true })],
    ];
    for (const [label, call] of calls) {
      const res = await call().set("Authorization", student.auth);
      expect(res.status, label).toBe(403);
    }
    const after = await prisma.test.findUniqueOrThrow({ where: { id: test.id } });
    expect(after.title).toBe("t");
    expect(after.isPublished).toBe(false);
  });

  it("403 for an admin on student-only attempt endpoints", async () => {
    const res = await request(app).post("/api/attempts").set("Authorization", admin.auth).send({ testId: "x" });
    expect(res.status).toBe(403);
  });

  it("401 for a still-valid token of a deleted user", async () => {
    const gone = await createUser("STUDENT", "gone");
    expect((await request(app).get("/api/auth/me").set("Authorization", gone.auth)).status).toBe(200);
    await prisma.user.delete({ where: { id: gone.user.id } });
    const res = await request(app).get("/api/tests").set("Authorization", gone.auth);
    expect(res.status).toBe(401);
  });

  it("401 for tokens issued before a password reset (tokenVersion bump)", async () => {
    await createUser("STUDENT", "resetme");
    const login = await request(app).post("/api/auth/login").send({ login: "resetme", password: PASSWORD });
    const auth = `Bearer ${login.body.token}`;
    expect((await request(app).get("/api/auth/me").set("Authorization", auth)).status).toBe(200);
    await prisma.user.update({ where: { login: "resetme" }, data: { tokenVersion: { increment: 1 } } });
    const res = await request(app).get("/api/auth/me").set("Authorization", auth);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Сессия устарела. Войдите снова.");
  });

  it("uses the current role from the DB, not the one in the token", async () => {
    const demoted = await createUser("ADMIN", "demoted");
    await prisma.user.update({ where: { id: demoted.user.id }, data: { role: "STUDENT" } });
    const res = await request(app).get("/api/students").set("Authorization", demoted.auth);
    expect(res.status).toBe(403);
  });
});

describe("error responses", () => {
  it("400 in Russian for malformed JSON, 413 for a huge body — not 500", async () => {
    const bad = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send("{bad");
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("Некорректный JSON в теле запроса.");

    const big = await request(app).post("/api/auth/login").send({ login: "x".repeat(3_000_000), password: "p" });
    expect(big.status).toBe(413);
    expect(big.body.error).toBe("Слишком большой запрос.");
  });

  it("400 for an undecodable URL parameter", async () => {
    const res = await request(app).get("/api/tests/%E0%A4%A").set("Authorization", admin.auth);
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
  });

  it("JSON 404 for unknown API routes", async () => {
    const res = await request(app).get("/api/definitely-not-here");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Метод API не найден.");
  });

  it("zod errors: first issue in Russian as `error`, details kept", async () => {
    const res = await request(app).post("/api/auth/login").send({ login: 5, password: "x" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/[а-яА-Я]/);
    expect(res.body.details.fieldErrors.login).toBeDefined();
  });

  it("404 for PATCH/DELETE of a missing test (Prisma P2025)", async () => {
    expect((await request(app).patch("/api/tests/nope/publish").set("Authorization", admin.auth).send({ isPublished: true })).status).toBe(404);
    expect((await request(app).delete("/api/tests/nope").set("Authorization", admin.auth)).status).toBe(404);
  });
});
