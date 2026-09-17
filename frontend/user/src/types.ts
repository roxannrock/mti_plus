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
  isMultiple: boolean;
}

export interface TestSummary {
  id: string;
  title: string;
  description: string | null;
  passPercent: number;
  createdAt: string;
  _count: { questions: number };
}

export interface TestDetail extends TestSummary {
  questions: Question[];
}

export interface SectionStat {
  correct: number;
  total: number;
}

export interface SubmitResult {
  totalCount: number;
  correctCount: number;
  scorePercent: number;
  passed: boolean;
  sectionStats: Record<string, SectionStat>;
}

export interface AttemptHistoryItem {
  id: string;
  finishedAt: string;
  totalCount: number;
  correctCount: number;
  scorePercent: number;
  passed: boolean;
  sectionStats: Record<string, SectionStat>;
  test: { title: string; passPercent: number };
}
