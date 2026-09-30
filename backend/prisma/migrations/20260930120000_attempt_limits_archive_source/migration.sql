-- Rename the source column: it now holds CSV, not only Markdown.
ALTER TABLE "tests" RENAME COLUMN "mdSource" TO "source";

-- Per-test attempt limit, time limit and soft-delete (archive).
ALTER TABLE "tests" ADD COLUMN "maxAttempts" INTEGER;
ALTER TABLE "tests" ADD COLUMN "timeLimitMinutes" INTEGER;
ALTER TABLE "tests" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- Deadline fixed at attempt start when the test has a time limit.
ALTER TABLE "attempts" ADD COLUMN "deadlineAt" TIMESTAMP(3);

-- Answers autosaved while the attempt is in progress.
ALTER TABLE "attempts" ADD COLUMN "draftAnswers" JSONB;
