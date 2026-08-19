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
// Two steps cost a model call and three do not — see stepUsesModel in
// src/lib/outreachSequence.ts. The three that don't are filled from their
// template here, stored the same way, and are indistinguishable downstream.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { deepSeekJson } from "@/lib/deepseek";
import { assistEvidenceLabels, hasAssistEvidence } from "@/lib/icpAssist";
import {
  FIRST_MESSAGE_VARIANTS,
  OutreachStep,
  SEQUENCE_MAX_TOKENS,
  SequenceContext,
  buildStepPrompt,
  connectionNote,
  fillTemplate,
  isOutreachStep,
  parseConnectionReply,
  parseFirstMessageReply,
  stepLock,
  stepUsesModel,
} from "@/lib/outreachSequence";
import {
  OutreachStepResult,
  sequenceState,
  toDraft,
} from "@/lib/outreachSequenceRead";

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
  const lock = stepLock(step, sequenceState(lead));
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
    priorMessages: lead.outreach.map(toDraft),
  };

  // ─── The three steps nobody pays for ─────────────────────────────────────
  //
  // Fixed prose with a name, a clinic and a link in it. There is no blank only
  // the evidence can fill, so there is nothing to ask a model — and asking
  // anyway would spend a call to get back the words we already have, with a
  // chance of getting them slightly wrong.
  if (!stepUsesModel(step)) {
    const content = fillTemplate(step, ctx);
    if (content === null) {
      return {
        ok: false,
        error:
          "This step's template needs the Loom link, and there isn't one on this lead yet.",
      };
    }
    await prisma.outreachMessage.create({
      data: { leadId, step, variant: null, content },
    });
    revalidatePath(`/pipeline/${leadId}`);
    return { ok: true, step, written: 1, fromTemplate: true, basedOn: [] };
  }

  // ─── The two that do ─────────────────────────────────────────────────────

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
    if (parsed.hook === null) {
      return { ok: true, step, written: 0, fromTemplate: false, basedOn };
    }
    await prisma.outreachMessage.create({
      data: {
        leadId,
        step,
        variant: null,
        content: connectionNote({
          contactName: lead.contactName,
          clinicName: lead.clinicName,
          hook: parsed.hook,
        }),
      },
    });
    revalidatePath(`/pipeline/${leadId}`);
    return {
      ok: true,
      step,
      written: 1,
      fromTemplate: false,
      basedOn,
      evidence: parsed.evidence,
    };
  }

  const parsed = parseFirstMessageReply(reply.content);
  if (!parsed) {
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
    (variant) => parsed[variant] !== null,
  );
  if (written.length === 0) {
    return { ok: true, step, written: 0, fromTemplate: false, basedOn };
  }

  await prisma.outreachMessage.createMany({
    data: written.map((variant) => ({
      leadId,
      step,
      variant,
      content: parsed[variant] as string,
    })),
  });
  revalidatePath(`/pipeline/${leadId}`);
  return {
    ok: true,
    step,
    written: written.length,
    fromTemplate: false,
    basedOn,
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
