// Bulk-creates student accounts from a CSV file (`логин,фио,пароль`, the same
// format and code path as the admin panel's «Студенты» → import). Empty
// passwords are generated; the resulting logins and passwords are written to
// a credentials CSV to hand out. Existing logins are skipped — their
// passwords are never changed.
//
// Run with: npm run seed:students -- path/to/students.csv [--out credentials.csv]
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "./db/prisma";
import { createStudents, credentialsCsv, parseStudentsCsv } from "./lib/studentsCsv";

const USAGE = "Usage: npm run seed:students -- path/to/students.csv [--out credentials.csv]";

// `npm run` switches cwd to backend/; resolve relative paths against the
// directory the command was typed in, which npm exposes as INIT_CWD.
const baseDir = process.env.INIT_CWD ?? process.cwd();

function parseArgs(argv: string[]) {
  let input: string | undefined;
  let out: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--out" || arg === "-o") out = argv[++i];
    else if (arg.startsWith("--out=")) out = arg.slice("--out=".length);
    else if (arg === "--help" || arg === "-h") return null;
    else if (!input) input = arg;
    else throw new Error(`Unexpected argument: ${arg}\n${USAGE}`);
  }
  if (!input) return null;
  const inputPath = path.resolve(baseDir, input);
  const outPath = out
    ? path.resolve(baseDir, out)
    : path.join(path.dirname(inputPath), `${path.basename(inputPath, path.extname(inputPath))}-credentials.csv`);
  return { inputPath, outPath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }
  const { inputPath, outPath } = args;

  // Refuse up front: overwriting an earlier credentials file would lose the
  // only copy of passwords that can't be recovered from the DB.
  if (existsSync(outPath)) throw new Error(`Output file already exists, not overwriting: ${outPath}`);

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(inputPath));
  } catch (err) {
    if (err instanceof TypeError) throw new Error(`${inputPath} is not valid UTF-8. Save it as "CSV UTF-8".`);
    throw err;
  }

  const { rows, issues } = parseStudentsCsv(text);
  if (issues.length > 0) {
    console.error(`Nothing imported — fix these errors in ${inputPath}:`);
    for (const issue of issues) console.error(`  строка ${issue.line}: ${issue.message}`);
    process.exitCode = 1;
    return;
  }

  const { created, skipped } = await createStudents(rows);
  for (const s of skipped) console.log(`Skipped line ${s.line} (${s.login}): ${s.reason}`);
  for (const s of created) console.log(`Created student ${s.login}${s.generated ? " (generated password)" : ""}`);

  if (created.length > 0) {
    writeFileSync(outPath, credentialsCsv(created), { encoding: "utf8", mode: 0o600 });
    console.log(`\n${created.length} created, ${skipped.length} skipped. Credentials written to ${outPath}`);
  } else {
    console.log(`\nNo new students (${skipped.length} skipped). No credentials file written.`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
