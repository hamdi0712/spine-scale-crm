"use server";

// The outreach sequence's writes — five steps' worth of drafting, and the
// handful of marks that gate them.
//
// This is the old hook action (src/lib/actions/outreachHook.ts, now gone) with
// four more steps behind it. What it kept from that one is the arrangement that
// mattered: the model is asked for text, the text is stored as a draft, and
// nothing is ever sent. Every message here is pasted into LinkedIn by the
// person whose account it is, and every state this app knows about — accepted,
// replied, sent — is a mark somebody made afterwards.
//
// The lead id is bound on the server (src/app/(app)/pipeline/[id]/page.tsx), so
// it is the record whose page the button was pressed on and not something the
// browser names. The one id that does arrive from the browser is a message's,
// on the mark-sent path, and it is only ever matched against rows belonging to
// that same lead.
//
// Every step costs a model call now. That is not because every step is written
// by a model: steps 4 and 5 are still fixed prose, and their sentences are
// assembled here by loomDeliveryNote and followUpNote. What the call buys is
// the one part of each that had to be read off the evidence — what the
// walkthrough covers, and a pain angle the earlier messages did not use — and
// neither of those is a blank a template can fill.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { deepSeekJson } from "@/lib/deepseek";
import { assistEvidenceLabels, hasAssistEvidence } from "@/lib/icpAssist";
import {
  FIRST_MESSAGE_VARIANTS,
  MessageMechanism,
  OutreachStep,
  SEQUENCE_MAX_TOKENS,
  SequenceContext,
  buildFirstMessageFallbackPrompt,
  buildStepPrompt,
  connectionNote,
  contextSalutation,
  curiosityPainSignalNote,
  curiosityProcessNote,
  followUpNote,
  formatInternalNote,
  isOutreachStep,
  loomDeliveryNote,
  parseAuditOfferReply,
  parseConnectionReply,
  parseFirstMessageFallbackReply,
  parseFirstMessageReply,
  parseFollowUpReply,
  parseLoomDeliveryReply,
  stepLock,
} from "@/lib/outreachSequence";
import {
  OutreachStepResult,
  sequenceState,
  toDraft,
} from "@/lib/outreachSequenceRead";

// The mechanism every evidence-led message in this sequence is written by, named
// once here so the five write paths below cannot drift from each other. It is
// stamped on rows this app has always written as well as on the new ones: the
// point of the column is a comparison, and a comparison needs both sides
// labelled from the same moment onwards.
const OBSERVATION: MessageMechanism = "observation";

// ─── Tracing step 2 (TEMPORARY) ────────────────────────────────────────────
//
// Step 2 has two model calls and four ways to end with nothing written, and
// until now all four surfaced as the one sentence the panel has always shown:
// "nothing specific enough to say". That is fine as an answer and useless as a
// diagnosis, which is exactly the position a fallback that appears not to fire
// leaves somebody in.
//
// So every branch of the step now appends a line saying what ran and what came
// back. The lines go to the server log under a grep-able prefix and travel back
// to the panel on the result, and they are for the person debugging rather than
// for the person sending: no message text goes in them, only lengths, counts and
// the reason a gate rejected something.
//
// Delete this block, the trace() calls, OutreachStepResult.debug and the panel's
// DebugTrace together once the fallback is confirmed working on real leads.
const TRACE_PREFIX = "[outreach:step2]";

function trace(lines: string[], line: string): void {
  lines.push(line);
  // eslint-disable-next-line no-console
  console.info(`${TRACE_PREFIX} ${line}`);
}

// Everything a prompt is written from, read in one query. The evidence, the
// contact's first name, the Loom, and every message already drafted for this
// lead — which is what lets a later step avoid repeating an earlier one.
async function loadContext(leadId: string) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      clinicName: true,
      contactName: true,
      websiteNotes: true,
      metaAdsSignal: true,
      reviewCount: true,
      loomUrl: true,
      connectionAcceptedAt: true,
      repliedAt: true,
      replyText: true,
      nextFollowUp: true,
      enrichedAt: true,
      outreach: {
        orderBy: { createdAt: "asc" },
        select: { step: true, variant: true, content: true, sentAt: true },
      },
    },
  });
  return lead;
}

