import express from "express";
import cors from "cors";
import helmet from "helmet";
import { z } from "zod";
import { corsOrigins, isProduction, trustProxy } from "./config/env";
import { authRouter } from "./routes/auth.routes";
import { testsRouter } from "./routes/tests.routes";
import { attemptsRouter } from "./routes/attempts.routes";
import { studentsRouter } from "./routes/students.routes";
import { errorHandler } from "./middleware/errorHandler";

// Russian validation messages for every zod schema in every router (custom
// messages given in a schema still win).
z.config(z.locales.ru());

export const app = express();

// In production the API runs behind Nginx: trust exactly one proxy hop
// (TRUST_PROXY, see env.ts) so req.ip is the real client address — the login
// rate limiter keys on it. In development nothing is trusted, so a forged
// X-Forwarded-For can't pick its own req.ip.
app.set("trust proxy", trustProxy);

// JSON-only API, so helmet's defaults are fine; the one exception is CORP —
// the frontends live on other origins, and "same-origin" would make browsers
// refuse to hand them the responses.
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

// Development: local dev servers are always allowed, whatever port or
// loopback host they end up on, plus anything in CORS_ORIGINS. Auth is a
// bearer token (not cookies), so allowing loopback origins leaks nothing.
// Production: only CORS_ORIGINS (env.ts refuses to start if it's empty).
const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || corsOrigins.includes(origin) || (!isProduction && LOOPBACK_ORIGIN.test(origin))) {
        callback(null, true);
        return;
      }
      console.warn(`CORS: blocked origin ${origin} — add it to CORS_ORIGINS`);
      callback(null, false);
    },
    // Lets the admin read the file name of the source CSV download.
    exposedHeaders: ["Content-Disposition"],
  }),
);
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);
app.use("/api/tests", testsRouter);
app.use("/api/attempts", attemptsRouter);
app.use("/api/students", studentsRouter);

// Unknown API routes get a JSON 404 instead of Express's HTML page.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Метод API не найден." });
});

app.use(errorHandler);
