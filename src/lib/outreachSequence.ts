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
    "One verified detail about the clinic. No pitch, no question, nothing about an audit.",
  FIRST_MESSAGE:
    "Up to three openers to choose between, each ending in a question rather than an offer.",
  AUDIT_OFFER:
    "Written from what they actually wrote back, and asking permission to record.",
  LOOM_DELIVERY: "The note the video goes out with, and the link exactly as stored.",
  FOLLOW_UP:
    "One nudge, and only one. Which version depends on whether the video has gone out.",
};

// Which steps a model writes, and which are filled in from the template here.
//
// The dividing line is whether the step has a blank only evidence can fill.
// Steps 1 and 2 read the research; step 3 reads what the prospect wrote back,
// which is a better source than the research and the reason that step moved
// over here. Steps 4 and 5 are fixed prose whose only variables are a link and
// which of two follow-ups applies, so asking a model would spend a call to be
// handed back the words we already have.
export function stepUsesModel(step: OutreachStep): boolean {
  return (
    step === "CONNECTION" ||
    step === "FIRST_MESSAGE" ||
    step === "AUDIT_OFFER"
  );
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

// An audit offer is four sentences. The ceiling is there to stop a paragraph of
// enthusiasm arriving where a calm offer was asked for.
export const AUDIT_OFFER_MAX_CHARS = 700;

// One message, three short ones, or one with a note attached. Comfortably over
// what any of the three answers needs.
export const SEQUENCE_MAX_TOKENS = 1100;

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
  // What the prospect actually wrote back, where it was captured when the reply
  // was marked. The audit offer is written from this: its job is to answer what
  // they said, and "appreciate that context" with no idea what the context was
  // is the version of this message that gets ignored.
  replyText: string | null;
}

// The salutation for a whole context, so the templates and both prompts read it
// from one place rather than each deciding for itself.
export function contextSalutation(ctx: SequenceContext): Salutation {
  return salutation(ctx.contactName, ctx.evidence.websiteNotes);
}

// ─── The house style ───────────────────────────────────────────────────────

