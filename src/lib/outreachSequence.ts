// The outreach sequence — five messages, in the order they happen, and the
// rules about each.
//
// This is the outreach hook grown up. That feature wrote one true line for the
// top of a connection request; this writes the connection request, the message
// after it is accepted, the audit offer after they reply, the note that
// delivers the Loom, and the follow-up when it all goes quiet. The first step
// is the old feature, whole — same evidence, same prompt about specificity,
// same refusal to write something generic — with four steps standing behind it.
//
// Three rules run through the whole module.
//
//   The templates are the templates. Each step's wording was written by the
//   person who sends these, and the model's job is to fill the blanks in it,
//   not to improve it. Steps 3 to 5 have no evidence-shaped blank at all — they
//   are fixed prose with a name, a clinic and a link in them — so they are
//   built here, in code, and a model is never asked. Only steps 1 and 2 need a
//   true specific detail, and they are the only two that cost a call.
//
//   Later steps see earlier ones. Every prompt is given the messages already
//   drafted for this lead, so the first message does not re-make the
//   observation the connection request already made. That is the whole reason
//   the drafts are a table rather than five columns.
//
//   First names, with a Dr. in front where one is owed. Every template
//   addresses somebody by their first name, because that is how these are
//   actually written, and a message opening "Hi Dr. Sarah Whitfield" reads as a
//   mail merge. But this pipeline is full of chiropractors, and "Hi Mike" to
//   somebody whose own clinic calls them Dr. Mike is its own kind of wrong — so
//   the title is worked out from the data (salutation() below) and the answer is
//   "Dr. Mike": the honorific with the first name, which is the register these
//   practices actually use. It is decided once for the whole sequence, because
//   code fills three of the five steps and only a model writes the other two.
//
// Pure. Nothing here touches the network or the database: the prompts and the
// readers live here, and src/lib/actions/outreachSequence.ts makes the calls.

import { IcpAssistEvidence, ASSIST_NOTES_MAX_CHARS } from "@/lib/icpAssist";

// ─── The steps ─────────────────────────────────────────────────────────────

// In the order they happen, which is also the order the panel lists them in.
// SQLite has no enums, so this constant is the enum — OutreachMessage.step is
// held to it here, exactly as a lead's stage is held to LEAD_STAGES.
export const OUTREACH_STEPS = [
  "CONNECTION",
  "FIRST_MESSAGE",
  "AUDIT_OFFER",
  "LOOM_DELIVERY",
  "FOLLOW_UP",
] as const;

export type OutreachStep = (typeof OUTREACH_STEPS)[number];

export function isOutreachStep(value: unknown): value is OutreachStep {
  return (
    typeof value === "string" &&
    (OUTREACH_STEPS as readonly string[]).includes(value)
  );
}

export const OUTREACH_STEP_LABELS: Record<OutreachStep, string> = {
  CONNECTION: "Connection request",
  FIRST_MESSAGE: "First message",
  AUDIT_OFFER: "Audit offer",
  LOOM_DELIVERY: "Loom delivery",
  FOLLOW_UP: "Follow-up",
};

// What each step is for, in one line, shown under its title on the timeline.
export const OUTREACH_STEP_BLURBS: Record<OutreachStep, string> = {
  CONNECTION:
    "One true specific detail about the clinic, and nothing that reads as a pitch.",
  FIRST_MESSAGE:
    "Three openers to choose between, each ending in a question rather than an offer.",
  AUDIT_OFFER:
    "The offer to record something specific for them, once they have replied.",
  LOOM_DELIVERY: "The note the video goes out with.",
  FOLLOW_UP: "One gentle nudge when it has gone quiet, and no more than one.",
};

// Which steps a model writes, and which are filled in from the template here.
// The dividing line is whether the step has a blank only the evidence can fill:
// steps 1 and 2 do, steps 3 to 5 are fixed prose with substitutions.
export function stepUsesModel(step: OutreachStep): boolean {
  return step === "CONNECTION" || step === "FIRST_MESSAGE";
}

// The first message is generated as three alternatives for a person to choose
// between; every other step is one message.
export const FIRST_MESSAGE_VARIANTS = ["A", "B", "C"] as const;

export type FirstMessageVariant = (typeof FIRST_MESSAGE_VARIANTS)[number];

