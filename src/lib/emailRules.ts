// Cold email — the playbook rules that sit around the opener and the templates.
//
//   - the contact name: whether it can be trusted to address someone by
//     ("Dr. Lastname"), and the reasons the lead goes to Check contact if not
//   - the short clinic name the front-desk greeting uses
//   - the opener's angle, and the screen a generated opener has to pass
//   - the pre-send check the assembled Email 1 has to pass before it can be
//     approved (and so before it can be Ready)
//   - the inbox display-name warning
//
// Pure: no network, no database. Imported by client components.

// ─── The contact name ──────────────────────────────────────────────────────

const HONORIFIC = /^(dr\.?|doctor|mr\.?|mrs\.?|ms\.?|miss)$/i;
const SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv|d\.?c\.?|m\.?d\.?|ph\.?d\.?|d\.?p\.?t\.?|p\.?t\.?|d\.?o\.?|n\.?d\.?|l\.?ac\.?|dacbr|daccp|dacnb|cccp|ccsp|ccep|faca|mpt|ma|ms|bs|lmt)$/i;

export interface ParsedContact {
  // Original casing, titles and credentials stripped.
  first: string | null;
  last: string | null;
  // One name and nothing else ("Dr. Megan", "Dr. Oswald"): it cannot be told
  // whether it is a first name or a surname without something to confirm it.
  singleToken: boolean;
}

export function parseContactName(raw: string | null | undefined): ParsedContact | null {
  const name = (raw ?? "").split(",")[0].replace(/\([^)]*\)/g, " ").trim();
  if (name === "") return null;
  const tokens = name
    .split(/\s+/)
    .filter((t) => !HONORIFIC.test(t) && !SUFFIX.test(t.replace(/,$/, "")))
    // Middle initials ("F.") are not a surname.
    .filter((t, i, all) => !(i > 0 && i < all.length - 1 && /^[A-Za-z]\.?$/.test(t)))
    .filter((t) => /[A-Za-z]/.test(t));
  if (tokens.length === 0) return null;
  if (tokens.length === 1) return { first: null, last: tokens[0], singleToken: true };
  return { first: tokens[0], last: tokens[tokens.length - 1], singleToken: false };
}

const slug = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z]/g, "");

// Words an inbox is named for rather than a person.
const ROLE_LOCAL = /^(info|office|frontdesk|front|desk|admin|contact|hello|hi|appointments?|appts?|schedul\w*|booking|book|reception|team|staff|mail|email|inquir\w*|enquir\w*|support|care|patients?|newpatients?|billing|manager|marketing|clinic|chiro\w*|spine|wellness|health|dr|doctor)$/;

export interface ContactLead {
  clinicName: string;
  contactName: string | null;
  email: string | null;
  emailType: string | null;
  // The other places a surname can be confirmed from.
  scorecardName: string | null;
  npiOfficialName: string | null;
  ownerStatus: string | null;
  ownerSource: string | null;
  contactNameByHand: boolean;
  contactConfirmedAt: Date | null;
}

function localPart(email: string | null): string {
  const e = (email ?? "").trim().toLowerCase();
  const at = e.indexOf("@");
  return at > 0 ? e.slice(0, at) : "";
}

// Whether an owner address's local part clearly names somebody other than
// the contact: drottomeyer@ for David Hadden. Shared inboxes, and local parts
// too short to read a name from, never count.
export function emailNamesSomeoneElse(lead: Pick<ContactLead, "email" | "emailType" | "contactName">): boolean {
  if (lead.emailType !== "owner") return false;
  const p = parseContactName(lead.contactName);
  if (!p) return false;
  const local = localPart(lead.email).replace(/[^a-z]/g, "");
  const bare = local.replace(/^(dr|doctor)/, "");
  if (bare.length < 4 || ROLE_LOCAL.test(bare) || ROLE_LOCAL.test(local)) return false;
  const first = slug(p.first);
  const last = slug(p.last);
  if (last.length >= 3 && local.includes(last)) return false;
  if (first.length >= 3 && local.includes(first)) return false;
  // dhadden@, davidh@, dh@ style: an initial against the other name.
  if (first && last && (bare === first[0] + last || bare === first + last[0] || bare.startsWith(first[0] + last.slice(0, 4)))) return false;
  if (!first && last && bare.startsWith(last.slice(0, 4))) return false;
  return true;
}

