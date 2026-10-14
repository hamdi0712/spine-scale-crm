// ICP Definition — who this agency is for, as the operator wrote it.
//
// The new scoring model (src/lib/icpScoring.ts) judges a clinic against
// whichever of these is active, and step 2 of the outreach sequence reads its
// pain points. Everything here is pure: the shape, the normalisation, and the
// reading of a stored row. src/lib/icpDefinitionStore.ts does the loading and
// src/lib/actions/icpDefinition.ts the saving, and both come through here.
//
// One rule governs the tag lists, and it is applied on every way in — the
// form, the seed, a hand-edited row: a tag is trimmed, its inner whitespace
// collapsed, lowercased, and kept once. "Spinal Decompression " and
// "spinal decompression" are the same service, and a scorer matching against
// a list that held both would be matching against a list nobody meant to
// write.
//
// The three long texts are prose and are stored as typed. Disqualifiers and
// buying triggers are read one per line (disqualifierLines, buyingTriggerLines)
// because each line is one thing the scorer is asked about by number.

export const ICP_TAG_FIELDS = [
  "targetTitles",
  "coreServices",
  "adjacentServices",
  "targetLocations",
] as const;

export type IcpTagField = (typeof ICP_TAG_FIELDS)[number];

export const ICP_TAG_FIELD_LABELS: Record<IcpTagField, string> = {
  targetTitles: "Target titles",
  coreServices: "Core services",
  adjacentServices: "Adjacent services",
  targetLocations: "Target locations",
};

// What each list is for, in the one line the edit page shows under it.
export const ICP_TAG_FIELD_HINTS: Record<IcpTagField, string> = {
  targetTitles:
    "The decision-maker roles worth reaching. Matched against the contact's title and any named person on the clinic's site.",
  coreServices:
    "A cited match on any of these earns the full service points.",
  adjacentServices:
    "Earn service points only with cited evidence of a spine, disc or back-pain program as well.",
  targetLocations:
    "Countries, states or metros. A clinic outside all of them earns no location points.",
};

export const ICP_TAG_PLACEHOLDERS: Record<IcpTagField, string> = {
  targetTitles: "e.g. clinic director",
  coreServices: "e.g. spinal decompression",
  adjacentServices: "e.g. chiropractic",
  targetLocations: "e.g. united states",
};

// Held to sizes a form can show and a prompt can carry. Generous: these are
// ceilings against a runaway paste, not limits anybody should meet.
export const ICP_NAME_MAX = 80;
export const ICP_TAG_MAX_CHARS = 80;
export const ICP_TAGS_MAX = 40;
export const ICP_LONG_TEXT_MAX = 6000;
export const ICP_SIZE_MAX = 1000;

export interface IcpDefinitionData {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  targetTitles: string[];
  coreServices: string[];
  adjacentServices: string[];
  targetLocations: string[];
  // In locations, not employees. Null is "no bound on this side".
  sizeMin: number | null;
  sizeMax: number | null;
  painPoints: string;
  buyingTriggers: string;
  disqualifiers: string;
  updatedAt: string;
}

// ─── Normalising ───────────────────────────────────────────────────────────

export function normalizeTag(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().toLowerCase().slice(0, ICP_TAG_MAX_CHARS);
}

// Trim, lowercase, de-duplicate, drop the empties, keep the order they were
// written in. Takes unknown because it is the gate for a posted form and for a
// stored JSON column alike.
export function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const tag = normalizeTag(item);
    if (tag === "" || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= ICP_TAGS_MAX) break;
  }
  return out;
}

// A stored JSON column back into a list. Anything that is not a JSON array of
// strings reads as an empty list rather than as an exception.
export function readTagList(json: unknown): string[] {
  if (Array.isArray(json)) return normalizeTags(json);
  if (typeof json !== "string" || json.trim() === "") return [];
  try {
    return normalizeTags(JSON.parse(json));
  } catch {
    return [];
  }
}

export function serializeTags(tags: string[]): string {
  return JSON.stringify(normalizeTags(tags));
}

// A size bound as it will be used: a whole number of locations, or null.
export function readSize(raw: unknown): number | null {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw)
        : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(Math.round(n), 0), ICP_SIZE_MAX);
}

// The two bounds, put the right way round. A min typed above the max is
// somebody who swapped the fields, not somebody who wants a range nothing can
// fall in.
export function orderedSize(
  min: number | null,
  max: number | null,
): { sizeMin: number | null; sizeMax: number | null } {
  if (min !== null && max !== null && min > max) {
    return { sizeMin: max, sizeMax: min };
  }
  return { sizeMin: min, sizeMax: max };
}

export function readLongText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  // Line endings normalised so a line count is a line count on every OS.
  return raw.replace(/\r\n?/g, "\n").trim().slice(0, ICP_LONG_TEXT_MAX);
}

export function readName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, ICP_NAME_MAX);
}

// One item per non-empty line, with any bullet somebody typed in front of it
// taken off — "- Outside the US" and "Outside the US" are the same line.
function lines(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[-*•–]|\d+[.)])\s*/, "").trim();
    if (line === "") continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

export function disqualifierLines(icp: Pick<IcpDefinitionData, "disqualifiers">): string[] {
  return lines(icp.disqualifiers);
}

export function buyingTriggerLines(
  icp: Pick<IcpDefinitionData, "buyingTriggers">,
): string[] {
  return lines(icp.buyingTriggers);
}

