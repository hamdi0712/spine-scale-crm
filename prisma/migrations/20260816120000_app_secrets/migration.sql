-- The DeepSeek key and the Apify token move out of .env and into the database,
-- so changing one is a form rather than a file edit and a restart.
--
-- One row, fixed id "singleton", the same shape PipelineSettings uses. A null
-- column means "not set here" and falls back to the environment variable of the
-- same name, which is why nothing is seeded: a fresh install has no row and
-- runs exactly on .env as it always did.

-- CreateTable
CREATE TABLE "AppSecrets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deepseekApiKey" TEXT,
    "apifyApiToken" TEXT,
    "updatedAt" DATETIME NOT NULL
);