// Where a one-word contact's surname can be confirmed: the scorecard's
// decision-maker, the email address, the NPI-confirmed owner, or an owner
// picked (or a contact kept) by hand.
function surnameConfirmed(lead: ContactLead, last: string): boolean {
  const s = slug(last);
  if (s.length < 2) return false;
  if (lead.contactConfirmedAt || lead.contactNameByHand || lead.ownerSource === "manual") return true;
  const fromScorecard = parseContactName(lead.scorecardName);
  if (fromScorecard && !fromScorecard.singleToken && slug(fromScorecard.last) === s) return true;
  const fromNpi = parseContactName(lead.npiOfficialName);
  if (fromNpi && !fromNpi.singleToken && slug(fromNpi.last) === s) return true;
  if (s.length >= 3 && localPart(lead.email).replace(/[^a-z]/g, "").includes(s)) return true;
  return false;
}

export interface ContactValidation {
  // A surname safe to address someone by ("Dr. Lastname"), or null.
  lastName: string | null;
  // Why the lead is flagged Check contact. Empty: nothing to check.
  issues: string[];
}

export function validateContact(lead: ContactLead): ContactValidation {
  const issues: string[] = [];
  const p = parseContactName(lead.contactName);
  let lastName: string | null = null;
  if (!p) {
    // Only an owner-type address needs a name. A front desk is greeted as
    // "Hi {short name} team," and asked for "the doctor"; a blank contact
    // kept by hand falls back the same way.
    if (lead.emailType === "owner" && !lead.contactConfirmedAt) issues.push("No contact name on an owner address.");
  } else if (p.singleToken) {
    if (surnameConfirmed(lead, p.last ?? "")) lastName = p.last;
    else issues.push(`“${(lead.contactName ?? "").trim()}” has one name only — can’t tell if “${p.last}” is the surname.`);
  } else {
    lastName = p.last;
  }
  // Runs whatever confirmed the name: an NPI-confirmed Hadden is still not
  // drottomeyer@. Fixed by changing the contact or the address.
  if (emailNamesSomeoneElse(lead)) {
    issues.push(`The owner address ${localPart(lead.email)}@ looks like someone other than ${(lead.contactName ?? "").trim()}.`);
    lastName = null;
  }
  return { lastName: issues.length === 0 ? lastName : null, issues };
}

// {contactOrDoctor}: "Dr. Lastname" only when the contact passes; never blank.
export function contactOrDoctor(v: ContactValidation): string {
  return v.issues.length === 0 && v.lastName ? `Dr. ${v.lastName}` : "the doctor";
}

// ─── The short clinic name ─────────────────────────────────────────────────

const GENERIC = new Set(
  "spine disc disk discs center centre centers clinic clinics chiropractic chiropractor chiropractors chiro wellness rehab rehabilitation sports care institute decompression physical therapy medicine medical pain relief back neck family group associates and & of the integrated integrative health".split(" "),
);
const LEGAL = /\b(L\.?L\.?C|P\.?L\.?L\.?C|P\.?C|Inc|Ltd|P\.?A|Corp|Co)\b\.?/gi;

export interface ShortClinic {
  name: string;
  // Not sure the result still clearly reads as the clinic: edit it by hand.
  flagged: boolean;
}

export function cleanClinicName(raw: string): ShortClinic {
  const full = raw.replace(/\s+/g, " ").trim();
  // Everything after a separator goes: taglines, services, the location.
  let s = full.split(/\s*\|\s*|\s*:\s*|\s+-\s*|\s*-\s+|\s*[–—]\s*/)[0].trim();
  s = s.replace(LEGAL, " ").replace(/,/g, " ").replace(/\s+/g, " ").trim();

  // A doctor's name in front of the practice: "Kyle F. Worell D.C. Chiropractor".
  const dcMatch = s.match(/^(?:dr\.?\s+)?((?:[A-Z][a-z'’-]+\.?\s+)(?:[A-Z]\.?\s+)?([A-Z][a-z'’-]+))\s+(?:D\.?\s?C\.?)(?:\s+|$)(.*)$/);
  const drMatch = s.match(/^dr\.?\s+(?:[A-Z][a-z'’-]+\s+)?(?:[A-Z]\.?\s+)?([A-Z][a-z'’-]+)\s*(.*)$/i);
  let doctorCase = false;
  if (dcMatch || drMatch) {
    const surname = dcMatch ? dcMatch[2] : drMatch![1];
    const rest = (dcMatch ? dcMatch[3] : drMatch![2]).replace(/\bchiropractors?\b/i, "Chiropractic").trim();
    s = `${surname} ${rest || "Chiropractic"}`.trim();
    doctorCase = true;
  }
  s = s.replace(/\bD\.?\s?C\.?(?=\s|$)/g, " ").replace(/\s+/g, " ").trim();

  // Trailing descriptor words go when what is left is still a name of two or
  // more distinctive words: "Health for Life Spine & Disc Center".
  if (!doctorCase) {
    const words = s.split(" ");
    let end = words.length;
    while (end > 0 && GENERIC.has(words[end - 1].toLowerCase())) end--;
    const kept = words.slice(0, end);
    const distinctive = kept.filter((w) => !GENERIC.has(w.toLowerCase()));
    if (kept.length >= 2 && kept.length < words.length && distinctive.length >= 1) s = kept.join(" ");
  }

  const words = s.split(" ").filter(Boolean);
  const distinctive = words.filter((w) => !GENERIC.has(w.toLowerCase()));
  const resembles = distinctive.every((w) => full.toLowerCase().includes(w.toLowerCase().replace(/\.$/, "")));
  const flagged =
    s.length < 3 || s.length > 45 || distinctive.length === 0 || !resembles || /\d/.test(s) || words.length > 6;
  return { name: s || full, flagged };
}

