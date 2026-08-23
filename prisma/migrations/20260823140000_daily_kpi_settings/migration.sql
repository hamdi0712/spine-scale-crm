-- Daily KPI goals. One singleton row, created the first time the goals are
-- saved; until then the page reads the defaults below without a row existing.
CREATE TABLE "DailyKpiSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "qualifiedLeadsGoal" INTEGER NOT NULL DEFAULT 20,
    "connectionsSentGoal" INTEGER NOT NULL DEFAULT 50,
    "repliesReceivedGoal" INTEGER NOT NULL DEFAULT 10,
    "meetingsBookedGoal" INTEGER NOT NULL DEFAULT 3,
    "updatedAt" DATETIME NOT NULL
);
