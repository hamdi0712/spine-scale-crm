// The same doctor or clinic on more than one lead — a warning, never a block,
// and never merged. Pure; read by the lead page ("Also on: …" chips) and the
// Pipeline rows (a Duplicate marker).
//
// Two leads are the same when either:
//   - their websites are on the same domain (straussmethod.com), leaving out
//     hosts many clinics share — Facebook pages, site builders, directories —
//     and free mail; or
//   - their contacts are the same person (first and last name) in the same
//     state (Dr. Steven Shoshany, NY), read off each lead's location.
// A lone surname ("Dr. Lee") never matches on its own: too many share one.

import { clinicDomain, isMailboxProvider, readDecisionMakerName } from "@/lib/emailFind";
import { stateFromLocation } from "@/lib/ownerFind";
import { LEAD_STAGE_LABELS, LeadStage } from "@/lib/constants";
import { LEAD_CHANNEL_LABELS, LeadChannel } from "@/lib/emailChannel";

export interface DuplicateLead {
  id: string;
  clinicName: string;
  channel: string;
  stage: string;
  websiteUrl: string | null;
  contactName: string | null;
  location: string | null;
}

export interface DuplicateMatch {
  id: string;
  clinicName: string;
  channel: string;
  stage: string;
  // Why: the same website domain, or the same person in the same state.
  by: "domain" | "person";
  // "LinkedIn · Contacted", for the chip.
  label: string;
}

// Hosts many unrelated clinics sit on: a shared domain says nothing.
const SHARED_HOSTS = [
  "facebook.com", "fb.com", "instagram.com", "linktr.ee", "linkedin.com", "google.com", "business.site", "g.page",
  "wixsite.com", "wix.com", "squarespace.com", "weebly.com", "wordpress.com", "godaddysites.com", "square.site",
  "yelp.com", "healthgrades.com", "zocdoc.com", "vitals.com", "webmd.com", "chiro.org", "chiropractic.net",
];

export function siteKey(websiteUrl: string | null | undefined): string | null {
  const d = clinicDomain(websiteUrl);
  if (!d || isMailboxProvider(d)) return null;
  if (SHARED_HOSTS.some((h) => d === h || d.endsWith(`.${h}`))) return null;
  return d;
}

// "steven shoshany|NY": a full name and a state, or nothing.
export function personKey(contactName: string | null | undefined, location: string | null | undefined): string | null {
  const p = readDecisionMakerName(contactName);
  const state = stateFromLocation(location);
  if (!p || !p.first || !p.last || !state) return null;
  return `${p.first} ${p.last}|${state}`;
}

function labelOf(l: { channel: string; stage: string }): string {
  const channel = LEAD_CHANNEL_LABELS[l.channel as LeadChannel] ?? l.channel;
  const stage = LEAD_STAGE_LABELS[l.stage as LeadStage] ?? l.stage;
  return `${channel} · ${stage}`;
}

// Every lead's matches among the others, built once for a whole list.
export function duplicateIndex(leads: DuplicateLead[]): Map<string, DuplicateMatch[]> {
  const bySite = new Map<string, DuplicateLead[]>();
  const byPerson = new Map<string, DuplicateLead[]>();
  for (const l of leads) {
    const s = siteKey(l.websiteUrl);
    if (s) bySite.set(s, [...(bySite.get(s) ?? []), l]);
    const p = personKey(l.contactName, l.location);
    if (p) byPerson.set(p, [...(byPerson.get(p) ?? []), l]);
  }
  const out = new Map<string, DuplicateMatch[]>();
  for (const l of leads) {
    const found = new Map<string, DuplicateMatch>();
    const add = (others: DuplicateLead[] | undefined, by: DuplicateMatch["by"]) => {
      for (const o of others ?? []) {
        if (o.id === l.id || found.has(o.id)) continue;
        found.set(o.id, { id: o.id, clinicName: o.clinicName, channel: o.channel, stage: o.stage, by, label: labelOf(o) });
      }
    };
    const s = siteKey(l.websiteUrl);
    if (s) add(bySite.get(s), "domain");
    const p = personKey(l.contactName, l.location);
    if (p) add(byPerson.get(p), "person");
    if (found.size > 0) out.set(l.id, Array.from(found.values()));
  }
  return out;
}

// One lead's matches.
export function duplicatesOf(lead: DuplicateLead, others: DuplicateLead[]): DuplicateMatch[] {
  return duplicateIndex([lead, ...others.filter((o) => o.id !== lead.id)]).get(lead.id) ?? [];
}

// The fields a read needs, for prisma's select.
export const DUPLICATE_SELECT = { id: true, clinicName: true, channel: true, stage: true, websiteUrl: true, contactName: true, location: true } as const;

// How a match reads beside a lead. Only the same channel is a duplicate
// (two email leads, two LinkedIn leads): the same clinic worked on another
// channel is just where else it is — "On LinkedIn", "On Call" — neutral.
export interface MatchTag {
  kind: "duplicate" | "elsewhere";
  // "On LinkedIn" / "Duplicate"
  pill: string;
  // "Hudson Valley Scoliosis · LinkedIn · Contacted"
  tooltip: string;
  // The lead page's chip: "Also on LinkedIn: Hudson Valley Scoliosis · Contacted"
  chip: string;
  id: string;
}

export function matchTag(leadChannel: string, m: DuplicateMatch): MatchTag {
  const channel = LEAD_CHANNEL_LABELS[m.channel as LeadChannel] ?? m.channel;
  const stage = LEAD_STAGE_LABELS[m.stage as LeadStage] ?? m.stage;
  if (m.channel === leadChannel) {
    return { kind: "duplicate", pill: "Duplicate", tooltip: `${m.clinicName} · ${channel} · ${stage}`, chip: `Also on: ${m.clinicName} · ${channel} · ${stage}`, id: m.id };
  }
  return { kind: "elsewhere", pill: `On ${channel}`, tooltip: `${m.clinicName} · ${channel} · ${stage}`, chip: `Also on ${channel}: ${m.clinicName} · ${stage}`, id: m.id };
}
