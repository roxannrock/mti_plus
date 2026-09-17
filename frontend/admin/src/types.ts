export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: "ADMIN" | "STUDENT";
}

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
  language: string;
  isPublished: boolean;
  createdAt: string;
  createdBy: { fullName: string };
  _count: { questions: number; attempts: number };
}

export interface TestDetail extends TestSummary {
  mdSource: string;
  questions: Question[];
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
    language: string;
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
  startedAt: string;
  finishedAt: string;
  totalCount: number;
  correctCount: number;
  scorePercent: number;
  passed: boolean;
  sectionStats: Record<string, SectionStat>;
  student: { id: string; fullName: string; email: string };
}

export interface ParticipantDetail extends Participant {
  test?: { title: string; passPercent: number };
  answers: {
    id: string;
    selectedKeys: string[];
    isCorrect: boolean;
    question: Question;
  }[];
}