// What each variant is trying to be, stated for the prompt and shown beside
// each option's label so a choice between three is a choice between three known
// things rather than three paragraphs to read.
//
// Kept to three or four words each: this sits on one line beside "Option A" and
// the character count, in a column the width of the lead page's main body, and
// a blurb that wraps puts the count on a line of its own.
export const VARIANT_BLURBS: Record<FirstMessageVariant, string> = {
  A: "Site or booking",
  B: "Their ad activity",
  C: "Warm and general",
};

// ─── Lengths ───────────────────────────────────────────────────────────────

// LinkedIn's own ceiling on a connection note is 300 characters, and the
// template's fixed words take about 110 of them. This is the whole note, so it
// is the number the panel counts against.
export const CONNECTION_MAX_CHARS = 300;

// A first message is a short paragraph ending in a question. Long enough for an
// observation and the question about it, short enough that a pitch will not fit.
export const FIRST_MESSAGE_MAX_CHARS = 600;

// Below this, nothing was written. "Hi Sarah — thoughts?" is thirty characters.
const MESSAGE_MIN_CHARS = 40;

// One note, or three short ones. Comfortably over what either answer needs.
export const SEQUENCE_MAX_TOKENS = 900;

// ─── Names, and whether to call somebody Dr. ───────────────────────────────

// What is left where a lead has no contact name — the same placeholder the hook
// panel used, kept as a bracketed blank rather than guessed at or smoothed
// away. A message that opens "Hi —" is worse than one that plainly needs a name
// typing in, and the person sending it is reading the box before they send.
export const CONTACT_NAME_PLACEHOLDER = "[First Name]";

// Honorifics and post-nominals that are not a first name, however the record
// happens to be written. "Dr. Sarah Whitfield, DC" is Sarah.
const TITLES = /^(dr|dr\.|doctor|mr|mr\.|mrs|mrs\.|ms|ms\.|miss|prof|prof\.|professor)$/i;

// The doctor titles specifically, as opposed to the plain courtesy ones. A
// contact recorded as "Mr. Alvarez" is being told apart from "Dr. Alvarez"
// here, not lumped in with them.
const DOCTOR_TITLES = /^(dr|dr\.|doctor)$/i;

// The letters after the comma that mean this person is addressed as Dr. in
// their own field. DC is a chiropractor, DPT a physical therapist, DO and MD
// physicians, DACNB and DACBSP the chiropractic board diplomates — all of them
// people whose own clinic's website will say "Dr." in front of their name.
//
// Deliberately not a general credentials list: LMT, CMT, RN, ATC and the like
// are real qualifications whose holders are not called Dr., and putting them in
// here would be the exact mistake this feature exists to avoid, in the other
// direction.
const DOCTOR_CREDENTIALS =
  /^(dc|dpt|pt,?\s*dpt|md|do|dacnb|dacbsp|dabci|dc,?\s*ccsp|ccsp|phd)$/i;

// A name for a regex, with everything the regex would read as syntax escaped.
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Where the "Dr." came from, said in the words the panel shows under the
// sequence — somebody about to paste "Hi Dr. Mike" into LinkedIn is entitled to
// know what made this app decide that.
export type HonorificSource =
  | "the contact name on this lead"
  | "the letters after their name"
  | "how their own website refers to them"
  | null;

export interface Salutation {
  // What goes after "Hi" — "Dr. Mike", "Mike", or the placeholder.
  address: string;
  // The bare first name, without the title.
  first: string;
  honorific: "Dr." | null;
  source: HonorificSource;
}

// Cleaned name parts: the bit before the comma, split on spaces, titles kept
// so the caller can look at them.
function nameParts(contactName: string | null): string[] {
  return (contactName ?? "")
    .split(",")[0]
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((part) => part !== "");
}

// Anything after the first comma — "Dr. Sarah Whitfield, DC" gives ["DC"].
function credentials(contactName: string | null): string[] {
  const [, ...rest] = (contactName ?? "").split(",");
  return rest.map((c) => c.replace(/\s+/g, " ").trim()).filter((c) => c !== "");
}

