// The outreach hook — one true line about a clinic, for the top of a
// connection request.
//
// It reads the same evidence the scoring assist reads (src/lib/icpAssist.ts)
// and asks a different question of it. Scoring asks "is this clinic worth
// talking to"; this asks "what would somebody who spent two minutes looking at
// this clinic have noticed" — a named program, a service combination, a review
// count worth remarking on, an ad campaign that has been running a while.
//
// The whole value of it is that the line is *true and specific*. A generic
// opener is worse than none: it reads as a template to the person receiving
// it, which is exactly the impression a hand-written first line exists to
// avoid. So the model is told, at length and with examples, that returning
// null is the correct answer whenever the evidence will not support something
// concrete — and the reply is held to that here rather than being trusted to
// have obeyed.
//
// What this is not: it is not a message, and nothing in this app sends it.
// The action stores the line, the panel puts it inside a note template, and a
// human reads it, edits it, copies it, and pastes it into LinkedIn. The same
// arrangement as every other outreach step here.
//
// Nothing in this module touches the network or the database: the prompt and
// the readers are pure, and src/lib/actions/outreachHook.ts does the call.

import { IcpAssistEvidence, ASSIST_NOTES_MAX_CHARS } from "@/lib/icpAssist";

// A clause, not a paragraph. Long enough for "Saw you're running the
// decompression program alongside PT", short enough that anything approaching
// a pitch is refused rather than trimmed into one.
export const HOOK_MAX_CHARS = 180;

// Below this it cannot be specific — "Nice site" fits in twelve characters.
const HOOK_MIN_CHARS = 15;

// The sentence in the evidence the line was read off, kept short: it is shown
// under the draft so the claim can be checked before it is sent to a stranger.
const EVIDENCE_MAX_CHARS = 300;

// One clause, and a citation for it. This answer is two sentences of output at
// most, so it needs a fraction of the scoring assist's ceiling.
export const HOOK_MAX_TOKENS = 300;

// ─── What comes back ───────────────────────────────────────────────────────

export type OutreachHookResult =
  | {
      ok: true;
      // Null when the evidence would not support anything specific enough to
      // be credible. That is a real answer and the panel says so — it is not
      // an error, and it must never be filled in with something generic.
      hook: string | null;
      // What in the evidence the line was read off, where the model cited it.
      evidence: string | null;
      // Which enrichment fields it had to work from, so the panel can say what
      // the line was made from rather than implying it saw everything.
      basedOn: string[];
    }
  | { ok: false; error: string };

// ─── The prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = [
  "You write the opening line of a LinkedIn connection request for a marketing agency that works with chiropractic and non-surgical spine clinics.",
  "You write from the evidence you are given and nothing else. You have no knowledge of this clinic beyond the evidence block, and you never state a fact it does not state — no invented program names, no guessed locations, no flattery dressed up as an observation.",
  "You would rather return null than write something that could be sent to any clinic. A generic opener is worse than no opener: it reads as a mail merge to the person receiving it, which is the one thing a hand-written first line exists to avoid.",
  // The lowercase "json" is load-bearing, not a typo. DeepSeek refuses a
  // request that asks for response_format json_object unless the word appears
  // in a prompt, and its documentation writes that word in lower case
  // throughout. Saying it both ways costs a clause and satisfies the check
  // whichever way it is spelled.
  "You reply with a single JSON object in exactly the shape requested, and nothing else — your reply is parsed as json, so any prose around it breaks it.",
].join(" ");

export function buildHookPrompt(evidence: IcpAssistEvidence): {
  system: string;
  user: string;
} {
  return { system: SYSTEM_PROMPT, user: userPrompt(evidence) };
}

