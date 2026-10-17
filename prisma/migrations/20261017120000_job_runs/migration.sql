-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "verb" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "total" INTEGER NOT NULL,
    "done" INTEGER NOT NULL DEFAULT 0,
    "succeeded" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "current" TEXT,
    "estimatedUsd" REAL,
    "spentUsd" REAL NOT NULL DEFAULT 0,
    "stopRequested" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeatAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "dismissedAt" DATETIME
);

-- CreateTable
CREATE TABLE "JobRunItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "subjectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "result" TEXT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobRunItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "JobRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "JobRun_status_idx" ON "JobRun"("status");

-- CreateIndex
CREATE INDEX "JobRun_startedAt_idx" ON "JobRun"("startedAt");

-- CreateIndex
CREATE INDEX "JobRunItem_runId_seq_idx" ON "JobRunItem"("runId", "seq");
