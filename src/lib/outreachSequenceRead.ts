// Turning stored rows into what the sequence's rules and its panel need.
//
// It exists because of one constraint and one boundary. The constraint: a
// "use server" module can export nothing but async functions, so the shape the
// generate action returns cannot be declared beside it. The boundary: the panel
// is a client component and the action is not, so what passes between them has
// to be plain data both can import — which is everything in this file.
//
// Pure, and it reads rows rather than a database: the query lives with the page
// and the action, and this is what either one does with the answer.

import {
  OUTREACH_STEPS,
  OutreachDraft,
  OutreachStep,
  SequenceState,
  isOutreachStep,
} from "@/lib/outreachSequence";

// ─── What a generate call answers with ─────────────────────────────────────

export type OutreachStepResult =
  | {
      ok: true;
      step: OutreachStep;
      // How many messages were written. Zero is a real answer and not an error:
      // the evidence carried nothing specific enough to say, which the panel
      // reports in place of the generic message it refuses to write.
      written: number;
      // Whether it came from the step's template rather than from a model call.
      // Said on the panel, because "this cost nothing and says exactly what the
      // template says" is worth knowing before somebody reads it looking for
      // signs of a machine.
      fromTemplate: boolean;
      // Which enrichment fields it had to work from, so the panel can say what
      // the message was made from rather than implying it saw everything.
      basedOn: string[];
      // Where the model cited the detail it read, on the steps that read one.
      evidence?: string | null;
    }
  | { ok: false; error: string };

// ─── Rows in, rules out ────────────────────────────────────────────────────

// One stored row as the prompts and the timeline see it. Anything whose step
// string is not one this build knows about is dropped rather than guessed at —
// a row written by a later version of the app should not become a message
// nobody can categorise.
export function toDraft(row: {
  step: string;
  variant: string | null;
  content: string;
  sentAt: Date | null;
}): OutreachDraft {
  return {
    step: isOutreachStep(row.step) ? row.step : "CONNECTION",
    variant: row.variant,
    content: row.content,
    sentAt: row.sentAt,
  };
}

// The four gates, read off a lead and its messages. Everything stepLock needs
// and nothing else.
export function sequenceState(lead: {
  websiteNotes: string | null;
  metaAdsSignal: string | null;
  reviewCount: number | null;
  connectionAcceptedAt: Date | null;
  repliedAt: Date | null;
  loomUrl: string | null;
  nextFollowUp: Date | null;
  outreach: { step: string; sentAt: Date | null }[];
}): SequenceState {
  return {
    // The same test the scoring assist and the old hook used, inlined rather
    // than imported so this module stays free of anything server-only.
    enriched:
      (lead.websiteNotes ?? "").trim() !== "" ||
      (lead.metaAdsSignal ?? "").trim() !== "" ||
      lead.reviewCount !== null,
    connectionAcceptedAt: lead.connectionAcceptedAt,
    repliedAt: lead.repliedAt,
    loomUrl: lead.loomUrl,
    nextFollowUp: lead.nextFollowUp,
    sentSteps: lead.outreach
      .filter((m) => m.sentAt !== null)
      .map((m) => m.step)
      .filter(isOutreachStep),
  };
}

// ─── What the timeline renders ─────────────────────────────────────────────

// One message as the panel holds it: a draft, plus the id the mark-sent and
// save actions need.
export interface OutreachMessageView {
  id: string;
  step: OutreachStep;
  variant: string | null;
  content: string;
  sentAt: Date | null;
  createdAt: Date;
}

// A stored row on its way to the panel. The step arrives as a string — SQLite
// has no enums, so the column is text — and a value this build does not know
// is dropped rather than rendered under a heading it has no place in.
export function toMessageViews(
  rows: {
    id: string;
    step: string;
    variant: string | null;
    content: string;
    sentAt: Date | null;
    createdAt: Date;
  }[],
): OutreachMessageView[] {
  return rows
    .filter((row) => isOutreachStep(row.step))
    .map((row) => ({ ...row, step: row.step as OutreachStep }));
}

// The messages for one step, newest generation first.
//
// Regenerating writes new rows rather than replacing old ones, so a step can
// hold several attempts. What the panel shows is the newest — for the first
// message, the newest *set* of variants, which is every row sharing the newest
// row's timestamp-ordered generation.
//
// A message already marked sent outranks all of that. Once something has been
// pasted into a conversation it is the record of what was said, and a later
// draft sitting on top of it would hide the only row that describes reality.
export function currentMessages(
  messages: OutreachMessageView[],
  step: OutreachStep,
): OutreachMessageView[] {
  const forStep = messages
    .filter((m) => m.step === step)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  if (forStep.length === 0) return [];

  const sent = forStep.filter((m) => m.sentAt !== null);
  if (sent.length > 0) {
    // The sent one, and — for the first message — the siblings it was chosen
    // from, so the panel can still show what the alternatives were.
    const chosen = sent[0];
    return forStep
      .filter(
        (m) =>
          m.sentAt !== null ||
          (chosen.variant !== null &&
            m.variant !== null &&
            sameGeneration(m, chosen)),
      )
      .sort(byVariant);
  }

  const newest = forStep[0];
  return forStep.filter((m) => sameGeneration(m, newest)).sort(byVariant);
}

// Rows written by one call arrive together, so "the same generation" is "within
// a few seconds of each other". createMany gives the three variants one
// timestamp in practice; the window is there for the case where it does not.
const GENERATION_WINDOW_MS = 10_000;

function sameGeneration(
  a: OutreachMessageView,
  b: OutreachMessageView,
): boolean {
  return (
    Math.abs(a.createdAt.getTime() - b.createdAt.getTime()) <
    GENERATION_WINDOW_MS
  );
}

// A, B, C — the order the prompt names them in, and the order they are read in.
function byVariant(a: OutreachMessageView, b: OutreachMessageView): number {
  return (a.variant ?? "").localeCompare(b.variant ?? "");
}

// Whether anything at all has been drafted, which is what decides between the
// timeline and its empty state.
export function hasAnyMessage(messages: OutreachMessageView[]): boolean {
  return OUTREACH_STEPS.some((step) =>
    messages.some((message) => message.step === step),
  );
}
