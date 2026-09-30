import { defineConfig } from "vitest/config";

// Integration tests run against a separate database in the dev container —
// never the dev database `mti_exam`. tests/globalSetup.ts creates it and
// applies the migrations; override with TEST_DATABASE_URL if needed.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://mti:mti_dev_pw@localhost:5433/mti_exam_test?schema=public";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/globalSetup.ts"],
    // Set before any src module is imported: config/env.ts loads dotenv, which
    // never overrides variables that are already present.
    env: {
      NODE_ENV: "test",
      DATABASE_URL: TEST_DATABASE_URL,
      JWT_SECRET: "test-secret-at-least-16-chars",
      JWT_EXPIRES_IN: "1h",
      CORS_ORIGINS: "http://localhost:5173",
    },
    // All integration files share one database and truncate it in beforeAll,
    // so files must not run concurrently.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
