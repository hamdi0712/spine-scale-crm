// Ad Hub — the ad-building framework in one place: the fixed vocabularies, the
// strategy guidance shown as helper text while positioning a concept, and the
// small derivations the pages share.
//
// Same rule the ICP scorecard and client health follow: the copy lives here, so
// re-wording the guidance or re-tuning the checklist never needs a migration.
// Nothing in this file talks to the database, so client components can import
// it directly.

// ─── Research notes ────────────────────────────────────────────────────────

export const RESEARCH_NOTE_TYPES = [
  "INTERNAL",
  "EXTERNAL",
  "MECHANISM",
  "DESIRE",
] as const;

export type ResearchNoteType = (typeof RESEARCH_NOTE_TYPES)[number];

export const RESEARCH_NOTE_TYPE_LABELS: Record<ResearchNoteType, string> = {
  INTERNAL: "Internal",
  EXTERNAL: "External",
  MECHANISM: "Mechanism",
  DESIRE: "Desire",
};

export const RESEARCH_NOTE_TYPE_BLURBS: Record<ResearchNoteType, string> = {
  INTERNAL:
    "What the client already knows — sales calls, patient objections, what the practice hears every day.",
  EXTERNAL:
    "What the market says without being asked — reviews, forums, comments, competitor ads.",
  MECHANISM:
    "How the treatment or the offer actually works, in plain language you could put in an ad.",
  DESIRE:
    "Raw want statements as people phrase them, before they are tidied into a reusable desire.",
};

// ─── Persona ───────────────────────────────────────────────────────────────

// The framework's own prompts, kept together so the wizard, the detail page
// and the tree all ask for the same things in the same order.
export interface PersonaField {
  key:
    | "demographics"
    | "wantsToBeSeenAs"
    | "believesAboutSelf"
    | "wantsToAchieve"
    | "triedAndFailed"
    | "reasonForFailure";
  label: string;
  placeholder: string;
}

export const PERSONA_FIELDS: PersonaField[] = [
  {
    key: "demographics",
    label: "Demographics",
    placeholder: "Age range, work, location, income, family situation…",
  },
  {
    key: "wantsToBeSeenAs",
    label: "Characteristics they want others to see",
    placeholder: "How they want to come across — capable, active, not fragile…",
  },
  {
    key: "believesAboutSelf",
    label: "What they believe about themselves",
    placeholder:
      "The private story — “I've just got a bad back”, “I left it too late”…",
  },
  {
    key: "wantsToAchieve",
    label: "What they want to achieve",
    placeholder: "The outcome in their own words, not the clinical one",
  },
  {
    key: "triedAndFailed",
    label: "Other solutions tried and failed",
    placeholder: "Chiro, painkillers, injections, stretching videos, rest…",
  },
  {
    key: "reasonForFailure",
    label: "Reason for failure",
    placeholder:
      "Why those did not hold — this is what the mechanism has to answer",
  },
];

// ─── Positioning: awareness ────────────────────────────────────────────────

export const AWARENESS_LEVELS = [
  "UNAWARE",
  "PROBLEM_AWARE",
  "SOLUTION_AWARE",
  "PRODUCT_AWARE",
  "MOST_AWARE",
] as const;

export type AwarenessLevel = (typeof AWARENESS_LEVELS)[number];

export const AWARENESS_LEVEL_LABELS: Record<AwarenessLevel, string> = {
  UNAWARE: "Unaware",
  PROBLEM_AWARE: "Problem Aware",
  SOLUTION_AWARE: "Solution Aware",
  PRODUCT_AWARE: "Product Aware",
  MOST_AWARE: "Most Aware",
};

// Shown as helper text under each option while positioning a concept, the same
// way the ICP scorecard spells out what each score means.
export const AWARENESS_LEVEL_GUIDANCE: Record<AwarenessLevel, string> = {
  UNAWARE:
    "They do not connect what they are living with to a problem worth solving. Lead with the situation, not the offer — a story or a moment they recognise. Sell nothing in the hook.",
  PROBLEM_AWARE:
    "They feel the problem but do not know what fixes it. Name the problem back to them precisely, then open the door to a category of solution.",
  SOLUTION_AWARE:
    "They know solutions exist and have probably tried one. Lead with the mechanism — what makes this way of solving it different from the one that failed them.",
  PRODUCT_AWARE:
    "They know the program and are weighing it up. Lead with proof and specifics — what happens, how long it takes, who it is for.",
  MOST_AWARE:
    "They are already convinced and just need a reason to move now. Lead with the offer and the next step.",
};