function userPrompt(evidence: IcpAssistEvidence): string {
  return [
    `CLINIC: ${evidence.clinicName}`,
    "",
    "EVIDENCE",
    "Gathered by an automated enrichment run. This is everything you have.",
    "",
    evidenceBlock(evidence),
    "",
    "TASK",
    "Find the single most specific true detail about this clinic in the evidence above — the kind of thing somebody who spent two minutes actually looking at them would notice — and write it as one short clause.",
    "",
    "What counts as specific enough:",
    "  - a named treatment program or protocol the clinic offers",
    "  - a combination of services that is worth remarking on together",
    "  - an observation about the review count, where the number supports it",
    "  - something concrete about the ads they are running or how long for",
    "",
    "What does not count, and must return null instead:",
    "  - anything true of every clinic (\"great website\", \"clearly patient-focused\", \"impressive practice\")",
    "  - praise with no fact in it",
    "  - a detail you are inferring rather than reading",
    "  - restating the clinic's name or town back at them",
    "",
    "REGISTER",
    "Match these two exactly — an observation, in the first person, understated, no pitch and no compliment:",
    "  \"Saw you're running the decompression program alongside PT\"",
    "  \"Noticed the strong review count on your booking experience\"",
    "",
    `Under ${HOOK_MAX_CHARS} characters. No trailing full stop — it is dropped into the middle of a sentence. No square brackets: the note it goes into uses them for placeholders. Do not name the clinic, do not greet anybody, and do not add a call to action; the note around this line already does all three.`,
    "",
    "REPLY FORMAT",
    "A single JSON object, exactly these keys:",
    "{",
    '  "hook": "<the clause>" | null,',
    '  "evidence": "<the phrase in the evidence you read it off, quoted>" | null',
    "}",
    "",
    "Return null for hook whenever the evidence will not support something concrete. That is a correct and expected answer, not a failure — a clinic whose crawl returned a page of navigation links has nothing specific in it, and saying so is more useful than a sentence that could be sent to anybody.",
  ].join("\n");
}

// The evidence, with its absences named — the same arrangement the scoring
// assist uses, and for the same reason: a missing field stated is a field the
// model knows was not checked, rather than one it quietly writes around.
function evidenceBlock(evidence: IcpAssistEvidence): string {
  const notes = (evidence.websiteNotes ?? "").trim();
  const ads = (evidence.metaAdsSignal ?? "").trim();
  return [
    "Website notes — text crawled from the clinic's own site:",
    notes === ""
      ? "(not gathered — no website notes on this lead)"
      : `"""\n${truncate(notes, ASSIST_NOTES_MAX_CHARS)}\n"""`,
    "",
    `Meta ads signal: ${ads === "" ? "(not gathered)" : ads}`,
    `Google review count: ${
      evidence.reviewCount === null ? "(not gathered)" : evidence.reviewCount
    }`,
  ].join("\n");
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// ─── Reading the reply ─────────────────────────────────────────────────────

// The model's JSON, held to what a hook is allowed to be. Returns null for the
// reply itself only when it could not be read at all; a reply that parsed and
// declined to offer a line is { hook: null }, which is a real answer.
export function parseHookReply(
  raw: string,
): { hook: string | null; evidence: string | null } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const body = parsed as Record<string, unknown>;
  const hook = readHook(body.hook);
  return {
    hook,
    // A citation with no line to cite is noise, so it travels only with one.
    evidence: hook === null ? null : readText(body.evidence, EVIDENCE_MAX_CHARS),
  };
}

// A line, or nothing. Every rule here is one the prompt already asked for, and
// is applied again because a prompt is a request and this is the gate.
export function readHook(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  // Whitespace collapses: this goes into one line of a note, and a clause with
  // a newline in it would break the template it is dropped into.
  let hook = raw.replace(/\s+/g, " ").trim();

  // Surrounding quotes are the commonest way a model returns a "clause".
  hook = hook.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();

  // The template supplies the full stop, because the line sits mid-sentence.
  hook = hook.replace(/[.!]+$/, "").trim();

  if (hook.length < HOOK_MIN_CHARS || hook.length > HOOK_MAX_CHARS) return null;

  // Square brackets mean an unfilled placeholder — "[Clinic Name]" — and the
  // note around this line uses them for exactly that. One arriving inside the
  // hook would read as a mail merge that failed, which is the precise
  // impression this feature exists to avoid.
  if (/[[\]]/.test(hook)) return null;

  // Nothing but punctuation is not a clause.
  if (!/[a-z]/i.test(hook)) return null;

  return hook;
}

function readText(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (trimmed === "") return null;
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

// ─── The note it goes into ─────────────────────────────────────────────────

// What is left where a lead has no contact name. Kept as the bracketed
// placeholder rather than guessed at or smoothed away: a request that opens
// "Hi —" is worse than one that plainly needs a name typing in, and the person
// sending it is reading this box before they send anything.
export const CONTACT_NAME_PLACEHOLDER = "[Contact Name]";

// The full connection note, pre-filled. One string, built in one place, so the
// panel cannot word it differently from anything else that comes to use it.
//
// The hook is dropped in mid-sentence and the full stop after it belongs to
// the template — which is why readHook strips a trailing one.
export function connectionNote({
  contactName,
  clinicName,
  hook,
}: {
  contactName: string | null;
  clinicName: string;
  hook: string;
}): string {
  const name = (contactName ?? "").trim() || CONTACT_NAME_PLACEHOLDER;
  return `Hi ${name} — came across ${clinicName.trim()} while looking into non-surgical spine/disc practices. ${hook}. Would love to connect.`;
}
