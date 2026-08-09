// Second looks — finding the rejections that are worth re-reading.
//
// The rejected list exists because the only useful thing to do with a rejection
// is disagree with it (src/app/(app)/discovery/rejected/page.tsx). This is the
// sweep that says which ones to start with, and it is a suggestion in the
// strictest sense the app has: it flags, it never promotes. Nothing downstream
// reads a flag, no status moves, and the only thing that can act on one is a
// person pressing "Promote anyway" — the same press, with the same confirmation
// on it, that was always there.
//
// The work splits the way every scoring decision in this app splits, and for
// the same reason (see "The two categories that need no model" in
// src/lib/discovery.ts): what can be worked out is worked out, and only the
// judgement is asked for.
//
//   Computed — the arithmetic. A clinic rejected one point under the promotion
//   bar is a near miss, and that is a subtraction, not an opinion. So is a
//   clinic that a disqualifier stopped but whose categories still added up past
//   the bar — "disqualified, and would have scored 8" is named in
//   src/lib/discovery.ts as the shape of the one clinic somebody will want to
//   look at again, and it is free to find.
//
//   Assist — the reading. Whether a disqualifier's stored reason is clear-cut
//   ("the site describes a surgical spine center with three surgeons named")
//   or a hedge dressed as a finding ("the site does not clearly say the clinic
//   is non-surgical") is a judgement about language, which is the one thing
//   here worth paying a model for. It sees the reasoning the run stored and
//   nothing else — no website notes, no ads signal, no re-scoring. It is not
//   asked whether the clinic is any good; it is asked whether the sentence that
//   ended the clinic's run actually establishes what it claims.
//
// A flag carries which of the two found it, because a reader deciding how much
// weight to give one needs to know whether it is a subtraction or a reading.
//
// Nothing here touches the network or the database: the rules, the prompt and
// the parsing are pure, and src/lib/actions/secondLook.ts does the call.

import { DiscoveryBreakdown, triggeredDisqualifiers } from "@/lib/discovery";
import { ICP_MAX_SCORE } from "@/lib/icp";

// How far under the promotion bar still counts as a near miss. One point: at
// two, a bar of 5 would flag every clinic that scored 3, which is most of the
// list and therefore no signal at all.
export const SECOND_LOOK_NEAR_MISS_MARGIN = 1;

// How many disqualified rejections one run sends to the model. The sweep is a
// single call, and this is what keeps that call a fixed, knowable size.
//
// Where there are more, the run takes them in the list's own order — highest
// score first, because that is where a decision worth overruling would be — and
// says plainly how many it did not reach. It is deliberately not a queue that
// works through a backlog across runs: a sweep that reviewed a different 25
// every time would make "nothing was flagged" mean nothing.
export const SECOND_LOOK_MAX_REVIEWED = 25;

// One flag per candidate. 25 of them, a sentence each.
const SECOND_LOOK_MAX_TOKENS = 1600;

// A flag's reason sits on one line in a list. Held to that on the way in.
const REASON_MAX_CHARS = 200;

// ─── What it reads ─────────────────────────────────────────────────────────

// The same two words a scored line in the breakdown uses for where its answer
// came from, and deliberately so — DISCOVERY_SOURCE_LABELS in
// src/lib/discovery.ts is what turns these into "Computed" and "DeepSeek" on
// screen, in one place for both.
export type SecondLookSource = "computed" | "assist";

// One rejected candidate, as the sweep sees it. Everything here is already on
// the record: the sweep re-reads the run's own verdict and never re-runs it.
export interface SecondLookCandidate {
  id: string;
  clinicName: string;
  disqualified: boolean;
  icpTotal: number | null;
  disqualifiedReason: string | null;
  // Parsed from the stored JSON, or null where a candidate carries no
  // breakdown — an older row, or one written before the run finished. Without
  // it there is no reasoning to weigh, so the model half skips it.
  breakdown: DiscoveryBreakdown | null;
}

export interface SecondLookFlag {
  flagged: boolean;
  reason: string;
  source: SecondLookSource;
}

// What one sweep did, for the panel that reports it.
export interface SecondLookRunSummary {
  // Every rejected candidate the sweep examined at all.
  examined: number;
  flagged: number;
  // Found by subtraction, and by the model, in that order.
  computed: number;
  assisted: number;
  // Disqualified candidates past SECOND_LOOK_MAX_REVIEWED that this run did not
  // send to the model. Zero on any ordinary list.
  notReached: number;
}

export type SecondLookResult =
  | { ok: true; summary: SecondLookRunSummary }
  | { ok: false; error: string };