// The first name, and only ever the first name.
//
// This is the one substitution every template makes and the one most likely to
// be embarrassing, so it is done here rather than left to a model — a prompt
// asking for a first name is a request, and this is the gate. A record holding
// only a surname, only a title, or a company name in the contact field comes
// back as the placeholder: a blank somebody fills in beats a greeting addressed
// to "Whitfield Spine Center".
export function firstName(contactName: string | null): string {
  const parts = nameParts(contactName);
  if (parts.length === 0) return CONTACT_NAME_PLACEHOLDER;

  const first = parts.find((part) => !TITLES.test(part));
  if (first === undefined) return CONTACT_NAME_PLACEHOLDER;

  // A single token that is the whole name is as likely to be a surname as a
  // first name, and "Hi Whitfield" is worse than a blank. Two tokens or more
  // and the first non-title one is a first name.
  if (parts.length === 1 && first.length < 2) return CONTACT_NAME_PLACEHOLDER;

  return first;
}

// The surname, where the record has one. Used only to look this person up in
// their own website copy, never to address them — "Hi Dr. Whitfield" is not the
// register any of these messages are written in.
function lastName(contactName: string | null): string | null {
  const named = nameParts(contactName).filter((part) => !TITLES.test(part));
  return named.length >= 2 ? named[named.length - 1] : null;
}

// Whether this clinic's own crawled copy calls this person Dr.
//
// The one signal that has to be handled carefully. A chiropractic clinic's
// website says "Dr." constantly — about the founder, the associates, the person
// who left last year — so a bare search for the word would put a doctorate on
// every receptionist in the pipeline. It is only a match when "Dr." sits
// directly in front of *this contact's* name.
//
// The surname is the anchor where there is one, because a first-name match on
// its own is exactly how the office manager called Sarah ends up wearing Dr.
// Sarah the owner's title. With no surname on the record, a first-name match is
// all there is, and it is taken — a clinic page that says "Dr. Mike" about the
// only Mike it mentions is usually right.
function websiteCallsThemDoctor(
  contactName: string | null,
  websiteNotes: string | null,
): boolean {
  const notes = (websiteNotes ?? "").trim();
  if (notes === "") return false;

  const first = firstName(contactName);
  const last = lastName(contactName);
  const anchor = last ?? (first === CONTACT_NAME_PLACEHOLDER ? null : first);
  if (anchor === null) return false;

  // "Dr Mike", "Dr. Mike", "Drs. Mike" — and, where both names are known,
  // "Dr. Mike Alvarez" as well as "Dr. Alvarez".
  const pattern = new RegExp(
    `\\bdrs?\\.?\\s+(?:${escapeRegex(first)}\\s+)?${escapeRegex(anchor)}\\b`,
    "i",
  );
  return pattern.test(notes);
}

// How to address this person, decided once and used by every step.
//
// Three signals, strongest first, and all three are read off stored data rather
// than asked of a model: the title somebody typed into the contact field, the
// letters after their name, and their own website's copy. A plain courtesy title
// ("Mr. Alvarez") settles it the other way and stops the website check running,
// because a record that says Mr. is a record somebody filled in on purpose.
//
// It is deliberately one decision rather than one per step. The model writes
// steps 1 and 2 and code fills 3 to 5, and a sequence that opened "Hi Dr. Mike"
// and followed up with "Hey Mike" would read as two people writing.
export function salutation(
  contactName: string | null,
  websiteNotes: string | null,
): Salutation {
  const first = firstName(contactName);
  const parts = nameParts(contactName);
  const titled = parts.filter((part) => TITLES.test(part));

  const doctorTitle = titled.some((part) => DOCTOR_TITLES.test(part));
  const courtesyTitle = titled.length > 0 && !doctorTitle;
  const doctorCredential = credentials(contactName).some((c) =>
    DOCTOR_CREDENTIALS.test(c),
  );

  const source: HonorificSource = doctorTitle
    ? "the contact name on this lead"
    : doctorCredential
      ? "the letters after their name"
      : !courtesyTitle && websiteCallsThemDoctor(contactName, websiteNotes)
        ? "how their own website refers to them"
        : null;

  const honorific = source === null ? null : ("Dr." as const);
  return {
    address: honorific === null ? first : `${honorific} ${first}`,
    first,
    honorific,
    source,
  };
}

