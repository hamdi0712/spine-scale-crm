// Re-clean owner names and email labels — free: no NPI Registry, Hunter or
// Instantly call. Server-only; Settings → Email's button runs it
// (src/lib/actions/ownerFind.ts).
//
// For every email lead:
//   1. The doctors the stored crawl names are read again with today's
//      cleanup (src/lib/ownerFind.ts, siteDoctorNames), and the owner decided
//      again from the NPI official the lead already stores. A lead waiting on
//      a pick that now has one doctor is confirmed; a site-confirmed owner
//      whose name was page words ("Dr. Plasker Conditions We") gets the
//      clean one. An owner picked by hand is never touched, and nothing is
//      re-decided on a lead whose emails have gone out.
//   2. The main address and the alternates are labelled owner or front desk
//      again (src/lib/emailFind.ts, classifyAddress). The check status is
//      kept. A label set by hand, or an address typed by hand, is left alone.

import { prisma } from "@/lib/prisma";
import { classifyAddress, parseAlternates, readDecisionMakerName } from "@/lib/emailFind";
import { cleanDoctorName, decideOwnerFrom, parseOwnerChoices, readOwnerSource, siteDoctorNames } from "@/lib/ownerFind";
import { rebuildDraft, setOwnerAsContact } from "@/lib/ownerFindRun";

export interface RecleanChange {
  leadId: string;
  clinicName: string;
  what: string;
}

export interface RecleanResult {
  scanned: number;
  confirmed: number;
  renamed: number;
  relabelled: number;
  changes: RecleanChange[];
}

export async function recleanEmailLeads(): Promise<RecleanResult> {
  const leads = await prisma.lead.findMany({
    where: { channel: "email" },
    include: { emailSends: { select: { id: true } } },
    orderBy: { clinicName: "asc" },
  });
  const out: RecleanResult = { scanned: leads.length, confirmed: 0, renamed: 0, relabelled: 0, changes: [] };
  const note = (lead: { id: string; clinicName: string }, what: string) => out.changes.push({ leadId: lead.id, clinicName: lead.clinicName, what });

  for (const lead of leads) {
    let contactName = lead.contactName;
    const sent = lead.emailSends.length > 0;

    // ─── 1. The owner's name ────────────────────────────────────────────
    const manual = readOwnerSource(lead.ownerSource) === "manual";
    if (!manual && !sent && lead.ownerCheckedAt) {
      const siteNames = siteDoctorNames(lead.websiteNotes, lead.websiteLinks);
      const d = decideOwnerFrom(lead.npiOfficialName, lead.npiOfficialTitle, lead.npiNumber !== null, siteNames);
      const wasSite = lead.ownerStatus === "confirmed" && readOwnerSource(lead.ownerSource) === "site";
      const choices = d.choices.length > 0 ? d.choices : siteNames;
      const choicesJson = choices.length > 0 ? JSON.stringify(choices) : null;

      if (lead.ownerStatus === "pick" && d.status === "confirmed" && d.name) {
        await prisma.lead.update({ where: { id: lead.id }, data: { ownerStatus: "confirmed", ownerSource: d.source, ownerSiteNames: choicesJson } });
        await setOwnerAsContact(lead.id, d.name, null);
        note(lead, `Owner confirmed: ${d.name} (was a pick between ${parseOwnerChoices(lead.ownerSiteNames).join(", ")})`);
        out.confirmed++;
        contactName = d.name;
      } else if (lead.ownerStatus === "pick" && d.status === "pick" && choicesJson !== lead.ownerSiteNames) {
        await prisma.lead.update({ where: { id: lead.id }, data: { ownerSiteNames: choicesJson } });
        note(lead, `Names to pick from cleaned: ${choices.join(", ")}`);
      } else if (wasSite && d.status === "confirmed" && d.name && d.name !== lead.contactName) {
        await prisma.lead.update({ where: { id: lead.id }, data: { ownerSource: d.source, ownerSiteNames: choicesJson } });
        await setOwnerAsContact(lead.id, d.name, null);
        note(lead, `Owner renamed: ${lead.contactName ?? "—"} → ${d.name}`);
        out.renamed++;
        contactName = d.name;
      } else if (wasSite && d.status !== "confirmed" && lead.contactName && cleanDoctorName(lead.contactName) === null) {
        // The "doctor" was page words ("Dr. Physical Therapists").
        await prisma.lead.update({
          where: { id: lead.id },
          data: { ownerStatus: d.status, ownerSource: null, ownerSiteNames: choicesJson, contactName: null, contactConfirmedAt: null },
        });
        await rebuildDraft(lead.id);
        note(lead, `Removed "${lead.contactName}" — not a name; ${d.status === "pick" ? "pick the owner" : "owner not found"}`);
        out.renamed++;
        contactName = null;
      }
    }

    // A contact name with page words on the end, whatever set it.
    if (!manual && !sent && contactName && /^dr\.?\s/i.test(contactName) && contactName === lead.contactName) {
      const clean = cleanDoctorName(contactName);
      if (clean && clean !== contactName && clean.split(" ").length >= 3) {
        await setOwnerAsContact(lead.id, clean, null);
        note(lead, `Contact renamed: ${contactName} → ${clean}`);
        out.renamed++;
        contactName = clean;
      }
    }

    // ─── 2. The labels ──────────────────────────────────────────────────
    if (lead.emailTypeByHand || lead.emailSource === "manual") continue;
    const person = readDecisionMakerName(contactName);
    const data: { emailType?: string; emailAlternates?: string } = {};
    const flips: string[] = [];
    if (lead.email && (lead.emailType === "owner" || lead.emailType === "generic")) {
      const type = classifyAddress(lead.email, person);
      if (type !== lead.emailType) {
        data.emailType = type;
        flips.push(`${lead.email} → ${type === "owner" ? "owner" : "generic"}`);
      }
    }
    const alternates = parseAlternates(lead.emailAlternates);
    let altChanged = false;
    const relabelled = alternates.map((a) => {
      const type = classifyAddress(a.address, person);
      if (type === a.type) return a;
      altChanged = true;
      flips.push(`${a.address} → ${type === "owner" ? "owner" : "generic"}`);
      return { ...a, type };
    });
    if (altChanged) data.emailAlternates = JSON.stringify(relabelled);
    if (flips.length === 0) continue;
    await prisma.lead.update({ where: { id: lead.id }, data });
    // The main address now reaches someone else: an unsent draft follows it.
    if (data.emailType && !sent && !lead.emailVersion) await rebuildDraft(lead.id);
    note(lead, `Relabelled ${flips.join(", ")}`);
    out.relabelled++;
  }
  return out;
}