// ─── The half that needs no model ──────────────────────────────────────────

// The two arithmetic rules, in the order they are worth reading. Returns null
// where neither applies, which is most of the list — a clinic that scored 1/10
// was not nearly promoted and saying so would be noise.
export function computedFlag(
  candidate: SecondLookCandidate,
  threshold: number,
): SecondLookFlag | null {
  const total = candidate.icpTotal;
  if (total === null) return null;

  if (!candidate.disqualified) {
    // Rejected on score alone. Anything from one point under the bar upward is
    // a near miss; anything at or over it was not rejected on score and is not
    // this rule's business.
    if (total >= threshold - SECOND_LOOK_NEAR_MISS_MARGIN && total < threshold) {
      const short = threshold - total;
      return {
        flagged: true,
        source: "computed",
        reason: `Scored ${total}/${ICP_MAX_SCORE} against a promotion bar of ${threshold} — ${short} point${short === 1 ? "" : "s"} short.`,
      };
    }
    return null;
  }

  // Stopped by a disqualifier, but the categories still added up past the bar.
  // The disqualifier may well be right; what makes this worth a look is that
  // everything except the disqualifier said yes.
  if (total >= threshold) {
    return {
      flagged: true,
      source: "computed",
      reason: `Disqualified, but the scored categories still came to ${total}/${ICP_MAX_SCORE} — at or above the promotion bar of ${threshold}.`,
    };
  }
  return null;
}

// Which candidates are worth asking about: disqualified, carrying reasoning to
// weigh, and not already flagged by subtraction — there is nothing to buy by
// paying for a second opinion on a candidate the list is already marking.
//
// Ordered highest score first, the same order the list itself uses, then capped.
export function selectForReview(
  candidates: SecondLookCandidate[],
  threshold: number,
): { review: SecondLookCandidate[]; deferred: SecondLookCandidate[] } {
  const eligible = candidates
    .filter(
      (c) =>
        c.disqualified &&
        computedFlag(c, threshold) === null &&
        triggeredWithReasons(c).length > 0,
    )
    .sort((a, b) => (b.icpTotal ?? -1) - (a.icpTotal ?? -1));
  return {
    review: eligible.slice(0, SECOND_LOOK_MAX_REVIEWED),
    // The ones this run has no opinion about. Named rather than counted,
    // because the action has to leave exactly these rows alone.
    deferred: eligible.slice(SECOND_LOOK_MAX_REVIEWED),
  };
}

// The disqualifiers that fired, with the sentence the run stored against each.
// A disqualifier that fired with no reason recorded is dropped rather than sent
// as an empty string: asking whether "" is clear-cut would get an answer.
function triggeredWithReasons(
  candidate: SecondLookCandidate,
): { label: string; reason: string }[] {
  if (!candidate.breakdown) return [];
  return triggeredDisqualifiers(candidate.breakdown)
    .filter((d) => d.reason.trim() !== "")
    .map((d) => ({ label: d.label, reason: d.reason.trim() }));
}

// ─── The prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = [
  "You audit the reasoning behind automated rejections for a marketing agency that qualifies chiropractic and non-surgical spine clinics.",
  "You are shown why each clinic was disqualified, and nothing else. You have no knowledge of these clinics beyond that text, and you never judge whether a clinic is a good prospect — that is not the question.",
  "The only question is whether the stated reason actually establishes what it claims. A reason that cites something specific and observed is clear-cut. A reason that hedges, generalises, reads as an assumption, or rests on the absence of evidence rather than on evidence is not.",
  "You are conservative: most automated rejections are correct, and flagging one costs somebody's time. Where the reason plainly establishes the disqualifier, you say so and move on.",
  // The lowercase "json" is load-bearing here exactly as it is in
  // src/lib/icpAssist.ts — DeepSeek refuses a response_format json_object
  // request unless the word appears in a prompt.
  "You reply with a single JSON object in exactly the shape requested, and nothing else — your reply is parsed as json, so any prose around it breaks it.",
].join(" ");

export function buildSecondLookPrompt(candidates: SecondLookCandidate[]): {
  system: string;
  user: string;
  maxTokens: number;
} {
  return {
    system: SYSTEM_PROMPT,
    user: userPrompt(candidates),
    maxTokens: SECOND_LOOK_MAX_TOKENS,
  };
}