// The em dash is banned from every message this app writes.
//
// Not a stylistic preference: it is the single most reliable tell that a
// message came out of a language model rather than off somebody's keyboard, and
// these are messages whose entire premise is that a person looked at this
// clinic. The app's own interface uses em dashes freely — that is prose for the
// person using it, not for the prospect.
//
// Applied to the templates by writing them without one, and to the model's
// output by rewriting rather than rejecting: a good sentence with the wrong
// punctuation in it should not cost a generation. A dash doing a comma's job
// becomes a comma; one doing a full stop's job becomes a full stop. Spaced
// dashes are read as parenthetical and become commas.
export function stripEmDashes(text: string): string {
  return text
    // " — " and " – " as a parenthetical or a pause.
    .replace(/\s+[—–]\s+/g, ", ")
    // Between numbers it is a range, not a pause: "9—5" is opening hours and
    // becomes "9-5". Turning that one into a comma is how you get "the 9, 5
    // window" into a message written to a clinic owner.
    .replace(/(\d)\s*[—–]\s*(\d)/g, "$1-$2")
    // Anything else unspaced is doing a pause's job.
    .replace(/[—–]/g, ", ")
    // The rewrite can leave doubled punctuation behind.
    .replace(/,\s*,/g, ",")
    .replace(/([,.!?;:])\s*,/g, "$1")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function hasEmDash(text: string): boolean {
  return /[—–]/.test(text);
}

// ─── The templates ─────────────────────────────────────────────────────────

// The steps a model is never asked to write, in the wording they were given.
//
// Step 3 is no longer among them. Its whole job is to answer what the prospect
// actually said, so it needs the reply in front of it and it needs a model —
// see auditOfferPrompt below. What is left here is the Loom delivery, whose one
// variable is a link, and the follow-up, whose two versions differ only by
// whether the video has gone out yet.
//
// A template with a blank it cannot fill returns null rather than a note with a
// hole in it — which in practice means the Loom delivery without a URL, and
// that step is gated on having one anyway.
export function fillTemplate(
  step: OutreachStep,
  ctx: SequenceContext,
  state?: SequenceState,
): string | null {
  const name = contextSalutation(ctx).address;
  const clinic = ctx.evidence.clinicName.trim();

  switch (step) {
    case "LOOM_DELIVERY": {
      const loom = (ctx.loomUrl ?? "").trim();
      if (loom === "") return null;
      // The link is dropped in exactly as stored. Nothing here reformats,
      // shortens or "tidies" a URL: a delivery message carrying a link that is
      // one character different from the one that was recorded is a message
      // that delivers nothing.
      return [
        `Here it is: ${loom}. It's about five minutes and walks through what I`,
        `saw in ${clinic}'s current booking and follow-up flow, including the`,
        "areas that may be creating avoidable drop-off between inquiry, booking,",
        "and attendance. If it's useful, happy to talk through it. If not, no",
        "worries either way.",
      ]
        .join(" ")
        .replace(/\s+/g, " ");
    }

    // Two follow-ups, and which one is right depends on what already went out.
    // Offering to send a video that was sent last week is the mistake this
    // branch exists to prevent, and it is the kind that reads as nobody having
    // looked at the thread.
    case "FOLLOW_UP": {
      const loomSent = state?.sentSteps.includes("LOOM_DELIVERY") ?? false;
      return loomSent
        ? [
            `Hey ${name}, no pressure at all. Just floating the video back up in`,
            "case it got buried. Happy to talk through anything that stood out,",
            "or leave it with you if now isn't the right time.",
          ]
            .join(" ")
            .replace(/\s+/g, " ")
        : [
            `Hey ${name}, no pressure at all. Just floating this back up in case`,
            "it got buried. Happy to put together the short breakdown whenever",
            "it's useful. If now isn't the right time, all good.",
          ]
            .join(" ")
            .replace(/\s+/g, " ");
    }

    // The three the model writes. There is no template fill for these: what
    // makes each one worth sending is the specific thing it says, and a
    // fallback would be the generic message this feature exists not to send.
    default:
      return null;
  }
}

// The connection request, assembled around the one observation the model
// supplies.
//
// A comma after the name, not a dash. The observation is a whole sentence of
// its own rather than a clause dropped mid-sentence, which is what lets it
// carry "I noticed" and a characterization without the seams showing.
export function connectionNote({
  address,
  clinicName,
  observation,
}: {
  // Already decided by salutation() — "Dr. Mike" or "Mike". The template does
  // not work it out for itself, so every step greets the person the same way.
  address: string;
  clinicName: string;
  observation: string;
}): string {
  return stripEmDashes(
    `Hi ${address}, I came across ${clinicName.trim()} while researching non-surgical spine and disc practices. ${observation}. Would be great to connect.`,
  );
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

// The proof standard. Every message this app writes is held to it, and most of
// it is about what NOT to say.
//
// The reason it is this long is that the failure it guards against is not a
// model writing badly — it is a model writing *plausibly*. "Most clinics your
// size struggle to convert leads" is fluent, confident, on-topic and completely
// unevidenced, and it is exactly the sentence that gets a message deleted by
// somebody who knows their own numbers and knows you do not.
const SYSTEM_PROMPT = [
  "You write outreach messages for a marketing agency that works with chiropractic and non-surgical spine, disc pain, and decompression clinics. The prospect is an owner, doctor, or practice manager at a small practice. Each message is sent by hand on LinkedIn by one person, and it reads like it.",

  // The proof standard.
  "You write from the evidence you are given and nothing else. The website, the Google Business Profile, advertisements, reviews and public profiles are evidence. Anything else is not. You never state a fact the evidence does not state.",
  "You never fabricate testimonials, results, client numbers, pricing, reviews, ad performance, operational weaknesses, patient outcomes, or comparisons. Not as illustration, not as a placeholder, not as a reasonable guess.",
  "You never claim something is absent merely because you did not find it. Where you describe a possible absence you say so carefully: \"I didn't see a visible...\", \"I may be missing it, but...\", \"It wasn't obvious from the public-facing flow...\".",
  "You never use unsupported comparisons. \"Most clinics like yours\", \"few practices do this\", \"clinics your size usually struggle with this\" are all forbidden, however true they might be, because nothing in your evidence establishes them.",

  // Whose business it is.
  "You never tell a clinic owner what their own positioning means. You never infer how they handle referrals, how they operate internally, how they serve patients, how they perform financially, or how they convert leads, unless the evidence states it or they told you themselves. You leave room for them to explain their own business.",

  // Personalization that reads as attention rather than as a merge field.
  "One relevant fact beats a list of facts. Research is not a performance. Where a genuine observation exists, you may pair it with restrained characterization: unique, notable, interesting, a strong signal, unusual, clearly established. Only where it naturally fits. You never invent praise and never force a characterization onto a fact that does not carry one.",
  "If the research is weak, you write the warm generic message rather than inventing a personalized hook.",

  // Register.
  "Register: warm, slightly formal, polished, considered. Complete sentences, not clipped fragments. Keep \"I\" where it is natural: \"I came across\", \"I noticed\". No exaggeration, no enthusiasm, no generic praise like \"I love what you're doing\".",
  "You never use an em dash or an en dash. Not once, anywhere, in any message. Use a comma, a full stop, or a new sentence.",
  "A comma after the person's name, never a dash. Use the clinic's full name as given; never shorten it, abbreviate it, or invent a nickname for it.",
  "One call to action per message, and never two.",
  "You never write the words \"not trying to pitch anything\" or any variant. A message that is not a pitch demonstrates that by its content.",

  // The lowercase "json" is load-bearing, not a typo — DeepSeek refuses a
  // json_object request unless the word appears in a prompt. See the note in
  // src/lib/deepseek.ts.
  "You reply with a single JSON object in exactly the shape requested, and nothing else. Your reply is parsed as json, so any prose around it breaks it.",
].join(" ");

export function buildStepPrompt(
  step: OutreachStep,
  ctx: SequenceContext,
): { system: string; user: string } {
  const user =
    step === "CONNECTION"
      ? connectionPrompt(ctx)
      : step === "FIRST_MESSAGE"
        ? firstMessagePrompt(ctx)
        : auditOfferPrompt(ctx);
  return { system: SYSTEM_PROMPT, user };
}

// What every prompt asks for alongside the message itself: the note a human
// reads before sending. It is never part of the message, and the panel keeps
// the two apart on screen as well as in the database.
const INTERNAL_NOTE_SPEC = [
  "Alongside the message, return an internal note for the person about to send it. It is for review only and is never seen by the prospect. Three short lines:",
  "  evidence: the specific evidence this message was built on, quoted or named.",
  "  uncertainty: any absence-of-evidence or hedging language you used, and what you were careful not to claim. Say \"none\" if there was none.",
  "  stage: the prospect stage that had to be true before this step could be sent.",
].join("\n");

// The evidence, with its absences named — the same arrangement the scoring
// assist uses, and for the same reason: a missing field stated is a field the
// model knows was not checked, rather than one it quietly writes around.
function evidenceBlock(evidence: IcpAssistEvidence): string {
  const notes = (evidence.websiteNotes ?? "").trim();
  const ads = (evidence.metaAdsSignal ?? "").trim();
  return [
    "Website notes, crawled from the clinic's own site:",
    notes === ""
      ? "(not gathered. No website notes on this lead. You have not seen their site, so you cannot say what is or is not on it.)"
      : `"""\n${truncate(notes, ASSIST_NOTES_MAX_CHARS)}\n"""`,
    "",
    `Advertising signal: ${ads === "" ? "(not gathered. This does NOT mean they are not advertising. It means nobody looked.)" : ads}`,
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
    "Already written to this person, oldest first. Do not repeat an observation that has already been made unless continuity genuinely requires it, and write as the same person who wrote these:",
    "",
    ...prior.map((message) => {
      const label = OUTREACH_STEP_LABELS[message.step];
      const variant = message.variant ? ` (option ${message.variant})` : "";
      const sent = message.sentAt ? "sent" : "drafted, not yet sent";
      return `- ${label}${variant}, ${sent}:\n  "${message.content}"`;
    }),
  ].join("\n");
}

// ─── Step 1 ────────────────────────────────────────────────────────────────

function connectionPrompt(ctx: SequenceContext): string {
  const { address } = contextSalutation(ctx);
  const clinic = ctx.evidence.clinicName.trim();
  return [
    `CLINIC: ${clinic}`,
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
    "This is a LinkedIn connection request with a note. It has one job: earn the connection. Nothing else.",
    "",
    "The note is already written except for one sentence, which is yours:",
    "",
    `  "Hi ${address}, I came across ${clinic} while researching non-surgical spine and disc practices. <YOUR SENTENCE>. Would be great to connect."`,
    "",
    "Write the observation sentence. One specific, verified detail from the evidence, as a complete sentence in the first person, usually opening \"I noticed\" or \"I saw\".",
    "",
    "Where the fact genuinely carries it, pair it with restrained characterization, for example \"which is a unique combination\" or \"which is a strong signal\". Only where it fits. A plain statement of the fact is the correct answer whenever it does not.",
    "",
    "This is the register to match:",
    "  \"I noticed your team includes both medical doctors and an orthopedic surgeon, which is a unique combination\"",
    "  \"I saw you offer both spinal decompression and laser therapy under one roof\"",
    "",
    "HARD RULES for this step:",
    "  - Do not pitch. Do not mention an audit, a video, a Loom, an offer, lead generation, marketing, or any service.",
    "  - Do not ask a question. Nothing here should require effort to answer.",
    "  - Use exactly one observation.",
    "  - Do not explain what the observation means for their business. State it and stop.",
    "  - Do NOT use an absence as the observation. \"I didn't see a booking form\" is a Step 2 sentence, not a connection request. If the only thing you have is an absence, return null.",
    "  - The whole note including the fixed parts should come in under about 300 characters, so your sentence has roughly 150 to work with.",
    "  - No square brackets. No em dashes.",
    "",
    INTERNAL_NOTE_SPEC,
    "",
    "REPLY FORMAT",
    "A single JSON object, exactly these keys:",
    "{",
    '  "observation": "<the sentence>" | null,',
    '  "evidence": "<what in the evidence you read it off, quoted>" | null,',
    '  "uncertainty": "<hedging used, or none>",',
    '  "stage": "<the stage required before this step>"',
    "}",
    "",
    "Return null for observation whenever the evidence will not support something specific and verified. That is a correct and expected answer, not a failure.",
  ].join("\n");
}

// ─── Step 2 ────────────────────────────────────────────────────────────────

function firstMessagePrompt(ctx: SequenceContext): string {
  const { address, honorific } = contextSalutation(ctx);
  const clinic = ctx.evidence.clinicName.trim();
  const ads = (ctx.evidence.metaAdsSignal ?? "").trim();
  return [
    `CLINIC: ${clinic}`,
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
    "They accepted the connection request. This message has one job: earn a genuine reply. It does not close, and it does not offer the audit.",
    "",
    "Write up to three versions, so the person sending can choose. Each follows its own shape:",
    "",
    "VARIANT A, website or booking-flow observation. Use when the public-facing site or booking flow shows something specific and relevant.",
    `  "Thanks for connecting, ${address}. One thing I noticed on ${clinic}'s site is <specific observation>. <If you are describing something you did not see, hedge it here: "I didn't see a visible...", "I may be missing it, but...">. Curious how you're currently handling that on the back end. Worth a quick chat, or am I off base?"`,
    "  Never state that a confirmation, reminder, follow-up or booking element does not exist just because it was not visible in the crawl.",
    "",
    "VARIANT B, advertising observation. Use ONLY when current or recent advertising is directly evidenced above.",
    `  "Thanks for connecting, ${address}. I noticed ${clinic} is running <Google/Meta> ads for <the verified service or offer shown>. Curious what you're seeing after someone clicks. Is the main focus currently lead volume, booking, or getting people to show?"`,
    "  Do not assume the ads are profitable, underperforming, or producing any particular number of leads. Do not assume there is a problem. Name only the service or offer actually shown in the evidence.",
    ads === ""
      ? "  THERE IS NO ADVERTISING EVIDENCE FOR THIS CLINIC. Return null for B. Writing it would mean inventing an ad."
      : `  The advertising evidence you have is exactly this and nothing more: "${ads}"`,
    "",
    "VARIANT C, warm generic fallback. Always write this one. It carries no personalization at all, on purpose, and it is what gets sent when the research is thin.",
    `  "Thanks for connecting, ${address}. I work with non-surgical spine and disc clinics on the booking and follow-up side, the things that happen after a lead comes in. I'm curious what your current booking flow looks like day to day."`,
    "  Do not add fabricated personalization to C. Do not add a second call to action.",
    "",
    "HARD RULES for all three:",
    "  - One question only, and no audit offer, no video, no Loom, no pricing.",
    "  - Do not explain to them what your observation supposedly means for their clinic.",
    honorific === null
      ? "  - No title in the greeting: nothing in the evidence says this person is a doctor."
      : "  - Keep the Dr. in the greeting exactly as given. Do not move it to their surname.",
    `  - Under ${FIRST_MESSAGE_MAX_CHARS} characters each. No square brackets. No em dashes.`,
    "",
    "Return null for A or B where the evidence does not support that variant. A forced variant is a fabricated one, and this is the step where fabrication is most likely: do not describe a booking flow you did not see, and do not describe an ad you were not shown. C is never null.",
    "",
    INTERNAL_NOTE_SPEC,
    "",
    "REPLY FORMAT",
    "A single JSON object, exactly these keys:",
    "{",
    '  "a": "<version A>" | null,',
    '  "b": "<version B>" | null,',
    '  "c": "<version C>",',
    '  "evidence": "<the evidence A and B were built on, quoted>" | null,',
    '  "uncertainty": "<hedging used, or none>",',
    '  "stage": "<the stage required before this step>"',
    "}",
  ].join("\n");
}

// ─── Step 3 ────────────────────────────────────────────────────────────────

// The audit offer, and the one step whose personalization comes from the
// prospect rather than from the research. What they wrote back is now the best
// evidence about this clinic that exists anywhere in the record, and a message
// that ignores it to recite the website again is a message that was not
// listening.
function auditOfferPrompt(ctx: SequenceContext): string {
  const { address } = contextSalutation(ctx);
  const clinic = ctx.evidence.clinicName.trim();
  const reply = (ctx.replyText ?? "").trim();
  return [
    `CLINIC: ${clinic}`,
    `ADDRESS THEM AS: ${address}`,
    "",
    "WHAT THEY WROTE BACK",
    reply === ""
      ? "(not captured. A reply was marked as received, but its text was not saved. Acknowledge that they replied. Do NOT invent anything they might have said, and do not paraphrase a reply you cannot see.)"
      : `"""\n${truncate(reply, 2000)}\n"""`,
    "",
    "CONVERSATION SO FAR",
    conversationBlock(ctx.priorMessages),
    "",
    "TASK",
    "They replied. This message offers to record a short audit, and asks permission to make it. It is not a pitch and it promises no result.",
    "",
    "This is the shape:",
    `  "Appreciate that context. Based on what you shared, I can put together a quick numbers-based breakdown for ${clinic} around the booking and follow-up flow. Happy to record it if useful. No obligation either way."`,
    "",
    reply === ""
      ? "Because their reply was not captured, stay close to that wording. Acknowledge the reply in general terms and do not attribute any specific statement to them."
      : "Adapt the opening so it answers what they actually said. Quote or paraphrase a specific detail from their reply where it reads naturally. Generic acknowledgement of a reply you can see is a wasted sentence.",
    "",
    "HARD RULES for this step:",
    "  - Do not say \"setups like yours\" unless they themselves described their setup.",
    "  - Do not claim the audit will find lost revenue, increase bookings, or produce any specific result.",
    "  - Do not imply that comparable clinics have achieved results. You have no verified proof of any.",
    "  - Ask permission to record it. One call to action, and no second one.",
    "  - Calm and specific. No enthusiasm, no urgency.",
    "  - No square brackets. No em dashes.",
    "",
    INTERNAL_NOTE_SPEC,
    "",
    "REPLY FORMAT",
    "A single JSON object, exactly these keys:",
    "{",
    '  "message": "<the message>",',
    '  "evidence": "<what you built it on, quoting their reply where you used it>" | null,',
    '  "uncertainty": "<hedging used, or none>",',
    '  "stage": "<the stage required before this step>"',
    "}",
  ].join("\n");
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// ─── Reading the reply ─────────────────────────────────────────────────────

// The observation sentence that goes into a connection request. Every rule here
// is one the prompt already asked for, applied again because a prompt is a
// request and this is the gate.
export function readObservation(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  // This goes into one line of a note, so whitespace collapses.
  let text = stripEmDashes(raw.replace(/\s+/g, " ").trim());
  // Surrounding quotes are the commonest way a model returns a sentence.
  text = text.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
  // The template supplies the full stop after the observation.
  text = text.replace(/[.!]+$/, "").trim();

  if (text.length < 15 || text.length > 200) return null;
  // Square brackets mean an unfilled placeholder, which reads as a mail merge
  // that failed — the precise impression this feature exists to avoid.
  if (/[[\]]/.test(text)) return null;
  if (!/[a-z]/i.test(text)) return null;
  // An absence belongs in step 2, where it can be hedged properly. In a
  // connection request it is both a downer and a claim the crawl cannot make.
  if (/\b(didn't see|did not see|couldn't find|could not find|no visible|doesn't (?:seem|appear)|does not (?:seem|appear)|missing)\b/i.test(text)) {
    return null;
  }
  return text;
}

// One message, held to what can actually be used.
//
// What it rejects is what cannot be sent: nothing there, a wall of text, an
// unfilled [placeholder]. What it does NOT reject is a message that breaks a
// style rule — an em dash is rewritten rather than refused, and a first message
// that does not end in a question is reported rather than deleted. That used to
// return null, which meant one stray full stop silently cost the person a whole
// option and left them choosing between two.
export function readMessage(raw: unknown, maxChars: number): string | null {
  if (typeof raw !== "string") return null;

  const message = stripEmDashes(
    raw.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(),
  );

  if (message.length < MESSAGE_MIN_CHARS) return null;
  if (message.length > maxChars) return null;
  if (/[[\]]/.test(message)) return null;
  return message;
}

// The one rule of the first message, checked rather than trusted — and reported
// rather than enforced. The panel puts a line under any option that fails it.
export function endsInQuestion(message: string): boolean {
  return message.trimEnd().endsWith("?");
}

// ─── The internal note ─────────────────────────────────────────────────────

// The three lines a human reads before sending: what the message was built on,
// what was hedged, and what had to have happened first.
//
// Stored beside the message and never inside it. That separation is the whole
// point of the note: it exists to be read by the person sending and to be
// impossible to paste by accident, which is why it is its own column and its
// own box on screen rather than a paragraph appended to the draft.
export interface InternalNote {
  evidence: string | null;
  uncertainty: string | null;
  stage: string | null;
}

export function readInternalNote(body: Record<string, unknown>): InternalNote {
  return {
    evidence: readText(body.evidence, 400),
    uncertainty: readText(body.uncertainty, 300),
    stage: readText(body.stage, 160),
  };
}

// Flattened for storage, in the order a reviewer reads them. Null when the
// model returned nothing worth keeping, so an empty note is stored as no note
// rather than as three empty headings.
export function formatInternalNote(note: InternalNote): string | null {
  const lines = [
    note.evidence === null ? null : `Evidence: ${note.evidence}`,
    note.uncertainty === null ? null : `Uncertainty: ${note.uncertainty}`,
    note.stage === null ? null : `Stage required: ${note.stage}`,
  ].filter((line): line is string => line !== null);
  return lines.length === 0 ? null : lines.join("\n");
}

// ─── Parsing each step's answer ────────────────────────────────────────────

export type ConnectionReply = {
  observation: string | null;
  note: InternalNote;
};

export function parseConnectionReply(raw: string): ConnectionReply | null {
  const body = readObject(raw);
  if (!body) return null;
  return {
    observation: readObservation(body.observation),
    note: readInternalNote(body),
  };
}

export type FirstMessageReply = {
  variants: Record<FirstMessageVariant, string | null>;
  note: InternalNote;
};

// Null for every variant is a real answer and reads as "nothing specific enough
// to say". The caller decides what to do with it.
export function parseFirstMessageReply(raw: string): FirstMessageReply | null {
  const body = readObject(raw);
  if (!body) return null;
  return {
    variants: {
      A: readMessage(body.a, FIRST_MESSAGE_MAX_CHARS),
      B: readMessage(body.b, FIRST_MESSAGE_MAX_CHARS),
      C: readMessage(body.c, FIRST_MESSAGE_MAX_CHARS),
    },
    note: readInternalNote(body),
  };
}

export type AuditOfferReply = { message: string | null; note: InternalNote };

export function parseAuditOfferReply(raw: string): AuditOfferReply | null {
  const body = readObject(raw);
  if (!body) return null;
  return {
    message: readMessage(body.message, AUDIT_OFFER_MAX_CHARS),
    note: readInternalNote(body),
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
  if (trimmed === "" || /^none$/i.test(trimmed)) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}
