-- Connections Sent becomes Messages Sent.
--
-- The metric is no longer read off the lead's optional connectionRequestSentAt
-- field but off the pipeline itself — a lead standing at Contacted or past it
-- was written to — so the goal column is renamed to match. The stored number
-- carries across unchanged: it was "how many approaches make a full day" before
-- and it is the same question now.
--
-- The table is rebuilt rather than altered in place, the way the monthly-goals
-- migration before it was: SQLite cannot rename a column with a default in one
-- step. There is at most one row.
CREATE TABLE "new_DailyKpiSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "qualifiedLeadsGoal" INTEGER NOT NULL DEFAULT 20,
    "messagesSentGoal" INTEGER NOT NULL DEFAULT 50,
    "repliesReceivedMonthlyGoal" INTEGER NOT NULL DEFAULT 200,
    "meetingsBookedMonthlyGoal" INTEGER NOT NULL DEFAULT 60,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "new_DailyKpiSettings" (
    "id",
    "qualifiedLeadsGoal",
    "messagesSentGoal",
    "repliesReceivedMonthlyGoal",
    "meetingsBookedMonthlyGoal",
    "updatedAt"
)
SELECT
    "id",
    "qualifiedLeadsGoal",
    "connectionsSentGoal",
    "repliesReceivedMonthlyGoal",
    "meetingsBookedMonthlyGoal",
    "updatedAt"
FROM "DailyKpiSettings";

DROP TABLE "DailyKpiSettings";
ALTER TABLE "new_DailyKpiSettings" RENAME TO "DailyKpiSettings";