function userPrompt(candidates: SecondLookCandidate[]): string {
  const blocks = candidates.map((candidate, i) => {
    const lines = [
      `[${i + 1}] ${candidate.clinicName}`,
      candidate.icpTotal === null
        ? "Scored categories: none recorded"
        : `Scored categories: ${candidate.icpTotal}/${ICP_MAX_SCORE} (scoring continued past the disqualifier, so this is what it would have totalled)`,
      "Disqualifiers that fired:",
    ];
    for (const d of triggeredWithReasons(candidate)) {
      lines.push(`  - ${d.label}: ${d.reason}`);
    }
    return lines.join("\n");
  });

  return [
    "REJECTIONS TO AUDIT",
    "Each block is one clinic an automated run disqualified, with the reason it recorded. The reasons were written by a model reading a website crawl, an ads-library lookup and a review count.",
    "",
    blocks.join("\n\n"),
    "",
    "TASK",
    "For each numbered clinic, decide whether its disqualification reasoning is clear-cut or borderline.",
    "",
    "Borderline means the reason does not actually establish the disqualifier. Examples of borderline reasoning:",
    "- It rests on what the evidence did not say rather than on what it said (\"the site does not mention support staff\").",
    "- It hedges (\"appears to\", \"likely\", \"may be\") on the one fact the disqualifier turns on.",
    "- It generalises from something adjacent (\"the clinic is in a medical building\") to the disqualifying fact.",
    "- It states a fact that does not meet the disqualifier as written (a clinic that offers one surgical referral pathway is not a surgical practice).",
    "",
    "Clear-cut means the reason names something specific and observed that meets the disqualifier as written. Say so and set borderline to false.",
    "",
    "Judge only the reasoning in front of you. Do not speculate about what a fresh look might find, and do not recommend promoting anything — you are marking which rejections a person should re-read, nothing more.",
    "",
    "REPLY FORMAT",
    "A single JSON object, exactly these keys:",
    "{",
    '  "verdicts": [',
    '    { "index": <the number in brackets>, "borderline": <true|false>, "reason": "<one sentence>" }',
    "  ]",
    "}",
    "",
    `One entry per clinic, every index accounted for. Each reason is one sentence under ${REASON_MAX_CHARS} characters saying what about the stated reasoning is thin — not what the clinic is like. For a clear-cut rejection the reason may be brief.`,
  ].join("\n");
}

// ─── Reading the reply ─────────────────────────────────────────────────────

export interface SecondLookVerdict {
  index: number;
  borderline: boolean;
  reason: string;
}

// The model's JSON, held to the shape the sweep can use. Returns null only when
// the reply carries no verdicts array at all, which the action reports as a
// malformed answer. Individual entries that are unusable are dropped: a reply
// with twenty good verdicts and one missing an index is worth twenty, and the
// candidate whose verdict went missing is left exactly as it was rather than
// being cleared on the strength of a broken line.
export function parseSecondLookVerdicts(raw: string): SecondLookVerdict[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const verdicts = (parsed as Record<string, unknown>).verdicts;
  if (!Array.isArray(verdicts)) return null;

  return verdicts.flatMap((item): SecondLookVerdict[] => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const entry = item as Record<string, unknown>;
    const index = entry.index;
    const borderline = entry.borderline;
    if (typeof index !== "number" || !Number.isInteger(index)) return [];
    if (typeof borderline !== "boolean") return [];
    const reason = typeof entry.reason === "string" ? entry.reason.trim() : "";
    // A borderline verdict with no reason is not actionable — the flag exists
    // to tell somebody what to re-read, and "look again" is not that.
    if (borderline && reason === "") return [];
    return [
      {
        index,
        borderline,
        reason:
          reason.length > REASON_MAX_CHARS
            ? `${reason.slice(0, REASON_MAX_CHARS)}…`
            : reason,
      },
    ];
  });
}

// The sentence the panel reports a finished run with. Written here rather than
// in the component so the counting and the wording stay together.
export function summariseRun(summary: SecondLookRunSummary): string {
  if (summary.examined === 0) {
    return "There are no rejected candidates to look through.";
  }
  const examined = `Looked through ${summary.examined} rejection${summary.examined === 1 ? "" : "s"}`;
  if (summary.flagged === 0) {
    return `${examined} and flagged none — every one of them reads as a decision that stands.`;
  }
  const parts: string[] = [];
  if (summary.computed > 0) {
    parts.push(`${summary.computed} scored close to the bar`);
  }
  if (summary.assisted > 0) {
    parts.push(
      `${summary.assisted} disqualified on reasoning that reads thin`,
    );
  }
  return `${examined} and flagged ${summary.flagged} for a second look — ${parts.join(", ")}.`;
}