export const AWARENESS_GUIDANCE_INTRO =
  "Pick where this persona actually is, not where you wish they were. The awareness level decides what the hook opens with — everything downstream follows it.";

// ─── Positioning: market sophistication ────────────────────────────────────

export const SOPHISTICATION_STAGES = [1, 2, 3, 4, 5] as const;

export type SophisticationStage = (typeof SOPHISTICATION_STAGES)[number];

export interface SophisticationStageMeta {
  stage: SophisticationStage;
  label: string;
  guidance: string;
}

export const SOPHISTICATION_STAGE_META: SophisticationStageMeta[] = [
  {
    stage: 1,
    label: "Stage 1 — First to market",
    guidance:
      "Nobody has made this claim to this market yet. State it plainly and directly; the claim itself does the work.",
  },
  {
    stage: 2,
    label: "Stage 2 — Claims are being copied",
    guidance:
      "Others are making the same claim. Enlarge it — more specific, faster, further than theirs — but keep it the same claim.",
  },
  {
    stage: 3,
    label: "Stage 3 — The market stopped believing claims",
    guidance:
      "Bigger promises no longer land. Lead with the mechanism: the how that makes the claim credible again.",
  },
  {
    stage: 4,
    label: "Stage 4 — The mechanism is being copied",
    guidance:
      "Competitors have your mechanism. Elaborate on it — more complete, easier, less of what they hate about the alternatives.",
  },
  {
    stage: 5,
    label: "Stage 5 — Numb to claims and mechanisms",
    guidance:
      "Nothing said about the product moves them. Shift to identity and experience — who they become, and how it feels to be that person.",
  },
];

export const SOPHISTICATION_GUIDANCE_INTRO =
  "How much of this has the market already heard? Stage is set by the competition, not by your product — read the ads already running before choosing.";

export function sophisticationMeta(stage: number): SophisticationStageMeta {
  return (
    SOPHISTICATION_STAGE_META.find((s) => s.stage === stage) ??
    SOPHISTICATION_STAGE_META[0]
  );
}

export function isSophisticationStage(n: number): boolean {
  return SOPHISTICATION_STAGES.includes(n as SophisticationStage);
}

// ─── Concept ───────────────────────────────────────────────────────────────

export const CONCEPT_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "KILLED"] as const;

export type ConceptStatus = (typeof CONCEPT_STATUSES)[number];

export const CONCEPT_STATUS_LABELS: Record<ConceptStatus, string> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  PAUSED: "Paused",
  KILLED: "Killed",
};

// ─── Creative ──────────────────────────────────────────────────────────────

export const CREATIVE_TYPES = ["PHOTO", "VIDEO", "UGC"] as const;

export type CreativeType = (typeof CREATIVE_TYPES)[number];

export const CREATIVE_TYPE_LABELS: Record<CreativeType, string> = {
  PHOTO: "Photo",
  VIDEO: "Video",
  UGC: "UGC",
};

export const CREATIVE_TYPE_BLURBS: Record<CreativeType, string> = {
  PHOTO: "A single static image — the hook carries almost all the weight.",
  VIDEO: "Scripted and shot. The hook is the first line said and shown.",
  UGC: "Filmed to look like a person talking to camera, not like an ad.",
};

export const CREATIVE_STATUSES = [
  "DRAFT",
  "COMPLIANCE_REVIEW",
  "READY",
  "LAUNCHED",
  "TESTING",
  "WINNER",
  "LOSER",
] as const;

export type CreativeStatus = (typeof CREATIVE_STATUSES)[number];

export const CREATIVE_STATUS_LABELS: Record<CreativeStatus, string> = {
  DRAFT: "Draft",
  COMPLIANCE_REVIEW: "Compliance review",
  READY: "Ready",
  LAUNCHED: "Launched",
  TESTING: "Testing",
  WINNER: "Winner",
  LOSER: "Loser",
};

// Copy guidance shown in the creative wizard. Lengths are the course's, kept
// here rather than hard-coded into the form so they read the same everywhere.
export const CONCEPT_HEADLINE_GUIDANCE =
  "The hook — the bold, predominant text on the creative itself. It is the only thing most people will read, so it carries the concept on its own.";

