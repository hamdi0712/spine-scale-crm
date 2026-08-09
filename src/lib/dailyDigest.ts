// AI notes — what the model is asked about the agency's day, and how its
// answer is read.
//
// The dashboard already answers "what is going on" twice: four KPI cards count
// things, and Today's focus lists what is due (src/lib/focus.ts). Neither says
// which of it matters most this morning, because both are rules — a list
// ordered by urgency cannot tell you that three overdue follow-ups matter less
// today than the one client who has just gone At risk. That judgement is the
// whole feature, and it is the only thing the model is asked for.
//
// It is held to the same rule as every other assist in this app:
//
//   It reads counts, not records. The snapshot below is five numbers and a
//   short list of client names — no contact details, no notes anybody typed,
//   no lead-level anything. A paragraph about the agency's day needs the shape
//   of the day, and the shape is countable.
//
//   It changes nothing. There is no action attached to the note, nothing is
//   marked read, and nothing downstream reads it back. It is a paragraph on a
//   dashboard, and the links beside it are the ones that were always there.
//
//   The numbers are counted, not asked for. Everything in the snapshot is
//   worked out from the database by src/lib/actions/dailyDigest.ts; the model
//   is given them and told to weigh them. Nothing it writes is allowed to be
//   the source of a number — which is why the counts are shown under the note
//   as well, in the app's own words.
//
// Nothing here touches the network or the database: building the prompt,
// reading the reply and judging a cached note's age are all pure.

// The one row's id, on the same terms as PIPELINE_SETTINGS_ID: a fixed string
// rather than "the first row", so every read is a findUnique and every write an
// upsert of the same record.
export const DAILY_DIGEST_ID = "singleton";

// How long a note stands before the dashboard writes a new one. Four hours is
// "a morning" or "an afternoon" — long enough that opening the dashboard
// repeatedly costs nothing, short enough that a note written before lunch is
// not still being read at five o'clock as though it were current.
//
// It is deliberately the only freshness rule. The alternative — regenerating
// whenever any number changes — would spend a call every time a follow-up was
// ticked off, and the paragraph would still be about the same day.
export const DIGEST_MAX_AGE_MS = 4 * 60 * 60 * 1000;

// One short paragraph. The prompt asks for three sentences; this is the
// ceiling that keeps a model which ignored that from reflowing the card.
const BODY_MAX_CHARS = 700;

// How many at-risk clients are named in the prompt. Past a handful the names
// stop being the point — "nine clients are at risk" is the sentence that
// matters, and it is in the count either way.
export const DIGEST_MAX_NAMED_CLIENTS = 5;

// ─── What it reads ─────────────────────────────────────────────────────────

// The day, in numbers. Everything here is counted from the records that own it
// at the moment the digest is written, and nothing else about those records
// travels: a client contributes its clinic name and the reason it is at risk,
// and a lead or a candidate contributes nothing but its place in a total.
export interface DigestSnapshot {
  activeClients: number;
  // Named, because "Ridgeline Spine has been at risk since Tuesday" is the
  // sentence somebody acts on and "one client is at risk" is not. Capped at
  // DIGEST_MAX_NAMED_CLIENTS; atRisk is the true count either way.
  atRisk: number;
  atRiskNames: { clinicName: string; reason: string }[];
  // Follow-ups whose date has already passed, on open leads. Deliberately not
  // the dashboard's "due in 7 days" KPI: a follow-up due on Thursday is not a
  // thing that needs attention today, and one that was due last Thursday is.
  overdueFollowUps: number;
  // Calls still marked Scheduled whose time has passed.
  overdueCalls: number;
  // Candidates waiting on a queue run — the work Discovery has not started.
  discoveryQueue: number;
  // Candidates promoted to the pipeline in the last DIGEST_PROMOTION_DAYS.
  recentPromotions: number;
}

// The window "recent promotions" is counted over. A week: short enough to be
// news, long enough that a quiet Monday does not read as a dead pipeline.
export const DIGEST_PROMOTION_DAYS = 7;

export type DigestResult =
  | { ok: true; body: string; snapshot: DigestSnapshot; generatedAt: string }
  | { ok: false; error: string };

// A note as the dashboard holds it: the paragraph, what it was written from,
// and when. Null where nothing has been written yet.
export interface CachedDigest {
  body: string;
  snapshot: DigestSnapshot;
  generatedAt: Date;
}

