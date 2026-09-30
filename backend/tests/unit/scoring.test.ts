import { describe, expect, it } from "vitest";
import { scoreAttempt } from "../../src/lib/scoring";

const q = (id: string, section: string, correctKeys: string[], selectedKeys: string[]) => ({
  questionId: id,
  section,
  correctKeys,
  selectedKeys,
});

describe("scoreAttempt", () => {
  it("scores exact matches only, order-insensitive", () => {
    const result = scoreAttempt(
      [
        q("1", "A", ["A"], ["A"]),
        q("2", "A", ["A", "C"], ["C", "A"]),
        q("3", "B", ["A", "C"], ["A"]), // partial = wrong
        q("4", "B", ["B"], []), // unanswered = wrong
        q("5", "B", ["B"], ["B", "C"]), // extra = wrong
      ],
      40,
    );
    expect(result.perQuestion).toEqual([
      { questionId: "1", isCorrect: true },
      { questionId: "2", isCorrect: true },
      { questionId: "3", isCorrect: false },
      { questionId: "4", isCorrect: false },
      { questionId: "5", isCorrect: false },
    ]);
    expect(result).toMatchObject({
      totalCount: 5,
      correctCount: 2,
      scorePercent: 40,
      passed: true,
      sectionStats: { A: { correct: 2, total: 2 }, B: { correct: 0, total: 3 } },
    });
  });

  it("rounds to two decimals and compares against passPercent", () => {
    const qs = [q("1", "S", ["A"], ["A"]), q("2", "S", ["A"], ["B"]), q("3", "S", ["A"], ["B"])];
    const r = scoreAttempt(qs, 34);
    expect(r.scorePercent).toBe(33.33);
    expect(r.passed).toBe(false);
    expect(scoreAttempt(qs, 33.33).passed).toBe(true);
  });

  it("compares the unrounded score (69.996% does not pass 70%)", () => {
    // 2333 of 3333 = 69.9969..% rounds to 70 but must fail
    const qs = Array.from({ length: 3333 }, (_, i) => q(String(i), "S", ["A"], i < 2333 ? ["A"] : []));
    const r = scoreAttempt(qs, 70);
    expect(r.scorePercent).toBe(70);
    expect(r.passed).toBe(false);
    // exact hit still passes, including float-unfriendly marks
    const seven = Array.from({ length: 10 }, (_, i) => q(String(i), "S", ["A"], i < 7 ? ["A"] : []));
    expect(scoreAttempt(seven, 70).passed).toBe(true);
    const third = [q("1", "S", ["A"], ["A"]), q("2", "S", ["A"], []), q("3", "S", ["A"], [])];
    expect(scoreAttempt(third, 100 / 3).passed).toBe(true);
  });

  it("handles an empty test", () => {
    expect(scoreAttempt([], 50)).toMatchObject({ totalCount: 0, correctCount: 0, scorePercent: 0, passed: false });
  });

  it("does not mutate the input arrays", () => {
    const correct = ["C", "A"];
    const selected = ["A", "C"];
    scoreAttempt([q("1", "S", correct, selected)], 50);
    expect(correct).toEqual(["C", "A"]);
    expect(selected).toEqual(["A", "C"]);
  });
});
