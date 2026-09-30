// Own file on purpose: the login limiter keeps its counters in memory per app
// instance, and vitest gives every test file a fresh module graph.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app";
import { createUser, PASSWORD, prisma, resetDb } from "../helpers";

beforeAll(async () => {
  await resetDb();
  await createUser("STUDENT", "victim");
  await createUser("STUDENT", "bystander");
  await createUser("STUDENT", "sprayed");
});
afterAll(() => prisma.$disconnect());

describe("login rate limit", () => {
  it("returns 429 after 10 failed logins for the same IP+login, even with the right password", async () => {
    for (let i = 0; i < 10; i++) {
      // Case/whitespace variations must count towards the same key.
      const login = i % 2 === 0 ? "victim" : "  VICTIM ";
      const res = await request(app).post("/api/auth/login").send({ login, password: "wrong-pass" });
      expect(res.status).toBe(401);
    }
    const blocked = await request(app).post("/api/auth/login").send({ login: "victim", password: PASSWORD });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/Слишком много попыток входа/);
  });

  it("does not block other logins from the same IP", async () => {
    const res = await request(app).post("/api/auth/login").send({ login: "bystander", password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it("does not count successful logins", async () => {
    for (let i = 0; i < 12; i++) {
      const res = await request(app).post("/api/auth/login").send({ login: "bystander", password: PASSWORD });
      expect(res.status).toBe(200);
    }
  });

  it("ignores a forged X-Forwarded-For outside production (trust proxy off)", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", `203.0.113.${i}`)
        .send({ login: "spoofer", password: "wrong-pass" });
      expect(res.status).toBe(401);
    }
    const blocked = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", "198.51.100.77")
      .send({ login: "spoofer", password: "wrong-pass" });
    expect(blocked.status).toBe(429);
  });

  // Last on purpose: after this the whole IP is blocked for this file's app.
  it("blocks password spraying: 50 failed logins per IP, whatever the login", async () => {
    // Earlier tests already spent part of this IP's budget (requests refused
    // by the per-login limiter never reach the IP limiter), so fewer than 50
    // new failures are needed here.
    let status = 0;
    let failures = 0;
    for (let i = 0; i < 60 && status !== 429; i++) {
      const res = await request(app).post("/api/auth/login").send({ login: `spray${i}`, password: "wrong-pass" });
      status = res.status;
      if (status === 401) failures += 1;
    }
    expect(status).toBe(429);
    expect(failures).toBeLessThan(50);
    // Now even a correct password for an untouched login is refused from this IP.
    const res = await request(app).post("/api/auth/login").send({ login: "sprayed", password: PASSWORD });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/Слишком много попыток входа/);
  });
});
