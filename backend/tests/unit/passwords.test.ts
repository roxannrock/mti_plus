import { describe, expect, it } from "vitest";
import { generatePassword, GENERATED_PASSWORD_LENGTH } from "../../src/lib/passwords";

describe("generatePassword", () => {
  it("has the default length and only unambiguous characters", () => {
    for (let i = 0; i < 200; i++) {
      const p = generatePassword();
      expect(p).toHaveLength(GENERATED_PASSWORD_LENGTH);
      expect(p).toMatch(/^[a-km-np-zA-HJ-NP-Z2-9]+$/);
      expect(p).not.toMatch(/[01lIoO]/);
    }
  });

  it("respects a custom length", () => {
    expect(generatePassword(24)).toHaveLength(24);
  });

  it("produces different passwords", () => {
    const set = new Set(Array.from({ length: 100 }, () => generatePassword()));
    expect(set.size).toBe(100);
  });
});
