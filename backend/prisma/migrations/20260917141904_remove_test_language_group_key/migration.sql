-- DropIndex
DROP INDEX "tests_groupKey_idx";

-- AlterTable
ALTER TABLE "tests" DROP COLUMN "language",
DROP COLUMN "groupKey";