export const AD_HEADLINE_GUIDANCE =
  "The headline in the ad unit, under the creative. Keep it to 40–50 characters so it does not truncate.";

export const AD_HEADLINE_MIN = 40;
export const AD_HEADLINE_MAX = 50;

// ─── Compliance gate ───────────────────────────────────────────────────────

// The fixed pre-launch checklist. Seeded onto a creative when it is created —
// changing this list affects new creatives, not ones already in flight, the
// same way the delivery checklist works.
export const AD_COMPLIANCE_ITEMS: string[] = [
  "No implied diagnosis or condition-specific language",
  "Frames around program/assessment, not body or diagnosis",
  "No before/after or transformation imagery",
  "No cure, outcome, or treatment-result claims",
  "No condition-based targeting implied",
];

export const AD_COMPLIANCE_RULE =
  "Every item has to be checked before a creative can be marked Ready. This is the gate between written and live — nothing goes to the ad account until it clears.";

export interface ComplianceLike {
  checked: boolean;
}

export function compliancePassed(items: ComplianceLike[]): boolean {
  return items.length > 0 && items.every((i) => i.checked);
}

export function complianceCheckedCount(items: ComplianceLike[]): number {
  return items.filter((i) => i.checked).length;
}

// The one status the gate blocks. Everything else stays selectable — a
// creative can sit in compliance review, or be killed, at any point.
export const COMPLIANCE_GATED_STATUS: CreativeStatus = "READY";

export function isStatusBlocked(
  status: string,
  compliance: ComplianceLike[],
): boolean {
  return status === COMPLIANCE_GATED_STATUS && !compliancePassed(compliance);
}

// ─── Tree rollups ──────────────────────────────────────────────────────────

export interface ConceptStatusLike {
  status: string;
}

// A persona has no status of its own, so the browse tree shows the strongest
// state among its concepts — the same question you would ask looking at the
// row: is anything of theirs actually running?
export function personaRollupStatus(
  concepts: ConceptStatusLike[],
): ConceptStatus | null {
  if (concepts.length === 0) return null;
  const order: ConceptStatus[] = ["ACTIVE", "DRAFT", "PAUSED", "KILLED"];
  return order.find((s) => concepts.some((c) => c.status === s)) ?? null;
}

// "1 concept" / "3 concepts" — used at every level of the tree.
export function countLabel(n: number, singular: string): string {
  return `${n} ${n === 1 ? singular : `${singular}s`}`;
}

// ─── Wizards ───────────────────────────────────────────────────────────────

export interface WizardStep {
  n: number;
  title: string;
  blurb: string;
}

export const CONCEPT_WIZARD_STEPS: WizardStep[] = [
  {
    n: 1,
    title: "Persona",
    blurb: "Who this concept talks to. Reuse one, or write a new one now.",
  },
  {
    n: 2,
    title: "Desire",
    blurb:
      "The want statement this concept answers. Desires are shared — pick the existing one wherever there is one.",
  },
  {
    n: 3,
    title: "Benefit",
    blurb:
      "Feature → benefit, against the desire you just chose. The benefit is the “so you can…” half.",
  },
  {
    n: 4,
    title: "Positioning",
    blurb:
      "Where the persona is, and how much the market has already heard. These two decide how the copy has to open.",
  },
  {
    n: 5,
    title: "Name it",
    blurb: "Name the concept and give it a batch number so it can be tracked.",
  },
];

export const CREATIVE_WIZARD_STEPS: WizardStep[] = [
  {
    n: 1,
    title: "Type",
    blurb: "What is actually being produced.",
  },
  {
    n: 2,
    title: "Hook + headline",
    blurb: "The bold text on the creative, and the headline in the ad unit.",
  },
  {
    n: 3,
    title: "Ad copy",
    blurb: "The body — written to the awareness level the concept is set to.",
  },
  {
    n: 4,
    title: "CTA",
    blurb: "The single next step you are asking for.",
  },
];

// ─── Shared copy ───────────────────────────────────────────────────────────

export const ITERATE_NOTE =
  "Don't kill a concept, iterate on it. Duplicating a creative keeps the concept and the lineage, and starts the copy back at Draft.";
