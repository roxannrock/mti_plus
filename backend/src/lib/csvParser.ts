// Parses the platform's test CSV format into structured questions. The
// format (documented in docs/csv-template-spec.md) is UTF-8, comma
// separated, with a header row:
//
// раздел,вопрос,A,B,C,D,E,ответ
// Networking,Какой порт у HTTPS?,21,80,443,22,,C
// Hardware,Что из этого — память?,CPU,RAM,SSD,GPU,,"B,C"
//
// The first column is the section, the second the question, the last the
// correct answer(s), and every column in between is an option (2–26 of
// them; empty cells are skipped). Answers are option letters (A, B, ...)
// or numbers (1, 2, ...); several answers make it a multi-select question.
// Title and pass percent are not part of the file — the admin sets them in
// the upload form.

export interface ParsedOption {
  key: string; // A, B, C, D, ...
  text: string;
}

export interface ParsedQuestion {
  order: number;
  section: string;
  prompt: string;
  options: ParsedOption[];
  correctKeys: string[];
}

export interface ParsedTest {
  title: string;
  description: string | null;
  passPercent: number;
  questions: ParsedQuestion[];
}

export interface ParseIssue {
  line: number;
  message: string;
}

export interface ParseResult {
  test: ParsedTest | null;
  issues: ParseIssue[];
}

export interface TestMeta {
  title: string;
  description: string | null;
  passPercent: number;
}

const OPTION_KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

interface CsvRow {
  line: number; // 1-based line in the file where the row starts
  cells: string[];
}

// RFC 4180: quoted fields may contain the delimiter, newlines and "" as an
// escaped quote.
function splitCsv(source: string, delimiter: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      cells.push(cell);
      cell = "";
    } else if (ch === "\n") {
      cells.push(cell);
      rows.push({ line: rowLine, cells });
      cells = [];
      cell = "";
      line++;
      rowLine = line;
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  rows.push({ line: rowLine, cells });

  return rows
    .map((row) => ({ ...row, cells: row.cells.map((c) => c.trim()) }))
    .filter((row) => row.cells.some((c) => c.length > 0));
}

// Excel with a Russian locale saves "CSV" with semicolons; accept that too
// so the admin doesn't have to fight their spreadsheet settings.
function detectDelimiter(source: string): string {
  const headerLine = source.split("\n", 1)[0] ?? "";
  return !headerLine.includes(",") && headerLine.includes(";") ? ";" : ",";
}

function parseAnswer(raw: string, optionCount: number): string[] | null {
  const tokens = raw.toUpperCase().split(/[\s,;/]+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const keys: string[] = [];
  for (const token of tokens) {
    let index: number;
    if (/^\d+$/.test(token)) index = Number(token) - 1;
    else if (/^[A-Z]$/.test(token)) index = OPTION_KEYS.indexOf(token);
    else return null;
    if (index < 0 || index >= optionCount) return null;
    const key = OPTION_KEYS[index]!;
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

export function parseTestCsv(source: string, meta: TestMeta): ParseResult {
  const issues: ParseIssue[] = [];
  const normalized = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n");

  if (normalized.includes("�")) {
    issues.push({ line: 1, message: "Файл не в кодировке UTF-8. Сохраните его как «CSV UTF-8»." });
    return { test: null, issues };
  }

  const rows = splitCsv(normalized, detectDelimiter(normalized));
  const [header, ...dataRows] = rows;

  if (!header || header.cells.length < 4) {
    issues.push({
      line: 1,
      message: "Первая строка должна быть заголовком: раздел,вопрос,A,B,...,ответ (минимум 4 колонки).",
    });
    return { test: null, issues };
  }
  if (dataRows.length === 0) {
    issues.push({ line: 2, message: "В файле нет ни одного вопроса." });
  }

  const columnCount = header.cells.length;
  const questions: ParsedQuestion[] = [];

  dataRows.forEach((row, index) => {
    const n = index + 1;
    if (row.cells.length > columnCount && row.cells.slice(columnCount).some(Boolean)) {
      issues.push({
        line: row.line,
        message: `Вопрос №${n}: колонок больше, чем в заголовке (${row.cells.length} > ${columnCount}). Возможно, текст с запятой не взят в кавычки.`,
      });
      return;
    }

    const cells = Array.from({ length: columnCount }, (_, i) => row.cells[i] ?? "");
    const section = cells[0]!;
    const prompt = cells[1]!;
    const answerRaw = cells[columnCount - 1]!;
    const optionCells = cells.slice(2, columnCount - 1);

    if (!section) issues.push({ line: row.line, message: `Вопрос №${n}: не указан раздел.` });
    if (!prompt) issues.push({ line: row.line, message: `Вопрос №${n}: пустой текст вопроса.` });

    // Keys follow the column position, so an answer "C" always means the
    // third option column even if an earlier one is left empty.
    const options: ParsedOption[] = [];
    optionCells.forEach((text, i) => {
      if (text) options.push({ key: OPTION_KEYS[i]!, text });
    });
    if (options.length < 2) {
      issues.push({ line: row.line, message: `Вопрос №${n}: нужно минимум 2 варианта ответа.` });
    }

    const correctKeys = parseAnswer(answerRaw, optionCells.length);
    if (!answerRaw) {
      issues.push({ line: row.line, message: `Вопрос №${n}: не указан правильный ответ.` });
    } else if (!correctKeys || correctKeys.some((key) => !options.some((o) => o.key === key))) {
      issues.push({
        line: row.line,
        message: `Вопрос №${n}: ответ «${answerRaw}» не соответствует заполненным вариантам (ожидается буква A–${OPTION_KEYS[optionCells.length - 1]} или номер).`,
      });
    }

    questions.push({ order: n, section, prompt, options, correctKeys: correctKeys ?? [] });
  });

  const title = meta.title.trim();
  if (!title) issues.push({ line: 1, message: "Не указано название теста." });
  if (!Number.isInteger(meta.passPercent) || meta.passPercent < 1 || meta.passPercent > 100) {
    issues.push({ line: 1, message: "Проходной балл должен быть целым числом от 1 до 100." });
  }

  if (issues.length > 0) return { test: null, issues };

  return {
    test: { title, description: meta.description?.trim() || null, passPercent: meta.passPercent, questions },
    issues: [],
  };
}
