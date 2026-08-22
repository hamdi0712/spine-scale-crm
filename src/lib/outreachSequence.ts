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
    "One verified pain observation, and a soft yes or no close. Never a description of the service.",
  AUDIT_OFFER:
    "Two or three things worth flagging, written from what they actually wrote back, offering the walkthrough.",
  LOOM_DELIVERY: "The note the video goes out with, and the link exactly as stored.",
  FOLLOW_UP:
    "One nudge, and only one, and on a different angle than the one already used.",
};

// The first message is generated as up to three alternatives for a person to
// choose between; every other step is one message. Each variant is a different
// pain, not a different tone, so a variant the evidence does not support is
// skipped rather than softened into a generic opener.
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
  A: "Funnel capture",
  B: "Idle program spend",
  C: "No-show follow-up",
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

// The fixed wording of steps 4 and 5, assembled around the parts only the
// evidence can supply.
//
// Neither of these is a whole message a model writes. The sentences were
// written by the person who sends them and they do not change; what changes is
// the link, the three things the walkthrough covers, and the one new
// observation the follow-up leads with. So the model is asked for those pieces
// and these functions build the message around them, the same arrangement the
// connection request has always used.

// The Loom note. The link is dropped in exactly as stored: nothing here
// reformats, shortens or "tidies" a URL, because a delivery message carrying a
// link one character different from the one that was recorded delivers nothing.
export function loomDeliveryNote({
  loomUrl,
  covers,
}: {
  loomUrl: string;
  // The two or three things the walkthrough covers, each a short noun phrase
  // and each already said in the audit offer. Nothing new is introduced here.
  covers: string[];
}): string | null {
  const loom = loomUrl.trim();
  const items = covers.map((c) => c.trim()).filter((c) => c !== "");
  if (loom === "" || items.length < 2) return null;
  const list =
    items.length === 2
      ? `${items[0]} and ${items[1]}`
      : `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
  return stripEmDashes(
    `Here's the walkthrough: ${loom}. Covers ${list}. No pressure either way, but happy to talk through any of it if useful.`,
  );
}