// Whether a cached note still stands. A missing note is stale by definition,
// which is what makes the dashboard write its first one.
export function isDigestFresh(
  digest: CachedDigest | null,
  now: Date = new Date(),
): boolean {
  if (!digest) return false;
  const age = now.getTime() - digest.generatedAt.getTime();
  // A note dated in the future is a clock that moved, not a fresh note. Read as
  // stale rather than trusted for the next four hours.
  return age >= 0 && age < DIGEST_MAX_AGE_MS;
}

// ─── The prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = [
  "You write one short internal note for the person running a small marketing agency that serves chiropractic and non-surgical spine clinics.",
  "You are given the day's numbers and nothing else. You never invent a number, a client, or an event that is not in them, and you never restate every number back — you say which of them matters most today and why.",
  "You write plainly and without encouragement. No greetings, no praise, no exhortation, and no sign-off: this is a note on a dashboard, not a message to somebody.",
  // The lowercase "json" is load-bearing, exactly as it is in
  // src/lib/icpAssist.ts — DeepSeek refuses a response_format json_object
  // request unless the word appears in a prompt. Anyone rewriting this has to
  // keep it.
  "You reply with a single JSON object in exactly the shape requested, and nothing else — your reply is parsed as json, so any prose around it breaks it.",
].join(" ");

export function buildDigestPrompt(snapshot: DigestSnapshot): {
  system: string;
  user: string;
} {
  return { system: SYSTEM_PROMPT, user: userPrompt(snapshot) };
}

function userPrompt(snapshot: DigestSnapshot): string {
  return [
    "TODAY'S NUMBERS",
    "Counted from the agency's own records just now. This is everything you have.",
    "",
    ...stateLines(snapshot),
    "",
    "TASK",
    "Write one paragraph of at most three sentences saying what most needs attention today.",
    "",
    "Rules:",
    "- Lead with the single thing that most needs attention, and say why it is that one rather than the others.",
    "- An at-risk client outranks overdue admin: a client losing money is a relationship, and an overdue follow-up is a task.",
    "- Name clinics where naming them makes the sentence actionable. Use the names exactly as given.",
    "- Where a number is zero, that is worth a clause only if its being zero is the notable thing (an empty discovery queue, say). Never list zeros.",
    "- If nothing needs attention, say so in one sentence and stop. A quiet day is a real answer and padding it out is not.",
    "- Do not suggest anything the numbers do not support, and do not recommend a specific commercial action — you have no visibility into what has already been tried.",
    "",
    "REPLY FORMAT",
    "A single JSON object, exactly these keys:",
    "{",
    '  "note": "<at most 3 sentences>"',
    "}",
    "",
    `The note is plain prose under ${BODY_MAX_CHARS} characters, with no markdown, no bullet points and no headings.`,
  ].join("\n");
}

// The numbers, with their absences named. A zero is written as a zero rather
// than left out, so the model reads "no clients are at risk" instead of
// deciding for itself whether silence meant none or meant unchecked.
function stateLines(snapshot: DigestSnapshot): string[] {
  const lines = [
    `Active clients: ${snapshot.activeClients}`,
    `Clients at risk: ${snapshot.atRisk}`,
  ];
  for (const client of snapshot.atRiskNames) {
    lines.push(`  - ${client.clinicName} — ${client.reason}`);
  }
  if (snapshot.atRisk > snapshot.atRiskNames.length) {
    lines.push(
      `  - and ${snapshot.atRisk - snapshot.atRiskNames.length} more, not named here`,
    );
  }
  lines.push(
    `Follow-ups overdue: ${snapshot.overdueFollowUps}`,
    `Calls overdue: ${snapshot.overdueCalls}`,
    `Candidates waiting in the Discovery queue: ${snapshot.discoveryQueue}`,
    `Candidates promoted to the pipeline in the last ${DIGEST_PROMOTION_DAYS} days: ${snapshot.recentPromotions}`,
  );
  return lines;
}

// ─── Reading the reply ─────────────────────────────────────────────────────

// The model's JSON, held to the one string the card shows. Returns null when
// nothing usable came back — an unparseable reply, or one with no note in it —
// which the action reports as a malformed answer.
export function parseDigestNote(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const note = (parsed as Record<string, unknown>).note;
  if (typeof note !== "string") return null;
  const trimmed = note.trim();
  if (trimmed === "") return null;
  return trimmed.length > BODY_MAX_CHARS
    ? `${trimmed.slice(0, BODY_MAX_CHARS)}…`
    : trimmed;
}

