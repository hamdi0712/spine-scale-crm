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
  MECHANISM_SAMPLE_FLOOR,
  MechanismGroup,
  MessageMechanism,
  OUTREACH_STEPS,
  OutreachDraft,
  OutreachStep,
  SequenceState,
  isMessageMechanism,
  isOutreachStep,
  mechanismGroup,
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
      // First message only: the variants the evidence could not support. Named
      // rather than merely counted, because "no advertising evidence, so no
      // option B" is an answer, and "two options" on its own is a puzzle.
      skipped?: readonly string[];
      // Which mechanism the run actually wrote by. Worth saying on the panel
      // rather than only in the database: a curiosity opener arriving where
      // three observations were asked for is a different message than the one
      // the button offered, and somebody about to paste it should be told that
      // by the app rather than work it out from the wording.
      mechanism?: MessageMechanism;
      // TEMPORARY, for tracing step 2's fallback on real leads. Each line names
      // one thing that actually ran and what it returned, in order, so a step
      // that comes back empty says where it went empty instead of leaving it to
      // be inferred from the one sentence the panel has always shown. Written to
      // the server log as well (see src/lib/actions/outreachSequence.ts) and
      // rendered under the step's note where present. Remove both together.
      debug?: string[];
    }
  // The error carries the trace too: the most useful case to see a trace for is
  // the one that failed. TEMPORARY, same as the field above.
  | { ok: false; error: string; debug?: string[] };

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

// The gates, read off a lead and its messages. Everything stepLock needs and
// nothing else.
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
  // When the first message went out, where it did. The step 2 bump is due five
  // days after that mark, so this branch of the follow-up needs the date and not
  // only the fact. Earliest, not latest: a step regenerated and re-marked is the
  // same conversation, and the clock started when they first heard from us.
  const firstMessageSentAt = lead.outreach
    .filter((m) => m.step === "FIRST_MESSAGE" && m.sentAt !== null)
    .map((m) => m.sentAt as Date)
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

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
    firstMessageSentAt,
  };
}

// ─── Observation against curiosity ─────────────────────────────────────────

// The one number this comparison exists for: of the first messages that went
// out, which kind of opener got answered more often.
//
// Two groups, not four. The curiosity openers are one bet written two ways and
// splitting them halves a sample that is already small; step2_bump is left out
// of both because it is a follow-up rather than an opener, and an untagged row
// is left out because guessing which group it belongs in is precisely what the
// stored column exists to prevent.
//
// A reply counts where it was marked at or after the message was sent. Without
// that rule a lead who replied to the connection request and was then sent a
// first message would score a reply for an opener it never read.
export interface MechanismGroupStats {
  sent: number;
  replies: number;
  // Null where nothing was sent, because 0% and "none yet" are different
  // answers and only one of them is about the message.
  replyRatePercent: number | null;
  // Whether this group is still too small to read anything into.
  smallSample: boolean;
}

export interface OpenerComparison {
  observation: MechanismGroupStats;
  curiosity: MechanismGroupStats;
  // Sent first messages carrying no mechanism at all, which are in neither
  // group. Surfaced rather than quietly dropped: a comparison missing a third
  // of its rows should say so where it is read.
  untagged: number;
}

export function openerComparison(
  rows: {
    messageMechanism: string | null;
    sentAt: Date | null;
    repliedAt: Date | null;
  }[],
): OpenerComparison {
  const tally = { observation: { sent: 0, replies: 0 }, curiosity: { sent: 0, replies: 0 } };
  let untagged = 0;

  for (const row of rows) {
    if (row.sentAt === null) continue;
    const mechanism = isMessageMechanism(row.messageMechanism)
      ? row.messageMechanism
      : null;
    const group = mechanismGroup(mechanism);
    if (group === null) {
      // step2_bump belongs to neither group and is not a gap in the data; an
      // untagged row is.
      if (mechanism === null) untagged++;
      continue;
    }
    tally[group].sent++;
    if (row.repliedAt !== null && row.repliedAt.getTime() >= row.sentAt.getTime()) {
      tally[group].replies++;
    }
  }

  const shape = (group: MechanismGroup): MechanismGroupStats => ({
    sent: tally[group].sent,
    replies: tally[group].replies,
    replyRatePercent:
      tally[group].sent === 0
        ? null
        : Math.round((tally[group].replies / tally[group].sent) * 100),
    smallSample: tally[group].sent < MECHANISM_SAMPLE_FLOOR,
  });

  return {
    observation: shape("observation"),
    curiosity: shape("curiosity"),
    untagged,
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
  // The reviewer's note. Rendered under the message and never inside it, so it
  // cannot be copied into LinkedIn along with the draft.
  internalNote: string | null;
  // Which mechanism this message was written by, as it was stamped at
  // generation time. Null on rows written before the column existed, and shown
  // as nothing rather than guessed at.
  messageMechanism: MessageMechanism | null;
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
    internalNote: string | null;
    messageMechanism: string | null;
    sentAt: Date | null;
    createdAt: Date;
  }[],
): OutreachMessageView[] {
  return rows
    .filter((row) => isOutreachStep(row.step))
    .map((row) => ({
      ...row,
      step: row.step as OutreachStep,
      // A mechanism this build does not know about is read as none, the same
      // way an unknown step is dropped: a label nobody can categorise is worse
      // than a blank.
      messageMechanism: isMessageMechanism(row.messageMechanism)
        ? row.messageMechanism
        : null,
    }));
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
