-- AlterTable
ALTER TABLE "tests" ADD COLUMN     "groupKey" TEXT;

-- CreateIndex
CREATE INDEX "tests_groupKey_idx" ON "tests"("groupKey");
