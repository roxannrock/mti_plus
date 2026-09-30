import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseTestCsv, type TestMeta } from "../../src/lib/csvParser";

const meta: TestMeta = { title: "Тест", description: null, passPercent: 70 };
const HEADER = "раздел,вопрос,A,B,C,D,ответ";

function parse(body: string, m: Partial<TestMeta> = {}) {
  return parseTestCsv(body, { ...meta, ...m });
}

describe("parseTestCsv", () => {
  it("parses the example CompTIA file with 90 questions and no issues", () => {
    const csv = readFileSync(path.resolve(__dirname, "../../../docs/example-comptia-a-plus.csv"), "utf8");
    const { test, issues } = parse(csv);
    expect(issues).toEqual([]);
    expect(test?.questions).toHaveLength(90);
    expect(test?.questions.map((q) => q.order)).toEqual(Array.from({ length: 90 }, (_, i) => i + 1));
    for (const q of test!.questions) {
      expect(q.options.length).toBeGreaterThanOrEqual(2);
      expect(q.correctKeys.length).toBeGreaterThanOrEqual(1);
      for (const k of q.correctKeys) expect(q.options.some((o) => o.key === k)).toBe(true);
    }
  });

  it("handles quoted commas, newlines and \"\" escapes", () => {
    const csv = [
      HEADER,
      'Net,"Порт, который ""слушает""\nHTTPS?",21,80,443,22,C',
      "Hw,Что это?,CPU,RAM,,,B",
    ].join("\n");
    const { test, issues } = parse(csv);
    expect(issues).toEqual([]);
    expect(test!.questions[0]).toEqual({
      order: 1,
      section: "Net",
      prompt: 'Порт, который "слушает"\nHTTPS?',
      options: [
        { key: "A", text: "21" },
        { key: "B", text: "80" },
        { key: "C", text: "443" },
        { key: "D", text: "22" },
      ],
      correctKeys: ["C"],
    });
    expect(test!.questions[1]!.options).toEqual([
      { key: "A", text: "CPU" },
      { key: "B", text: "RAM" },
    ]);
  });

  it("strips a BOM and accepts CRLF line endings", () => {
    const csv = `﻿${HEADER}\r\nNet,Q1,a,b,c,d,A\r\nNet,Q2,a,b,c,d,B\r\n`;
    const { test, issues } = parse(csv);
    expect(issues).toEqual([]);
    expect(test!.questions).toHaveLength(2);
    expect(test!.questions[0]!.section).toBe("Net");
    expect(test!.questions[1]!.correctKeys).toEqual(["B"]);
  });

  it("falls back to ; as the delimiter", () => {
    const csv = "раздел;вопрос;A;B;C;ответ\nNet;Порт, HTTPS?;21;80;443;C";
    const { test, issues } = parse(csv);
    expect(issues).toEqual([]);
    expect(test!.questions[0]!.prompt).toBe("Порт, HTTPS?");
    expect(test!.questions[0]!.correctKeys).toEqual(["C"]);
  });

  it("parses multi-answer and numeric answers", () => {
    const csv = [HEADER, 'S,Q1,a,b,c,d,"A,C"', "S,Q2,a,b,c,d,2", 'S,Q3,a,b,c,d,"1, 4"', "S,Q4,a,b,c,d,b"].join("\n");
    const { test, issues } = parse(csv);
    expect(issues).toEqual([]);
    expect(test!.questions.map((q) => q.correctKeys)).toEqual([["A", "C"], ["B"], ["A", "D"], ["B"]]);
  });

  it("uses trimmed title/description and passes passPercent through", () => {
    const { test } = parse(`${HEADER}\nS,Q,a,b,,,A`, { title: "  T  ", description: "  d ", passPercent: 100 });
    expect(test).toMatchObject({ title: "T", description: "d", passPercent: 100 });
  });

  describe("errors", () => {
    it("reports too many columns with the row's line number", () => {
      const csv = [HEADER, "S,Q1,a,b,c,d,A", "S,Q2 with, comma,a,b,c,d,A"].join("\n");
      const { test, issues } = parse(csv);
      expect(test).toBeNull();
      expect(issues).toHaveLength(1);
      expect(issues[0]!.line).toBe(3);
      expect(issues[0]!.message).toMatch(/колонок больше/);
    });

    it("counts physical lines through quoted newlines", () => {
      const csv = [HEADER, 'S,"multi\nline\nprompt",a,b,c,d,A', "S,Q2,a,,,,A"].join("\n");
      const { issues } = parse(csv);
      expect(issues).toEqual([{ line: 5, message: expect.stringMatching(/минимум 2 варианта/) }]);
    });

    it("rejects an answer pointing at an empty option", () => {
      const { test, issues } = parse(`${HEADER}\nS,Q1,a,b,c,d,A\nS,Q2,a,b,,d,C`);
      expect(test).toBeNull();
      expect(issues).toEqual([{ line: 3, message: expect.stringMatching(/ответ «C» не соответствует/) }]);
    });

    it("rejects an out-of-range or garbage answer and a missing answer", () => {
      const { issues } = parse(`${HEADER}\nS,Q1,a,b,c,d,5\nS,Q2,a,b,c,d,X1\nS,Q3,a,b,c,d,`);
      expect(issues.map((i) => i.line)).toEqual([2, 3, 4]);
      expect(issues[2]!.message).toMatch(/не указан правильный ответ/);
    });

    it("reports missing section and prompt", () => {
      const { issues } = parse(`${HEADER}\n,Q1,a,b,c,d,A\nS,,a,b,c,d,A`);
      expect(issues).toEqual([
        { line: 2, message: expect.stringMatching(/не указан раздел/) },
        { line: 3, message: expect.stringMatching(/пустой текст вопроса/) },
      ]);
    });

    it("requires at least 2 options", () => {
      const { issues } = parse(`${HEADER}\nS,Q1,only,,,,A`);
      expect(issues).toEqual([{ line: 2, message: expect.stringMatching(/минимум 2 варианта/) }]);
    });

    it("rejects an empty title", () => {
      const { test, issues } = parse(`${HEADER}\nS,Q1,a,b,,,A`, { title: "   " });
      expect(test).toBeNull();
      expect(issues).toEqual([{ line: 1, message: expect.stringMatching(/название/i) }]);
    });

    it.each([0, 101, 50.5, Number.NaN])("rejects passPercent %s", (passPercent) => {
      const { test, issues } = parse(`${HEADER}\nS,Q1,a,b,,,A`, { passPercent });
      expect(test).toBeNull();
      expect(issues).toEqual([{ line: 1, message: expect.stringMatching(/Проходной балл/) }]);
    });

    it("accepts passPercent bounds 1 and 100", () => {
      expect(parse(`${HEADER}\nS,Q1,a,b,,,A`, { passPercent: 1 }).issues).toEqual([]);
      expect(parse(`${HEADER}\nS,Q1,a,b,,,A`, { passPercent: 100 }).issues).toEqual([]);
    });

    it("detects non-UTF-8 input (U+FFFD)", () => {
      const { test, issues } = parse(`${HEADER}\nS,��,a,b,,,A`);
      expect(test).toBeNull();
      expect(issues).toEqual([{ line: 1, message: expect.stringMatching(/UTF-8/) }]);
    });

    it("rejects a too-short header and a file without questions", () => {
      expect(parse("раздел,вопрос,ответ\nS,Q,A").issues[0]).toMatchObject({ line: 1 });
      expect(parse(HEADER).issues).toEqual([{ line: 2, message: expect.stringMatching(/нет ни одного вопроса/) }]);
    });
  });
});
