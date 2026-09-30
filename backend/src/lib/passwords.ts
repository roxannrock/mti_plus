import { randomInt } from "node:crypto";

// No 0/O/o, 1/l/I, etc. — these passwords get read off a printout or a
// spreadsheet and typed in by hand, so every character must be unambiguous.
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const GENERATED_PASSWORD_LENGTH = 10;

// crypto.randomInt is uniform (no modulo bias) and CSPRNG-backed.
// 10 chars from 55 symbols ≈ 57 bits — plenty behind a rate-limited login.
export function generatePassword(length = GENERATED_PASSWORD_LENGTH): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}