// One line for the panel, so the decision is visible before anything is pasted
// into LinkedIn rather than discovered in the message.
export function salutationNote(s: Salutation): string {
  if (s.first === CONTACT_NAME_PLACEHOLDER) {
    return "No contact name on this lead — every message leaves a blank to fill in.";
  }
  return s.honorific === null
    ? `Addressed as “${s.address}”. Nothing in the data says they are a doctor.`
    : `Addressed as “${s.address}” — read off ${s.source}.`;
}

// ─── What a step is written from ───────────────────────────────────────────

// One drafted message as the prompts and the panel see it. The database row
// carries more (an id, a lead); this is the part that is the message.
export interface OutreachDraft {
  step: OutreachStep;
  variant: string | null;
  content: string;
  sentAt: Date | null;
}

// Everything a step is written from: the clinic and its evidence, the person,
// the Loom, and whatever has already been drafted for this lead.
export interface SequenceContext {
  evidence: IcpAssistEvidence;
  contactName: string | null;
  loomUrl: string | null;
  // Newest last, the order they were written in. Later steps are shown these so
  // they can avoid repeating an observation already made.
  priorMessages: OutreachDraft[];
}

// The salutation for a whole context, so the templates and both prompts read it
// from one place rather than each deciding for itself.
export function contextSalutation(ctx: SequenceContext): Salutation {
  return salutation(ctx.contactName, ctx.evidence.websiteNotes);
}

// ─── The templates ─────────────────────────────────────────────────────────

// The three steps a model is never asked to write. Each is the wording exactly
// as it was given, with the name, the clinic and the link filled in.
//
// A template with a blank it cannot fill returns null rather than a note with a
// hole in it — which in practice means the Loom delivery without a URL, and
// that step is gated on having one anyway.
export function fillTemplate(
  step: OutreachStep,
  ctx: SequenceContext,
): string | null {
  const name = contextSalutation(ctx).address;
  const clinic = ctx.evidence.clinicName.trim();

  switch (step) {
    case "AUDIT_OFFER":
      return [
        "Appreciate that context. I actually put together a quick breakdown of",
        `what's usually happening in setups like yours — happy to record a`,
        `specific one for ${clinic} if useful. Takes me a few minutes, no`,
        "obligation.",
      ]
        .join(" ")
        .replace(/\s+/g, " ");

    case "LOOM_DELIVERY": {
      const loom = (ctx.loomUrl ?? "").trim();
      if (loom === "") return null;
      return [
        `Here it is: ${loom}. About 5 minutes — walks through what I saw and`,
        "where clinics like yours usually lose booked consults. If it's useful,",
        "happy to talk through options. If not, no worries either way.",
      ]
        .join(" ")
        .replace(/\s+/g, " ");
    }

    case "FOLLOW_UP":
      return [
        `Hey ${name} — no pressure at all, just floating this back up in case it`,
        "got buried. Happy to send the video whenever's useful, or if now's not",
        "the right time, all good.",
      ]
        .join(" ")
        .replace(/\s+/g, " ");

    // The two the model writes. There is no template fill for these: their
    // whole content is the specific detail, and a fallback for them would be
    // the generic opener this feature exists not to send.
    default:
      return null;
  }
}

// The connection request, assembled around the one clause the model supplies.
// The hook sits mid-sentence and the full stop after it belongs to the
// template, which is why readHook strips a trailing one.
export function connectionNote({
  address,
  clinicName,
  hook,
}: {
  // Already decided by salutation() — "Dr. Mike" or "Mike". The template does
  // not work it out for itself, so every step greets the person the same way.
  address: string;
  clinicName: string;
  hook: string;
}): string {
  return `Hi ${address} — came across ${clinicName.trim()} while looking into non-surgical spine/disc practices. ${hook}. Would love to connect.`;
}

// ─── Gating ────────────────────────────────────────────────────────────────

// What has to be true before a step can be written. Every one of these is a
// state somebody marked by hand, because every one of them happened on LinkedIn
// where this app cannot see.
export interface SequenceState {
  enriched: boolean;
  connectionAcceptedAt: Date | null;
  repliedAt: Date | null;
  loomUrl: string | null;
  nextFollowUp: Date | null;
  // Which steps already have a message marked sent.
  sentSteps: OutreachStep[];
}

export type StepLock =
  | { unlocked: true }
  // Why it is locked, in the words the timeline shows under the greyed-out
  // step. Plain, and always naming the thing that would unlock it.
  | { unlocked: false; reason: string };

