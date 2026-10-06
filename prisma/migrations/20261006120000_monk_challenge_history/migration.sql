-- Monk Mode challenge history: every challenge keeps its own row.
--
-- Nullable, so the current challenge (and any row that predates this) reads as
-- still open. Older rows that were superseded are closed, and a challenge whose
-- row was overwritten is rebuilt from its completions, at read time in
-- monkModeStore.reconcileChallengeHistory — the rules for that live in code.

-- AlterTable
ALTER TABLE "MonkModeChallenge" ADD COLUMN "endDate" DATETIME;
