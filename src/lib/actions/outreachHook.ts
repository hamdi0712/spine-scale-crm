"use server";

// The outreach hook's one call.
//
// Reads the same three enrichment fields the scoring assist reads, asks
// DeepSeek for one true specific line about the clinic, and hands it back to
// the panel.
//
// Unlike the scoring assist, this one writes — a single column, outreachHook,
// and nothing else. That is the difference between a suggestion and a draft: a
// score is a decision somebody makes on a card and must not be stored by a
// model call, whereas a hook is a piece of text being prepared, and losing it
// on a page reload would mean paying for it twice.
//
// It sends nothing anywhere. The line goes into a box on the page for somebody
// to read, edit and copy; the connection request is still made by hand on
// LinkedIn, and this app has no idea whether it was.
//
// The lead id is bound on the server (src/app/(app)/pipeline/[id]/page.tsx),
// so it is the record whose page the button was pressed on and not something
// the browser names. prisma.lead is only ever updated, and only ever on that
// id and that one column.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { deepSeekJson } from "@/lib/deepseek";
import { assistEvidenceLabels, hasAssistEvidence } from "@/lib/icpAssist";
import {
  HOOK_MAX_TOKENS,
  OutreachHookResult,
  buildHookPrompt,
  parseHookReply,
} from "@/lib/outreachHook";

export async function generateOutreachHook(
  leadId: string,
): Promise<OutreachHookResult> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    // The evidence and the clinic's name. Nothing else on the lead is read,
    // and so nothing else can be sent — no contact, no notes anybody typed,
    // no stage. The contact's name is put into the note in the browser, not
    // here, because the model has no use for it.
    select: {
      clinicName: true,
      websiteNotes: true,
      metaAdsSignal: true,
      reviewCount: true,
    },
  });
  if (!lead) {
    return { ok: false, error: "That lead no longer exists." };
  }

  // The button is already disabled without evidence; this is the same rule on
  // the server, because a disabled button is a courtesy and not a guarantee.
  if (!hasAssistEvidence(lead)) {
    return {
      ok: false,
      error:
        "There is nothing to read yet. Run “Enrich this lead” first — the hook is written from the website notes, the Meta ads signal and the review count, and this lead has none of them.",
    };
  }

  const { system, user } = buildHookPrompt(lead);
  const reply = await deepSeekJson({ system, user, maxTokens: HOOK_MAX_TOKENS });
  if (!reply.ok) {
    return { ok: false, error: reply.error };
  }

  const parsed = parseHookReply(reply.content);
  if (!parsed) {
    return {
      ok: false,
      error:
        "DeepSeek answered, but not in a shape that reads as a hook. Nothing has been saved — try again.",
    };
  }

  // A line that came back is stored; a run that found nothing specific clears
  // whatever was there. Both are the same rule: what is on the record is what
  // the last run actually produced, and leaving a stale line under a run that
  // declined to write one would be the worst of the three outcomes.
  await prisma.lead.update({
    where: { id: leadId },
    data: { outreachHook: parsed.hook },
  });
  revalidatePath(`/pipeline/${leadId}`);

  return {
    ok: true,
    hook: parsed.hook,
    evidence: parsed.evidence,
    basedOn: assistEvidenceLabels(lead),
  };
}
