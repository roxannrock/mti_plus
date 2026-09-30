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

interface TestBase {
  id: string;
  title: string;
  description: string | null;
  passPercent: number;
  maxAttempts: number | null;
  timeLimitMinutes: number | null;
  createdAt: string;
}

/** GET /tests (student list). */
export interface TestSummary extends TestBase {
  /** finished attempts by the current student */
  myAttempts: number;
  _count: { questions: number };
}

/** GET /tests/:id (student) — no counts, no correct keys. */
export interface TestDetail extends TestBase {
  questions: Question[];
}

export interface SectionStat {
  correct: number;
  total: number;
}

export type AnswerMap = Record<string, string[]>;

export interface StartedAttempt {
  id: string;
  testId: string;
  startedAt: string;
  deadlineAt: string | null;
  draftAnswers: AnswerMap;
  finishedAt: string | null;
  serverNow: string;
}

/** GET /attempts/active and the `active` field of /attempts/status. */
export interface ActiveAttempt {
  id: string;
  testId: string;
  startedAt: string;
  deadlineAt: string | null;
}

export interface AttemptStatus {
  active: ActiveAttempt | null;
  finishedCount: number;
  /** set when this request closed a timed-out attempt — show its result */
  expiredAttemptId: string | null;
}

export interface SubmitResult {
  attemptId: string;
  /** true when the submit came after the deadline and the autosaved draft was scored */
  expired: boolean;
  totalCount: number;
  correctCount: number;
  scorePercent: number;
  passed: boolean;
  sectionStats: Record<string, SectionStat>;
}

export interface AttemptHistoryItem {
  id: string;
  testId: string;
  finishedAt: string;
  totalCount: number;
  correctCount: number;
  scorePercent: number;
  passed: boolean;
  /** pass mark when scored; null for attempts from before snapshots existed */
  passPercentAtFinish: number | null;
  sectionStats: Record<string, SectionStat>;
  test: { title: string; passPercent: number };
}

export interface ReviewAnswer {
  id: string;
  questionId: string;
  selectedKeys: string[];
  isCorrect: boolean;
  /** only present when correct answers may be shown */
  correctKeys?: string[];
  question: {
    id: string;
    order: number;
    section: string;
    prompt: string;
    options: Option[];
  };
}

/** GET /attempts/:id — for an unfinished attempt scores are null and answers empty. */
export interface AttemptDetail {
  id: string;
  testId: string;
  startedAt: string;
  deadlineAt: string | null;
  finishedAt: string | null;
  totalCount: number | null;
  correctCount: number | null;
  scorePercent: number | null;
  passed: boolean | null;
  passPercentAtFinish?: number | null;
  sectionStats: Record<string, SectionStat> | null;
  /** true while the student can still retake — the key is withheld */
  correctAnswersHidden?: boolean;
  test: { title: string; passPercent: number };
  answers: ReviewAnswer[];
}
