// Parses the platform's test-authoring Markdown format into structured
// questions. The format (documented in docs/md-template-spec.md):
//
// ---
// title: Test title
// description: optional free text
// pass_percent: 70
// language: ru        (optional, free text — "ru"/"uz"/"en"/..., defaults to "ru")
// ---
//
// ## Q1 [Section Name]
// Question prompt text, may wrap
// across multiple lines.
//
// - [x] Correct option
// - [ ] Wrong option
// - [ ] Wrong option
// - [ ] Wrong option
//
// Sections are free-form text (never a hardcoded enum) so the same parser
// works for any subject. Multiple `[x]` marks in one question make it a
// multi-select question.

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
  language: string;
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

const OPTION_KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function parseFrontMatter(block: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const rawLine of block.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    fields[key] = value;
  }
  return fields;
}

export function parseTestMarkdown(source: string): ParseResult {
  const issues: ParseIssue[] = [];
  const normalized = source.replace(/\r\n/g, "\n").trim();

  const frontMatterMatch = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!frontMatterMatch) {
    issues.push({ line: 1, message: "Не найден front matter (блок между --- и ---) с title/pass_percent." });
    return { test: null, issues };
  }

  const frontMatter = parseFrontMatter(frontMatterMatch[1] ?? "");
  const body = normalized.slice(frontMatterMatch[0].length);

  const title = frontMatter.title?.trim();
  if (!title) {
    issues.push({ line: 1, message: "В front matter отсутствует title." });
  }

  const passPercentRaw = frontMatter.pass_percent;
  const passPercent = Number(passPercentRaw);
  if (!passPercentRaw || Number.isNaN(passPercent) || passPercent <= 0 || passPercent > 100) {
    issues.push({ line: 1, message: "В front matter pass_percent должен быть числом от 1 до 100." });
  }

  const description = frontMatter.description?.trim() || null;
  const language = frontMatter.language?.trim() || "ru";

  const lines = body.split("\n");
  const questionBlocks: { headingLine: number; section: string; lines: string[] }[] = [];

  const headingPattern = /^##\s+Q\d+\s*\[(.+?)\]\s*$/;

  let current: { headingLine: number; section: string; lines: string[] } | null = null;
  lines.forEach((line, idx) => {
    const lineNumber = idx + frontMatterMatch[0].split("\n").length;
    const headingMatch = line.match(headingPattern);
    if (headingMatch) {
      if (current) questionBlocks.push(current);
      current = { headingLine: lineNumber, section: (headingMatch[1] ?? "").trim(), lines: [] };
      return;
    }
    if (current) current.lines.push(line);
  });
  if (current) questionBlocks.push(current);

  if (questionBlocks.length === 0) {
    issues.push({
      line: 1,
      message: "Не найдено ни одного вопроса. Заголовок вопроса должен быть в формате: ## Q1 [Раздел]",
    });
  }

  const questions: ParsedQuestion[] = [];

  questionBlocks.forEach((block, index) => {
    const optionLines: string[] = [];
    const promptLines: string[] = [];
    for (const line of block.lines) {
      if (/^\s*-\s*\[[ xX]\]/.test(line)) {
        optionLines.push(line);
      } else if (line.trim().length > 0) {
        promptLines.push(line.trim());
      }
    }

    const prompt = promptLines.join(" ").trim();
    if (!prompt) {
      issues.push({ line: block.headingLine, message: `Вопрос №${index + 1}: пустой текст вопроса.` });
    }

    if (!block.section) {
      issues.push({ line: block.headingLine, message: `Вопрос №${index + 1}: не указан раздел в [Section].` });
    }

    const options: ParsedOption[] = [];
    const correctKeys: string[] = [];

    optionLines.forEach((line, optIdx) => {
      const match = line.match(/^\s*-\s*\[([ xX])\]\s*(.+)$/);
      if (!match) return;
      const isCorrect = (match[1] ?? "").toLowerCase() === "x";
      const text = (match[2] ?? "").trim();
      const key = OPTION_KEYS[optIdx] ?? String(optIdx + 1);
      options.push({ key, text });
      if (isCorrect) correctKeys.push(key);
    });

    if (options.length < 2) {
      issues.push({
        line: block.headingLine,
        message: `Вопрос №${index + 1}: нужно минимум 2 варианта ответа в формате "- [ ] текст".`,
      });
    }

    if (correctKeys.length === 0) {
      issues.push({
        line: block.headingLine,
        message: `Вопрос №${index + 1}: не отмечен правильный ответ (используйте "- [x] текст").`,
      });
    }

    questions.push({
      order: index + 1,
      section: block.section,
      prompt,
      options,
      correctKeys,
    });
  });

  if (issues.length > 0 || !title || Number.isNaN(passPercent)) {
    return { test: null, issues };
  }

  return {
    test: {
      title,
      description,
      passPercent,
      language,
      questions,
    },
    issues: [],
  };
}