export function stepLock(
  step: OutreachStep,
  state: SequenceState,
  now: Date = new Date(),
): StepLock {
  switch (step) {
    // Always available, on the same terms the hook always had: there has to be
    // something to write from.
    case "CONNECTION":
      return state.enriched
        ? { unlocked: true }
        : {
            unlocked: false,
            reason:
              "Run “Enrich this lead” first — the opening line is written from the website notes, the Meta ads signal and the review count, and this lead has none of them yet.",
          };

    case "FIRST_MESSAGE":
      return state.connectionAcceptedAt
        ? { unlocked: true }
        : {
            unlocked: false,
            reason:
              "Unlocks once the connection request is accepted. Mark that above when it happens on LinkedIn.",
          };

    case "AUDIT_OFFER":
      return state.repliedAt
        ? { unlocked: true }
        : {
            unlocked: false,
            reason:
              "Unlocks once they reply. Mark that above — the offer answers something they said, so it is not worth writing before there is something to answer.",
          };

    case "LOOM_DELIVERY":
      return (state.loomUrl ?? "").trim() !== ""
        ? { unlocked: true }
        : {
            unlocked: false,
            reason:
              "Unlocks once there is a Loom link on this lead. Record the audit, then paste the link into the field above.",
          };

    // The one gate that is not a single mark: the offer or the video has to
    // have gone out, and the follow-up date has to have come round. That date
    // is the lead's own next follow-up field — the one the pipeline already
    // sorts on — rather than a second timer of this panel's invention, so
    // moving the date moves this with it.
    case "FOLLOW_UP": {
      const offered =
        state.sentSteps.includes("AUDIT_OFFER") ||
        state.sentSteps.includes("LOOM_DELIVERY");
      if (!offered) {
        return {
          unlocked: false,
          reason:
            "Unlocks once the audit offer or the Loom has been marked sent — there is nothing to follow up on before then.",
        };
      }
      if (state.nextFollowUp === null) {
        return {
          unlocked: false,
          reason:
            "Set a follow-up date on this lead. This step is due when that date is, so the panel and the pipeline chase on the same day.",
        };
      }
      if (state.nextFollowUp.getTime() > now.getTime()) {
        return {
          unlocked: false,
          reason: `Due on the lead's follow-up date. Nothing to send yet — it is set for ${state.nextFollowUp.toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`,
        };
      }
      return { unlocked: true };
    }
  }
}

// ─── The prompts ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = [
  "You write outreach messages for a marketing agency that works with chiropractic and non-surgical spine clinics. The messages are sent by hand on LinkedIn by one person, and they read like it.",
  "You write from the evidence you are given and nothing else. You have no knowledge of this clinic beyond the evidence block, and you never state a fact it does not state — no invented program names, no guessed locations, no flattery dressed up as an observation.",
  "You would rather return null than write something that could be sent to any clinic. A generic message is worse than none: it reads as a mail merge to the person receiving it, which is the one thing a hand-written message exists to avoid.",
  "You never pitch. These messages open a conversation; nothing you write asks for a call, names a price, or describes a service.",
  // The lowercase "json" is load-bearing, not a typo — DeepSeek refuses a
  // json_object request unless the word appears in a prompt. See the note in
  // src/lib/deepseek.ts.
  "You reply with a single JSON object in exactly the shape requested, and nothing else — your reply is parsed as json, so any prose around it breaks it.",
].join(" ");

