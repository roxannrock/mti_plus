import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { rateLimit, ipKeyGenerator, type RateLimitInfo } from "express-rate-limit";
import { prisma } from "../db/prisma";
import { env } from "../config/env";
import { asyncHandler, HttpError } from "../middleware/errorHandler";
import { requireAuth } from "../middleware/auth";

export const authRouter = Router();

const loginSchema = z.object({
  // Logins are stored lowercase, so "Ivanov" and "ivanov" are the same user.
  login: z.string().trim().toLowerCase().min(1),
  password: z.string().min(1),
});

// Brute-force protection: at most 10 *failed* logins per IP+login in 15
// minutes (successful ones are not counted). Keyed on the login too so one
// student guessing wrong doesn't lock out a whole classroom behind one NAT.
// In-memory store: fine for a single API process, resets on restart.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function pluralMinutes(n: number) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "минуту";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "минуты";
  return "минут";
}

function tooManyAttempts(req: Request, res: Response) {
  const resetTime = (req as Request & { rateLimit?: RateLimitInfo }).rateLimit?.resetTime;
  const msLeft = resetTime ? resetTime.getTime() - Date.now() : LOGIN_WINDOW_MS;
  const minutes = Math.max(1, Math.ceil(msLeft / 60_000));
  res.status(429).json({ error: `Слишком много попыток входа. Попробуйте через ${minutes} ${pluralMinutes(minutes)}.` });
}

const loginLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MS,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator(req) {
    const rawLogin: unknown = req.body?.login;
    const login = typeof rawLogin === "string" ? rawLogin.trim().toLowerCase() : "";
    return `${ipKeyGenerator(req.ip ?? "unknown")}|${login}`;
  },
  handler: tooManyAttempts,
});

// Second line of defence against password spraying (one password tried on
// many logins): at most 50 failed logins per IP in 15 minutes, whatever the
// login. Generous enough for a classroom behind one NAT address. Runs after
// the per-login limiter, so requests that one already refused don't count.
const ipLoginLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MS,
  limit: 50,
  skipSuccessfulRequests: true,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown"),
  handler: tooManyAttempts,
});

// Compared against when the login doesn't exist, so a wrong login costs the
// same bcrypt time as a wrong password and response timing doesn't reveal
// which logins exist. Cost 10 = the cost of imported student hashes, which
// are the overwhelming majority of accounts (see studentsCsv.ts).
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", 10);

authRouter.post(
  "/login",
  loginLimiter,
  ipLoginLimiter,
  asyncHandler(async (req, res) => {
    const { login, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { login } });
    const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid) throw new HttpError(401, "Неверный логин или пароль.");

    // tv lets a password reset (tokenVersion bump) revoke this token.
    const token = jwt.sign({ userId: user.id, role: user.role, tv: user.tokenVersion }, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN,
    } as jwt.SignOptions);

    res.json({
      token,
      user: { id: user.id, login: user.login, fullName: user.fullName, role: user.role },
    });
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } });
    if (!user) throw new HttpError(404, "Пользователь не найден.");
    res.json({ id: user.id, login: user.login, fullName: user.fullName, role: user.role });
  }),
);
