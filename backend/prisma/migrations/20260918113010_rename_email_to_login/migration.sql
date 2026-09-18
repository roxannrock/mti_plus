-- RenameColumn (keeps existing data — email values become login values)
ALTER TABLE "users" RENAME COLUMN "email" TO "login";
