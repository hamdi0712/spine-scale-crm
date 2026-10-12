// The enrichment evidence every model call in the scoring and outreach paths
// is written from — what it is, whether there is any, and what to call it.
//
// This file used to hold the old lead scorecard's scoring assist as well (the
// "Suggest remaining scores" button on the A–D card). That card was replaced by
// the ICP model's (src/components/IcpScorecardV2.tsx), whose one call lives in
// src/lib/icpScoringAssist.ts; what stays here is the part every caller still
// shares: the evidence shape, the gate that says there is something to read,
// the labels it is named by, and how much of the website copy is sent.
//
// Nothing here touches the network or the database.

// How much of the website notes to send. The crawler stores up to 20k
// characters (three pages), and the answer to "does this clinic name a program
// and price it" is on the first few thousand — the rest is a blog. Cut with an
// ellipsis so a truncated note never reads to the model as a complete one.
export const ASSIST_NOTES_MAX_CHARS = 12000;

// ─── What it reads ─────────────────────────────────────────────────────────

// The enrichment fields, and nothing else off the lead. The clinic name goes
// with them so the summary can name the clinic; no contact, no stage, and no
// note anybody typed is ever sent.
export interface IcpAssistEvidence {
  clinicName: string;
  websiteNotes: string | null;
  metaAdsSignal: string | null;
  reviewCount: number | null;
}

// Whether there is anything to read at all. The button is disabled without it,
// and the action refuses without it — a lead that has never been enriched has
// nothing for a model to score, and asking anyway would produce three
// confident sentences about no evidence.
export function hasAssistEvidence(evidence: {
  websiteNotes: string | null;
  metaAdsSignal: string | null;
  reviewCount: number | null;
}): boolean {
  return (
    (evidence.websiteNotes ?? "").trim() !== "" ||
    (evidence.metaAdsSignal ?? "").trim() !== "" ||
    evidence.reviewCount !== null
  );
}

// What a model call was made from, named for the reader. Same labels the
// enrichment panel uses, so "based on Website notes, Review count" reads as
// the same fields the run reported writing.
export function assistEvidenceLabels(evidence: {
  websiteNotes: string | null;
  metaAdsSignal: string | null;
  reviewCount: number | null;
}): string[] {
  const labels: string[] = [];
  if ((evidence.websiteNotes ?? "").trim() !== "") labels.push("Website notes");
  if ((evidence.metaAdsSignal ?? "").trim() !== "") labels.push("Meta ads signal");
  if (evidence.reviewCount !== null) labels.push("Review count");
  return labels;
}
