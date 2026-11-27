// Runs once when the server starts (Next.js instrumentation hook). Node.js
// runtime only — never the edge runtime, and never during `next build`.
//
//   1. One-time data migrations (src/lib/dataMigrations.ts): backed up, checked,
//      written only when nothing would move.
//   2. The contact finder's hourly timer (src/lib/contactFinderTimer.ts).
//
// The imports sit inside the NEXT_RUNTIME check, the shape Next.js documents,
// so the edge bundle never pulls in Prisma or the file system.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { runDataMigrations } = await import("./lib/dataMigrations");
    await runDataMigrations();
    const { startContactFinderTimer } = await import("./lib/contactFinderTimer");
    startContactFinderTimer();
  }
}
