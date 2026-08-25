// Does stageChangedAt hold still when nothing about the stage changed?
//
// That question is the whole reason the column exists, and it cannot be
// answered by reading the code: it is a claim about what four write paths do
// to a row, and the interesting half of it is a negative — a timestamp that
// must *not* move while updatedAt, sitting next to it, does. So this drives
// the real server actions against a real database and reads the row back.
//
// Run it against a scratch database, never a real one — it creates leads and
// deletes them again, and a failed assertion leaves them behind:
//
//   DATABASE_URL="file:$PWD/.verify.db" npx prisma migrate deploy
//   DATABASE_URL="file:$PWD/.verify.db" npx tsx tools/verify-stage-changed-at.ts
//
// The require hook is what lets a "use server" module load outside a request
// (see tools/next-cache-stub.cjs). It has to be installed before anything
// pulls in an action, which is why the imports below are dynamic.

import Module from "node:module";
import path from "node:path";

const STUB = path.join(__dirname, "next-cache-stub.cjs");
const resolveFilename = (
  Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string }
)._resolveFilename;
(
  Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string }
)._resolveFilename = function (request: string, ...args: unknown[]) {
  if (request === "next/cache") return STUB;
  return resolveFilename.call(this, request, ...args);
};

// tsx compiles this to CommonJS, which has no top-level await, so the whole
// run — the dynamic imports included — lives in one async function.
async function main(): Promise<void> {
  const { prisma } = await import("@/lib/prisma");
  const { addLeadNote, moveLeadStage, moveLeadsStage, updateLead } = await import(
    "@/lib/actions/leads"
  );

  // ─── Harness ───────────────────────────────────────────────────────────────

  let failures = 0;

  function check(name: string, ok: boolean, detail: string) {
    if (ok) {
      console.log(`  ✓ ${name}`);
    } else {
      failures++;
      console.log(`  ✗ ${name}\n      ${detail}`);
    }
  }

  function read(id: string) {
    return prisma.lead.findUniqueOrThrow({
      where: { id },
      select: { stage: true, stageChangedAt: true, updatedAt: true },
    });
  }

  // SQLite stores these to the millisecond, and a write that lands inside the
  // same millisecond as the one before it reads as "did not move" whether or not
  // it moved. A short wait between the setup write and the write under test is
  // what makes the comparison mean something.
  const tick = () => new Promise((r) => setTimeout(r, 25));

  // A lead at a stage, as the detail form would post it back.
  function form(fields: Record<string, string>): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  }

  async function makeLead(stage: string, clinicName: string): Promise<string> {
    const lead = await prisma.lead.create({
      data: { clinicName, stage, phone: "555-0100" },
    });
    return lead.id;
  }

  // ─── The cases ─────────────────────────────────────────────────────────────

  console.log("\nstageChangedAt\n");

  // 1. The one the column exists for: an unrelated edit to a lead already at
  //    Contacted. updatedAt must move and stageChangedAt must not.
  {
    const id = await makeLead("CONTACTED", "Case 1 — unrelated edit");
    const before = await read(id);
    await tick();

    await updateLead(
      id,
      form({
        clinicName: "Case 1 — unrelated edit",
        // The edit: a new phone number and a note in the contact fields.
        phone: "555-0199",
        contactName: "Dana Reyes",
        // The form posts the stage it is already at, which is exactly the
        // shape of the mistake this column was added to stop.
        stage: "CONTACTED",
      }),
    );

    const after = await read(id);
    check(
      "an unrelated edit leaves stageChangedAt where it was",
      after.stageChangedAt.getTime() === before.stageChangedAt.getTime(),
      `moved from ${before.stageChangedAt.toISOString()} to ${after.stageChangedAt.toISOString()}`,
    );
    check(
      "an unrelated edit does move updatedAt",
      after.updatedAt.getTime() > before.updatedAt.getTime(),
      `updatedAt stayed at ${before.updatedAt.toISOString()} — the edit may not have landed`,
    );
    const saved = await prisma.lead.findUniqueOrThrow({
      where: { id },
      select: { phone: true },
    });
    check(
      "and the edit itself was saved",
      saved.phone === "555-0199",
      `phone is ${saved.phone}`,
    );
    await prisma.lead.delete({ where: { id } });
  }

  // 2. The same form, actually changing the stage. Both move.
  {
    const id = await makeLead("NEW", "Case 2 — real move via the form");
    const before = await read(id);
    await tick();

    await updateLead(
      id,
      form({ clinicName: "Case 2 — real move via the form", stage: "CONTACTED" }),
    );

    const after = await read(id);
    check(
      "a real stage change through the form does move stageChangedAt",
      after.stage === "CONTACTED" &&
        after.stageChangedAt.getTime() > before.stageChangedAt.getTime(),
      `stage ${after.stage}, stageChangedAt ${after.stageChangedAt.toISOString()}`,
    );
    await prisma.lead.delete({ where: { id } });
  }

  // 3. The board's drag, dropped back on the column it came from.
  {
    const id = await makeLead("CONTACTED", "Case 3 — dropped where it was");
    const before = await read(id);
    await tick();

    await moveLeadStage(id, "CONTACTED");

    const after = await read(id);
    check(
      "dropping a card on the stage it is already at moves nothing",
      after.stageChangedAt.getTime() === before.stageChangedAt.getTime() &&
        after.updatedAt.getTime() === before.updatedAt.getTime(),
      `stageChangedAt ${after.stageChangedAt.toISOString()}, updatedAt ${after.updatedAt.toISOString()}`,
    );
    await prisma.lead.delete({ where: { id } });
  }

  // 4. The board's drag, onto a different column.
  {
    const id = await makeLead("NEW", "Case 4 — real drag");
    const before = await read(id);
    await tick();

    await moveLeadStage(id, "CONTACTED");

    const after = await read(id);
    check(
      "dragging a card to a new stage does move stageChangedAt",
      after.stage === "CONTACTED" &&
        after.stageChangedAt.getTime() > before.stageChangedAt.getTime(),
      `stage ${after.stage}, stageChangedAt ${after.stageChangedAt.toISOString()}`,
    );
    await prisma.lead.delete({ where: { id } });
  }

  // 5. A bulk move over a mixed selection — one lead already at the target and
  //    one not. Only the one that actually moves is re-dated.
  {
    const already = await makeLead("CONTACTED", "Case 5 — already there");
    const moving = await makeLead("NEW", "Case 5 — moving");
    const beforeAlready = await read(already);
    const beforeMoving = await read(moving);
    await tick();

    await moveLeadsStage([already, moving], "CONTACTED");

    const afterAlready = await read(already);
    const afterMoving = await read(moving);
    check(
      "a bulk move does not re-date the leads already at the stage",
      afterAlready.stageChangedAt.getTime() ===
        beforeAlready.stageChangedAt.getTime(),
      `moved from ${beforeAlready.stageChangedAt.toISOString()} to ${afterAlready.stageChangedAt.toISOString()}`,
    );
    check(
      "a bulk move does re-date the leads it actually moves",
      afterMoving.stage === "CONTACTED" &&
        afterMoving.stageChangedAt.getTime() >
          beforeMoving.stageChangedAt.getTime(),
      `stage ${afterMoving.stage}, stageChangedAt ${afterMoving.stageChangedAt.toISOString()}`,
    );
    await prisma.lead.deleteMany({ where: { id: { in: [already, moving] } } });
  }

  // 6. A note added against the lead. It writes a row of its own and must not
  //    reach the lead's timestamps at all.
  {
    const id = await makeLead("CONTACTED", "Case 6 — note added");
    const before = await read(id);
    await tick();

    await addLeadNote(id, form({ body: "Left a voicemail." }));

    const after = await read(id);
    const notes = await prisma.leadNote.count({ where: { leadId: id } });
    check(
      "adding a note leaves stageChangedAt where it was",
      after.stageChangedAt.getTime() === before.stageChangedAt.getTime(),
      `moved to ${after.stageChangedAt.toISOString()}`,
    );
    check(
      "and the note itself was written",
      notes === 1,
      `${notes} notes on the lead`,
    );
    await prisma.lead.delete({ where: { id } });
  }

  console.log(
    failures === 0
      ? "\nAll cases passed.\n"
      : `\n${failures} case${failures === 1 ? "" : "s"} failed.\n`,
  );

  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);

}

void main();
