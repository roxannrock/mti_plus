export interface ScoredQuestion {
  questionId: string;
  section: string;
  correctKeys: string[];
  selectedKeys: string[];
}

export interface SectionStat {
  correct: number;
  total: number;
}

export interface ScoreResult {
  totalCount: number;
  correctCount: number;
  scorePercent: number;
  passed: boolean;
  sectionStats: Record<string, SectionStat>;
  perQuestion: { questionId: string; isCorrect: boolean }[];
}

function sameKeys(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, idx) => value === sortedB[idx]);
}

export function scoreAttempt(questions: ScoredQuestion[], passPercent: number): ScoreResult {
  const sectionStats: Record<string, SectionStat> = {};
  const perQuestion: { questionId: string; isCorrect: boolean }[] = [];

  let correctCount = 0;

  for (const q of questions) {
    const isCorrect = sameKeys(q.correctKeys, q.selectedKeys);
    if (isCorrect) correctCount += 1;

    const stat = sectionStats[q.section] ?? { correct: 0, total: 0 };
    stat.total += 1;
    if (isCorrect) stat.correct += 1;
    sectionStats[q.section] = stat;

    perQuestion.push({ questionId: q.questionId, isCorrect });
  }

  const totalCount = questions.length;
  const scorePercent = totalCount === 0 ? 0 : Math.round((correctCount / totalCount) * 10000) / 100;

  return {
    totalCount,
    correctCount,
    scorePercent,
    // Compare the exact ratio, not the rounded percentage (69.996 must not pass 70).
    // correctCount*100 is an exact integer; the epsilon absorbs float noise in
    // passPercent*totalCount (e.g. 33.33 * 3).
    passed:
      totalCount === 0 ? passPercent <= 0 : correctCount * 100 >= passPercent * totalCount - 1e-9,
    sectionStats,
    perQuestion,
  };
}
