-- Password resets invalidate existing sessions.
ALTER TABLE "users" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- Snapshot what an attempt was scored against, so later edits of a
-- question or the pass mark don't make old reviews contradict themselves.
ALTER TABLE "attempts" ADD COLUMN "passPercentAtFinish" DOUBLE PRECISION;
ALTER TABLE "attempt_answers" ADD COLUMN "correctKeysAtFinish" JSONB;

-- Backfill: existing attempts were scored against the current values as far as we know.
UPDATE "attempts" a SET "passPercentAtFinish" = t."passPercent"
  FROM "tests" t WHERE a."testId" = t.id AND a."finishedAt" IS NOT NULL;
UPDATE "attempt_answers" aa SET "correctKeysAtFinish" = q."correctKeys"
  FROM "questions" q WHERE aa."questionId" = q.id;