// The one follow-up. Its whole reason to exist is the observation in the middle
// of it, which has to be a pain angle none of the earlier messages used. A
// "just checking in" bump is the version of this message that gets somebody
// muted, so there is no wording here that works without a new observation.
export function followUpNote({
  address,
  clinicName,
  observation,
}: {
  address: string;
  clinicName: string;
  observation: string;
}): string | null {
  const angle = observation.trim().replace(/[.]+$/, "");
  if (angle === "") return null;
  return stripEmDashes(
    `${address}, one more thing I noticed on ${clinicName.trim()}'s side: ${angle}. No worries if now's not the time, happy to send what I found either way.`,
  );
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

    // A reply, and a genuine one. The mark is all this app can see, so the
    // rest of that condition is said in the reason and asked of the person
    // pressing the button: an offer written on the back of "no thanks" is
    // worse than no offer.
    case "AUDIT_OFFER":
      return state.repliedAt
        ? { unlocked: true }
        : {
            unlocked: false,
            reason:
              "Unlocks once they reply. Mark that above — the offer answers something they said, so it is not worth writing before there is something to answer. A reply that says no is not one to write this from.",
          };

    case "LOOM_DELIVERY":
      return (state.loomUrl ?? "").trim() !== ""
        ? { unlocked: true }
        : {
            unlocked: false,
            reason:
              "Unlocks once there is a Loom link on this lead. Record the audit, then paste the link into the field above.",
          };

    // The one gate that is not a single mark, and the only step that can be
    // locked by having already happened. It follows up on silence after the
    // first message or the audit offer, so one of those has to have gone out;
    // the follow-up date has to have come round; and there has to be no
    // follow-up sent already, because the sequence ends after one. That date is
    // the lead's own next follow-up field, the one the pipeline already sorts
    // on, rather than a second timer of this panel's invention, so moving the
    // date moves this with it.
    //
    // Silence is not something this app can see, and neither is an explicit no.
    // Both are said in the reasons below and left to the person sending, who
    // read the thread.
    case "FOLLOW_UP": {
      if (state.sentSteps.includes("FOLLOW_UP")) {
        return {
          unlocked: false,
          reason:
            "One follow-up, and only one. That has been sent, so this sequence is finished. Anything after it is a conversation somebody starts by hand.",
        };
      }
      const opened =
        state.sentSteps.includes("FIRST_MESSAGE") ||
        state.sentSteps.includes("AUDIT_OFFER");
      if (!opened) {
        return {
          unlocked: false,
          reason:
            "Unlocks once the first message or the audit offer has been marked sent — there is nothing to follow up on before then.",
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

  // The tell this whole sequence is written around.
  "You never open a message by describing your own service. \"I work with clinics like yours\", \"I work with non-surgical spine clinics on...\", \"I help practices with...\" and every variant of them are forbidden as an opener and forbidden anywhere at all in the connection request and the first message. That phrase is the most recognizable agency-spam opening there is, and a prospect has read it a hundred times. Every opener leads with a specific, verified observation about their clinic instead, never with a description of what you do.",
  "A line about your own work is appropriate in exactly one place: the audit offer, after they have replied. Nowhere earlier.",
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
        : step === "AUDIT_OFFER"
          ? auditOfferPrompt(ctx)
          : step === "LOOM_DELIVERY"
            ? loomDeliveryPrompt(ctx)
            : followUpPrompt(ctx);
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

// The message that goes out once they accept, and the step this sequence was
// rewritten around.
//
// Three variants, and each one is a different pain rather than a different
// tone. There is no warm generic fallback any more: the fallback used to open
// by describing the service, which is the single most recognizable agency-spam
// line there is, and a variant the evidence cannot support is now skipped
// instead. Two true openers beat three where one is a form letter, and no
// openers at all is a correct answer for a lead nobody has looked at properly.
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
    "They accepted the connection request. This message has one job: earn a genuine reply. It does not close, it does not offer the audit, and it never describes what you do.",
    "",
    "Write up to three versions, so the person sending can choose. Each is a different pain, and each is only written where this clinic's evidence actually supports it. Do not force one the evidence does not support.",
    "",
    "VARIANT A, funnel capture. Use ONLY where advertising or paid traffic is evidenced AND the landing or booking flow shows a specific weakness you can name.",
    `  "Thanks for connecting, ${address}. Noticed ${clinic} is running <ads or traffic> to the <verified> page, but the booking step looks form-only, no calendar. That's usually where a chunk of paid leads never make it to a consult. Is that something you're already on top of, or worth me sending what I'd flag?"`,
    "  Name only the advertising and the booking weakness the evidence actually shows. If the evidence does not show what the booking step looks like, this variant is null.",
    ads === ""
      ? "  THERE IS NO ADVERTISING EVIDENCE FOR THIS CLINIC. Return null for A. Writing it would mean inventing an ad."
      : `  The advertising evidence you have is exactly this and nothing more: "${ads}"`,
    "",
    "VARIANT B, idle equipment or program spend. Use ONLY where the evidence shows a real investment (a decompression table, a laser, a named program, a dedicated service page) AND a specific gap in what happens after the lead arrives.",
    `  "Thanks for connecting, ${address}. Noticed ${clinic} has the program built out, but <the specific verified gap>. At $2-6k a case, that gap usually costs more than the ad spend itself. Already on your radar, or worth sending what I'd change first?"`,
    "  The $2-6k figure is this clinic's own published or widely known case range for this kind of care, and it is the one number allowed in this message. Do not add any other number, and do not claim what this clinic in particular earns or loses.",
    "",
    "VARIANT C, no-show and missed-call follow-up. Use ONLY where the evidence points at a front-desk-dependent flow (a phone number as the main call to action, a contact form, hours, a request-a-call step) and no automated reminder or follow-up is visible.",
    `  "Thanks for connecting, ${address}. Noticed ${clinic}'s booking flow doesn't look like it has an automated no-show or missed-call follow-up, most clinics your size lose 1-2 cases a month right there. Already handled on your end, or worth me sending what I found?"`,
    "  This is the one place the \"most clinics your size\" phrasing is allowed, because it is the template's own wording. Do not extend it, do not put a revenue figure on it, and do not say this clinic is losing anything.",
    "  Never state that a reminder, confirmation or follow-up does not exist. Say what the public-facing flow does not appear to show.",
    "",
    "HARD RULES for all three:",
    "  - Never describe your own service. Not as the opener, not anywhere in the message. \"I work with clinics like yours\", \"I work with non-surgical spine clinics on...\" and every variant are forbidden here.",
    "  - Every version opens with the observation about their clinic.",
    "  - End on a soft yes or no closer, in the shape the template shows: \"already on top of it, or worth sending what I'd flag\". Never an open-ended question like \"what does your booking flow look like?\".",
    "  - No calendar link, no pitch, no pricing, no \"would love to hop on a call\". One observation, one soft binary close.",
    "  - Do not explain to them what your observation supposedly means for their clinic beyond the one line the template already carries.",
    honorific === null
      ? "  - No title in the greeting: nothing in the evidence says this person is a doctor."
      : "  - Keep the Dr. in the greeting exactly as given. Do not move it to their surname.",
    `  - Under ${FIRST_MESSAGE_MAX_CHARS} characters each. No square brackets. No em dashes.`,
    "",
    "Return null for any variant this clinic's evidence does not support, and say which in the internal note and why. A forced variant is a fabricated one, and this is the step where fabrication is most likely: do not describe a booking flow you did not see, do not describe an ad you were not shown, and do not describe equipment the evidence does not mention. All three null is a correct answer.",
    "",
    INTERNAL_NOTE_SPEC,
    "",
    "REPLY FORMAT",
    "A single JSON object, exactly these keys:",
    "{",
    '  "a": "<version A>" | null,',
    '  "b": "<version B>" | null,',
    '  "c": "<version C>" | null,',
    '  "skipped": "<which variants you returned null for and what evidence each would have needed>" | null,',
    '  "evidence": "<the evidence each written variant was built on, quoted>" | null,',
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
//
// It is also the only step allowed to say anything about the sender's own work,
// and it says it as a pre-emption rather than a credential: most agencies
// pitching a clinic lead with more ads, and naming that before they do is what
// gets a hearing from somebody a previous agency already burned. That line only
// earns its place next to genuinely verified observations. Next to invented
// ones it is just a better-dressed pitch.
function auditOfferPrompt(ctx: SequenceContext): string {
  const { address, first } = contextSalutation(ctx);
  const clinic = ctx.evidence.clinicName.trim();
  const reply = (ctx.replyText ?? "").trim();
  return [
    `CLINIC: ${clinic}`,
    `ADDRESS THEM AS: ${address}`,
    "",
    "EVIDENCE",
    "Gathered by an automated enrichment run. This is everything you have about the clinic itself.",
    "",
    evidenceBlock(ctx.evidence),
    "",
    "WHAT THEY WROTE BACK",
    reply === ""
      ? "(not captured. A reply was marked as received, but its text was not saved. Do NOT invent anything they might have said, and do not paraphrase a reply you cannot see. Build the flagged points from the clinic evidence above instead.)"
      : `"""\n${truncate(reply, 2000)}\n"""`,
    "",
    "CONVERSATION SO FAR",
    conversationBlock(ctx.priorMessages),
    "",
    "TASK",
    "They replied with genuine interest. This message names what you would flag and offers to record a short walkthrough. It is not a pitch and it promises no result.",
    "",
    "This is the shape, and the wording after the flagged points does not change:",
    `  "${address}, here's what I'd flag specifically: <2 or 3 concrete verified observations>. Most agencies pitching clinics like yours lead with more ads; the actual leak is usually what happens after the lead comes in. I put together a short walkthrough (5-8 min) showing exactly where I think you're losing cases and what I'd fix first, want me to send it over?"`,
    "",
    "The flagged points are the whole message. Two or three of them, each concrete and each read off the evidence above or off what they wrote back. Their reply is the better source wherever it says something.",
    "",
    reply === ""
      ? "Because their reply was not captured, do not attribute any statement to them. Flag only what the clinic evidence supports."
      : "Answer what they actually said. Where their reply names a problem, that is the first thing you flag.",
    "",
    "HARD RULES for this step:",
    "  - Keep the \"most agencies pitching clinics like yours lead with more ads\" line exactly as it is. It is there to get ahead of somebody who has been burned by an agency before, and it only works next to real observations. If you cannot flag two genuinely verified things, return null for the message rather than pairing that line with invented ones.",
    "  - Do not say \"setups like yours\" unless they themselves described their setup.",
    "  - Do not claim the walkthrough will find lost revenue, increase bookings, or produce any specific result.",
    "  - Do not imply that comparable clinics have achieved results. You have no verified proof of any.",
    "  - One call to action, the offer to send it, and no second one.",
    "  - Calm and specific. No enthusiasm, no urgency.",
    "  - No square brackets. No em dashes.",
    "",
    INTERNAL_NOTE_SPEC,
    "",
    "REPLY FORMAT",
    "A single JSON object, exactly these keys:",
    "{",
    '  "message": "<the message>" | null,',
    '  "evidence": "<what each flagged point was read off, quoting their reply where you used it>" | null,',
    '  "uncertainty": "<hedging used, or none>",',
    '  "stage": "<the stage required before this step>"',
    "}",
    "",
    `The message addresses them as ${first === CONTACT_NAME_PLACEHOLDER ? "the placeholder above" : address} and nothing else.`,
  ].join("\n");
}

// ─── Step 4 ────────────────────────────────────────────────────────────────

// The note the Loom goes out with. The sentences are fixed and assembled by
// loomDeliveryNote above; the only thing asked for here is what the walkthrough
// covers, and the only correct source for that is the audit offer that was
// already sent. A covered point that was not flagged in step 3 is either a new
// claim or a different video.
function loomDeliveryPrompt(ctx: SequenceContext): string {
  const clinic = ctx.evidence.clinicName.trim();
  return [
    `CLINIC: ${clinic}`,
    "",
    "EVIDENCE",
    evidenceBlock(ctx.evidence),
    "",
    "CONVERSATION SO FAR",
    conversationBlock(ctx.priorMessages),
    "",
    "TASK",
    "The walkthrough has been recorded and is going out. The note around it is already written, and the link is added by the app, not by you. You are asked for one thing: what the walkthrough covers.",
    "",
    "The note reads:",
    '  "Here\'s the walkthrough: <link>. Covers <your items>. No pressure either way, but happy to talk through any of it if useful."',
    "",
    "Return two or three items. Each is a short noun phrase, three to eight words, and each is one of the things already flagged in the audit offer above.",
    "  Good: \"the form-only booking step\", \"missed-call follow-up\", \"what happens after an inquiry comes in\"",
    "",
    "HARD RULES for this step:",
    "  - No new claims. Every item was already said in a message that has gone out. If the audit offer flagged only two things, return two.",
    "  - No result, no promise, no number, no second call to action.",
    "  - No square brackets. No em dashes.",
    "",
    INTERNAL_NOTE_SPEC,
    "",
    "REPLY FORMAT",
    "A single JSON object, exactly these keys:",
    "{",
    '  "covers": ["<item>", "<item>", "<item>"],',
    '  "evidence": "<where in the messages already sent each item was flagged>" | null,',
    '  "uncertainty": "<hedging used, or none>",',
    '  "stage": "<the stage required before this step>"',
    "}",
  ].join("\n");
}

// ─── Step 5 ────────────────────────────────────────────────────────────────

// The single follow-up, and the step most likely to be written badly, because
// the easy version of it is "just checking in" and that version costs nothing
// to write and nothing to ignore. The one thing that makes a follow-up worth
// sending is that it says something the earlier messages did not, so the only
// blank in this template is a pain angle that has not been used yet, and there
// is no wording available for a message that cannot fill it.
function followUpPrompt(ctx: SequenceContext): string {
  const { address } = contextSalutation(ctx);
  const clinic = ctx.evidence.clinicName.trim();
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
    "The last message got silence, and this is the only follow-up that will be sent. The sentences around it are fixed:",
    "",
    `  "${address}, one more thing I noticed on ${clinic}'s side: <YOUR OBSERVATION>. No worries if now's not the time, happy to send what I found either way."`,
    "",
    "Write the observation. One verified pain angle, as a clause that reads on from the colon, and it must be a genuinely different angle from whatever the earlier messages led with. Read them above and pick something else.",
    "",
    "HARD RULES for this step:",
    "  - Never a bump. \"Just checking in\", \"floating this back up\", \"in case it got buried\" and every variant of them are forbidden. If the only thing you have to say is that you wrote before, return null.",
    "  - A different pain from the one already used. Repeating the earlier observation in new words is the same failure as a bump.",
    "  - Verified, like every other observation in this sequence. An absence is hedged: \"didn't look like\", \"wasn't obvious from the outside\".",
    "  - Never describe your own service.",
    "  - No pitch, no link, no calendar, no second call to action.",
    "  - No square brackets. No em dashes.",
    "",
    INTERNAL_NOTE_SPEC,
    "",
    "REPLY FORMAT",
    "A single JSON object, exactly these keys:",
    "{",
    '  "observation": "<the clause>" | null,',
    '  "evidence": "<what in the evidence you read it off, quoted>" | null,',
    '  "uncertainty": "<hedging used, or none>",',
    '  "stage": "<the stage required before this step>"',
    "}",
    "",
    "Return null whenever the evidence will not support a second, different, verified observation. A follow-up that says nothing new is worse than no follow-up, and null is the correct answer, not a failure.",
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

// The clause the follow-up is built around.
//
// Nearly the connection request's reader, with one rule reversed and one added.
// An absence is allowed here, because by step 5 there is room to hedge it and a
// hedged absence is often the only new angle left. A bump is not allowed, and
// this is the gate on it rather than the prompt: "just checking in" is the
// sentence a tired model reaches for, and it is the one thing this step exists
// not to send.
export function readFollowUpObservation(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  let text = stripEmDashes(raw.replace(/\s+/g, " ").trim());
  text = text.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
  text = text.replace(/[.!]+$/, "").trim();

  if (text.length < 15 || text.length > 220) return null;
  if (/[[\]]/.test(text)) return null;
  if (!/[a-z]/i.test(text)) return null;
  // The bump, in the shapes it actually arrives in.
  if (
    /\b(just checking in|checking back in|circling back|following up on|floating (?:this|it) back|in case (?:this|it) got buried|bumping this|touching base|wanted to follow up)\b/i.test(
      text,
    )
  ) {
    return null;
  }
  return text;
}

// The two or three things the Loom note says it covers. Short noun phrases, and
// held to being short: a "covered point" that arrives as a sentence is a claim
// being smuggled into a message whose job is to hand over a link.
export function readCovers(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const items = raw
    .filter((item): item is string => typeof item === "string")
    .map((item) =>
      stripEmDashes(item.replace(/\s+/g, " ").trim())
        .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
        .replace(/[.]+$/, "")
        .trim(),
    )
    .filter((item) => item.length >= 4 && item.length <= 90 && !/[[\]]/.test(item))
    .slice(0, 3);
  return items.length >= 2 ? items : null;
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

export type LoomDeliveryReply = { covers: string[] | null; note: InternalNote };

export function parseLoomDeliveryReply(raw: string): LoomDeliveryReply | null {
  const body = readObject(raw);
  if (!body) return null;
  return { covers: readCovers(body.covers), note: readInternalNote(body) };
}

export type FollowUpReply = { observation: string | null; note: InternalNote };

export function parseFollowUpReply(raw: string): FollowUpReply | null {
  const body = readObject(raw);
  if (!body) return null;
  return {
    observation: readFollowUpObservation(body.observation),
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