export function buildStepPrompt(
  step: OutreachStep,
  ctx: SequenceContext,
): { system: string; user: string } {
  return {
    system: SYSTEM_PROMPT,
    user:
      step === "CONNECTION" ? connectionPrompt(ctx) : firstMessagePrompt(ctx),
  };
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

// What has already been said to this person, so the next thing said is not the
// same thing again. This is the block that makes the sequence a sequence rather
// than five messages that happen to share a lead.
function conversationBlock(prior: OutreachDraft[]): string {
  if (prior.length === 0) {
    return "Nothing has been written to this person yet. This is the first thing they will read.";
  }
  return [
    "Already written to this person, oldest first. Some may not have been sent yet — what matters is that you do not repeat an observation that has already been made, and that anything you write sounds like the same person who wrote these:",
    "",
    ...prior.map((message) => {
      const label = OUTREACH_STEP_LABELS[message.step];
      const variant = message.variant ? ` (option ${message.variant})` : "";
      const sent = message.sentAt ? "sent" : "drafted, not yet sent";
      return `— ${label}${variant}, ${sent}:\n  "${message.content}"`;
    }),
  ].join("\n");
}

function connectionPrompt(ctx: SequenceContext): string {
  const { address } = contextSalutation(ctx);
  return [
    `CLINIC: ${ctx.evidence.clinicName}`,
    "",
    "EVIDENCE",
    "Gathered by an automated enrichment run. This is everything you have.",
    "",
    evidenceBlock(ctx.evidence),
    "",
    "CONVERSATION SO FAR",
    conversationBlock(ctx.priorMessages),
    "",
    "TASK",
    "Find the single most specific true detail about this clinic in the evidence above — the kind of thing somebody who spent two minutes actually looking at them would notice — and write it as one short clause.",
    "",
    "It is dropped into the middle of this sentence, which is already written and which you do not repeat back:",
    `  "Hi ${address} — came across ${ctx.evidence.clinicName.trim()} while looking into non-surgical spine/disc practices. <your clause>. Would love to connect."`,
    "The greeting is already decided and already correct, title included where there is one. You are writing the clause and nothing else.",
    "",
    "What counts as specific enough:",
    "  - a named treatment program or protocol the clinic offers",
    "  - a combination of services that is worth remarking on together",
    "  - an observation about the review count, where the number supports it",
    "  - something concrete about the ads they are running or how long for",
    "",
    "What does not count, and must return null instead:",
    '  - anything true of every clinic ("great website", "clearly patient-focused")',
    "  - praise with no fact in it",
    "  - a detail you are inferring rather than reading",
    "  - restating the clinic's name or town back at them",
    "",
    "REGISTER",
    "Match these two exactly — an observation, in the first person, understated, no pitch and no compliment:",
    "  \"Saw you're running the decompression program alongside PT\"",
    '  "Noticed the strong review count on your booking experience"',
    "",
    "Under 180 characters. No trailing full stop — the template supplies it. No square brackets. Do not name the clinic, do not greet anybody, and do not add a call to action; the sentence around your clause already does all three.",
    "",
    "REPLY FORMAT",
    "A single JSON object, exactly these keys:",
    "{",
    '  "hook": "<the clause>" | null,',
    '  "evidence": "<the phrase in the evidence you read it off, quoted>" | null',
    "}",
    "",
    "Return null for hook whenever the evidence will not support something concrete. That is a correct and expected answer, not a failure.",
  ].join("\n");
}

function firstMessagePrompt(ctx: SequenceContext): string {
  const { address, honorific } = contextSalutation(ctx);
  return [
    `CLINIC: ${ctx.evidence.clinicName}`,
    `ADDRESS THEM AS: ${address}`,
    "",
    "EVIDENCE",
    "Gathered by an automated enrichment run. This is everything you have.",
    "",
    evidenceBlock(ctx.evidence),
    "",
    "CONVERSATION SO FAR",
    conversationBlock(ctx.priorMessages),
    "",
    "TASK",
    "They accepted the connection request. Write the first real message — three alternative versions of it, so the person sending can pick the one that fits.",
    "",
    `  A) ${VARIANT_BLURBS.A}. An observation about something specific on their site or their booking flow, ending in a question about it.`,
    `  B) ${VARIANT_BLURBS.B}. An observation about their ad activity, ending in a question about it.`,
    `  C) ${VARIANT_BLURBS.C}. No specific hook needed — warm, short, and still ending in a question.`,
    "",
    "RULES, all three:",
    // The honorific is settled before the prompt is built (salutation() above),
    // off the contact field, the letters after their name, and their own site.
    // The model is told the answer rather than asked for it, because the other
    // three steps are filled in code and cannot ask — and a sequence that
    // opened "Hi Dr. Mike" and followed up with "Hey Mike" would read as two
    // people writing.
    `  - Open by addressing them as "${address}" and exactly that. ${
      honorific === null
        ? "No title: nothing in the evidence says this person is a doctor, and awarding them one is worse than leaving it off."
        : "Keep the Dr. — this person is a doctor and their own clinic addresses them that way. Do not extend it to the surname; \"Dr. Mike\" is the register, \"Dr. Alvarez\" is not."
    } Never the full name.`,
    "  - End in a question. A message that ends in an offer is the wrong message — the offer is the next step, and it is written after they answer.",
    "  - No pitch, no service description, no price, no call booking, no link.",
    "  - Do not repeat an observation already made in the conversation above. If the connection request already used the best detail, A and B find a different one or lean on what is actually there.",
    `  - Under ${FIRST_MESSAGE_MAX_CHARS} characters each. Two or three sentences.`,
    "  - No square brackets: they read as a mail merge that failed.",
    "  - Written in the first person, understated, the way one person writes to another.",
    "",
    "WRITE ALL THREE. Three is what the person sending gets to choose between, and two is a choice with a hole in it — never return null, and never return fewer than three.",
    "",
    "Where an angle is thin in the evidence, that is what changes, not the count. If there is no ad activity to remark on, B opens on the nearest true thing the evidence does support and stays short and light rather than leaning on a detail. What you must never do is invent the missing detail: an angle you cannot evidence becomes a warmer, more general message, not a confident claim about something you did not read.",
    "",
    "The three must be genuinely different to choose between — a different observation, a different question, or a different length. Three versions of one sentence is the same as having one.",
    "",
    "REPLY FORMAT",
    "A single JSON object, exactly these keys, all three of them strings:",
    "{",
    '  "a": "<version A>",',
    '  "b": "<version B>",',
    '  "c": "<version C>"',
    "}",
  ].join("\n");
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// ─── Reading the reply ─────────────────────────────────────────────────────

// The clause that opens a connection request. Every rule here is one the prompt
// already asked for, applied again because a prompt is a request and this is the
// gate.
export function readHook(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  // This goes into one line of a note, so whitespace collapses.
  let hook = raw.replace(/\s+/g, " ").trim();
  // Surrounding quotes are the commonest way a model returns a "clause".
  hook = hook.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
  // The template supplies the full stop, because the line sits mid-sentence.
  hook = hook.replace(/[.!]+$/, "").trim();

  if (hook.length < 15 || hook.length > 180) return null;
  // Square brackets mean an unfilled placeholder, which reads as a mail merge
  // that failed — the precise impression this feature exists to avoid.
  if (/[[\]]/.test(hook)) return null;
  if (!/[a-z]/i.test(hook)) return null;
  return hook;
}

// One of the three first-message variants.
//
// What it rejects is what cannot be used: nothing there, a wall of text, an
// unfilled [placeholder]. What it does NOT reject is a message that breaks the
// ends-in-a-question rule — that used to return null here, which meant one
// stray full stop silently cost the person a whole option and left them
// choosing between two. The rule still matters, so it is checked and shown
// against the message (endsInQuestion below) rather than enforced by deletion:
// this is a draft in an editable box, and a note saying "this one does not end
// in a question" is worth more than the option disappearing.
export function readFirstMessage(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  // Paragraph breaks survive — these are messages, not clauses — but trailing
  // and repeated blank lines go.
  const message = raw
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (message.length < MESSAGE_MIN_CHARS) return null;
  if (message.length > FIRST_MESSAGE_MAX_CHARS) return null;
  if (/[[\]]/.test(message)) return null;
  return message;
}

// The one rule of this step, checked rather than trusted — and reported rather
// than enforced. The panel puts a line under any option that fails it.
export function endsInQuestion(message: string): boolean {
  return message.trimEnd().endsWith("?");
}

export type ConnectionReply = { hook: string | null; evidence: string | null };

export function parseConnectionReply(raw: string): ConnectionReply | null {
  const body = readObject(raw);
  if (!body) return null;
  const hook = readHook(body.hook);
  return {
    hook,
    // A citation with no line to cite is noise, so it travels only with one.
    evidence: hook === null ? null : readText(body.evidence, 300),
  };
}

export type FirstMessageReply = Record<FirstMessageVariant, string | null>;

// Null for every variant is a real answer and reads as "nothing specific enough
// to say", the same way a null hook does. The caller decides what to do with it.
export function parseFirstMessageReply(raw: string): FirstMessageReply | null {
  const body = readObject(raw);
  if (!body) return null;
  return {
    A: readFirstMessage(body.a),
    B: readFirstMessage(body.b),
    C: readFirstMessage(body.c),
  };
}

function readObject(raw: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

function readText(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (trimmed === "") return null;
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}
