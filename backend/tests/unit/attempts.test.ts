import { describe, expect, it } from "vitest";
import { isPastGrace, normalizeAnswers, SUBMIT_GRACE_MS } from "../../src/lib/attempts";

const options = [
  { key: "A", text: "a" },
  { key: "B", text: "b" },
  { key: "C", text: "c" },
];
const questions = [
  { id: "single", section: "S", options, correctKeys: ["B"] },
  { id: "multi", section: "S", options, correctKeys: ["A", "C"] },
];

describe("normalizeAnswers", () => {
  it("keeps valid, partial and empty answers as they are", () => {
    expect(normalizeAnswers(questions, {})).toEqual({});
    expect(normalizeAnswers(questions, { single: ["A"], multi: ["A", "B", "C"] })).toEqual({
      single: ["A"],
      multi: ["A", "B", "C"],
    });
    expect(normalizeAnswers(questions, { single: [], multi: [] })).toEqual({ single: [], multi: [] });
  });

  // A question may be edited while an attempt is open — never reject, just fit.
  it("ignores unknown questions", () => expect(normalizeAnswers(questions, { nope: ["A"] })).toEqual({}));
  it("drops keys that are not options", () =>
    expect(normalizeAnswers(questions, { multi: ["A", "Z"] })).toEqual({ multi: ["A"] }));
  it("collapses duplicate keys", () =>
    expect(normalizeAnswers(questions, { multi: ["A", "A"] })).toEqual({ multi: ["A"] }));
  it("keeps several keys on a single-answer question (scored as wrong)", () =>
    expect(normalizeAnswers(questions, { single: ["A", "B"] })).toEqual({ single: ["A", "B"] }));
  it("tolerates garbage from a stored draft", () => {
    expect(normalizeAnswers(questions, null)).toEqual({});
    expect(normalizeAnswers(questions, { single: "B", multi: [1, "C"] })).toEqual({ single: [], multi: ["C"] });
  });
});

describe("isPastGrace", () => {
  it("is false without a deadline and within the grace period", () => {
    const now = Date.now();
    expect(isPastGrace(null, now)).toBe(false);
    expect(isPastGrace(new Date(now - SUBMIT_GRACE_MS + 1000), now)).toBe(false);
    expect(isPastGrace(new Date(now - SUBMIT_GRACE_MS - 1000), now)).toBe(true);
  });
});
