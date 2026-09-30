import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { hashPasswords } from "../../src/lib/hashPool";

describe("hashPasswords", () => {
  it("returns valid hashes in input order (worker-thread path)", async () => {
    const passwords = Array.from({ length: 24 }, (_, i) => `password-${i}`);
    const hashes = await hashPasswords(passwords, 4);
    expect(hashes).toHaveLength(passwords.length);
    for (let i = 0; i < passwords.length; i++) {
      expect(bcrypt.compareSync(passwords[i]!, hashes[i]!)).toBe(true);
    }
    expect(bcrypt.getRounds(hashes[0]!)).toBe(4);
  });

  it("handles small and empty batches on the main thread", async () => {
    expect(await hashPasswords([], 4)).toEqual([]);
    const [h] = await hashPasswords(["one"], 4);
    expect(bcrypt.compareSync("one", h!)).toBe(true);
  });
});