export async function generateOutreachStep(
  leadId: string,
  step: string,
): Promise<OutreachStepResult> {
  if (!isOutreachStep(step)) {
    return { ok: false, error: "That is not a step in the sequence." };
  }

  const lead = await loadContext(leadId);
  if (!lead) {
    return { ok: false, error: "That lead no longer exists." };
  }

  // The panel already refuses to show a button for a locked step; this is the
  // same rule on the server, because a hidden button is a courtesy and not a
  // guarantee. The reason it gives is the one the timeline shows.
  const state = sequenceState(lead);
  const lock = stepLock(step, state);
  if (!lock.unlocked) {
    return { ok: false, error: lock.reason };
  }

  const ctx: SequenceContext = {
    evidence: {
      clinicName: lead.clinicName,
      websiteNotes: lead.websiteNotes,
      metaAdsSignal: lead.metaAdsSignal,
      reviewCount: lead.reviewCount,
    },
    contactName: lead.contactName,
    loomUrl: lead.loomUrl,
    replyText: lead.replyText,
    priorMessages: lead.outreach.map(toDraft),
  };

  if (!hasAssistEvidence(lead)) {
    return {
      ok: false,
      error:
        "There is nothing to read yet. Run “Enrich this lead” first — these messages are written from the website notes, the Meta ads signal and the review count, and this lead has none of them.",
    };
  }

  const { system, user } = buildStepPrompt(step, ctx);
  const reply = await deepSeekJson({
    system,
    user,
    maxTokens: SEQUENCE_MAX_TOKENS,
  });
  if (!reply.ok) {
    return { ok: false, error: reply.error };
  }

  const basedOn = assistEvidenceLabels(lead);

  if (step === "CONNECTION") {
    const parsed = parseConnectionReply(reply.content);
    if (!parsed) {
      return {
        ok: false,
        error:
          "DeepSeek answered, but not in a shape that reads as an opening line. Nothing has been saved — try again.",
      };
    }
    // A run that found nothing specific enough is a real answer, not an error,
    // and it stores nothing rather than a generic opener somebody might send.
    if (parsed.observation === null) {
      return { ok: true, step, written: 0, fromTemplate: false, basedOn };
    }
    await prisma.outreachMessage.create({
      data: {
        leadId,
        step,
        variant: null,
        content: connectionNote({
          address: contextSalutation(ctx).address,
          clinicName: lead.clinicName,
          observation: parsed.observation,
        }),
        internalNote: formatInternalNote(parsed.note),
        messageMechanism: OBSERVATION,
      },
    });
    revalidatePath(`/pipeline/${leadId}`);
    return {
      ok: true,
      step,
      written: 1,
      fromTemplate: false,
      basedOn,
      evidence: parsed.note.evidence,
    };
  }

  if (step === "LOOM_DELIVERY") {
    const parsed = parseLoomDeliveryReply(reply.content);
    const content =
      parsed === null || parsed.covers === null
        ? null
        : loomDeliveryNote({
            loomUrl: lead.loomUrl ?? "",
            covers: parsed.covers,
          });
    if (parsed === null || content === null) {
      return {
        ok: false,
        error:
          "DeepSeek answered, but not with two or three things the walkthrough covers. Nothing has been saved — try again.",
      };
    }
    await prisma.outreachMessage.create({
      data: {
        leadId,
        step,
        variant: null,
        content,
        internalNote: formatInternalNote(parsed.note),
        messageMechanism: OBSERVATION,
      },
    });
    revalidatePath(`/pipeline/${leadId}`);
    return {
      ok: true,
      step,
      written: 1,
      fromTemplate: false,
      basedOn,
      evidence: parsed.note.evidence,
    };
  }

  // A follow-up with nothing new to say is not written at all. That is the
  // same answer the connection request gives when the evidence is thin, and
  // for the same reason: the message this step exists to avoid is the one
  // that says "just checking in".
  if (step === "FOLLOW_UP") {
    const parsed = parseFollowUpReply(reply.content);
    if (!parsed) {
      return {
        ok: false,
        error:
          "DeepSeek answered, but not in a shape that reads as a follow-up. Nothing has been saved — try again.",
      };
    }
    const content =
      parsed.observation === null
        ? null
        : followUpNote({
            address: contextSalutation(ctx).address,
            clinicName: lead.clinicName,
            observation: parsed.observation,
          });
    if (content === null) {
      return { ok: true, step, written: 0, fromTemplate: false, basedOn };
    }
    await prisma.outreachMessage.create({
      data: {
        leadId,
        step,
        variant: null,
        content,
        internalNote: formatInternalNote(parsed.note),
        messageMechanism: OBSERVATION,
      },
    });
    revalidatePath(`/pipeline/${leadId}`);
    return {
      ok: true,
      step,
      written: 1,
      fromTemplate: false,
      basedOn,
      evidence: parsed.note.evidence,
    };
  }

  if (step === "AUDIT_OFFER") {
    const parsed = parseAuditOfferReply(reply.content);
    if (!parsed || parsed.message === null) {
      return {
        ok: false,
        error:
          "DeepSeek answered, but not in a shape that reads as an audit offer. Nothing has been saved — try again.",
      };
    }
    await prisma.outreachMessage.create({
      data: {
        leadId,
        step,
        variant: null,
        content: parsed.message,
        internalNote: formatInternalNote(parsed.note),
        messageMechanism: OBSERVATION,
      },
    });
    revalidatePath(`/pipeline/${leadId}`);
    return {
      ok: true,
      step,
      written: 1,
      fromTemplate: false,
      basedOn,
      evidence: parsed.note.evidence,
    };
  }

  // TEMPORARY tracing, see the note on trace() above.
  const debug: string[] = [];
  trace(
    debug,
    `lead=${leadId} generateOutreachStep(FIRST_MESSAGE) ran the observation-led call, which answered ${reply.content.length} chars`,
  );

  const parsed = parseFirstMessageReply(reply.content);
  if (!parsed) {
    trace(debug, "parseFirstMessageReply: not a JSON object, so nothing was written");
    return {
      ok: false,
      error:
        "DeepSeek answered, but not in a shape that reads as three messages. Nothing has been saved — try again.",
    };
  }

  // Whichever of the three came back usable. A variant the evidence could not
  // support comes back null and is simply not written — two options that are
  // both true beat three where one is filler.
  const written = FIRST_MESSAGE_VARIANTS.filter(
    (variant) => parsed.variants[variant] !== null,
  );
  // None of the three: the evidence will not carry a verified pain observation.
  // That used to end the step, and a blank step ends the sequence for that lead.
  // A curiosity question needs no pain point to be true, so the run falls through
  // to one rather than stopping — and only here, after the observation-led call
  // has said in its own answer that it has nothing.
  trace(
    debug,
    `parseFirstMessageReply: usable variants ${written.length === 0 ? "none" : written.join(", ")}`,
  );
  if (written.length === 0) {
    return await generateCuriosityFallback({ leadId, ctx, basedOn, debug });
  }

  const note = formatInternalNote(parsed.note);
  await prisma.outreachMessage.createMany({
    data: written.map((variant) => ({
      leadId,
      step,
      variant,
      content: parsed.variants[variant] as string,
      internalNote: note,
      messageMechanism: OBSERVATION,
    })),
  });
  revalidatePath(`/pipeline/${leadId}`);
  return {
    ok: true,
    step,
    written: written.length,
    fromTemplate: false,
    basedOn,
    // Which of A and B the evidence could not support, so the panel can say why
    // there are two options rather than three instead of leaving somebody to
    // wonder whether something failed.
    skipped: FIRST_MESSAGE_VARIANTS.filter(
      (variant) => parsed.variants[variant] === null,
    ),
    evidence: parsed.note.evidence,
    mechanism: OBSERVATION,
    debug,
  };
}