// ─── The stored snapshot ───────────────────────────────────────────────────

export function serializeSnapshot(snapshot: DigestSnapshot): string {
  return JSON.stringify(snapshot);
}

// Reads a stored snapshot back. Never throws: a row written by an older shape
// comes back with zeros in the fields it did not have, which is the honest
// reading — the note is still the note, and the counts under it are only ever
// context for it.
export function parseDigestSnapshot(raw: string | null | undefined): DigestSnapshot {
  const empty: DigestSnapshot = {
    activeClients: 0,
    atRisk: 0,
    atRiskNames: [],
    overdueFollowUps: 0,
    overdueCalls: 0,
    discoveryQueue: 0,
    recentPromotions: 0,
  };
  if (!raw) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return empty;
  }
  const body = parsed as Record<string, unknown>;
  const count = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;
  return {
    activeClients: count(body.activeClients),
    atRisk: count(body.atRisk),
    atRiskNames: readNames(body.atRiskNames),
    overdueFollowUps: count(body.overdueFollowUps),
    overdueCalls: count(body.overdueCalls),
    discoveryQueue: count(body.discoveryQueue),
    recentPromotions: count(body.recentPromotions),
  };
}

function readNames(raw: unknown): { clinicName: string; reason: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): { clinicName: string; reason: string }[] => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const entry = item as Record<string, unknown>;
    if (typeof entry.clinicName !== "string") return [];
    return [
      {
        clinicName: entry.clinicName,
        reason: typeof entry.reason === "string" ? entry.reason : "",
      },
    ];
  });
}

// ─── Naming the clinic in the sentence ─────────────────────────────────────

// One run of the note's text, and whether it is a clinic the note was handed by
// name. The card renders an entity run as a tinted chip and everything else as
// prose.
export interface NoteSegment {
  text: string;
  entity: boolean;
}

// Splits the note around the clinic names it was given.
//
// Only names from the snapshot are marked, and that limit is the feature rather
// than a shortcut: those are the clinics the app itself named in the prompt, so
// a chip is the app recognising its own record rather than the card guessing at
// which capitalised words in a generated paragraph are real. A clinic the model
// mentioned that was never in the snapshot stays plain text — as it should,
// since nothing here can vouch for it.
//
// Matching is case-insensitive but the note's own casing is what renders, and a
// name only matches on word boundaries: "Harbor Chiropractic" must not light up
// inside "Harborview Chiropractic". Longest names first, so a clinic whose name
// contains another clinic's name is chipped whole.
export function segmentNote(body: string, names: string[]): NoteSegment[] {
  const wanted = Array.from(
    new Set(names.map((n) => n.trim()).filter((n) => n !== "")),
  ).sort((a, b) => b.length - a.length);
  if (wanted.length === 0) return [{ text: body, entity: false }];

  const haystack = body.toLowerCase();
  const segments: NoteSegment[] = [];
  let plain = "";
  let i = 0;

  const push = (text: string, entity: boolean) => {
    if (text !== "") segments.push({ text, entity });
  };

  while (i < body.length) {
    const hit = wanted.find((name) => {
      const lower = name.toLowerCase();
      if (!haystack.startsWith(lower, i)) return false;
      return (
        !isWordChar(body[i - 1]) && !isWordChar(body[i + name.length])
      );
    });
    if (hit) {
      push(plain, false);
      plain = "";
      push(body.slice(i, i + hit.length), true);
      i += hit.length;
      continue;
    }
    plain += body[i];
    i += 1;
  }
  push(plain, false);
  return segments;
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9]/.test(char);
}

// What the note was written from, in the app's own words, for the line under
// it. The counts are shown rather than only sent, so a paragraph that got a
// number wrong is caught by the reader rather than believed.
export function digestBasedOn(snapshot: DigestSnapshot): string[] {
  const plural = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`;
  return [
    plural(snapshot.activeClients, "active client", "active clients"),
    plural(snapshot.atRisk, "at risk", "at risk"),
    plural(snapshot.overdueFollowUps, "follow-up overdue", "follow-ups overdue"),
    plural(snapshot.overdueCalls, "call overdue", "calls overdue"),
    plural(snapshot.discoveryQueue, "in the queue", "in the queue"),
    plural(
      snapshot.recentPromotions,
      `promoted in ${DIGEST_PROMOTION_DAYS}d`,
      `promoted in ${DIGEST_PROMOTION_DAYS}d`,
    ),
  ];
}
