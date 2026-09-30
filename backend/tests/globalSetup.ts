// Runs once before the whole suite: makes sure the test database exists and
// is migrated. Refuses to touch anything that isn't a *_test database.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { Client } from "pg";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://mti:mti_dev_pw@localhost:5433/mti_exam_test?schema=public";
  const parsed = new URL(url);
  const dbName = parsed.pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) {
    throw new Error(`Refusing to run tests against "${dbName}": the test database name must end with _test.`);
  }

  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  adminUrl.search = "";
  const client = new Client({ connectionString: adminUrl.toString() });
  try {
    await client.connect();
  } catch (err) {
    throw new Error(`Cannot connect to PostgreSQL at ${adminUrl.host} — is the dev container up (make db-up)?\n${String(err)}`);
  }
  try {
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
  } finally {
    await client.end();
  }

  const backendDir = path.resolve(__dirname, "..");
  execFileSync("npx", ["prisma", "migrate", "deploy", "--config", "prisma7.config.ts"], {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