// One buying trigger line, read for its strength tag. "[strong]" is worth
// TRIGGER_POINTS.strong, "[medium]" — or no tag — TRIGGER_POINTS.medium. The
// tag is taken off the label the scorer and the card show.
export const TRIGGER_POINTS = { strong: 10, medium: 5 } as const;
export type TriggerStrength = keyof typeof TRIGGER_POINTS;

export interface BuyingTrigger {
  label: string;
  strength: TriggerStrength;
  points: number;
  // Hiring, a new location, provider or device, a seminar: only news while it
  // is new, so it scores only with a date or "new / now / coming soon".
  timeBased: boolean;
  // A trigger about running ads. Ads are scored in Budget Signal and the chiro
  // program check; a trigger line about them never scores a second time.
  aboutAds: boolean;
}

const STRENGTH_TAG = /\[\s*(strong|medium)\s*\]/i;
const TIME_BASED_TRIGGER = /\b(hir(e|es|ed|ing)|jobs?|careers?|recruit\w*|open(ed|ing)|expan\w*|seminars?|workshops?|webinars?|events?|talks?|lunch\s+(and|&)\s+learn)\b|\b(new|added|adding|another)\b[\w\s-]{0,40}\b(locations?|offices?|clinics?|providers?|doctors?|chiropractors?|associates?|devices?|equipment|machines?|tables?|lasers?|technology|staff)\b/i;
const AD_TRIGGER = /\b(ads?|advertis\w*|meta|facebook|instagram|ppc|google\s+ads)\b/i;

export function parseBuyingTrigger(line: string): BuyingTrigger {
  const tag = line.match(STRENGTH_TAG);
  const strength: TriggerStrength = tag && tag[1].toLowerCase() === "strong" ? "strong" : "medium";
  const label = line.replace(STRENGTH_TAG, "").replace(/\s{2,}/g, " ").trim();
  return {
    label,
    strength,
    points: TRIGGER_POINTS[strength],
    timeBased: TIME_BASED_TRIGGER.test(label),
    aboutAds: AD_TRIGGER.test(label),
  };
}

export function buyingTriggers(icp: Pick<IcpDefinitionData, "buyingTriggers">): BuyingTrigger[] {
  return buyingTriggerLines(icp).map(parseBuyingTrigger);
}

// What a time-based trigger's quote must show to count: a visible date, or
// explicit newness. "We offer seminars" is not a trigger; "Seminar — March 12"
// or "Now hiring" is.
const MONTH = "(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const VISIBLE_DATE = new RegExp(
  `\\b(${MONTH}\\s+\\d{1,2}(st|nd|rd|th)?(,?\\s+20\\d\\d)?|\\d{1,2}\\s+${MONTH}|${MONTH}\\s+20\\d\\d|\\d{1,2}[/.-]\\d{1,2}[/.-](20)?\\d\\d|20\\d\\d-\\d\\d-\\d\\d|(19|20)\\d\\d)\\b`,
  "i",
);
const NEWNESS = /\b(new|newly|now|coming\s+soon|just\s+(opened|joined|arrived|added|launched)|grand\s+opening|opening\s+soon|upcoming)\b/i;

export function showsRecency(quote: string): boolean {
  return VISIBLE_DATE.test(quote) || NEWNESS.test(quote);
}

// ─── Reading a row ─────────────────────────────────────────────────────────

export function readIcpDefinition(row: {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  targetTitles: string;
  coreServices: string;
  adjacentServices: string;
  targetLocations: string;
  sizeMin: number | null;
  sizeMax: number | null;
  painPoints: string;
  buyingTriggers: string;
  disqualifiers: string;
  updatedAt: Date;
}): IcpDefinitionData {
  const { sizeMin, sizeMax } = orderedSize(readSize(row.sizeMin), readSize(row.sizeMax));
  return {
    id: row.id,
    name: readName(row.name) || "Untitled ICP",
    description: row.description ?? "",
    isActive: row.isActive === true,
    targetTitles: readTagList(row.targetTitles),
    coreServices: readTagList(row.coreServices),
    adjacentServices: readTagList(row.adjacentServices),
    targetLocations: readTagList(row.targetLocations),
    sizeMin,
    sizeMax,
    painPoints: row.painPoints ?? "",
    buyingTriggers: row.buyingTriggers ?? "",
    disqualifiers: row.disqualifiers ?? "",
    updatedAt: row.updatedAt.toISOString(),
  };
}

// "1–9 locations", "10+ locations", "any size". The one sentence the list page
// and the scorer both describe the band with.
export function sizeRangeLabel(icp: Pick<IcpDefinitionData, "sizeMin" | "sizeMax">): string {
  const { sizeMin: min, sizeMax: max } = icp;
  const unit = (n: number) => (n === 1 ? "location" : "locations");
  if (min === null && max === null) return "any size";
  if (min !== null && max !== null) {
    return min === max ? `${min} ${unit(min)}` : `${min}–${max} locations`;
  }
  if (min !== null) return `${min}+ ${unit(min)}`;
  return `up to ${max} ${unit(max!)}`;
}

export function sizeInRange(
  count: number,
  icp: Pick<IcpDefinitionData, "sizeMin" | "sizeMax">,
): boolean {
  if (icp.sizeMin !== null && count < icp.sizeMin) return false;
  if (icp.sizeMax !== null && count > icp.sizeMax) return false;
  return true;
}
