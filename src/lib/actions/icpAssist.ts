"use server";

// The scoring assist's one call.
//
// Reads the three enrichment fields off the lead, asks DeepSeek to score
// category B and the two Automation Gap boxes against the framework text, and
// hands the parsed suggestion back to the card.
//
// It writes nothing. That is not an omission — it is the feature: the card
// pre-selects what comes back and stores it only when somebody presses Save
// scorecard, exactly as it does with the staff-count suggestion. There is no
// prisma.lead.update in this file and there should never be one.
//
// The lead id is bound on the server (src/app/(app)/pipeline/[id]/page.tsx),
// so it is the record whose page the card was opened from and not something
// the browser names.

import { prisma } from "@/lib/prisma";
import { deepSeekJson } from "@/lib/deepseek";
import {
  IcpAssistResult,
  assistEvidenceLabels,
  buildAssistPrompt,
  hasAssistEvidence,
  parseAssistSuggestion,
} from "@/lib/icpAssist";

export async function suggestIcpScores(
  leadId: string,
): Promise<IcpAssistResult> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    // The evidence and the clinic's name. Nothing else on the lead is read,
    // and so nothing else can be sent.
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
        "There is nothing to read yet. Run “Enrich this lead” first — the suggestion is made from the website notes, the Meta ads signal and the review count, and this lead has none of them.",
    };
  }

  const { system, user } = buildAssistPrompt(lead);
  const reply = await deepSeekJson({ system, user });
  if (!reply.ok) {
    return { ok: false, error: reply.error };
  }

  const suggestion = parseAssistSuggestion(reply.content);
  if (!suggestion) {
    return {
      ok: false,
      error:
        "DeepSeek answered, but not in a shape that reads as scores. Nothing has been changed on the card — try again.",
    };
  }

  return { ok: true, suggestion, basedOn: assistEvidenceLabels(lead) };
}