// ─── Step 2's fallback ─────────────────────────────────────────────────────

// The curiosity opener, written when the evidence-led call found nothing.
//
// A second model call, and the only place in this app where one step can cost
// two. It is worth the call for what it avoids: a lead whose connection was
// accepted, whose evidence is thin, and whose step 2 is therefore permanently
// blank. What it is not allowed to do is turn thin evidence into an invented
// detail, so both messages below are assembled in code from a blank the model
// had to read off the evidence, and a run that cannot fill either blank leaves
// the step unfilled exactly as before.
//
// Which of the two gets written is decided here rather than by the model. The
// process question is the primary, because it presumes nothing at all; the
// no-show question is only reached where something soft actually pointed that
// way, and where the primary's detail was missing too.
async function generateCuriosityFallback({
  leadId,
  ctx,
  basedOn,
  debug,
}: {
  leadId: string;
  ctx: SequenceContext;
  basedOn: string[];
  // TEMPORARY, see trace() above. Carried in rather than started here so the
  // trace reads as one path through the step rather than two.
  debug: string[];
}): Promise<OutreachStepResult> {
  const step: OutreachStep = "FIRST_MESSAGE";
  trace(debug, "no observation-led variant, so generateCuriosityFallback ran");
  const { system, user } = buildFirstMessageFallbackPrompt(ctx);
  const reply = await deepSeekJson({
    system,
    user,
    maxTokens: SEQUENCE_MAX_TOKENS,
  });
  // A failed second call used to come back as the step having written nothing,
  // which made a broken model call indistinguishable from a lead whose evidence
  // is genuinely empty — the same yellow "nothing specific enough to say" for
  // two completely different problems, and the reason this was so hard to see
  // from the panel. It is its own error now, and it says which call failed.
  if (!reply.ok) {
    trace(debug, `the fallback call itself failed: ${reply.error}`);
    return {
      ok: false,
      error: `The three observation-led openers came back empty, and the curiosity fallback behind them could not be written either: ${reply.error}`,
      debug,
    };
  }
  trace(debug, `the fallback call answered ${reply.content.length} chars`);

  const parsed = parseFirstMessageFallbackReply(reply.content);
  if (!parsed) {
    trace(debug, "parseFirstMessageFallbackReply: not a JSON object");
    return {
      ok: false,
      error:
        "The curiosity fallback ran, but DeepSeek's answer to it was not a JSON object, so nothing was saved. Try again.",
      debug,
    };
  }
  trace(
    debug,
    `parseFirstMessageFallbackReply: detail=${
      parsed.detail === null
        ? `none (${parsed.detailRejected ?? "the model returned nothing"})`
        : `“${parsed.detail}”`
    }, painSignal=${parsed.painSignal === null ? "none" : "present"}`,
  );

  const { address } = contextSalutation(ctx);
  const process =
    parsed.detail === null
      ? null
      : curiosityProcessNote({ address, detail: parsed.detail });

  // The primary where there is a true detail to anchor it. Otherwise the no-show
  // question, and only where a genuine soft signal pointed at no-shows or
  // follow-up: without one it is a presumed pain point wearing a question mark,
  // which is the thing this fallback exists to avoid.
  const chosen: { content: string; mechanism: MessageMechanism } | null =
    process !== null
      ? { content: process, mechanism: "curiosity_process" }
      : parsed.painSignal !== null
        ? {
            content: curiosityPainSignalNote({
              address,
              clinicName: ctx.evidence.clinicName,
            }),
            mechanism: "curiosity_pain_signal",
          }
        : null;

  // Evidence empty enough that neither message can be grounded in anything real.
  // The step stays unfilled, which is the answer it has always given.
  if (chosen === null) {
    trace(
      debug,
      "neither curiosity variant could be grounded, so the step was left unfilled",
    );
    return { ok: true, step, written: 0, fromTemplate: false, basedOn, debug };
  }
  trace(debug, `writing one message, mechanism=${chosen.mechanism}`);

  // Wrapped, and wrapped here specifically: this is the first write in the app
  // that sets messageMechanism, so a database that has not had the migration
  // applied fails on exactly this statement and nowhere else. Unwrapped it
  // throws out of the action and the panel reports it as the server being
  // unreachable, which is the wrong thing to go and check.
  try {
    await prisma.outreachMessage.create({
    data: {
      leadId,
      step,
      variant: null,
      content: chosen.content,
      internalNote: formatInternalNote({
        ...parsed.note,
        // The note says why this is a curiosity opener rather than one of the
        // three observations, because that is the first question somebody reading
        // it will have. The soft signal goes in where it decided the wording.
        evidence: [
          "No verified pain observation in the evidence, so this is the curiosity opener rather than an observation-led message.",
          parsed.note.evidence,
          chosen.mechanism === "curiosity_pain_signal" && parsed.painSignal
            ? `Soft signal pointing at no-shows or follow-up: ${parsed.painSignal}`
            : null,
        ]
          .filter((line): line is string => line !== null && line !== "")
          .join(" "),
      }),
      messageMechanism: chosen.mechanism,
    },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    trace(debug, `the write failed: ${detail.slice(0, 300)}`);
    return {
      ok: false,
      error:
        "The curiosity opener was written but could not be saved. If the message mentions an unknown column, this database has not had the messageMechanism migration applied yet: run prisma migrate deploy.",
      debug,
    };
  }
  revalidatePath(`/pipeline/${leadId}`);
  return {
    ok: true,
    step,
    written: 1,
    fromTemplate: false,
    basedOn,
    evidence: parsed.note.evidence,
    // All three observation variants were skipped on the way here, which is what
    // the panel says under a run that wrote one message instead of three.
    skipped: FIRST_MESSAGE_VARIANTS,
    mechanism: chosen.mechanism,
    debug,
  };
}

// ─── The marks ─────────────────────────────────────────────────────────────
//
// Four states, all of them recording something that happened somewhere this app
// cannot see. Each is stamped with the moment it was marked rather than a date
// somebody picks, for the reason connectionRequestSentAt is: the useful question
// is "has this happened", and a date field would invite an accuracy the record
// does not have. Each has a way back, because the way back from a misclick is
// the whole reason a mark is not a one-way door.

export async function markConnectionAccepted(leadId: string) {
  await prisma.lead.update({
    where: { id: leadId },
    data: { connectionAcceptedAt: new Date() },
  });
  revalidatePath(`/pipeline/${leadId}`);
  revalidatePath("/pipeline");
}

export async function clearConnectionAccepted(leadId: string) {
  await prisma.lead.update({
    where: { id: leadId },
    data: { connectionAcceptedAt: null },
  });
  revalidatePath(`/pipeline/${leadId}`);
  revalidatePath("/pipeline");
}

export async function markReplied(leadId: string) {
  await prisma.lead.update({
    where: { id: leadId },
    data: { repliedAt: new Date() },
  });
  revalidatePath(`/pipeline/${leadId}`);
  revalidatePath("/pipeline");
}

export async function clearReplied(leadId: string) {
  await prisma.lead.update({
    where: { id: leadId },
    data: { repliedAt: null },
  });
  revalidatePath(`/pipeline/${leadId}`);
  revalidatePath("/pipeline");
}

// Marking one message sent. The id comes from the browser, so it is matched
// against this lead's own messages — updateMany with both in the where clause
// means an id belonging to another lead updates nothing at all, rather than
// stamping a row on a record whose page nobody is looking at.
//
// Marking one variant of the first message sent unmarks its siblings: three
// alternatives are three ways of saying the same thing once, and two of them
// marked sent would be a record of a conversation that did not happen.
export async function markMessageSent(leadId: string, messageId: string) {
  const message = await prisma.outreachMessage.findFirst({
    where: { id: messageId, leadId },
    select: { id: true, step: true, variant: true },
  });
  if (!message) return;

  if (message.variant !== null) {
    await prisma.outreachMessage.updateMany({
      where: { leadId, step: message.step, id: { not: message.id } },
      data: { sentAt: null },
    });
  }

  await prisma.outreachMessage.updateMany({
    where: { id: message.id, leadId },
    data: { sentAt: new Date() },
  });
  revalidatePath(`/pipeline/${leadId}`);
  revalidatePath("/pipeline");
}

export async function clearMessageSent(leadId: string, messageId: string) {
  await prisma.outreachMessage.updateMany({
    where: { id: messageId, leadId },
    data: { sentAt: null },
  });
  revalidatePath(`/pipeline/${leadId}`);
  revalidatePath("/pipeline");
}

// An edited draft, saved back over the row it was generated into.
//
// The old hook panel let somebody edit the note in the box and copy it, and the
// edit went nowhere — which was fine when the box was rebuilt from a stored
// clause each time. Here the message is the stored thing, and an edit that
// vanished on reload would lose work. Saving is explicit: typing changes the
// box, this writes it.
export async function saveMessageContent(
  leadId: string,
  messageId: string,
  content: string,
) {
  const trimmed = content.trim();
  // An empty message is not an edit, it is a delete by another name, and this
  // is not the delete path.
  if (trimmed === "") return;
  await prisma.outreachMessage.updateMany({
    where: { id: messageId, leadId },
    data: { content: trimmed.slice(0, 4000) },
  });
  revalidatePath(`/pipeline/${leadId}`);
}
