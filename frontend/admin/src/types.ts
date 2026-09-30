export interface Option {
  key: string;
  text: string;
}

export interface Question {
  id: string;
  order: number;
  section: string;
  prompt: string;
  options: Option[];
  correctKeys?: string[];
}

export interface TestSummary {
  id: string;
  title: string;
  description: string | null;
  passPercent: number;
  isPublished: boolean;
  maxAttempts: number | null;
  timeLimitMinutes: number | null;
  archivedAt: string | null;
  createdAt: string;
  createdBy: { fullName: string };
  // attempts = all incl. in progress (decides delete vs archive)
  _count: { questions: number; attempts: number };
  finishedAttempts: number;
}

export interface TestDetail extends TestSummary {
  questions: Question[];
}

export interface TestSettings {
  title?: string;
  description?: string | null;
  passPercent?: number;
  maxAttempts?: number | null;
  timeLimitMinutes?: number | null;
}

export interface QuestionUpdate {
  section: string;
  prompt: string;
  options: Option[];
  correctKeys: string[];
}

export interface ParsedQuestionPreview {
  order: number;
  section: string;
  prompt: string;
  options: Option[];
  correctKeys: string[];
}

export interface ParsePreviewResult {
  test: {
    title: string;
    description: string | null;
    passPercent: number;
    questions: ParsedQuestionPreview[];
  } | null;
  issues: { line: number; message: string }[];
}

export interface SectionStat {
  correct: number;
  total: number;
}

export interface Participant {
  id: string;
  attemptNumber: number;
  startedAt: string;
  finishedAt: string;
  totalCount: number;
  correctCount: number;
  scorePercent: number;
  passed: boolean;
  sectionStats: Record<string, SectionStat>;
  student: { id: string; fullName: string; login: string };
}

export interface ParticipantDetail extends Omit<Participant, "attemptNumber"> {
  // Current pass mark; passPercentAtFinish is what the attempt was scored against.
  test: { title: string; passPercent: number };
  passPercentAtFinish: number | null;
  answers: {
    id: string;
    selectedKeys: string[];
    isCorrect: boolean;
    // Correct keys at scoring time (null for rows scored before snapshots existed).
    correctKeysAtFinish: string[] | null;
    question: Question;
  }[];
}
