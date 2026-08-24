-- Replies Received and Meetings Booked move from a daily goal to a monthly one.
--
-- The table is rebuilt rather than altered in place: SQLite cannot rename a
-- column with a default in one step, and the new names are the point — a bare
-- "Goal" on a monthly metric reads as a daily one.
--
-- A stored daily goal is carried across at twenty working days to the month,
-- which is the same standard over the new timeframe rather than a target
-- silently divided by twenty. There is at most one row.
CREATE TABLE "new_DailyKpiSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "qualifiedLeadsGoal" INTEGER NOT NULL DEFAULT 20,
    "connectionsSentGoal" INTEGER NOT NULL DEFAULT 50,
    "repliesReceivedMonthlyGoal" INTEGER NOT NULL DEFAULT 200,
    "meetingsBookedMonthlyGoal" INTEGER NOT NULL DEFAULT 60,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "new_DailyKpiSettings" (
    "id",
    "qualifiedLeadsGoal",
    "connectionsSentGoal",
    "repliesReceivedMonthlyGoal",
    "meetingsBookedMonthlyGoal",
    "updatedAt"
)
SELECT
    "id",
    "qualifiedLeadsGoal",
    "connectionsSentGoal",
    "repliesReceivedGoal" * 20,
    "meetingsBookedGoal" * 20,
    "updatedAt"
FROM "DailyKpiSettings";

DROP TABLE "DailyKpiSettings";
ALTER TABLE "new_DailyKpiSettings" RENAME TO "DailyKpiSettings";