export function shortClinicFor(lead: { clinicName: string; shortClinicName: string | null }): ShortClinic {
  const stored = (lead.shortClinicName ?? "").trim();
  return stored !== "" ? { name: stored, flagged: false } : cleanClinicName(lead.clinicName);
}

// ─── The opener ────────────────────────────────────────────────────────────

export const OPENER_ANGLES = ["ads_landing", "booking_friction", "program_gap", "review_signal", "manual"] as const;
export type OpenerAngle = (typeof OPENER_ANGLES)[number];
export const OPENER_ANGLE_LABELS: Record<OpenerAngle, string> = {
  ads_landing: "Ads → landing",
  booking_friction: "Booking friction",
  program_gap: "Program + booking gap",
  review_signal: "Review signal",
  manual: "Manual",
};
export function readOpenerAngle(v: unknown): OpenerAngle | null {
  return typeof v === "string" && (OPENER_ANGLES as readonly string[]).includes(v) ? (v as OpenerAngle) : null;
}

export const OPENER_MAX_WORDS = 40;

export const BANNED_PHRASES = ["i work with", "i help", "we help", "clinics like yours", "boost", "grow your practice", "more patients"];
const BANNED_START = /^\s*(i noticed|i saw|i came across|quick question|random question)\b/i;
const COMPLIMENT = /\b(great|amazing|impressive|impressed|love|loved|beautiful|awesome|congrat\w*|fantastic|excellent|stellar|glowing|wonderful|outstanding|well[- ]designed|nice)\b/i;
const COMPARISON = /\b(most|many|other|typical)\s+(clinics|practices|offices|chiropractors)\b|\b(usually|typically|on average)\b/i;
const MEDICAL = /\b(cure[sd]?|heal(s|ed|ing)?|guarantee\w*|outcomes?|recover(y|ies)?|surgery[- ]free|pain[- ]free)\b/i;
const HEDGE = /\b(probably|presumably|i (?:imagine|bet|assume|suspect|guess)|chances are)\b/i;
// Internal processes nobody can see from outside.
const INFERRED = /\b(no|without|don'?t have|doesn'?t have|lacks?|lacking|missing)\b[^.]{0,40}\b(follow[- ]?ups?|reminders?|sequences?|nurtur\w*|crm|automation|text(?:ing)? back|call[- ]?backs?)\b/i;
const NEVER_LEAD = /\b(dated|outdated|old[- ]looking|social media|instagram|facebook page|tiktok|attribution|what'?s working)\b/i;

export function bannedPhraseIn(text: string): string | null {
  const t = text.toLowerCase().replace(/[’]/g, "'");
  return BANNED_PHRASES.find((p) => new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t)) ?? null;
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

// Digits in an opener: only inside a product name the clinic's own site or
// the cited evidence carries (DRX9000, X3-Laser). A bare number, a
// percentage or a dollar figure never.
export function numberReason(opener: string, sourceText: string): string | null {
  const source = sourceText.toLowerCase();
  for (const token of opener.match(/\S*\d\S*/g) ?? []) {
    const t = token.replace(/^[^A-Za-z0-9$]+|[^A-Za-z0-9%]+$/g, "");
    if (/[$%]/.test(t) || !/[A-Za-z]/.test(t)) return `it uses a number (“${t}”)`;
    if (!source.includes(t.toLowerCase())) return `“${t}” isn’t in the clinic’s cited evidence`;
  }
  return null;
}

// The screen a generated opener has to pass. Null: it passes.
export function openerReason(opener: string, ctx: { clinicName: string; sourceText: string }): string | null {
  const o = opener.trim();
  if (o === "") return "it is empty";
  if (o.includes("?")) return "it asks a question (the template carries the ask)";
  if (countWords(o) > OPENER_MAX_WORDS) return `it is over ${OPENER_MAX_WORDS} words`;
  const sentences = o.match(/[^.!]+[.!]+|[^.!]+$/g) ?? [o];
  if (sentences.filter((x) => x.trim() !== "").length > 2) return "it is more than two sentences";
  if (/^\s*(hi|hey|hello|dear)\b/i.test(o)) return "it starts with a greeting";
  if (BANNED_START.test(o)) return "it starts with a banned opening";
  const banned = bannedPhraseIn(o);
  if (banned) return `it uses “${banned}”`;
  if (ctx.clinicName.trim() && o.toLowerCase().includes(ctx.clinicName.trim().toLowerCase())) return "it writes the clinic’s full name";
  if (COMPLIMENT.test(o)) return "it pays a compliment";
  if (COMPARISON.test(o)) return "it compares the clinic to others";
  if (MEDICAL.test(o)) return "it makes a medical or outcome claim";
  if (HEDGE.test(o)) return "it guesses (“probably”, “I imagine”)";
  if (INFERRED.test(o)) return "it claims an internal process we can’t see from outside";
  if (NEVER_LEAD.test(o)) return "it leads with a never-lead topic (site looks, social, attribution)";
  return numberReason(o, ctx.sourceText);
}

// ─── The pre-send check ────────────────────────────────────────────────────

// The body without what comes after it: the opt-out line and the sign-off.
export function bodyBeforeOptOut(body: string, optOutLine: string): string {
  const cut = optOutLine.trim() !== "" ? body.lastIndexOf(optOutLine.trim()) : -1;
  return (cut === -1 ? body : body.slice(0, cut)).trim();
}

// Every reason the assembled Email 1 cannot be approved. Empty: it passes.
export function preSendCheck(
  subject: string,
  body: string,
  ctx: { optOutLine: string; clinicName: string },
): string[] {
  const out: string[] = [];
  const main = bodyBeforeOptOut(body, ctx.optOutLine);
  const words = countWords(main);
  if (words > 80) out.push(`The email is ${words} words — 80 at most.`);
  const q = (main.match(/\?/g) ?? []).length;
  if (q !== 1) out.push(`The email has ${q} question marks — exactly one.`);
  const left = Array.from(new Set(Array.from(`${subject}\n${main}`.matchAll(/\{(\w+)\}/g)).map((m) => m[0])));
  if (left.length > 0) out.push(`Unfilled: ${left.join(", ")}.`);
  const banned = bannedPhraseIn(main);
  if (banned) out.push(`It uses the banned phrase “${banned}”.`);
  const name = ctx.clinicName.trim().toLowerCase();
  if (name !== "") {
    const n = main.toLowerCase().split(name).length - 1;
    if (n > 1) out.push(`The clinic’s full name appears ${n} times — once at most.`);
  }
  if (/:/.test(subject)) out.push("The subject has a colon.");
  if (/["“”]|(^|\s)['‘’]|['‘’](\s|$)/.test(subject)) out.push("The subject has quote marks.");
  if (/\bre\b/i.test(subject.trim().split(/\s+/)[0] ?? "")) out.push("The subject starts with “Re”.");
  return out;
}

// ─── The inbox display name ────────────────────────────────────────────────

// amer@ signed as "Hamdi Domangcag": the local part names nobody in the
// display name. Role inboxes and blank names never warn.
export function inboxNameMismatch(address: string, displayName: string): boolean {
  const local = localPart(address).replace(/[^a-z]/g, "");
  const name = displayName.trim();
  if (local === "" || name === "" || ROLE_LOCAL.test(local)) return false;
  const parts = name.toLowerCase().split(/\s+/).map(slug).filter((p) => p.length >= 2);
  if (parts.length === 0) return false;
  if (parts.some((p) => local.includes(p) || (p.length >= 3 && p.includes(local)))) return false;
  const initials = parts.map((p) => p[0]).join("");
  if (local === initials || local === parts[0][0] + (parts[parts.length - 1] ?? "")) return false;
  return true;
}
