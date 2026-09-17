import express from "express";
import cors from "cors";
import { corsOrigins } from "./config/env";
import { authRouter } from "./routes/auth.routes";
import { testsRouter } from "./routes/tests.routes";
import { attemptsRouter } from "./routes/attempts.routes";
import { errorHandler } from "./middleware/errorHandler";

export const app = express();

app.use(
  cors({
    origin: corsOrigins.length > 0 ? corsOrigins : true,
  }),
);
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);
app.use("/api/tests", testsRouter);
app.use("/api/attempts", attemptsRouter);

app.use(errorHandler);
