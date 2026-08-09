-- CreateTable
CREATE TABLE "DailyDigest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "body" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "generatedAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
