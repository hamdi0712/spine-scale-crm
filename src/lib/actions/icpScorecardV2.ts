"use server";

// The lead card's two calls under the ICP model: score this lead against the
// active ICP (a suggestion, written nowhere), and save the card with whatever
// was overridden on it.
//
// Same arrangement as the old card's assist, and held to the same rule: the
// model's answer is pre-filled on the card with every citation behind it, and
// nothing is stored until somebody presses Save. The lead id is bound on the
// server (src/app/(app)/pipeline/[id]/page.tsx), so it is always the record
// whose page the card was opened from.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { loadActiveIcp } from "@/lib/icpDefinitionStore";
import { loadPipelineSettings } from "@/lib/pipelineSettingsStore";
import { scoreWithIcp } from "@/lib/icpScoringRun";
import {
  CriterionKey,
  FIT_KEYS,
  IcpBreakdownV2,
  SIGNAL_KEYS,
  V2Override,
  allowedPoints,
  applyOverride,
  emptyBreakdownV2,
  parseBreakdownV2,
  serializeBreakdownV2,
} from "@/lib/icpScoring";

export type V2SuggestResult =
  | { ok: true; breakdown: IcpBreakdownV2 }
  | { ok: false; error: string };

export async function suggestIcpScoresV2(leadId: string): Promise<V2SuggestResult> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    // The evidence and the few record fields a fit criterion can cite.
    // Nothing else on the lead is read, and so nothing else can be sent.
    select: {
      clinicName: true,
      websiteUrl: true,
      websiteNotes: true,
      metaAdsSignal: true,
      reviewCount: true,
      staffCountRaw: true,
      location: true,
      contactName: true,
      contactTitle: true,
    },
  });
  if (!lead) return { ok: false, error: "That lead no longer exists." };

  const icp = await loadActiveIcp();
  if (!icp) {
    return {
      ok: false,
      error: "No ICP Definition is active. Switch one on under Settings → ICP first.",
    };
  }
  const settings = await loadPipelineSettings();
  const result = await scoreWithIcp({
    evidence: lead,
    icp,
    threshold: settings.promotionThresholdV2,
  });
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.failure === "evidence"
          ? `${result.reason.replace(/ — add a website URL on the candidate and run it again\.$/, ".")} Run “Enrich this lead” first, or score it by hand below.`
          : `${result.reason} Nothing has been changed on the card.`,
    };
  }
  return { ok: true, breakdown: result.breakdown };
}

// Saves the card. The base is the breakdown the card was showing — the one
// stored, a fresh suggestion, or a blank card against the active ICP — and
// the override is whatever was changed on it. Both are read back through the
// same functions a run uses, so a saved card is judged by the same rules.
export async function saveIcpScorecardV2(leadId: string, formData: FormData) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { icpBreakdown: true },
  });
  if (!lead) return;

  const now = new Date();
  const posted = formData.get("base");
  let base: IcpBreakdownV2 | null =
    typeof posted === "string" ? parseBreakdownV2(posted) : null;
  base = base ?? parseBreakdownV2(lead.icpBreakdown);
  if (!base) {
    const icp = await loadActiveIcp();
    if (!icp) return;
    const settings = await loadPipelineSettings();
    base = emptyBreakdownV2(icp, settings.promotionThresholdV2, now);
  }

  const points: V2Override["points"] = {};
  for (const key of [...FIT_KEYS, ...SIGNAL_KEYS] as CriterionKey[]) {
    const raw = formData.get(`points_${key}`);
    const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
    // Only a value the criterion can actually take. Anything else is a form
    // somebody tampered with, and the base value stands.
    if (Number.isFinite(n) && allowedPoints(key).includes(n)) points[key] = n;
  }
  const disqualifiers: Record<string, boolean> = {};
  for (const d of base.disqualifiers) {
    disqualifiers[d.id] = formData.get(`dq_${d.id}`) === "on";
  }
  const note = formData.get("overrideNote");

  const saved = applyOverride(
    base,
    {
      points,
      disqualifiers,
      chiropractic: formData.get("chiro") === "on",
      note: typeof note === "string" && note.trim() !== "" ? note.trim().slice(0, 2000) : null,
    },
    now,
  );

  await prisma.lead.update({
    where: { id: leadId },
    data: { icpBreakdown: serializeBreakdownV2(saved), icpBreakdownAt: now },
  });
  revalidatePath(`/pipeline/${leadId}`);
  revalidatePath("/pipeline");
  revalidatePath("/outreach");
  revalidatePath("/");
}
